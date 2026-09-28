"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setQuickBooksWrites } from "@/app/actions";
import clsx from "clsx";

export function QuoForm() {
  const [apiKey, setApiKey] = useState("");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form
      className="mt-3 grid sm:grid-cols-[1fr_180px_auto] gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await fetch("/api/oauth/quo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, fromNumber: from }) });
        setBusy(false);
        setMsg(res.ok ? "Saved." : (await res.json()).error);
        if (res.ok) {
          setApiKey("");
          router.refresh();
        }
      }}
    >
      <input className="input" placeholder="Quo API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" autoComplete="off" />
      <input className="input" placeholder="+18015550142" value={from} onChange={(e) => setFrom(e.target.value)} />
      <button className="btn-primary" disabled={busy || !apiKey || !from}>Save</button>
      {msg && <p className="text-sm text-ink-2 sm:col-span-3">{msg}</p>}
    </form>
  );
}

export function QboWritesToggle({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  return (
    <button type="button" role="switch" aria-checked={on} disabled={pending} onClick={() => { const n = !on; setOn(n); start(() => setQuickBooksWrites(n)); }} className={clsx("relative h-7 w-12 rounded-full transition-colors shrink-0", on ? "bg-accent" : "bg-border")}>
      <span className={clsx("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}
