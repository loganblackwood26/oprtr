import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ROUTINES, type RoutineDef } from "@/lib/domain/lifecycle/routines";
import type { JobState } from "@/lib/domain/lifecycle/states";

/**
 * Turns routine definitions into concrete due times in routine_runs.
 * Called whenever a job enters a state or its dates change.
 * The cron endpoint (/api/cron/routines) fires whatever is due.
 */

export async function loadRoutines(db: SupabaseClient, companyId: string): Promise<RoutineDef[]> {
  const { data } = await db.from("routines").select("routine_key,definition,enabled").eq("company_id", companyId);
  if (!data?.length) return DEFAULT_ROUTINES.filter((r) => r.enabledByDefault);
  return data.filter((r) => r.enabled).map((r) => r.definition as RoutineDef);
}

/** Seed a company's routines from defaults (idempotent). */
export async function seedRoutines(db: SupabaseClient, companyId: string) {
  const rows = DEFAULT_ROUTINES.map((r) => ({ company_id: companyId, routine_key: r.id, definition: r, enabled: r.enabledByDefault }));
  await db.from("routines").upsert(rows, { onConflict: "company_id,routine_key", ignoreDuplicates: true });
}

const HOUR = 3600_000;

export async function scheduleRoutinesForState(db: SupabaseClient, companyId: string, jobId: string, state: JobState) {
  const [routines, jobRes] = await Promise.all([
    loadRoutines(db, companyId),
    db.from("jobs").select("visit_at,start_at,completed_at,estimate_sent_at,last_activity_at").eq("id", jobId).single(),
  ]);
  const job = jobRes.data;
  if (!job) return;

  // Clear unfired runs from previous states — the job moved on.
  await db.from("routine_runs").delete().eq("job_id", jobId).is("fired_at", null);

  const now = Date.now();
  const rows: Array<{ company_id: string; job_id: string; routine_key: string; due_at: string }> = [];
  for (const r of routines) {
    if (r.state !== state) continue;
    const t = r.trigger;
    let due: number | null = null;
    switch (t.kind) {
      case "on_enter":
        due = now;
        break;
      case "relative_to": {
        const base = job[t.field] ? Date.parse(job[t.field] as string) : null;
        if (base) due = base + t.offsetHours * HOUR;
        break;
      }
      case "every":
        due = now + t.hours * HOUR;
        break;
      case "idle":
        due = Date.parse(job.last_activity_at) + t.hours * HOUR;
        break;
    }
    if (due !== null && due > now - 6 * HOUR) {
      rows.push({ company_id: companyId, job_id: jobId, routine_key: r.id, due_at: new Date(Math.max(due, now)).toISOString() });
    }
  }
  if (rows.length) await db.from("routine_runs").upsert(rows, { onConflict: "job_id,routine_key,due_at", ignoreDuplicates: true });
}

/** After a run fires, schedule the next occurrence for repeating triggers. */
export async function scheduleNext(db: SupabaseClient, companyId: string, jobId: string, routine: RoutineDef, firedCount: number) {
  const t = routine.trigger;
  if (t.kind !== "every" && t.kind !== "idle") return;
  if (t.maxTimes && firedCount >= t.maxTimes) return;
  const due = new Date(Date.now() + t.hours * HOUR).toISOString();
  await db.from("routine_runs").upsert({ company_id: companyId, job_id: jobId, routine_key: routine.id, due_at: due }, { onConflict: "job_id,routine_key,due_at", ignoreDuplicates: true });
}
