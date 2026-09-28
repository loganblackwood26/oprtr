import { currentContext } from "@/lib/supabase/server";
import { ApprovalCard, type ApprovalRow } from "@/components/approval-card";

export default async function ApprovalsPage() {
  const ctx = (await currentContext())!;
  const companyId = ctx.membership!.company_id as string;
  const { data } = await ctx.supabase.from("approvals").select("*").eq("company_id", companyId).eq("status", "pending").order("created_at");
  const rows = (data ?? []) as ApprovalRow[];

  // Attach message bodies for message-type approvals
  const msgIds = rows.map((r) => r.payload?.messageId).filter(Boolean) as string[];
  if (msgIds.length) {
    const { data: msgs } = await ctx.supabase.from("messages").select("id,body,subject,channel").in("id", msgIds);
    const byId = new Map((msgs ?? []).map((m) => [m.id, m]));
    for (const r of rows) if (r.payload?.messageId) r.messages = byId.get(r.payload.messageId) ?? null;
  }

  return (
    <div className="px-4 md:px-8 pt-6 md:pt-10 max-w-3xl w-full mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
      <p className="text-ink-2 mt-1">Nothing goes out without your OK. Tap <span className="font-medium">Always allow</span> to stop being asked for that kind of thing.</p>
      <div className="mt-6 space-y-3">
        {rows.length === 0 && <div className="card p-8 text-center text-ink-2">All clear.</div>}
        {rows.map((a) => <ApprovalCard key={a.id} approval={a} />)}
      </div>
    </div>
  );
}
