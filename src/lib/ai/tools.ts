import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { computeEstimate, formatCents } from "@/lib/domain/pricing/engine";
import type { EstimateInput, PriceBookItem, PricingModel } from "@/lib/domain/pricing/types";
import { assertTransition, type JobState } from "@/lib/domain/lifecycle/states";
import { requestAction } from "./actions";
import { rememberChunk, searchMemory } from "./memory";
import { getIntegration } from "@/lib/integrations/registry";
import { scheduleRoutinesForState } from "./scheduler";

export interface ToolContext {
  db: SupabaseClient;
  companyId: string;
  userId: string;
  /** owner | office | crew */
  role: string;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  /** roles allowed to invoke; default all */
  roles?: string[];
  run: (ctx: ToolContext, input: never) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const money = z.number().int().describe("integer cents");
const pricingModel: z.ZodType<PricingModel> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unit"), unitPriceCents: money, unit: z.string() }),
  z.object({ kind: z.literal("flat"), priceCents: money }),
  z.object({
    kind: z.literal("material_markup"),
    materialCostCents: money,
    unit: z.string(),
    markupPct: z.number().min(0).max(5),
    laborPctOfMaterial: z.number().min(0).max(5),
    laborOnMarkedUp: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("material_plus_labor"),
    unit: z.string(),
    materialCostCents: money,
    materialMarkupPct: z.number().min(0).max(5),
    laborCostCents: money,
    laborMarkupPct: z.number().min(0).max(5),
  }),
]);

function def<T extends z.ZodTypeAny>(d: Omit<ToolDef, "run" | "schema"> & { schema: T; run: (ctx: ToolContext, input: z.infer<T>) => Promise<unknown> }): ToolDef {
  return d as unknown as ToolDef;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export const TOOLS: ToolDef[] = [
  def({
    name: "get_customer",
    description: "Look up a customer by name, phone, or email. Returns matches.",
    schema: z.object({ query: z.string() }),
    run: async (ctx, { query }) => {
      const q = `%${query}%`;
      const { data } = await ctx.db.from("customers").select("id,name,phone,email,address,notes,sms_opt_out,email_opt_out").eq("company_id", ctx.companyId).or(`name.ilike.${q},phone.ilike.${q},email.ilike.${q}`).limit(10);
      return data ?? [];
    },
  }),

  def({
    name: "create_lead",
    description: "Create a customer (if new) and a job in the 'lead' state. Use when a new inquiry comes in.",
    schema: z.object({
      customer: z.object({ name: z.string(), phone: z.string().optional(), email: z.string().optional(), address: z.string().optional() }),
      title: z.string().describe("Short job title, e.g. 'Backyard paver patio'"),
      source: z.string().optional(),
      notes: z.string().optional(),
    }),
    run: async (ctx, { customer, title, source, notes }) => {
      let customerId: string | undefined;
      if (customer.phone || customer.email) {
        const { data } = await ctx.db.from("customers").select("id").eq("company_id", ctx.companyId).or([customer.phone ? `phone.eq.${customer.phone}` : null, customer.email ? `email.eq.${customer.email}` : null].filter(Boolean).join(",")).limit(1).maybeSingle();
        customerId = data?.id;
      }
      if (!customerId) {
        const { data, error } = await ctx.db.from("customers").insert({ company_id: ctx.companyId, name: customer.name, phone: customer.phone ?? null, email: customer.email ?? null, address: customer.address ? { line1: customer.address } : null }).select("id").single();
        if (error) throw error;
        customerId = data.id;
      }
      const { data: job, error } = await ctx.db.from("jobs").insert({ company_id: ctx.companyId, customer_id: customerId, title, source: source ?? null, visit_notes: notes ?? null }).select("id,state").single();
      if (error) throw error;
      await ctx.db.from("job_events").insert({ company_id: ctx.companyId, job_id: job.id, kind: "state_change", to_state: "lead", actor: "ai", payload: { source } });
      await scheduleRoutinesForState(ctx.db, ctx.companyId, job.id, "lead");
      return { jobId: job.id, customerId };
    },
  }),

  def({
    name: "list_jobs",
    description: "List jobs, optionally filtered by state. Returns id, title, state, customer, key dates.",
    schema: z.object({ state: z.string().optional(), limit: z.number().int().max(50).default(20) }),
    run: async (ctx, { state, limit }) => {
      let q = ctx.db.from("jobs").select("id,title,state,visit_at,start_at,last_activity_at,customers(name,phone)").eq("company_id", ctx.companyId).order("last_activity_at", { ascending: false }).limit(limit);
      if (state) q = q.eq("state", state);
      const { data } = await q;
      return data ?? [];
    },
  }),

  def({
    name: "get_job",
    description: "Full job record: customer, state, notes, latest estimate, recent events and messages.",
    schema: z.object({ jobId: z.string().uuid() }),
    run: async (ctx, { jobId }) => {
      const [job, est, events, msgs] = await Promise.all([
        ctx.db.from("jobs").select("*, customers(*)").eq("id", jobId).eq("company_id", ctx.companyId).single(),
        ctx.db.from("estimates").select("id,version,status,total_cents,result,customer_summary").eq("job_id", jobId).order("version", { ascending: false }).limit(1).maybeSingle(),
        ctx.db.from("job_events").select("kind,from_state,to_state,actor,payload,created_at").eq("job_id", jobId).order("created_at", { ascending: false }).limit(15),
        ctx.db.from("messages").select("channel,direction,status,subject,body,created_at").eq("job_id", jobId).order("created_at", { ascending: false }).limit(10),
      ]);
      if (job.error) throw job.error;
      return { job: job.data, latestEstimate: est.data, events: events.data, messages: msgs.data };
    },
  }),

  def({
    name: "move_job",
    description: "Move a job to a new lifecycle state (validated). Also sets dates when relevant.",
    schema: z.object({
      jobId: z.string().uuid(),
      to: z.string(),
      visitAt: z.string().datetime().optional(),
      startAt: z.string().datetime().optional(),
      lostReason: z.string().optional(),
    }),
    run: async (ctx, { jobId, to, visitAt, startAt, lostReason }) => {
      const { data: job, error } = await ctx.db.from("jobs").select("state").eq("id", jobId).eq("company_id", ctx.companyId).single();
      if (error) throw error;
      assertTransition(job.state as JobState, to as JobState);
      const patch: Record<string, unknown> = { state: to, last_activity_at: new Date().toISOString() };
      if (visitAt) patch.visit_at = visitAt;
      if (startAt) patch.start_at = startAt;
      if (to === "complete") patch.completed_at = new Date().toISOString();
      if (lostReason) patch.lost_reason = lostReason;
      await ctx.db.from("jobs").update(patch).eq("id", jobId);
      await ctx.db.from("job_events").insert({ company_id: ctx.companyId, job_id: jobId, kind: "state_change", from_state: job.state, to_state: to, actor: "ai", payload: { lostReason } });
      await scheduleRoutinesForState(ctx.db, ctx.companyId, jobId, to as JobState);
      return { ok: true, from: job.state, to };
    },
  }),

  def({
    name: "add_job_note",
    description: "Append a note to a job (visit notes, owner comments, measurements).",
    schema: z.object({ jobId: z.string().uuid(), note: z.string() }),
    run: async (ctx, { jobId, note }) => {
      const { data: job } = await ctx.db.from("jobs").select("visit_notes").eq("id", jobId).eq("company_id", ctx.companyId).single();
      const merged = [job?.visit_notes, note].filter(Boolean).join("\n\n");
      await ctx.db.from("jobs").update({ visit_notes: merged, last_activity_at: new Date().toISOString() }).eq("id", jobId);
      await ctx.db.from("job_events").insert({ company_id: ctx.companyId, job_id: jobId, kind: "note", actor: "ai", payload: { note } });
      return { ok: true };
    },
  }),

  def({
    name: "get_price_book",
    description: "Return the active price book with item ids and pricing models.",
    schema: z.object({}),
    run: async (ctx) => {
      const { data } = await ctx.db.from("price_book_items").select("id,name,description,category,model,minimum_cents,taxable").eq("company_id", ctx.companyId).eq("active", true);
      return data ?? [];
    },
  }),

  def({
    name: "draft_estimate",
    description:
      "THE ONLY WAY TO PRICE ANYTHING. Give price book item ids and quantities; the engine computes every number and saves a draft estimate on the job for owner review. Returns totals and warnings.",
    schema: z.object({
      jobId: z.string().uuid(),
      lines: z.array(z.object({ priceBookItemId: z.string().uuid(), quantity: z.number().nonnegative(), note: z.string().optional() })).min(1),
      adjustments: z.array(z.object({ label: z.string(), amountCents: money.optional(), pct: z.number().optional() })).optional(),
      customerSummary: z.string().optional().describe("Plain-English explanation for the customer; can be filled later."),
    }),
    run: async (ctx, { jobId, lines, adjustments, customerSummary }) => {
      const ids = lines.map((l) => l.priceBookItemId);
      const [{ data: items }, { data: company }, { data: prev }] = await Promise.all([
        ctx.db.from("price_book_items").select("*").eq("company_id", ctx.companyId).in("id", ids),
        ctx.db.from("companies").select("default_tax_rate,target_margin_pct,deposit_rule").eq("id", ctx.companyId).single(),
        ctx.db.from("estimates").select("id,version").eq("job_id", jobId).order("version", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const byId = new Map((items ?? []).map((i) => [i.id, i]));
      const input: EstimateInput = {
        lines: lines.map((l) => {
          const row = byId.get(l.priceBookItemId);
          if (!row) throw new Error(`Price book item ${l.priceBookItemId} not found`);
          const item: PriceBookItem = { id: row.id, companyId: ctx.companyId, name: row.name, description: row.description ?? undefined, category: row.category ?? undefined, model: row.model, minimumCents: row.minimum_cents ?? undefined, taxable: row.taxable, active: row.active };
          return { priceBookItemId: row.id, item, quantity: l.quantity, note: l.note };
        }),
        adjustments,
        taxRate: Number(company?.default_tax_rate ?? 0),
        targetMarginPct: Number(company?.target_margin_pct ?? 0),
        deposit: company?.deposit_rule ?? undefined,
      };
      const result = computeEstimate(input);
      if (prev) await ctx.db.from("estimates").update({ status: "superseded" }).eq("id", prev.id);
      const { data: est, error } = await ctx.db
        .from("estimates")
        .insert({ company_id: ctx.companyId, job_id: jobId, version: (prev?.version ?? 0) + 1, input, result, total_cents: result.totalCents, customer_summary: customerSummary ?? null })
        .select("id,version")
        .single();
      if (error) throw error;
      await ctx.db.from("jobs").update({ last_activity_at: new Date().toISOString() }).eq("id", jobId);
      return {
        estimateId: est.id,
        version: est.version,
        lines: result.lines.map((l) => ({ name: l.name, qty: l.quantity, unit: l.unit, unitPrice: formatCents(l.unitPriceCents), subtotal: formatCents(l.subtotalCents) })),
        subtotal: formatCents(result.subtotalCents),
        adjustments: formatCents(result.adjustmentsCents),
        tax: formatCents(result.taxCents),
        total: formatCents(result.totalCents),
        deposit: formatCents(result.depositCents),
        grossMarginPct: result.grossMarginPct === null ? null : Math.round(result.grossMarginPct * 1000) / 10,
        warnings: result.warnings,
        next: "Owner must approve in the app before this can be sent.",
      };
    },
  }),

  def({
    name: "materials_list",
    description: "Return the line items of the latest estimate for a job as a materials/quantities checklist skeleton.",
    schema: z.object({ jobId: z.string().uuid() }),
    run: async (ctx, { jobId }) => {
      const { data } = await ctx.db.from("estimates").select("result").eq("job_id", jobId).eq("company_id", ctx.companyId).order("version", { ascending: false }).limit(1).maybeSingle();
      const lines = (data?.result?.lines ?? []) as Array<{ name: string; quantity: number; unit: string }>;
      return lines.map((l) => ({ item: l.name, quantity: l.quantity, unit: l.unit }));
    },
  }),

  def({
    name: "propose_message",
    description: "Draft a text or email to a customer. It is saved and routed to the owner's approvals inbox (or auto-sent if a rule allows). Never claim it was sent.",
    schema: z.object({
      jobId: z.string().uuid().optional(),
      customerId: z.string().uuid(),
      channel: z.enum(["sms", "email"]),
      subject: z.string().optional(),
      body: z.string().min(1),
      routineId: z.string().optional(),
    }),
    run: async (ctx, { jobId, customerId, channel, subject, body, routineId }) => {
      const { data: msg, error } = await ctx.db
        .from("messages")
        .insert({ company_id: ctx.companyId, job_id: jobId ?? null, customer_id: customerId, channel, direction: "outbound", status: "pending_approval", subject: subject ?? null, body, routine_id: routineId ?? null })
        .select("id")
        .single();
      if (error) throw error;
      const res = await requestAction({
        db: ctx.db,
        companyId: ctx.companyId,
        jobId,
        action: channel === "sms" ? "send_sms" : "send_email",
        routineId,
        summary: `${channel === "sms" ? "Text" : "Email"}: ${subject ?? body.slice(0, 80)}`,
        payload: { type: channel === "sms" ? "send_sms" : "send_email", messageId: msg.id },
      });
      return res;
    },
  }),

  def({
    name: "send_estimate",
    description: "After the OWNER has approved an estimate in the app, request sending it to the customer with a cover message. Creates an approval unless auto-allowed.",
    schema: z.object({ estimateId: z.string().uuid(), channel: z.enum(["sms", "email"]), body: z.string(), subject: z.string().optional() }),
    run: async (ctx, { estimateId, channel, body, subject }) => {
      const { data: est, error } = await ctx.db.from("estimates").select("id,status,job_id,total_cents,public_token,jobs(customer_id)").eq("id", estimateId).eq("company_id", ctx.companyId).single();
      if (error) throw error;
      if (est.status !== "owner_approved") return { error: "Estimate is not owner-approved yet. Ask the owner to approve it in the app first." };
      const link = `${process.env.NEXT_PUBLIC_APP_URL}/e/${est.public_token}`;
      const jobs = est.jobs as unknown as { customer_id: string } | { customer_id: string }[] | null;
      const customerId = Array.isArray(jobs) ? jobs[0]?.customer_id : jobs?.customer_id;
      const { data: msg } = await ctx.db.from("messages").insert({ company_id: ctx.companyId, job_id: est.job_id, customer_id: customerId, channel, direction: "outbound", status: "pending_approval", subject: subject ?? null, body: `${body}\n\n${link}` }).select("id").single();
      return requestAction({
        db: ctx.db,
        companyId: ctx.companyId,
        jobId: est.job_id,
        action: "send_estimate",
        amountCents: est.total_cents,
        summary: `Send estimate (${formatCents(est.total_cents)}) by ${channel}`,
        payload: { type: "send_estimate", estimateId, messageId: msg!.id },
      });
    },
  }),

  def({
    name: "ask_owner",
    description: "Ask the owner a question with tap-able options. Shows in the app; no approval needed.",
    schema: z.object({ jobId: z.string().uuid().optional(), question: z.string(), options: z.array(z.string()).min(2).max(4) }),
    run: async (ctx, { jobId, question, options }) => {
      const { data, error } = await ctx.db
        .from("approvals")
        .insert({ company_id: ctx.companyId, job_id: jobId ?? null, action: "ask_owner", summary: question, payload: { type: "question", question, options } })
        .select("id")
        .single();
      if (error) throw error;
      return { questionId: data.id, status: "waiting_for_owner" };
    },
  }),

  def({
    name: "search_memory",
    description: "Semantic search over company memory: past jobs, stories, SOPs, notes. Use before writing anything about 'why us'.",
    schema: z.object({ query: z.string(), k: z.number().int().max(15).default(6) }),
    run: async (ctx, { query, k }) => {
      try {
        return await searchMemory(ctx.db, ctx.companyId, query, k);
      } catch {
        const { data } = await ctx.db.from("memory_chunks").select("kind,title,content").eq("company_id", ctx.companyId).ilike("content", `%${query.split(" ")[0]}%`).limit(k);
        return data ?? [];
      }
    },
  }),

  def({
    name: "save_fact",
    description: "Save an exact fact about the company under a dotted key (e.g. 'hours.working', 'services.offered', 'referral.program'). Overwrites.",
    schema: z.object({ key: z.string().regex(/^[a-z0-9_.]+$/), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.record(z.string(), z.unknown())]) }),
    roles: ["owner", "office"],
    run: async (ctx, { key, value }) => {
      const { error } = await ctx.db.from("memory_facts").upsert({ company_id: ctx.companyId, key, value, source: "onboarding", updated_at: new Date().toISOString() }, { onConflict: "company_id,key" });
      if (error) throw error;
      return { ok: true };
    },
  }),

  def({
    name: "remember",
    description: "Store a freeform memory (past job, story, FAQ, note) for later semantic search.",
    schema: z.object({ kind: z.enum(["past_job", "story", "faq", "note"]), title: z.string().optional(), content: z.string().min(10) }),
    roles: ["owner", "office"],
    run: async (ctx, chunk) => {
      await rememberChunk(ctx.db, ctx.companyId, chunk);
      return { ok: true };
    },
  }),

  def({
    name: "save_sop",
    description: "Save a standard operating procedure the AI should follow.",
    schema: z.object({ title: z.string(), triggerHint: z.string().optional(), body: z.string().min(10) }),
    roles: ["owner", "office"],
    run: async (ctx, { title, triggerHint, body }) => {
      const { error } = await ctx.db.from("sops").insert({ company_id: ctx.companyId, title, trigger_hint: triggerHint ?? null, body });
      if (error) throw error;
      return { ok: true };
    },
  }),

  def({
    name: "propose_price_book_item",
    description: "Propose a new price book item (name + pricing model). Goes to the owner for confirmation before it can be used in estimates.",
    schema: z.object({ name: z.string(), description: z.string().optional(), category: z.string().optional(), model: pricingModel, minimumCents: money.optional(), taxable: z.boolean().default(true) }),
    roles: ["owner", "office"],
    run: async (ctx, item) => {
      return requestAction({
        db: ctx.db,
        companyId: ctx.companyId,
        action: "price_book_write",
        summary: `Add price book item: ${item.name}`,
        payload: { type: "price_book_write", item: { name: item.name, description: item.description ?? null, category: item.category ?? null, model: item.model, minimum_cents: item.minimumCents ?? null, taxable: item.taxable } },
      });
    },
  }),

  def({
    name: "calendar_availability",
    description: "Free/busy from the connected Google Calendar for a date range (ISO). Returns busy blocks.",
    schema: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
    run: async (ctx, { from, to }) => {
      const g = await getIntegration(ctx.db, ctx.companyId, "google");
      return g.calendar.freeBusy({ from, to });
    },
  }),

  def({
    name: "book_calendar_event",
    description: "Book a site visit or job start on the calendar. Creates an approval unless auto-allowed.",
    schema: z.object({ jobId: z.string().uuid(), kind: z.enum(["visit", "start"]), title: z.string(), startAt: z.string().datetime(), endAt: z.string().datetime(), description: z.string().optional() }),
    run: async (ctx, p) => {
      return requestAction({
        db: ctx.db,
        companyId: ctx.companyId,
        jobId: p.jobId,
        action: "calendar_write",
        summary: `${p.kind === "visit" ? "Book visit" : "Schedule start"}: ${p.title} at ${p.startAt}`,
        payload: { type: "calendar_write", ...p },
      });
    },
  }),

  def({
    name: "quickbooks_import_customers",
    description: "Pull customers from the connected QuickBooks into the app (read-only on QuickBooks).",
    schema: z.object({}),
    roles: ["owner", "office"],
    run: async (ctx) => {
      const q = await getIntegration(ctx.db, ctx.companyId, "quickbooks");
      const customers = await q.quickbooks.listCustomers();
      let added = 0;
      for (const c of customers) {
        const { data: existing } = await ctx.db.from("customers").select("id").eq("company_id", ctx.companyId).eq("quickbooks_customer_id", c.id).maybeSingle();
        if (existing) continue;
        await ctx.db.from("customers").insert({ company_id: ctx.companyId, name: c.name, phone: c.phone ?? null, email: c.email ?? null, address: c.address ?? null, quickbooks_customer_id: c.id });
        added++;
      }
      return { imported: added, total: customers.length };
    },
  }),

  def({
    name: "quickbooks_import_items",
    description: "Pull QuickBooks products/services as price book candidates. Returns them; use propose_price_book_item to add the ones the owner confirms.",
    schema: z.object({}),
    roles: ["owner", "office"],
    run: async (ctx) => {
      const q = await getIntegration(ctx.db, ctx.companyId, "quickbooks");
      return q.quickbooks.listItems();
    },
  }),

  def({
    name: "quickbooks_sync_estimate",
    description: "Push an owner-approved estimate to QuickBooks. Creates an approval unless auto-allowed.",
    schema: z.object({ estimateId: z.string().uuid() }),
    roles: ["owner", "office"],
    run: async (ctx, { estimateId }) => {
      const { data: est } = await ctx.db.from("estimates").select("total_cents,job_id,status").eq("id", estimateId).eq("company_id", ctx.companyId).single();
      if (!est) throw new Error("Estimate not found");
      return requestAction({
        db: ctx.db,
        companyId: ctx.companyId,
        jobId: est.job_id,
        action: "quickbooks_write",
        amountCents: est.total_cents,
        summary: `Create estimate in QuickBooks (${formatCents(est.total_cents)})`,
        payload: { type: "quickbooks_write", op: "create_estimate", estimateId },
      });
    },
  }),
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Convert to Anthropic tool definitions. */
export function toAnthropicTools(names?: string[]): Anthropic.Tool[] {
  const list = names ? TOOLS.filter((t) => names.includes(t.name)) : TOOLS;
  return list.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.schema) as Anthropic.Tool["input_schema"],
  }));
}

export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<unknown> {
  const t = TOOLS_BY_NAME.get(name);
  if (!t) return { error: `Unknown tool ${name}` };
  if (t.roles && !t.roles.includes(ctx.role)) return { error: `Your role (${ctx.role}) can't use ${name}.` };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input", issues: parsed.error.issues };
  try {
    return await t.run(ctx, parsed.data as never);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
