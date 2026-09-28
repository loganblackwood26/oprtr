import { NextResponse } from "next/server";
import { currentContext } from "@/lib/supabase/server";
import { decideApproval } from "@/lib/ai/actions";
import { runOrchestrator } from "@/lib/ai/orchestrator";

export const runtime = "nodejs";

/**
 * POST /api/approvals/:id  { decision: "approve"|"reject"|"answer", alwaysAllow?: boolean, answer?: string }
 * - approve/reject: executes or discards the stored payload.
 * - answer: for ask_owner questions; feeds the answer back to the AI which then acts.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await currentContext();
  if (!ctx?.membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.membership.role === "crew") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json()) as { decision: "approve" | "reject" | "answer"; alwaysAllow?: boolean; answer?: string };
  const companyId = ctx.membership.company_id as string;

  try {
    if (body.decision === "answer") {
      const { data: q } = await ctx.supabase.from("approvals").select("*").eq("id", id).eq("company_id", companyId).eq("status", "pending").single();
      if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });
      await ctx.supabase.from("approvals").update({ status: "approved", decided_by: ctx.user.id, decided_at: new Date().toISOString(), payload: { ...q.payload, answer: body.answer } }).eq("id", id);
      const res = await runOrchestrator(
        `The owner answered your question "${q.summary}" with: "${body.answer}". Job: ${q.job_id ?? "n/a"}. Act on it now (move the job, start an estimate, queue a follow-up, etc.), then confirm in one line.`,
        { db: ctx.supabase, companyId, userId: ctx.user.id, role: ctx.membership.role as string, maxTurns: 8 },
      );
      return NextResponse.json({ ok: true, reply: res.text });
    }
    const result = await decideApproval(ctx.supabase, companyId, id, ctx.user.id, body.decision, body.alwaysAllow);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
