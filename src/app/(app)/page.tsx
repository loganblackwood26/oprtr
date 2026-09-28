import Link from "next/link";
import { currentContext } from "@/lib/supabase/server";
import { formatCents } from "@/lib/domain/pricing/engine";
import { STATE_LABELS, type JobState } from "@/lib/domain/lifecycle/states";
import { Chat } from "@/components/chat";
import { ApprovalCard } from "@/components/approval-card";
import { format } from "date-fns";

export default async function HomePage() {
  const ctx = (await currentContext())!;
  const companyId = ctx.membership!.company_id as string;
  const db = ctx.supabase;
  const now = new Date();
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);

  const [approvals, today, pipeline, revenue] = await Promise.all([
    db.from("approvals").select("*").eq("company_id", companyId).eq("status", "pending").order("created_at").limit(5),
    db.from("jobs").select("id,title,state,visit_at,start_at,customers(name)").eq("company_id", companyId).or(`visit_at.lte.${dayEnd.toISOString()},start_at.lte.${dayEnd.toISOString()}`).in("state", ["booked", "scheduled", "in_progress"]).order("visit_at").limit(8),
    db.from("jobs").select("state").eq("company_id", companyId),
    db.from("estimates").select("total_cents").eq("company_id", companyId).in("status", ["sent", "owner_approved"]),
  ]);

  const counts: Partial<Record<JobState, number>> = {};
  for (const j of pipeline.data ?? []) counts[j.state as JobState] = (counts[j.state as JobState] ?? 0) + 1;
  const open = (revenue.data ?? []).reduce((s, e) => s + e.total_cents, 0);
  const member = ctx.membership as { display_name?: string };
  const hour = now.getHours();
  const greet = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 md:px-8 pt-6 md:pt-10 max-w-5xl w-full mx-auto">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{greet}{member.display_name ? `, ${member.display_name.split(" ")[0]}` : ""}.</h1>
        <p className="text-ink-2 mt-1">
          {(approvals.data?.length ?? 0) > 0 ? `${approvals.data!.length} thing${approvals.data!.length === 1 ? "" : "s"} waiting on you.` : "Nothing waiting on you."}
          {" "}{counts.estimate_sent ? `${counts.estimate_sent} estimate${counts.estimate_sent === 1 ? "" : "s"} out (${formatCents(open)}).` : ""}
        </p>

        <div className="grid md:grid-cols-3 gap-3 mt-6">
          <Stat label="New leads" value={counts.lead ?? 0} href="/pipeline" />
          <Stat label="Estimates out" value={counts.estimate_sent ?? 0} sub={formatCents(open)} href="/pipeline" />
          <Stat label="Jobs in progress" value={(counts.scheduled ?? 0) + (counts.in_progress ?? 0)} href="/pipeline" />
        </div>

        {(approvals.data?.length ?? 0) > 0 && (
          <section className="mt-8">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-semibold">Needs your OK</h2>
              <Link href="/approvals" className="text-sm text-accent">See all</Link>
            </div>
            <div className="space-y-3">{approvals.data!.map((a) => <ApprovalCard key={a.id} approval={a} compact />)}</div>
          </section>
        )}

        {(today.data?.length ?? 0) > 0 && (
          <section className="mt-8">
            <h2 className="font-semibold mb-3">Today</h2>
            <div className="card divide-y divide-border">
              {today.data!.map((j) => {
                const c = j.customers as unknown as { name: string } | null;
                const when = j.state === "booked" ? j.visit_at : j.start_at;
                return (
                  <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2">
                    <div>
                      <div className="font-medium">{j.title}</div>
                      <div className="text-sm text-ink-2">{c?.name} · {STATE_LABELS[j.state as JobState]}</div>
                    </div>
                    {when && <div className="text-sm text-ink-2">{format(new Date(when), "h:mm a")}</div>}
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>
      <div className="mt-8 flex-1 flex flex-col min-h-[320px]">
        <Chat suggestions={["New lead: Sarah at 801-555-0142 wants a paver patio, about 400 sq ft", "What's waiting on me?", "Draft an estimate for the Hendricks job", "Who haven't we followed up with this week?"]} />
      </div>
    </div>
  );
}

function Stat({ label, value, sub, href }: { label: string; value: number; sub?: string; href: string }) {
  return (
    <Link href={href} className="card p-4 hover:bg-surface-2 transition-colors">
      <div className="text-sm text-ink-2">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}{sub && <span className="text-sm font-normal text-ink-3 ml-2">{sub}</span>}</div>
    </Link>
  );
}
