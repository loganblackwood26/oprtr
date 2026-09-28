"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, MessageSquareText, Mail, CalendarPlus, FileText, BookOpen, Landmark } from "lucide-react";
import clsx from "clsx";
import { formatCents } from "@/lib/domain/pricing/engine";

export interface ApprovalRow {
  id: string;
  action: string;
  summary: string;
  amount_cents: number | null;
  payload: Record<string, unknown> & { type?: string; question?: string; options?: string[]; body?: string; messageId?: string };
  job_id: string | null;
  routine_id: string | null;
  created_at: string;
  /** joined for display */
  messages?: { body: string; subject: string | null; channel: string } | null;
}

const ICONS: Record<string, React.ElementType> = {
  send_sms: MessageSquareText,
  send_email: Mail,
  send_estimate: FileText,
  calendar_write: CalendarPlus,
  quickbooks_write: Landmark,
  price_book_write: BookOpen,
  ask_owner: MessageSquareText,
};

export function ApprovalCard({ approval: a, compact }: { approval: ApprovalRow; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const Icon = ICONS[a.action] ?? FileText;
  const isQuestion = a.action === "ask_owner";

  async function decide(decision: "approve" | "reject" | "answer", extra: Record<string, unknown> = {}) {
    setBusy(decision + (extra.answer ?? "") + (extra.alwaysAllow ? "!" : ""));
    const res = await fetch(`/api/approvals/${a.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, ...extra }) });
    const j = await res.json();
    setBusy(null);
    if (!res.ok) {
      setDone(`Failed: ${j.error}`);
      return;
    }
    setDone(decision === "reject" ? "Skipped" : decision === "answer" ? "Answered" : extra.alwaysAllow ? "Done — always allowed from now on" : "Done");
    if (j.reply) setReply(j.reply);
    router.refresh();
  }

  const body = a.messages?.body ?? (typeof a.payload.body === "string" ? a.payload.body : null);

  return (
    <div className={clsx("card overflow-hidden", done && "opacity-70")}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0"><Icon className="h-[18px] w-[18px]" /></div>
          <div className="min-w-0 flex-1">
            <div className="font-medium leading-snug">{a.summary}</div>
            <div className="text-xs text-ink-3 mt-0.5">
              {a.amount_cents ? formatCents(a.amount_cents) + " · " : ""}
              {a.routine_id ? "Routine · " : ""}
              {new Date(a.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
        </div>
        {body && !compact && (
          <div className="mt-3 rounded-xl bg-surface-2 px-3.5 py-3 text-[15px] whitespace-pre-wrap leading-relaxed">
            {a.messages?.subject && <div className="font-medium mb-1">{a.messages.subject}</div>}
            {body}
          </div>
        )}
        {body && compact && <div className="mt-2 text-sm text-ink-2 line-clamp-2">{body}</div>}
        {reply && <div className="mt-3 text-sm text-ink-2 border-l-2 border-accent pl-3">{reply}</div>}
      </div>
      {done ? (
        <div className="px-4 py-2.5 bg-surface-2 text-sm text-ink-2">{done}</div>
      ) : isQuestion ? (
        <div className="px-4 pb-4 flex flex-wrap gap-2">
          {(a.payload.options ?? []).map((o) => (
            <button key={o} className="btn-outline flex-1 min-w-[40%]" disabled={!!busy} onClick={() => decide("answer", { answer: o })}>
              {busy === "answer" + o ? <Loader2 className="h-4 w-4 animate-spin" /> : o}
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 pb-4 flex gap-2">
          <button className="btn-primary flex-1" disabled={!!busy} onClick={() => decide("approve")}>
            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4" /> Approve</>}
          </button>
          <button className="btn-outline" disabled={!!busy} onClick={() => decide("approve", { alwaysAllow: true })} title="Approve and don't ask again for this kind of action">
            {busy === "approve!" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Always allow"}
          </button>
          <button className="btn-ghost px-3" disabled={!!busy} onClick={() => decide("reject")} aria-label="Skip">
            {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );
}
