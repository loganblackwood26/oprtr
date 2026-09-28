import Link from "next/link";
import { currentContext } from "@/lib/supabase/server";
import { QuoForm, QboWritesToggle } from "./forms";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const { connected } = await searchParams;
  const ctx = (await currentContext())!;
  const companyId = ctx.membership!.company_id as string;
  const { data: rows } = await ctx.supabase.from("integrations").select("provider,external_id,writes_enabled,connected_at").eq("company_id", companyId);
  const by = new Map((rows ?? []).map((r) => [r.provider, r]));
  const qbo = by.get("quickbooks");
  const quo = by.get("quo");

  return (
    <div className="px-4 md:px-8 pt-6 md:pt-10 max-w-3xl w-full mx-auto pb-16 space-y-8">
      <div>
        <Link href="/settings" className="text-sm text-ink-3">← Settings</Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">Connections</h1>
        {connected && <p className="text-ok mt-1 text-sm">Connected {connected}.</p>}
      </div>

      <section className="card p-4">
        <h2 className="font-semibold">QuickBooks Online</h2>
        {qbo ? (
          <>
            <p className="text-sm text-ink-2 mt-1">Company {qbo.external_id} · connected {new Date(qbo.connected_at).toLocaleDateString()}</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-sm">Allow writes</div>
                <div className="text-xs text-ink-2">Off = read-only. On = the assistant can create customers and estimates in QuickBooks, each one still needing your approval unless you auto-allow it.</div>
              </div>
              <QboWritesToggle enabled={qbo.writes_enabled} />
            </div>
          </>
        ) : (
          <div className="mt-3"><Link href="/api/oauth/quickbooks" className="btn-primary">Connect QuickBooks</Link></div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="font-semibold">Quo (texting)</h2>
        <p className="text-sm text-ink-2 mt-1">Texts go out from your own Quo number. Paste an API key from Quo → Settings → API, and the number to send from. Then point a Quo webhook for incoming messages at <code className="text-xs bg-surface-2 px-1 rounded">{process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/quo</code>.</p>
        {quo && <p className="text-sm text-ok mt-2">Connected · sending from {quo.external_id}</p>}
        <QuoForm />
      </section>

      <section className="card p-4">
        <h2 className="font-semibold">Google</h2>
        <p className="text-sm text-ink-2 mt-1">Email is sent from your Gmail; visits and starts go on your primary calendar.</p>
        <div className="mt-3">{by.get("google") ? <span className="pill bg-ok-soft text-ok">Connected · {by.get("google")!.external_id}</span> : <Link href="/api/oauth/google" className="btn-primary">Connect Google</Link>}</div>
      </section>
    </div>
  );
}
