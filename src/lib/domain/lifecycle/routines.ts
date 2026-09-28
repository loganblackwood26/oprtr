import type { JobState } from "./states";

/**
 * Routines are the "CEO brain" on autopilot. Each is a rule, not a prompt:
 * WHEN a trigger fires for a job in a given state, DO an action. The action
 * is carried out by a skill (which may use the LLM to write words), but the
 * decision to act comes from here. Every outbound action passes through the
 * approval policy before it leaves the building.
 */

export type RoutineTrigger =
  /** fire once when a job enters the state */
  | { kind: "on_enter" }
  /** fire at an offset from a date field on the job (negative = before) */
  | { kind: "relative_to"; field: JobDateField; offsetHours: number }
  /** fire repeatedly while the job stays in the state */
  | { kind: "every"; hours: number; maxTimes?: number }
  /** fire when no activity for N hours */
  | { kind: "idle"; hours: number; maxTimes?: number };

export type JobDateField = "visit_at" | "start_at" | "completed_at" | "estimate_sent_at";

export type ActionType =
  | "send_sms"
  | "send_email"
  | "send_estimate"
  | "ask_owner" // in-app question to the owner (never needs approval)
  | "create_task" // internal task for owner/crew (never needs approval)
  | "materials_list"; // generate materials list from estimate (never needs approval)

export interface RoutineDef {
  id: string;
  name: string;
  state: JobState;
  trigger: RoutineTrigger;
  action: ActionType;
  /** Which skill drafts the content. */
  skill: string;
  /** Short instruction the skill uses as intent (not the customer-facing copy). */
  intent: string;
  audience: "customer" | "owner" | "crew";
  enabledByDefault: boolean;
}

/**
 * Default routines shipped with every company. Companies can toggle, retime,
 * or add their own; these live in the DB after onboarding, seeded from here.
 */
export const DEFAULT_ROUTINES: RoutineDef[] = [
  // ---- lead → contacted ----------------------------------------------------
  {
    id: "lead_first_touch",
    name: "Reply to new lead",
    state: "lead",
    trigger: { kind: "on_enter" },
    action: "send_sms",
    skill: "follow_up",
    intent: "Thank them for reaching out, ask 1-2 qualifying questions, offer to book a visit.",
    audience: "customer",
    enabledByDefault: true,
  },
  {
    id: "lead_chase",
    name: "Chase unanswered lead",
    state: "contacted",
    trigger: { kind: "idle", hours: 48, maxTimes: 3 },
    action: "send_sms",
    skill: "follow_up",
    intent: "Friendly nudge; make it easy to pick a visit time.",
    audience: "customer",
    enabledByDefault: true,
  },
  // ---- booked ----------------------------------------------------------------
  {
    id: "visit_reminder_day_before",
    name: "Visit reminder (day before)",
    state: "booked",
    trigger: { kind: "relative_to", field: "visit_at", offsetHours: -24 },
    action: "send_sms",
    skill: "follow_up",
    intent: "Confirm tomorrow's visit time and who is coming.",
    audience: "customer",
    enabledByDefault: true,
  },
  {
    id: "visit_reminder_day_of",
    name: "Visit reminder (day of)",
    state: "booked",
    trigger: { kind: "relative_to", field: "visit_at", offsetHours: -2 },
    action: "send_sms",
    skill: "follow_up",
    intent: "Heads up we're on our way today.",
    audience: "customer",
    enabledByDefault: true,
  },
  {
    id: "why_us_email",
    name: "Why-us email before visit",
    state: "booked",
    trigger: { kind: "relative_to", field: "visit_at", offsetHours: -48 },
    action: "send_email",
    skill: "sales_pitch",
    intent: "Warm intro to the company: what makes us different, what to expect at the visit.",
    audience: "customer",
    enabledByDefault: true,
  },
  {
    id: "post_visit_owner_checkin",
    name: "Ask owner how the visit went",
    state: "booked",
    trigger: { kind: "relative_to", field: "visit_at", offsetHours: 2 },
    action: "ask_owner",
    skill: "owner_checkin",
    intent: "How did it go? Options: start an estimate / pass / follow up later.",
    audience: "owner",
    enabledByDefault: true,
  },
  // ---- estimating / estimate_sent ---------------------------------------
  {
    id: "estimate_delivery",
    name: "Deliver approved estimate",
    state: "estimating",
    trigger: { kind: "on_enter" },
    action: "create_task",
    skill: "estimator",
    intent: "Draft the estimate from the visit notes and price book for owner review.",
    audience: "owner",
    enabledByDefault: true,
  },
  {
    id: "estimate_chase",
    name: "Chase estimate approval",
    state: "estimate_sent",
    trigger: { kind: "idle", hours: 72, maxTimes: 4 },
    action: "send_sms",
    skill: "follow_up",
    intent: "Check if they have questions on the estimate; offer to walk through it.",
    audience: "customer",
    enabledByDefault: true,
  },
  // ---- won / scheduled / in_progress -----------------------------------
  {
    id: "won_schedule",
    name: "Schedule the job",
    state: "won",
    trigger: { kind: "on_enter" },
    action: "ask_owner",
    skill: "scheduler",
    intent: "Propose start dates from crew calendar; confirm with owner.",
    audience: "owner",
    enabledByDefault: true,
  },
  {
    id: "won_materials",
    name: "Materials to order",
    state: "won",
    trigger: { kind: "on_enter" },
    action: "materials_list",
    skill: "estimator",
    intent: "List every material and quantity from the approved estimate.",
    audience: "owner",
    enabledByDefault: true,
  },
  {
    id: "start_reminder",
    name: "Start-date reminder to customer",
    state: "scheduled",
    trigger: { kind: "relative_to", field: "start_at", offsetHours: -24 },
    action: "send_sms",
    skill: "follow_up",
    intent: "Crew arrives tomorrow; what to expect, access needs.",
    audience: "customer",
    enabledByDefault: true,
  },
  {
    id: "progress_owner_checkin",
    name: "Job progress check-in",
    state: "in_progress",
    trigger: { kind: "every", hours: 24 },
    action: "ask_owner",
    skill: "owner_checkin",
    intent: "Quick status: on track? anything to tell the customer?",
    audience: "owner",
    enabledByDefault: true,
  },
  // ---- complete / nurture -------------------------------------------------
  {
    id: "thank_you",
    name: "Thank-you after completion",
    state: "complete",
    trigger: { kind: "on_enter" },
    action: "send_email",
    skill: "follow_up",
    intent: "Thank them, ask for a review, mention referral program.",
    audience: "customer",
    enabledByDefault: true,
  },
  {
    id: "nurture_quarterly",
    name: "Quarterly stay-in-touch",
    state: "nurture",
    trigger: { kind: "every", hours: 24 * 90 },
    action: "send_email",
    skill: "nurture",
    intent: "Seasonal tip, referral reminder, be top of mind.",
    audience: "customer",
    enabledByDefault: true,
  },
];

/** Actions that leave the company (need approval by default). */
export const OUTBOUND_ACTIONS: readonly ActionType[] = ["send_sms", "send_email", "send_estimate"];

export function isOutbound(action: ActionType): boolean {
  return OUTBOUND_ACTIONS.includes(action);
}
