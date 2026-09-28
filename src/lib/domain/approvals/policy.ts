/**
 * Approval policy — the "always ask" default and the allow-once / always-allow
 * pop-up behavior. Nothing outbound or money-related executes without a
 * decision from this module.
 *
 * Gated action kinds go beyond routine actions: they cover every side effect
 * the AI can request (QuickBooks writes, calendar writes, etc.).
 */

export type GatedAction =
  | "send_sms"
  | "send_email"
  | "send_estimate"
  | "calendar_write"
  | "quickbooks_write"
  | "price_book_write"
  | "customer_write";

export const ALL_GATED_ACTIONS: readonly GatedAction[] = [
  "send_sms",
  "send_email",
  "send_estimate",
  "calendar_write",
  "quickbooks_write",
  "price_book_write",
  "customer_write",
];

export type ApprovalMode =
  /** always put it in the approvals inbox */
  | "always_ask"
  /** auto-approve; never ask */
  | "always_allow"
  /** auto-approve when amount <= threshold, otherwise ask */
  | { kind: "threshold"; maxAmountCents: number };

export interface ApprovalRule {
  action: GatedAction;
  mode: ApprovalMode;
  /** Narrow a rule to a routine (e.g. auto-allow visit reminders only). */
  routineId?: string;
}

export interface ApprovalPolicy {
  rules: ApprovalRule[];
}

export interface ApprovalRequest {
  action: GatedAction;
  routineId?: string;
  /** Money involved, when applicable (estimate total, invoice amount). */
  amountCents?: number;
  /** Set when the owner clicked "allow once" on this specific request. */
  oneTimeApproved?: boolean;
}

export type ApprovalDecision = { decision: "auto_approved"; reason: string } | { decision: "needs_approval"; reason: string };

/** The default policy: ask for everything. */
export const DEFAULT_POLICY: ApprovalPolicy = {
  rules: ALL_GATED_ACTIONS.map((action) => ({ action, mode: "always_ask" as const })),
};

function findRule(policy: ApprovalPolicy, req: ApprovalRequest): ApprovalRule | undefined {
  // Routine-specific rule wins over the generic action rule.
  const specific = req.routineId
    ? policy.rules.find((r) => r.action === req.action && r.routineId === req.routineId)
    : undefined;
  return specific ?? policy.rules.find((r) => r.action === req.action && !r.routineId);
}

export function evaluateApproval(policy: ApprovalPolicy, req: ApprovalRequest): ApprovalDecision {
  if (req.oneTimeApproved) return { decision: "auto_approved", reason: "Owner allowed once." };
  const rule = findRule(policy, req);
  if (!rule) return { decision: "needs_approval", reason: "No rule for this action; asking by default." };
  if (rule.mode === "always_ask") return { decision: "needs_approval", reason: "Rule: always ask." };
  if (rule.mode === "always_allow") return { decision: "auto_approved", reason: "Rule: always allow." };
  // threshold
  if (req.amountCents === undefined) {
    return { decision: "needs_approval", reason: "Threshold rule but no amount on request; asking." };
  }
  return req.amountCents <= rule.mode.maxAmountCents
    ? { decision: "auto_approved", reason: `Amount within threshold.` }
    : { decision: "needs_approval", reason: `Amount exceeds threshold.` };
}

/** Owner clicked "always allow" — returns an updated policy (immutable). */
export function setRule(policy: ApprovalPolicy, rule: ApprovalRule): ApprovalPolicy {
  const others = policy.rules.filter((r) => !(r.action === rule.action && (r.routineId ?? null) === (rule.routineId ?? null)));
  return { rules: [...others, rule] };
}
