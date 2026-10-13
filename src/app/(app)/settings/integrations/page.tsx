import Link from "next/link";
import { currentContext } from "@/lib/supabase/server";
import { connectionStatus, TOOLKIT_LABEL, type Toolkit } from "@/lib/integrations/composio";
import { QuoForm, QboWritesToggle, DisconnectButton } from "./forms";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { connected, error } = await searchParams;
  const ctx = (await currentContext())!;
  const companyId = ctx.membership!.company_id as string;
  const [{ data: rows }, status] = await Promise.all([
    ctx.supabase.from("integrations").select("provider,external_id,writes_enabled,connected_at").eq("company_id", companyId),
    connectionStatus(companyId).catch(() => [] as Awaited<ReturnType<typeof connectionStatus>>),
  ]);
  const by = new Map((rows ?? []).map((r) => [r.provider, r]));
  const quo = by.get("quo");
  const qboRow = by.get("quickbooks");
  const is = (t: Toolkit) => status.find((s) => s.toolkit === t)?.connected ?? false;

  return (
    <div className="px-4 md:px-8 pt-6 md:pt-10 max-w-3xl w-full mx-auto pb-16 space-y-8">
      <div>
        <Link href="/settings" className="text-sm text-ink-3">← Settings</Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">Connections</h1>
        <p className="text-ink-2 mt-1">Each one is a single sign-in. You can disconnect any time.</p>
        {connected && <p className="text-ok mt-2 text-sm">Connected {TOOLKIT_LABEL[connected as Toolkit] ?? connected}.</p>}
        {error && <p className="text-danger mt-2 text-sm">Couldn&apos;t connect: {error}</p>}
      </div>

      <Card title="QuickBooks Online" sub="Customers, items, and estimates stay in sync." connected={is("quickbooks")} toolkit="quickbooks">
        {is("quickbooks") && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <div className="font-medium text-sm">Allow writes</div>
              <div className="text-xs text-ink-2">Off = read-only. On = the assistant can create customers and estimates in QuickBooks, each one still needing your approval unless you auto-allow it.</div>
            </div>
            <QboWritesToggle enabled={!!qboRow?.writes_enabled} />
          </div>
        )}
      </Card>

      <Card title="Gmail" sub="Emails to customers go out from your own inbox." connected={is("gmail")} toolkit="gmail" />
      <Card title="Google Calendar" sub="Visits and job starts land on your primary calendar." connected={is("googlecalendar")} toolkit="googlecalendar" />

      <section className="card p-4">
        <h2 className="font-semibold">Quo (texting)</h2>
        <p className="text-sm text-ink-2 mt-1">
          Texts go out from your own Quo number. Paste an API key from Quo → Settings → API, and the number to send from. Then point a Quo webhook for incoming messages at{" "}
          <code className="text-xs bg-surface-2 px-1 rounded">{process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/quo</code>.
        </p>
        {quo ? (
          <div className="mt-3 flex items-center justify-between"><span className="pill bg-ok-soft text-ok">Connected · sending from {quo.external_id}</span><DisconnectButton toolkit="quo" /></div>
        ) : (
          <QuoForm />
        )}
      </section>
    </div>
  );
}

function Card({ title, sub, connected, toolkit, children }: { title: string; sub: string; connected: boolean; toolkit: Toolkit; children?: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="font-semibold">{title}</h2><p className="text-sm text-ink-2 mt-0.5">{sub}</p></div>
        {connected ? (
          <div className="flex items-center gap-2"><span className="pill bg-ok-soft text-ok">Connected</span><DisconnectButton toolkit={toolkit} /></div>
        ) : (
          <a href={`/api/connect/${toolkit}`} className="btn-primary h-9 shrink-0">Connect</a>
        )}
      </div>
      {children}
    </section>
  );
}
