import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoutineDef } from "@/lib/domain/lifecycle/routines";
import { runOrchestrator } from "./orchestrator";
import { loadRoutines, scheduleNext } from "./scheduler";

/**
 * Fires due routine_runs. Each run = one headless orchestrator call with the
 * routine's skill forced and its intent as the "user" message. Anything
 * outbound lands in approvals via the normal tools.
 *
 * Runs with the service-role client; every query filters by company_id.
 */
export async function runDueRoutines(db: SupabaseClient, limit = 25) {
  const { data: due } = await db
    .from("routine_runs")
    .select("id,company_id,job_id,routine_key,due_at")
    .is("fired_at", null)
    .lte("due_at", new Date().toISOString())
    .order("due_at")
    .limit(limit);

  const results: Array<{ id: string; outcome: string }> = [];
  for (const run of due ?? []) {
    // claim
    const { data: claimed } = await db.from("routine_runs").update({ fired_at: new Date().toISOString() }).eq("id", run.id).is("fired_at", null).select("id").maybeSingle();
    if (!claimed) continue;

    try {
      const routines = await loadRoutines(db, run.company_id);
      const routine = routines.find((r) => r.id === run.routine_key);
      const { data: job } = await db.from("jobs").select("state,title,customer_id").eq("id", run.job_id).single();
      if (!routine || !job || job.state !== routine.state) {
        await finish(db, run.id, "skipped", { reason: "routine disabled or job moved on" });
        results.push({ id: run.id, outcome: "skipped" });
        continue;
      }
      const { data: owner } = await db.from("memberships").select("user_id").eq("company_id", run.company_id).eq("role", "owner").limit(1).single();
      if (!owner) throw new Error("No owner membership");

      const prompt = `ROUTINE "${routine.name}" fired for job ${run.job_id} ("${job.title}", customer ${job.customer_id}).
Intent: ${routine.intent}
Audience: ${routine.audience}. Action type: ${routine.action}. Routine id: ${routine.id} (pass as routineId on propose_message).
Load the job with get_job first. Then do exactly this one thing and stop. If it doesn't make sense right now (e.g. customer already replied, opted out, or info is missing), do nothing and explain why in one sentence.`;

      const res = await runOrchestrator(prompt, {
        db,
        companyId: run.company_id,
        userId: owner.user_id,
        role: "owner",
        skillId: routine.skill,
        maxTurns: 6,
      });

      const { count } = await db.from("routine_runs").select("id", { count: "exact", head: true }).eq("job_id", run.job_id).eq("routine_key", run.routine_key).not("fired_at", "is", null);
      await scheduleNext(db, run.company_id, run.job_id, routine as RoutineDef, count ?? 1);
      await db.from("job_events").insert({ company_id: run.company_id, job_id: run.job_id, kind: "routine_fired", actor: "system", payload: { routine: routine.id, summary: res.text.slice(0, 500) } });
      await finish(db, run.id, "ran", { summary: res.text.slice(0, 500) });
      results.push({ id: run.id, outcome: "ran" });
    } catch (e) {
      await finish(db, run.id, "error", { error: String(e) });
      results.push({ id: run.id, outcome: "error" });
    }
  }
  return results;
}

async function finish(db: SupabaseClient, id: string, outcome: string, detail: Record<string, unknown>) {
  await db.from("routine_runs").update({ outcome, detail }).eq("id", id);
}
