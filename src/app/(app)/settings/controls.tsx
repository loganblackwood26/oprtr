"use client";

import { useState, useTransition } from "react";
import { resetApprovalRule, toggleRoutine, updateCompanySettings } from "@/app/actions";
import clsx from "clsx";

export function SettingsForm({ company }: { company: { name: string; target_margin_pct: number; default_tax_rate: number; deposit_rule: { kind: string; pct?: number; amountCents?: number } | null } }) {
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [margin, setMargin] = useState(String(Math.round(company.target_margin_pct * 100)));
  const [tax, setTax] = useState(String(+(company.default_tax_rate * 100).toFixed(3)));
  const [dep, setDep] = useState(company.deposit_rule?.kind === "pct" ? String(Math.round((company.deposit_rule.pct ?? 0) * 100)) : "");

  return (
    <form
      className="card p-4 grid sm:grid-cols-3 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await updateCompanySettings({
            target_margin_pct: Number(margin) / 100,
            default_tax_rate: Number(tax) / 100,
            deposit_rule: dep ? { kind: "pct", pct: Number(dep) / 100 } : null,
          });
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        });
      }}
    >
      <Field label="Target gross margin %" value={margin} onChange={setMargin} />
      <Field label="Sales tax %" value={tax} onChange={setTax} />
      <Field label="Deposit % (blank = none)" value={dep} onChange={setDep} />
      <div className="sm:col-span-3 flex justify-end">
        <button className="btn-primary" disabled={pending}>{saved ? "Saved" : pending ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-sm">
      <div className="text-ink-2 mb-1">{label}</div>
      <input className="input" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function RoutineToggle({ routineKey, enabled }: { routineKey: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={pending}
      onClick={() => {
        const next = !on;
        setOn(next);
        start(() => toggleRoutine(routineKey, next));
      }}
      className={clsx("relative h-7 w-12 rounded-full transition-colors shrink-0", on ? "bg-accent" : "bg-border")}
    >
      <span className={clsx("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

export function ResetRuleButton({ action, routineId }: { action: string; routineId?: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="btn-ghost h-8 text-sm" disabled={pending} onClick={() => start(() => resetApprovalRule(action, routineId))}>Ask me again</button>
  );
}
