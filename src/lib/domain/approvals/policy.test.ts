import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, evaluateApproval, setRule } from "./policy";
import { assertTransition, canTransition } from "../lifecycle/states";
import { DEFAULT_ROUTINES, isOutbound } from "../lifecycle/routines";

describe("approval policy", () => {
  it("asks for everything by default", () => {
    expect(evaluateApproval(DEFAULT_POLICY, { action: "send_sms" }).decision).toBe("needs_approval");
    expect(evaluateApproval(DEFAULT_POLICY, { action: "quickbooks_write", amountCents: 100 }).decision).toBe(
      "needs_approval",
    );
  });
  it("allow once approves only that request", () => {
    expect(evaluateApproval(DEFAULT_POLICY, { action: "send_sms", oneTimeApproved: true }).decision).toBe(
      "auto_approved",
    );
    expect(evaluateApproval(DEFAULT_POLICY, { action: "send_sms" }).decision).toBe("needs_approval");
  });
  it("always allow for a specific routine does not leak to other routines", () => {
    const p = setRule(DEFAULT_POLICY, { action: "send_sms", routineId: "visit_reminder_day_before", mode: "always_allow" });
    expect(evaluateApproval(p, { action: "send_sms", routineId: "visit_reminder_day_before" }).decision).toBe(
      "auto_approved",
    );
    expect(evaluateApproval(p, { action: "send_sms", routineId: "lead_chase" }).decision).toBe("needs_approval");
    expect(evaluateApproval(p, { action: "send_sms" }).decision).toBe("needs_approval");
  });
  it("threshold rule compares amounts", () => {
    const p = setRule(DEFAULT_POLICY, { action: "send_estimate", mode: { kind: "threshold", maxAmountCents: 500000 } });
    expect(evaluateApproval(p, { action: "send_estimate", amountCents: 499999 }).decision).toBe("auto_approved");
    expect(evaluateApproval(p, { action: "send_estimate", amountCents: 500001 }).decision).toBe("needs_approval");
    expect(evaluateApproval(p, { action: "send_estimate" }).decision).toBe("needs_approval");
  });
});

describe("lifecycle", () => {
  it("allows the happy path", () => {
    const path = ["lead", "contacted", "booked", "met", "estimating", "estimate_sent", "won", "scheduled", "in_progress", "complete", "nurture"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it("rejects skipping straight to complete", () => {
    expect(() => assertTransition("lead", "complete")).toThrow();
  });
  it("every default routine targets a real state and marks outbound-ness", () => {
    for (const r of DEFAULT_ROUTINES) {
      expect(typeof r.state).toBe("string");
      if (r.audience === "customer") expect(isOutbound(r.action)).toBe(true);
      if (r.audience === "owner") expect(isOutbound(r.action)).toBe(false);
    }
  });
});
