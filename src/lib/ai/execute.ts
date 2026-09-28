import type { SupabaseClient } from "@supabase/supabase-js";
import { getIntegration } from "@/lib/integrations/registry";

/**
 * Payloads are the exact thing that will run when approved. They are stored
 * verbatim in the approvals table so what the owner approves is what executes.
 */
export type ActionPayload =
  | { type: "send_sms"; messageId: string }
  | { type: "send_email"; messageId: string }
  | { type: "send_estimate"; estimateId: string; messageId: string }
  | { type: "calendar_write"; jobId: string; title: string; startAt: string; endAt: string; description?: string; kind: "visit" | "start" }
  | { type: "quickbooks_write"; op: "create_estimate"; estimateId: string }
  | { type: "quickbooks_write"; op: "create_customer"; customerId: string }
  | { type: "price_book_write"; item: Record<string, unknown> }
  | { type: "customer_write"; customer: Record<string, unknown> };

export async function executeAction(db: SupabaseClient, companyId: string, p: ActionPayload): Promise<unknown> {
  switch (p.type) {
    case "send_sms":
    case "send_email":
      return sendMessage(db, companyId, p.messageId);
    case "send_estimate": {
      await db.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", p.estimateId).eq("company_id", companyId);
      const { data: est } = await db.from("estimates").select("job_id").eq("id", p.estimateId).single();
      if (est) {
        await db.from("jobs").update({ state: "estimate_sent", estimate_sent_at: new Date().toISOString(), last_activity_at: new Date().toISOString() }).eq("id", est.job_id);
        await db.from("job_events").insert({ company_id: companyId, job_id: est.job_id, kind: "state_change", from_state: "estimating", to_state: "estimate_sent", actor: "ai", payload: { estimateId: p.estimateId } });
      }
      return sendMessage(db, companyId, p.messageId);
    }
    case "calendar_write": {
      const cal = await getIntegration(db, companyId, "google");
      const ev = await cal.calendar.createEvent({ title: p.title, startAt: p.startAt, endAt: p.endAt, description: p.description });
      const patch = p.kind === "visit" ? { visit_at: p.startAt, calendar_event_id: ev.id, state: "booked" } : { start_at: p.startAt, state: "scheduled" };
      await db.from("jobs").update({ ...patch, last_activity_at: new Date().toISOString() }).eq("id", p.jobId).eq("company_id", companyId);
      return ev;
    }
    case "quickbooks_write": {
      const qbo = await getIntegration(db, companyId, "quickbooks");
      if (p.op === "create_estimate") {
        const { data: est } = await db.from("estimates").select("*, jobs(customer_id, title), companies(name)").eq("id", p.estimateId).single();
        if (!est) throw new Error("Estimate not found");
        const res = await qbo.quickbooks.createEstimate(est);
        await db.from("estimates").update({ quickbooks_estimate_id: res.id }).eq("id", p.estimateId);
        return res;
      }
      const { data: cust } = await db.from("customers").select("*").eq("id", p.customerId).single();
      if (!cust) throw new Error("Customer not found");
      const res = await qbo.quickbooks.createCustomer(cust);
      await db.from("customers").update({ quickbooks_customer_id: res.id }).eq("id", p.customerId);
      return res;
    }
    case "price_book_write": {
      const { data, error } = await db.from("price_book_items").insert({ ...p.item, company_id: companyId }).select("id").single();
      if (error) throw error;
      return data;
    }
    case "customer_write": {
      const { data, error } = await db.from("customers").insert({ ...p.customer, company_id: companyId }).select("id").single();
      if (error) throw error;
      return data;
    }
  }
}

async function sendMessage(db: SupabaseClient, companyId: string, messageId: string) {
  const { data: msg, error } = await db.from("messages").select("*, customers(phone,email,name)").eq("id", messageId).eq("company_id", companyId).single();
  if (error || !msg) throw new Error("Message not found");
  try {
    let providerId: string;
    if (msg.channel === "sms") {
      const quo = await getIntegration(db, companyId, "quo");
      const to = msg.customers?.phone;
      if (!to) throw new Error("Customer has no phone number");
      providerId = (await quo.sms.send({ to, body: msg.body })).id;
    } else if (msg.channel === "email") {
      const g = await getIntegration(db, companyId, "google");
      const to = msg.customers?.email;
      if (!to) throw new Error("Customer has no email");
      providerId = (await g.gmail.send({ to, subject: msg.subject ?? "", body: msg.body })).id;
    } else {
      providerId = "in_app";
    }
    await db.from("messages").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: providerId }).eq("id", messageId);
    await db.from("usage_events").insert({ company_id: companyId, kind: msg.channel, quantity: 1 });
    if (msg.job_id) {
      await db.from("jobs").update({ last_activity_at: new Date().toISOString() }).eq("id", msg.job_id);
      await db.from("job_events").insert({ company_id: companyId, job_id: msg.job_id, kind: "message_out", actor: "ai", payload: { messageId, channel: msg.channel } });
    }
    return { messageId, providerId };
  } catch (e) {
    await db.from("messages").update({ status: "failed", error: String(e) }).eq("id", messageId);
    throw e;
  }
}
