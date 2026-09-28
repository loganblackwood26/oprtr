"use server";

import { revalidatePath } from "next/cache";
import { currentContext } from "@/lib/supabase/server";
import { seedRoutines } from "@/lib/ai/scheduler";

async function ownerCtx() {
  const ctx = await currentContext();
  if (!ctx?.membership || ctx.membership.role === "crew") throw new Error("Not allowed");
  return { ...ctx, companyId: ctx.membership.company_id as string };
}

/** Owner approves an estimate draft → it can be sent to the customer. */
export async function approveEstimate(estimateId: string) {
  const { supabase, companyId } = await ownerCtx();
  const { error } = await supabase.from("estimates").update({ status: "owner_approved", owner_approved_at: new Date().toISOString() }).eq("id", estimateId).eq("company_id", companyId).eq("status", "draft");
  if (error) throw error;
  revalidatePath("/jobs");
}

/** Customer-facing: they approve/decline from the public page (by token). */
export async function customerDecideEstimate(token: string, decision: "approve" | "decline") {
  const { createServiceClient } = await import("@/lib/supabase/server");
  const db = createServiceClient();
  const { data: est } = await db.from("estimates").select("id,company_id,job_id,status").eq("public_token", token).single();
  if (!est || est.status !== "sent") throw new Error("This estimate is no longer open.");
  const now = new Date().toISOString();
  await db.from("estimates").update({ status: decision === "approve" ? "customer_approved" : "declined", customer_decided_at: now }).eq("id", est.id);
  const to = decision === "approve" ? "won" : "lost";
  await db.from("jobs").update({ state: to, last_activity_at: now, ...(to === "lost" ? { lost_reason: "Customer declined estimate" } : {}) }).eq("id", est.job_id);
  await db.from("job_events").insert({ company_id: est.company_id, job_id: est.job_id, kind: "state_change", from_state: "estimate_sent", to_state: to, actor: "customer", payload: { estimateId: est.id } });
  const { scheduleRoutinesForState } = await import("@/lib/ai/scheduler");
  await scheduleRoutinesForState(db, est.company_id, est.job_id, to);
}

export async function createCompany(form: { name: string; trade: string; displayName: string; timezone: string }) {
  const ctx = await currentContext();
  if (!ctx) throw new Error("Sign in first");
  const { data: company, error } = await ctx.supabase.from("companies").insert({ name: form.name, trade: form.trade || null, timezone: form.timezone }).select("id").single();
  if (error) throw error;
  const { error: mErr } = await ctx.supabase.from("memberships").insert({ company_id: company.id, user_id: ctx.user.id, role: "owner", display_name: form.displayName });
  if (mErr) throw mErr;
  await seedRoutines(ctx.supabase, company.id);
  return company.id;
}

export async function completeOnboarding() {
  const { supabase, companyId } = await ownerCtx();
  await supabase.from("companies").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", companyId);
  revalidatePath("/");
}

export async function updateCompanySettings(patch: { target_margin_pct?: number; default_tax_rate?: number; deposit_rule?: unknown; name?: string; timezone?: string }) {
  const { supabase, companyId } = await ownerCtx();
  const { error } = await supabase.from("companies").update(patch).eq("id", companyId);
  if (error) throw error;
  revalidatePath("/settings");
}

export async function setQuickBooksWrites(enabled: boolean) {
  const { supabase, companyId } = await ownerCtx();
  await supabase.from("integrations").update({ writes_enabled: enabled }).eq("company_id", companyId).eq("provider", "quickbooks");
  revalidatePath("/settings/integrations");
}

export async function toggleRoutine(routineKey: string, enabled: boolean) {
  const { supabase, companyId } = await ownerCtx();
  await supabase.from("routines").update({ enabled }).eq("company_id", companyId).eq("routine_key", routineKey);
  revalidatePath("/settings/routines");
}

export async function resetApprovalRule(action: string, routineId?: string | null) {
  const { supabase, companyId } = await ownerCtx();
  const { loadPolicy } = await import("@/lib/ai/actions");
  const policy = await loadPolicy(supabase, companyId);
  const rules = policy.rules.filter((r) => !(r.action === action && (r.routineId ?? null) === (routineId ?? null)));
  await supabase.from("companies").update({ approval_policy: { rules } }).eq("id", companyId);
  revalidatePath("/settings");
}
