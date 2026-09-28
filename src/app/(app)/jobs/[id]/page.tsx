import Link from "next/link";
import { notFound } from "next/navigation";
import { currentContext } from "@/lib/supabase/server";
import { STATE_LABELS, type JobState } from "@/lib/domain/lifecycle/states";
import { formatCents } from "@/lib/domain/pricing/engine";
import type { EstimateResult } from "@/lib/domain/pricing/types";
import { EstimateTable } from "@/components/estimate-table";
import { ApproveEstimateButton } from "./approve-button";
import { format } from "date-fns";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = (await currentContext())!;
  const companyId = ctx.membership!.company_id as string;
  const role = ctx.membership!.role as string;
  const db = ctx.supabase;
  const [{ data: job }, { data: estimates }, { data: events }, { data: msgs }] = await Promise.all([
    db.from("jobs").select("*, customers(*)").eq("id", id).eq("company_id", companyId).maybeSingle(),
    role === "crew" ? Promise.resolve({ data: [] }) : db.from("estimates").select("*").eq("job_id", id).order("version", { ascending: false }),
    db.from("job_events").select("*").eq("job_id", id).order("created_at", { ascending: false }).limit(30),
    db.from("messages").select("*").eq("job_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (!job) notFound();
  const customer = job.customers as { name: string; phone: string | null; email: string | null; address: { line1?: string } | null };
  const latest = estimates?.[0];
  const result = latest?.result as EstimateResult | undefined;

  return (
    <div className="px-4 md:px-8 pt-6 md:pt-10 max-w-3xl w-full mx-auto pb-10">
      <Link href="/pipeline" className="text-sm text-ink-3">← Pipeline</Link>
      <div className="flex items-start justify-between gap-4 mt-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
          <p className="text-ink-2 mt-1">{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}{customer.email ? ` · ${customer.email}` : ""}</p>
          {(job.site_address?.line1 ?? customer.address?.line1) && <p className="text-ink-3 text-sm">{job.site_address?.line1 ?? customer.address?.line1}</p>}
        </div>
        <span className="pill bg-accent-soft text-accent shrink-0">{STATE_LABELS[job.state as JobState]}</span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-5 text-sm">
        <Info label="Visit" value={job.visit_at ? format(new Date(job.visit_at), "EEE MMM d, h:mm a") : "—"} />
        <Info label="Start" value={job.start_at ? format(new Date(job.start_at), "EEE MMM d") : "—"} />
        <Info label="Source" value={job.source ?? "—"} />
      </div>

      {job.visit_notes && (
        <section className="mt-6">
          <h2 className="font-semibold mb-2">Notes</h2>
          <div className="card p-4 text-[15px] whitespace-pre-wrap leading-relaxed">{job.visit_notes}</div>
        </section>
      )}

      {latest && result && (
        <section className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Estimate <span className="text-ink-3 font-normal">v{latest.version}</span></h2>
            <span className="pill bg-surface-2 text-ink-2 capitalize">{String(latest.status).replace("_", " ")}</span>
          </div>
          <div className="card p-4">
            <EstimateTable result={result} summary={latest.customer_summary} />
            {result.warnings.length > 0 && (
              <ul className="mt-4 space-y-1">
                {result.warnings.map((w, i) => <li key={i} className="text-sm text-warn bg-warn-soft rounded-lg px-3 py-1.5">{w}</li>)}
              </ul>
            )}
            {result.grossMarginPct !== null && <p className="text-xs text-ink-3 mt-3">Gross margin {(result.grossMarginPct * 100).toFixed(1)}% · cost basis {formatCents(result.costBasisCents)}</p>}
            {latest.status === "draft" && role !== "crew" && (
              <div className="mt-4 flex gap-2">
                <ApproveEstimateButton estimateId={latest.id} />
                <Link href={`/chat`} className="btn-outline">Ask for changes</Link>
              </div>
            )}
            {latest.status === "owner_approved" && (
              <p className="mt-4 text-sm text-ink-2">Approved. Tell the assistant to send it (&ldquo;send the estimate to {customer.name.split(" ")[0]}&rdquo;) and you&apos;ll get one last OK on the message.</p>
            )}
          </div>
        </section>
      )}

      {(msgs?.length ?? 0) > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold mb-2">Messages</h2>
          <div className="space-y-2">
            {msgs!.map((m) => (
              <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] whitespace-pre-wrap ${m.direction === "outbound" ? "ml-auto bg-accent-soft/60" : "bg-surface border border-border"}`}>
                {m.subject && <div className="font-medium text-sm">{m.subject}</div>}
                {m.body}
                <div className="text-[11px] text-ink-3 mt-1 capitalize">{m.channel} · {m.status.replace("_", " ")} · {format(new Date(m.created_at), "MMM d, h:mm a")}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-semibold mb-2">History</h2>
        <ol className="card divide-y divide-border text-sm">
          {(events ?? []).map((e) => (
            <li key={e.id} className="px-4 py-2.5 flex justify-between gap-3">
              <span className="text-ink-2">
                {e.kind === "state_change" ? `${e.from_state ? STATE_LABELS[e.from_state as JobState] + " → " : ""}${STATE_LABELS[e.to_state as JobState]}` : e.kind === "routine_fired" ? `Routine: ${e.payload?.routine}` : e.kind === "note" ? "Note added" : e.kind.replace("_", " ")}
                <span className="text-ink-3"> · {e.actor}</span>
              </span>
              <span className="text-ink-3 shrink-0">{format(new Date(e.created_at), "MMM d, h:mm a")}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3"><div className="text-ink-3 text-xs">{label}</div><div className="font-medium mt-0.5">{value}</div></div>
  );
}
