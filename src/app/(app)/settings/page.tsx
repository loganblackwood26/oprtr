import Link from "next/link";
import { currentContext } from "@/lib/supabase/server";
import { formatCents } from "@/lib/domain/pricing/engine";
import { loadPolicy } from "@/lib/ai/actions";
import { DEFAULT_ROUTINES } from "@/lib/domain/lifecycle/routines";
import { ResetRuleButton, RoutineToggle, SettingsForm } from "./controls";

export default async function SettingsPage() {
  const ctx = (await currentContext())!;
  const companyId = ctx.membership!.company_id as string;
  const db = ctx.supabase;
  const [{ data: company }, { data: items }, { data: integrations }, { data: routines }, policy] = await Promise.all([
    db.from("companies").select("*").eq("id", companyId).single(),
    db.from("price_book_items").select("id,name,category,model,minimum_cents,taxable").eq("company_id", companyId).eq("active", true).order("category").order("name"),
    db.from("integrations").select("provider,external_id,writes_enabled,connected_at").eq("company_id", companyId),
    db.from("routines").select("routine_key,enabled").eq("company_id", companyId),
    loadPolicy(db, companyId),
  ]);
  const connected = new Map((integrations ?? []).map((i) => [i.provider, i]));
  const enabled = new Map((routines ?? []).map((r) => [r.routine_key, r.enabled]));
  const allowRules = policy.rules.filter((r) => r.mode !== "always_ask");

  return (
    <div className="px-4 md:px-8 pt-6 md:pt-10 max-w-3xl w-full mx-auto pb-16 space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-ink-2 mt-1">Most of this you can also change by just telling the assistant.</p>
      </div>

      <section>
        <h2 className="font-semibold mb-3">Connections</h2>
        <div className="card divide-y divide-border">
          <Conn name="QuickBooks Online" sub={connected.get("quickbooks") ? `Connected · ${connected.get("quickbooks")!.writes_enabled ? "reads + writes" : "read-only"}` : "Customers, items, estimates"} href="/api/oauth/quickbooks" connected={!!connected.get("quickbooks")} extra={connected.get("quickbooks") ? <Link href="/settings/integrations" className="text-sm text-accent">Manage</Link> : null} />
          <Conn name="Google (Gmail + Calendar)" sub={connected.get("google") ? `Connected · ${connected.get("google")!.external_id}` : "Send email as you, book visits"} href="/api/oauth/google" connected={!!connected.get("google")} />
          <Conn name="Quo (texting)" sub={connected.get("quo") ? `Connected · ${connected.get("quo")!.external_id}` : "Text customers from your business number"} href="/settings/integrations" connected={!!connected.get("quo")} />
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Money rules</h2>
        <SettingsForm company={{ name: company!.name, target_margin_pct: Number(company!.target_margin_pct), default_tax_rate: Number(company!.default_tax_rate), deposit_rule: company!.deposit_rule }} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold">Price book <span className="text-ink-3 font-normal">({items?.length ?? 0})</span></h2>
          <Link href="/chat" className="text-sm text-accent">Add via chat</Link>
        </div>
        <div className="card divide-y divide-border">
          {(items ?? []).length === 0 && <div className="p-6 text-center text-ink-2 text-sm">Empty. Tell the assistant how you price things and it&apos;ll propose items for your OK.</div>}
          {(items ?? []).map((it) => (
            <div key={it.id} className="px-4 py-3 flex justify-between gap-3 text-sm">
              <div><div className="font-medium">{it.name}</div><div className="text-ink-3 text-xs">{it.category ?? "Uncategorized"}{it.taxable ? "" : " · non-taxable"}{it.minimum_cents ? ` · min ${formatCents(it.minimum_cents)}` : ""}</div></div>
              <div className="text-ink-2 text-right tabular-nums">{describe(it.model)}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-1">Auto-allowed actions</h2>
        <p className="text-sm text-ink-2 mb-3">Everything else still asks you first.</p>
        <div className="card divide-y divide-border">
          {allowRules.length === 0 && <div className="p-6 text-center text-ink-2 text-sm">Nothing yet. Tap &ldquo;Always allow&rdquo; on an approval to add one.</div>}
          {allowRules.map((r, i) => (
            <div key={i} className="px-4 py-3 flex justify-between items-center text-sm">
              <div>
                <span className="font-medium">{r.action.replace("_", " ")}</span>
                {r.routineId && <span className="text-ink-3"> · {DEFAULT_ROUTINES.find((d) => d.id === r.routineId)?.name ?? r.routineId}</span>}
                <span className="text-ink-3"> · {typeof r.mode === "string" ? "always" : `up to ${formatCents(r.mode.maxAmountCents)}`}</span>
              </div>
              <ResetRuleButton action={r.action} routineId={r.routineId} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-1">Routines</h2>
        <p className="text-sm text-ink-2 mb-3">What the assistant does on its own schedule. Drafts still go to Approvals unless auto-allowed.</p>
        <div className="card divide-y divide-border">
          {DEFAULT_ROUTINES.map((r) => (
            <div key={r.id} className="px-4 py-3 flex justify-between items-center gap-3 text-sm">
              <div><div className="font-medium">{r.name}</div><div className="text-ink-3 text-xs">{r.intent}</div></div>
              <RoutineToggle routineKey={r.id} enabled={enabled.get(r.id) ?? r.enabledByDefault} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Conn({ name, sub, href, connected, extra }: { name: string; sub: string; href: string; connected: boolean; extra?: React.ReactNode }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div><div className="font-medium">{name}</div><div className="text-sm text-ink-2">{sub}</div></div>
      {connected ? (extra ?? <span className="pill bg-ok-soft text-ok">Connected</span>) : <Link href={href} className="btn-outline h-9">Connect</Link>}
    </div>
  );
}

function describe(m: { kind: string; [k: string]: unknown }): string {
  switch (m.kind) {
    case "unit": return `${formatCents(m.unitPriceCents as number)} / ${m.unit}`;
    case "flat": return `${formatCents(m.priceCents as number)} flat`;
    case "material_markup": return `${formatCents(m.materialCostCents as number)}/${m.unit} mat · +${Math.round((m.markupPct as number) * 100)}% · labor ${Math.round((m.laborPctOfMaterial as number) * 100)}%`;
    case "material_plus_labor": return `mat + labor / ${m.unit}`;
    default: return m.kind;
  }
}
