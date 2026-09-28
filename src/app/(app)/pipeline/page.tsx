import Link from "next/link";
import { currentContext } from "@/lib/supabase/server";
import { PIPELINE_STATES, STATE_LABELS, type JobState } from "@/lib/domain/lifecycle/states";
import { formatDistanceToNowStrict } from "date-fns";

export default async function PipelinePage() {
  const ctx = (await currentContext())!;
  const companyId = ctx.membership!.company_id as string;
  const { data } = await ctx.supabase.from("jobs").select("id,title,state,last_activity_at,visit_at,start_at,customers(name)").eq("company_id", companyId).in("state", [...PIPELINE_STATES]).order("last_activity_at", { ascending: false });
  const jobs = data ?? [];
  const byState = new Map<JobState, typeof jobs>();
  for (const s of PIPELINE_STATES) byState.set(s, []);
  for (const j of jobs) byState.get(j.state as JobState)?.push(j);

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 md:px-8 pt-6 md:pt-10">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="text-ink-2 mt-1">{jobs.length} open job{jobs.length === 1 ? "" : "s"}. The assistant moves these as things happen.</p>
      </div>
      <div className="flex-1 overflow-x-auto px-4 md:px-8 py-6">
        <div className="flex gap-3 min-w-max">
          {PIPELINE_STATES.map((s) => {
            const list = byState.get(s)!;
            return (
              <div key={s} className="w-64 shrink-0">
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-sm font-medium">{STATE_LABELS[s]}</span>
                  <span className="text-xs text-ink-3 tabular-nums">{list.length}</span>
                </div>
                <div className="space-y-2 min-h-24 rounded-2xl bg-surface-2/60 p-2">
                  {list.map((j) => {
                    const c = j.customers as unknown as { name: string } | null;
                    return (
                      <Link key={j.id} href={`/jobs/${j.id}`} className="block card p-3 hover:border-accent transition-colors">
                        <div className="font-medium text-[15px] leading-snug">{j.title}</div>
                        <div className="text-sm text-ink-2 mt-0.5">{c?.name}</div>
                        <div className="text-xs text-ink-3 mt-2">{formatDistanceToNowStrict(new Date(j.last_activity_at))} ago</div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
