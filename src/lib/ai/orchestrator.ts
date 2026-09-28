import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompanyContext, renderCompanyContext } from "./memory";
import { SKILLS, skillIndex } from "./skills";
import { runTool, toAnthropicTools, type ToolContext } from "./tools";

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

export interface OrchestratorOptions {
  db: SupabaseClient;
  companyId: string;
  userId: string;
  role: string;
  /** Force a skill (used by routines). Otherwise the orchestrator picks. */
  skillId?: string;
  /** For chat: prior turns. */
  history?: Anthropic.MessageParam[];
  /** Streaming callback for text deltas. */
  onText?: (delta: string) => void;
  onToolUse?: (name: string, input: unknown) => void;
  maxTurns?: number;
}

function buildSystemPrompt(companyBlock: string, role: string, userName: string, skillId?: string, tz = "America/Denver"): string {
  const base = `You are the office manager for this business — the one person the owner talks to. You run everything else quietly underneath: estimating, follow-ups, scheduling, memory, bookkeeping sync.

Who you're talking to: ${userName} (role: ${role}). Current time: ${new Date().toLocaleString("en-US", { timeZone: tz })} (${tz}).

How you work:
- Be brief and plain. The owner is often in the field on a phone. Lead with the answer or the next step. No preambles.
- You never do math. Prices come from draft_estimate. Dates come from the job record or the calendar. If you don't have a number, say so and get it from a tool or the owner.
- You never send anything yourself. Texts, emails, estimates, calendar bookings, and QuickBooks writes go through tools that create approvals. Say "I've queued that for your approval" — never "sent".
- Ground everything in company memory below. If memory doesn't cover something, ask instead of assuming, and offer to remember the answer.
- When a request needs a specialist, adopt that specialist's rules (skills listed below). You can switch skills mid-task.
- If something can't be done yet (integration not connected, missing info), say exactly what's needed in one line.

Specialists available:
${skillIndex()}
`;
  const skill = skillId ? SKILLS[skillId] : undefined;
  const skillBlock = skill ? `\n---\nACTIVE SPECIALIST: ${skill.name}\n${skill.prompt}\n` : `\n---\nSpecialist rules (apply whichever fits the task):\n${Object.values(SKILLS).map((s) => `\n## ${s.name}\n${s.prompt}`).join("\n")}\n`;
  return `${base}${skillBlock}\n---\n${companyBlock}`;
}

export interface OrchestratorResult {
  text: string;
  messages: Anthropic.MessageParam[];
  usage: { input: number; output: number };
}

export async function runOrchestrator(userMessage: string, opts: OrchestratorOptions): Promise<OrchestratorResult> {
  const ctx = await loadCompanyContext(opts.db, opts.companyId);
  const { data: member } = await opts.db.from("memberships").select("display_name").eq("company_id", opts.companyId).eq("user_id", opts.userId).maybeSingle();
  const system = buildSystemPrompt(renderCompanyContext(ctx), opts.role, member?.display_name ?? "the owner", opts.skillId, ctx.company.timezone);

  const toolCtx: ToolContext = { db: opts.db, companyId: opts.companyId, userId: opts.userId, role: opts.role };
  const tools = toAnthropicTools(opts.skillId ? SKILLS[opts.skillId]?.tools : undefined);

  const messages: Anthropic.MessageParam[] = [...(opts.history ?? []), { role: "user", content: userMessage }];
  let finalText = "";
  const usage = { input: 0, output: 0 };
  const maxTurns = opts.maxTurns ?? 12;

  for (let turn = 0; turn < maxTurns; turn++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    });
    stream.on("text", (delta) => {
      finalText += delta;
      opts.onText?.(delta);
    });
    const response = await stream.finalMessage();
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      opts.onToolUse?.(block.name, block.input);
      const result = await runTool(toolCtx, block.name, block.input);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });
    finalText += "";
  }

  await opts.db.from("usage_events").insert({ company_id: opts.companyId, kind: "llm_tokens", quantity: usage.input + usage.output, metadata: { input: usage.input, output: usage.output, model: MODEL } }).then(() => undefined, () => undefined);

  return { text: finalText, messages, usage };
}
