import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_POLICY, evaluateApproval, type ApprovalPolicy, type GatedAction } from "@/lib/domain/approvals/policy";
import { executeAction, type ActionPayload } from "./execute";

/**
 * The single front door for every side effect the AI wants to cause.
 * Evaluates the company's approval policy; either executes now or parks the
 * exact payload in the approvals inbox for the owner.
 */
export interface RequestActionArgs {
  db: SupabaseClient;
  companyId: string;
  jobId?: string;
  action: GatedAction;
  routineId?: string;
  amountCents?: number;
  summary: string;
  payload: ActionPayload;
  oneTimeApproved?: boolean;
}

export type RequestActionResult =
  | { status: "executed"; result: unknown }
  | { status: "pending_approval"; approvalId: string };

export async function loadPolicy(db: SupabaseClient, companyId: string): Promise<ApprovalPolicy> {
  const { data } = await db.from("companies").select("approval_policy").eq("id", companyId).single();
  const p = data?.approval_policy as ApprovalPolicy | undefined;
  return p && Array.isArray(p.rules) && p.rules.length ? p : DEFAULT_POLICY;
}

export async function requestAction(args: RequestActionArgs): Promise<RequestActionResult> {
  const policy = await loadPolicy(args.db, args.companyId);
  const decision = evaluateApproval(policy, {
    action: args.action,
    routineId: args.routineId,
    amountCents: args.amountCents,
    oneTimeApproved: args.oneTimeApproved,
  });

  if (decision.decision === "auto_approved") {
    const result = await executeAction(args.db, args.companyId, args.payload);
    await args.db.from("job_events").insert({
      company_id: args.companyId,
      job_id: args.jobId ?? null,
      kind: "approval",
      actor: "system",
      payload: { action: args.action, auto: true, reason: decision.reason, summary: args.summary },
    }).then(() => undefined, () => undefined);
    return { status: "executed", result };
  }

  const { data, error } = await args.db
    .from("approvals")
    .insert({
      company_id: args.companyId,
      job_id: args.jobId ?? null,
      action: args.action,
      routine_id: args.routineId ?? null,
      amount_cents: args.amountCents ?? null,
      summary: args.summary,
      payload: args.payload,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { status: "pending_approval", approvalId: data.id };
}

/** Owner decided in the inbox. `alwaysAllow` also writes a policy rule. */
export async function decideApproval(
  db: SupabaseClient,
  companyId: string,
  approvalId: string,
  userId: string,
  decision: "approve" | "reject",
  alwaysAllow = false,
) {
  const { data: appr, error } = await db
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("company_id", companyId)
    .eq("status", "pending")
    .single();
  if (error || !appr) throw new Error("Approval not found or already decided");

  if (decision === "reject") {
    await db.from("approvals").update({ status: "rejected", decided_by: userId, decided_at: new Date().toISOString() }).eq("id", approvalId);
    return { status: "rejected" as const };
  }

  const result = await executeAction(db, companyId, appr.payload as ActionPayload);
  await db.from("approvals").update({ status: "approved", decided_by: userId, decided_at: new Date().toISOString() }).eq("id", approvalId);

  if (alwaysAllow) {
    const policy = await loadPolicy(db, companyId);
    const { setRule } = await import("@/lib/domain/approvals/policy");
    const next = setRule(policy, { action: appr.action as GatedAction, routineId: appr.routine_id ?? undefined, mode: "always_allow" });
    await db.from("companies").update({ approval_policy: next }).eq("id", companyId);
  }
  return { status: "approved" as const, result };
}
