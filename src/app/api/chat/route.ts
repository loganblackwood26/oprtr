import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { currentContext } from "@/lib/supabase/server";
import { runOrchestrator } from "@/lib/ai/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const ctx = await currentContext();
  if (!ctx?.membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { message, conversationId, skillId } = (await req.json()) as { message: string; conversationId?: string; skillId?: string };
  if (!message?.trim()) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const { supabase, user, membership } = ctx;
  const companyId = membership.company_id as string;

  // Load or create the conversation and its history
  let convId = conversationId;
  if (!convId) {
    const { data } = await supabase.from("conversations").insert({ company_id: companyId, user_id: user.id, title: message.slice(0, 60) }).select("id").single();
    convId = data!.id;
  }
  const { data: prior } = await supabase.from("chat_messages").select("role,content").eq("conversation_id", convId).order("created_at").limit(40);
  const history = (prior ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.content as Anthropic.MessageParam["content"] }));

  await supabase.from("chat_messages").insert({ conversation_id: convId, role: "user", content: message });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({ type: "conversation", id: convId });
      try {
        const res = await runOrchestrator(message, {
          db: supabase,
          companyId,
          userId: user.id,
          role: membership.role as string,
          skillId,
          history,
          onText: (delta) => send({ type: "text", delta }),
          onToolUse: (name) => send({ type: "tool", name }),
        });
        // Persist only the final assistant text (tool traffic is not replayed into history to keep it small)
        await supabase.from("chat_messages").insert({ conversation_id: convId, role: "assistant", content: res.text });
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
