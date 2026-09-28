# Foreman (working name)

One AI office manager for trade businesses. The owner talks to one assistant; underneath it runs specialist skills (estimator, follow-up, scheduler, why-us, nurture, onboarding), a deterministic pricing engine, company memory, routines on a schedule, and an approval gate in front of every side effect.

## How it's built

| Layer | Where | Notes |
|---|---|---|
| Pricing engine | `src/lib/domain/pricing` | Pure code, integer cents, tested. The LLM never computes a price. Models: per-unit, flat, material + markup + labor-as-%-of-material, material+labor. |
| Job lifecycle | `src/lib/domain/lifecycle` | 12 states, legal transitions enforced. `routines.ts` = the follow-up rules (reminders, chasers, thank-you, nurture). |
| Approval policy | `src/lib/domain/approvals` | Default: always ask. Per-action / per-routine "always allow" and dollar thresholds. |
| AI | `src/lib/ai` | `orchestrator.ts` (one loop, Claude tool use, prompt caching), `skills.ts` (specialist prompts), `tools.ts` (everything the AI can do), `actions.ts` (approval front door), `execute.ts` (what runs when approved), `scheduler.ts` + `runner.ts` (routines). |
| Memory | `src/lib/ai/memory.ts` + `memory_facts`, `memory_chunks`, `sops`, `price_book_items` | Exact facts in tables; freeform in pgvector via Voyage embeddings. |
| Integrations | `src/lib/integrations` | QuickBooks (OAuth, read always, writes gated), Quo SMS (API key), Google Gmail + Calendar (OAuth). Credentials AES-GCM encrypted at rest. |
| App | `src/app` | Home (dashboard + chat), Chat, Pipeline board, Approvals inbox, Job detail with estimate review, Customers, Settings, Onboarding interview, public estimate page `/e/[token]`. |
| DB | `supabase/migrations/0001_init.sql` | Multi-tenant with RLS; crew can't see money. |

## Setup (about 20 minutes)

1. **Supabase**: create a project → SQL editor → run `supabase/migrations/0001_init.sql`. Enable the `vector` extension if the script complains. Auth → enable Email (magic link). Copy URL, anon key, service role key into `.env.local`.
2. **Anthropic**: API key → `ANTHROPIC_API_KEY`.
3. **Voyage** (embeddings for memory search): key → `VOYAGE_API_KEY`. Optional — memory still saves without it, search falls back to keyword.
4. **Secrets**: `openssl rand -hex 32` → `CREDENTIALS_ENCRYPTION_KEY`; any long string → `CRON_SECRET`.
5. **QuickBooks**: in the Intuit developer app, add redirect URI `https://<your-domain>/api/oauth/quickbooks`. Client ID/secret → env.
6. **Google**: Cloud Console → OAuth client (web) → redirect URI `https://<your-domain>/api/oauth/google`; enable Gmail API + Calendar API. Client ID/secret → env.
7. **Quo**: API key from Quo settings; paste it in the app under Settings → Connections along with the sending number. Point Quo's "message received" webhook at `/api/webhooks/quo` (optional header `x-webhook-secret` = `QUO_WEBHOOK_SECRET`).
8. **Vercel**: import the repo, add all env vars, deploy. `vercel.json` schedules the routine runner every 10 minutes; set `CRON_SECRET` in Vercel too.

Local: `cp .env.example .env.local`, fill it in, `npm i --legacy-peer-deps`, `npm run dev`.

## First run

Sign in → create the company → the onboarding interview starts. Tell it how you quote; it proposes price book items into Approvals for your OK. Then try: *"New lead: Sarah, 801-555-0142, wants a 400 sq ft paver patio."*

## Guardrails to know

- Nothing outbound (text, email, estimate, calendar, QuickBooks write) executes without an approval row unless you've hit "Always allow" for that action/routine.
- QuickBooks writes are additionally off until you flip the toggle in Settings → Connections.
- Estimates: AI drafts → owner approves in the job page → AI asks to send → one more OK on the message → customer approves on the public page → job moves to Won and the scheduling/materials routines fire.

## Commands

`npm run dev` · `npm run build` · `npm test` · `npm run typecheck` · `npm run lint`
