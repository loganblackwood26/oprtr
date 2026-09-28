import Link from "next/link";
import { currentContext } from "@/lib/supabase/server";

export default async function CustomersPage() {
  const ctx = (await currentContext())!;
  const companyId = ctx.membership!.company_id as string;
  const { data } = await ctx.supabase.from("customers").select("id,name,phone,email,quickbooks_customer_id, jobs(id,title,state)").eq("company_id", companyId).order("name");
  const rows = data ?? [];
  return (
    <div className="px-4 md:px-8 pt-6 md:pt-10 max-w-3xl w-full mx-auto pb-10">
      <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
      <p className="text-ink-2 mt-1">{rows.length} total. Add one by telling the assistant, or import from QuickBooks in Settings.</p>
      <div className="card mt-6 divide-y divide-border">
        {rows.length === 0 && <div className="p-8 text-center text-ink-2">No customers yet.</div>}
        {rows.map((c) => {
          const jobs = (c.jobs as unknown as Array<{ id: string; title: string; state: string }>) ?? [];
          const open = jobs.filter((j) => !["lost", "nurture", "complete"].includes(j.state));
          return (
            <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-sm text-ink-2 truncate">{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact info"}</div>
              </div>
              <div className="text-right text-sm shrink-0">
                {open.length > 0 ? <Link href={`/jobs/${open[0].id}`} className="text-accent">{open.length === 1 ? open[0].title : `${open.length} open jobs`}</Link> : <span className="text-ink-3">{jobs.length} past</span>}
                {c.quickbooks_customer_id && <div className="text-[11px] text-ink-3">QuickBooks</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
