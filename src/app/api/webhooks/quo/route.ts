import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runOrchestrator } from "@/lib/ai/orchestrator";
import type { QuoInboundEvent } from "@/lib/integrations/quo";

export const runtime = "nodejs";

/**
 * Inbound texts from customers. Matches the "to" number to a company, logs the
 * message on the customer's open job, and lets the AI draft a reply (which
 * goes to approvals like everything else).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.QUO_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const evt = JSON.parse(raw) as QuoInboundEvent;
  const m = evt.data?.object;
  if (!m || m.direction !== "incoming") return NextResponse.json({ ok: true, ignored: true });

  const db = createServiceClient();
  const to = m.to[0];
  const { data: integ } = await db.from("integrations").select("company_id").eq("provider", "quo").eq("external_id", to).maybeSingle();
  if (!integ) return NextResponse.json({ ok: true, ignored: "unknown number" });
  const companyId = integ.company_id;

  const { data: customer } = await db.from("customers").select("id,name").eq("company_id", companyId).eq("phone", m.from).maybeSingle();
  let customerId = customer?.id;
  if (!customerId) {
    const { data } = await db.from("customers").insert({ company_id: companyId, name: m.from, phone: m.from }).select("id").single();
    customerId = data!.id;
  }
  const { data: job } = await db.from("jobs").select("id").eq("company_id", companyId).eq("customer_id", customerId).not("state", "in", '("lost","nurture","complete")').order("last_activity_at", { ascending: false }).limit(1).maybeSingle();

  const body = m.text ?? m.body ?? "";
  await db.from("messages").insert({ company_id: companyId, job_id: job?.id ?? null, customer_id: customerId, channel: "sms", direction: "inbound", status: "delivered", body, provider_message_id: m.id });
  if (job) {
    await db.from("jobs").update({ last_activity_at: new Date().toISOString() }).eq("id", job.id);
    await db.from("job_events").insert({ company_id: companyId, job_id: job.id, kind: "message_in", actor: "customer", payload: { body } });
  }

  const { data: owner } = await db.from("memberships").select("user_id").eq("company_id", companyId).eq("role", "owner").limit(1).single();
  if (owner) {
    await runOrchestrator(
      `Inbound text from ${customer?.name ?? m.from} (customer ${customerId}${job ? `, job ${job.id}` : ", no open job — create a lead if it's an inquiry"}): "${body}". Decide the right next step (reply, book, move job, or ask the owner) and take it.`,
      { db, companyId, userId: owner.user_id, role: "owner", maxTurns: 8 },
    ).catch(() => undefined);
  }
  return NextResponse.json({ ok: true });
}
