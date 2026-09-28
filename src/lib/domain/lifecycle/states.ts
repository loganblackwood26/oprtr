/**
 * The job lifecycle. Every routine, every follow-up, and every dashboard
 * column hangs off these states. The AI never invents a transition; it can
 * only request one, and the machine decides whether it's legal.
 */

export const JOB_STATES = [
  "lead", // new inquiry, no contact yet
  "contacted", // AI/owner reached out, waiting on customer
  "booked", // site visit / consult on the calendar
  "met", // visit happened; awaiting owner's call
  "estimating", // owner chose to estimate; draft in progress
  "estimate_sent", // estimate delivered; chasing approval
  "won", // customer approved
  "scheduled", // crew start date set
  "in_progress", // crew on site
  "complete", // work done, final invoice out
  "nurture", // long-term relationship / referrals
  "lost", // passed or customer declined
] as const;

export type JobState = (typeof JOB_STATES)[number];

/** Legal transitions: from → set of to. */
export const TRANSITIONS: Record<JobState, readonly JobState[]> = {
  lead: ["contacted", "booked", "lost"],
  contacted: ["booked", "estimating", "lost", "nurture"],
  booked: ["met", "contacted", "lost"],
  met: ["estimating", "contacted", "lost", "nurture"],
  estimating: ["estimate_sent", "lost"],
  estimate_sent: ["won", "lost", "estimating", "nurture"],
  won: ["scheduled", "lost"],
  scheduled: ["in_progress", "won"],
  in_progress: ["complete", "scheduled"],
  complete: ["nurture"],
  nurture: ["lead", "lost"],
  lost: ["nurture", "lead"],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal job transition ${from} → ${to}`);
  }
}

/** Human labels for the UI. */
export const STATE_LABELS: Record<JobState, string> = {
  lead: "New lead",
  contacted: "Reached out",
  booked: "Visit booked",
  met: "Visited",
  estimating: "Estimating",
  estimate_sent: "Estimate sent",
  won: "Won",
  scheduled: "Scheduled",
  in_progress: "In progress",
  complete: "Complete",
  nurture: "Past customer",
  lost: "Passed",
};

/** States that show on the sales pipeline board, in order. */
export const PIPELINE_STATES: readonly JobState[] = [
  "lead",
  "contacted",
  "booked",
  "met",
  "estimating",
  "estimate_sent",
  "won",
  "scheduled",
  "in_progress",
];
