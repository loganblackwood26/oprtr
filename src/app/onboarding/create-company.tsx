"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCompany } from "@/app/actions";

const TRADES = ["Landscaping", "HVAC", "Plumbing", "Electrical", "Concrete", "Roofing", "Painting", "General contractor", "Cleaning", "Other"];

export function CreateCompanyForm({ defaultEmail }: { defaultEmail: string }) {
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [me, setMe] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <form
      className="w-full max-w-sm space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            await createCompany({ name, trade, displayName: me, timezone: tz });
            router.refresh();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
        });
      }}
    >
      <div>
        <div className="h-10 w-10 rounded-xl bg-accent mb-4" />
        <h1 className="text-2xl font-semibold tracking-tight">Let&apos;s set up your business</h1>
        <p className="text-ink-2 mt-1">Signed in as {defaultEmail}. Three quick fields, then we talk.</p>
      </div>
      <label className="block text-sm"><div className="text-ink-2 mb-1">Your name</div><input className="input" value={me} onChange={(e) => setMe(e.target.value)} required autoFocus /></label>
      <label className="block text-sm"><div className="text-ink-2 mb-1">Business name</div><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label className="block text-sm">
        <div className="text-ink-2 mb-1">Trade</div>
        <select className="input" value={trade} onChange={(e) => setTrade(e.target.value)} required>
          <option value="" disabled>Pick one</option>
          {TRADES.map((t) => <option key={t} value={t.toLowerCase()}>{t}</option>)}
        </select>
      </label>
      {err && <p className="text-danger text-sm">{err}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Creating…" : "Continue"}</button>
    </form>
  );
}
