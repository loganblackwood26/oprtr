"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import clsx from "clsx";

interface Msg {
  role: "user" | "assistant";
  text: string;
  tools?: string[];
}

const TOOL_LABELS: Record<string, string> = {
  draft_estimate: "Pricing with your price book",
  propose_message: "Drafting a message for approval",
  get_job: "Looking at the job",
  list_jobs: "Checking the pipeline",
  get_customer: "Looking up the customer",
  search_memory: "Checking what you've told me",
  save_fact: "Saving that",
  remember: "Remembering that",
  save_sop: "Saving procedure",
  propose_price_book_item: "Adding to price book (needs your OK)",
  calendar_availability: "Checking the calendar",
  book_calendar_event: "Queuing a booking for approval",
  quickbooks_import_customers: "Pulling customers from QuickBooks",
  quickbooks_import_items: "Reading QuickBooks items",
  ask_owner: "Asking you a question",
  move_job: "Updating the job",
};

export function Chat({
  skillId,
  placeholder = "What needs to happen?",
  starter,
  suggestions,
  className,
}: {
  skillId?: string;
  placeholder?: string;
  starter?: string;
  suggestions?: string[];
  className?: string;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(starter ? [{ role: "assistant", text: starter }] : []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState<string | undefined>();
  const [activity, setActivity] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, activity]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: convId, skillId }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          if (!f.startsWith("data: ")) continue;
          const evt = JSON.parse(f.slice(6));
          if (evt.type === "conversation") setConvId(evt.id);
          else if (evt.type === "text") {
            setActivity(null);
            setMsgs((m) => {
              const last = m[m.length - 1];
              return [...m.slice(0, -1), { ...last, text: last.text + evt.delta }];
            });
          } else if (evt.type === "tool") setActivity(TOOL_LABELS[evt.name] ?? "Working…");
          else if (evt.type === "error") setMsgs((m) => [...m.slice(0, -1), { role: "assistant", text: `Something went wrong: ${evt.message}` }]);
        }
      }
    } catch (e) {
      setMsgs((m) => [...m.slice(0, -1), { role: "assistant", text: `Couldn't reach the assistant. ${e instanceof Error ? e.message : ""}` }]);
    } finally {
      setBusy(false);
      setActivity(null);
      ta.current?.focus();
    }
  }

  return (
    <div className={clsx("flex flex-col flex-1 min-h-0", className)}>
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5">
        {msgs.length === 0 && suggestions && (
          <div className="max-w-2xl mx-auto pt-10">
            <p className="text-ink-3 text-sm mb-3">Try</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="btn-outline h-auto py-2 text-left text-sm rounded-2xl">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={clsx("max-w-2xl mx-auto flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={clsx("rounded-2xl px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap max-w-[85%]", m.role === "user" ? "bg-accent text-white rounded-br-md" : "bg-surface border border-border rounded-bl-md")}>
              {m.text || (busy && i === msgs.length - 1 ? <span className="inline-flex items-center gap-2 text-ink-3"><Loader2 className="h-4 w-4 animate-spin" />{activity ?? "Thinking…"}</span> : "")}
            </div>
          </div>
        ))}
        {busy && activity && msgs[msgs.length - 1]?.text && (
          <div className="max-w-2xl mx-auto text-xs text-ink-3 flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />{activity}</div>
        )}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="px-4 md:px-8 pb-4 pt-2"
      >
        <div className="max-w-2xl mx-auto flex items-end gap-2 card p-2 pl-4 focus-within:border-accent">
          <textarea
            ref={ta}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder={placeholder}
            className="flex-1 resize-none bg-transparent outline-none py-2.5 text-[15px] max-h-40"
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 160) + "px";
            }}
          />
          <button className="btn-primary h-10 w-10 rounded-xl p-0 shrink-0" disabled={busy || !input.trim()} aria-label="Send">
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </form>
    </div>
  );
}
