-- ============================================================================
-- 0001_init.sql — core schema
-- Multi-tenant by company_id. Row-level security on every table.
-- Money is integer cents. Percentages are numeric fractions (0.5 = 50%).
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- Tenancy & users
-- ---------------------------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade text,                          -- 'landscaping', 'hvac', ...
  timezone text not null default 'America/Denver',
  phone text,
  email text,
  address jsonb,
  -- settings that must be exact, never freeform
  target_margin_pct numeric(5,4) not null default 0.40,
  default_tax_rate numeric(6,5) not null default 0,
  deposit_rule jsonb,                  -- {"kind":"pct","pct":0.5} | {"kind":"fixed","amountCents":...}
  approval_policy jsonb not null default '{"rules":[]}',
  onboarding_completed_at timestamptz,
  plan text not null default 'small',  -- small | medium | large
  created_at timestamptz not null default now()
);

create type member_role as enum ('owner', 'office', 'crew');

create table memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'owner',
  display_name text,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

-- helper: companies the current user belongs to
create or replace function my_company_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select company_id from memberships where user_id = auth.uid()
$$;

create or replace function my_role(cid uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from memberships where user_id = auth.uid() and company_id = cid
$$;

-- ---------------------------------------------------------------------------
-- Company memory
--   structured facts (exact) + freeform chunks (embedded) + SOPs
-- ---------------------------------------------------------------------------
create table memory_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  key text not null,                   -- 'services.offered', 'quoting.method', 'voice.tone'
  value jsonb not null,
  source text not null default 'onboarding',  -- onboarding | owner | ai_confirmed
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);

create table memory_chunks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null,                  -- 'past_job' | 'sop' | 'story' | 'faq' | 'note'
  title text,
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index memory_chunks_company_idx on memory_chunks(company_id);
create index memory_chunks_embedding_idx on memory_chunks using hnsw (embedding vector_cosine_ops);

create table sops (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null,
  trigger_hint text,                   -- when the AI should pull this in
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Price book
-- ---------------------------------------------------------------------------
create table price_book_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  description text,
  category text,
  model jsonb not null,                -- PricingModel (see src/lib/domain/pricing/types.ts)
  minimum_cents integer,
  taxable boolean not null default true,
  active boolean not null default true,
  quickbooks_item_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index price_book_company_idx on price_book_items(company_id) where active;

-- ---------------------------------------------------------------------------
-- Customers, jobs, activity
-- ---------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address jsonb,
  notes text,
  quickbooks_customer_id text,
  sms_opt_out boolean not null default false,
  email_opt_out boolean not null default false,
  created_at timestamptz not null default now()
);
create index customers_company_idx on customers(company_id);

create type job_state as enum (
  'lead','contacted','booked','met','estimating','estimate_sent',
  'won','scheduled','in_progress','complete','nurture','lost'
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  title text not null,
  state job_state not null default 'lead',
  source text,                         -- 'website', 'referral', 'google', ...
  site_address jsonb,
  visit_at timestamptz,
  start_at timestamptz,
  completed_at timestamptz,
  estimate_sent_at timestamptz,
  last_activity_at timestamptz not null default now(),
  visit_notes text,
  lost_reason text,
  calendar_event_id text,
  created_at timestamptz not null default now()
);
create index jobs_company_state_idx on jobs(company_id, state);

create table job_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  kind text not null,                  -- 'state_change' | 'message_in' | 'message_out' | 'note' | 'routine_fired' | 'approval'
  from_state job_state,
  to_state job_state,
  actor text not null,                 -- 'owner' | 'ai' | 'customer' | 'system'
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index job_events_job_idx on job_events(job_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Estimates
-- ---------------------------------------------------------------------------
create type estimate_status as enum ('draft','owner_approved','sent','customer_approved','declined','superseded');

create table estimates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  version integer not null default 1,
  status estimate_status not null default 'draft',
  -- inputs (what the engine was given) and outputs (what it computed) — both snapshotted
  input jsonb not null,                -- EstimateInput
  result jsonb not null,               -- EstimateResult
  total_cents integer not null,
  customer_summary text,               -- plain-English explanation for the customer
  quickbooks_estimate_id text,
  public_token text unique default encode(gen_random_bytes(16), 'hex'),
  owner_approved_at timestamptz,
  sent_at timestamptz,
  customer_decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, version)
);

-- ---------------------------------------------------------------------------
-- Messaging & approvals
-- ---------------------------------------------------------------------------
create type channel as enum ('sms','email','in_app');
create type msg_direction as enum ('inbound','outbound');
create type msg_status as enum ('draft','pending_approval','approved','sent','delivered','failed','rejected');

create table messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  channel channel not null,
  direction msg_direction not null,
  status msg_status not null default 'draft',
  subject text,
  body text not null,
  routine_id text,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index messages_company_idx on messages(company_id, created_at desc);

create type approval_status as enum ('pending','approved','rejected','expired');

create table approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  action text not null,                -- GatedAction
  routine_id text,
  amount_cents integer,
  summary text not null,               -- one line the owner reads
  payload jsonb not null,              -- exactly what will execute if approved
  status approval_status not null default 'pending',
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index approvals_pending_idx on approvals(company_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Routines (per-company copies of defaults) and scheduled firings
-- ---------------------------------------------------------------------------
create table routines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  routine_key text not null,           -- matches DEFAULT_ROUTINES id
  definition jsonb not null,           -- RoutineDef (editable copy)
  enabled boolean not null default true,
  unique (company_id, routine_key)
);

create table routine_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  routine_key text not null,
  due_at timestamptz not null,
  fired_at timestamptz,
  outcome text,                        -- 'approval_created' | 'auto_sent' | 'skipped' | 'error'
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (job_id, routine_key, due_at)
);
create index routine_runs_due_idx on routine_runs(due_at) where fired_at is null;

-- ---------------------------------------------------------------------------
-- Chat with the assistant
-- ---------------------------------------------------------------------------
create table conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null,                  -- 'user' | 'assistant' | 'tool'
  content jsonb not null,              -- Anthropic content blocks
  created_at timestamptz not null default now()
);
create index chat_messages_conv_idx on chat_messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Integrations
-- ---------------------------------------------------------------------------
create table integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text not null,              -- 'quickbooks' | 'quo' | 'google'
  external_id text,                    -- e.g. QBO realm id
  credentials jsonb not null,          -- encrypted at the app layer before insert
  scopes text[],
  writes_enabled boolean not null default false,
  connected_at timestamptz not null default now(),
  unique (company_id, provider)
);

-- ---------------------------------------------------------------------------
-- Usage metering (usage-based plans)
-- ---------------------------------------------------------------------------
create table usage_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null,                  -- 'llm_tokens' | 'sms' | 'email' | 'routine_run'
  quantity integer not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index usage_events_company_idx on usage_events(company_id, created_at);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'companies','memberships','memory_facts','memory_chunks','sops','price_book_items',
    'customers','jobs','job_events','estimates','messages','approvals','routines',
    'routine_runs','conversations','integrations','usage_events'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

alter table chat_messages enable row level security;

create policy companies_member on companies for all
  using (id in (select my_company_ids()))
  with check (id in (select my_company_ids()));
-- any signed-in user may create a company (they become its owner right after)
create policy companies_insert on companies for insert to authenticated
  with check (true);

create policy memberships_self on memberships for select
  using (company_id in (select my_company_ids()));
-- a user may add themselves as owner of a company that has no members yet
create policy memberships_bootstrap on memberships for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (select 1 from memberships m where m.company_id = memberships.company_id)
  );
-- owners manage other members
create policy memberships_owner on memberships for all
  using (my_role(company_id) = 'owner') with check (my_role(company_id) = 'owner');

-- generic member policies for tenant tables
do $$
declare t text;
begin
  foreach t in array array[
    'memory_facts','memory_chunks','sops','price_book_items','customers','jobs','job_events',
    'estimates','messages','approvals','routines','routine_runs','conversations','usage_events'
  ] loop
    execute format(
      'create policy %I_member on %I for all using (company_id in (select my_company_ids())) with check (company_id in (select my_company_ids()))',
      t, t);
  end loop;
end $$;

-- integrations: owner only
create policy integrations_owner on integrations for all
  using (my_role(company_id) = 'owner') with check (my_role(company_id) = 'owner');

create policy chat_messages_member on chat_messages for all
  using (conversation_id in (select id from conversations where company_id in (select my_company_ids())));

-- crew cannot see estimates or money
create policy estimates_not_crew on estimates as restrictive for select
  using (my_role(company_id) <> 'crew');

-- ---------------------------------------------------------------------------
-- Similarity search helper
-- ---------------------------------------------------------------------------
create or replace function match_memory(cid uuid, query vector(1536), k int default 8)
returns table (id uuid, kind text, title text, content text, similarity float)
language sql stable as $$
  select id, kind, title, content, 1 - (embedding <=> query) as similarity
  from memory_chunks
  where company_id = cid and embedding is not null
  order by embedding <=> query
  limit k
$$;

-- hardening
revoke execute on function public.my_company_ids() from anon;
revoke execute on function public.my_role(uuid) from anon;
alter function public.match_memory(uuid, vector, int) set search_path = public;
revoke execute on function public.match_memory(uuid, vector, int) from anon;
