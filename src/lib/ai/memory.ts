import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCents, unitBreakdown } from "@/lib/domain/pricing/engine";
import type { PricingModel } from "@/lib/domain/pricing/types";

/**
 * Company memory = the exact stuff (facts, price book, SOPs) + freeform chunks
 * found by similarity search. This module turns it into text the model reads.
 */

export interface CompanyContext {
  company: {
    id: string;
    name: string;
    trade: string | null;
    timezone: string;
    target_margin_pct: number;
    default_tax_rate: number;
    deposit_rule: unknown;
    onboarding_completed_at: string | null;
  };
  facts: Record<string, unknown>;
  priceBook: Array<{ id: string; name: string; category: string | null; model: PricingModel; minimum_cents: number | null; taxable: boolean }>;
  sops: Array<{ id: string; title: string; trigger_hint: string | null; body: string }>;
}

export async function loadCompanyContext(db: SupabaseClient, companyId: string): Promise<CompanyContext> {
  const [companyRes, factsRes, priceRes, sopRes] = await Promise.all([
    db.from("companies").select("*").eq("id", companyId).single(),
    db.from("memory_facts").select("key,value").eq("company_id", companyId),
    db.from("price_book_items").select("id,name,category,model,minimum_cents,taxable").eq("company_id", companyId).eq("active", true).order("category").order("name"),
    db.from("sops").select("id,title,trigger_hint,body").eq("company_id", companyId).eq("active", true),
  ]);
  if (companyRes.error) throw companyRes.error;
  const facts: Record<string, unknown> = {};
  for (const f of factsRes.data ?? []) facts[f.key] = f.value;
  return {
    company: companyRes.data,
    facts,
    priceBook: (priceRes.data ?? []) as CompanyContext["priceBook"],
    sops: sopRes.data ?? [],
  };
}

function describeModel(m: PricingModel): string {
  const bd = unitBreakdown(m);
  switch (m.kind) {
    case "unit":
      return `${formatCents(m.unitPriceCents)} per ${m.unit}`;
    case "flat":
      return `${formatCents(m.priceCents)} flat`;
    case "material_markup":
      return `material ${formatCents(m.materialCostCents)}/${m.unit} + ${Math.round(m.markupPct * 100)}% markup + labor ${Math.round(m.laborPctOfMaterial * 100)}% of material = ${formatCents(bd.unitPriceCents)}/${m.unit}`;
    case "material_plus_labor":
      return `${formatCents(bd.unitPriceCents)}/${m.unit} (material + labor, each marked up)`;
  }
}

/** Render memory as a compact block for the system prompt. */
export function renderCompanyContext(ctx: CompanyContext): string {
  const { company, facts, priceBook, sops } = ctx;
  const lines: string[] = [];
  lines.push(`# Company: ${company.name}${company.trade ? ` (${company.trade})` : ""}`);
  lines.push(`Timezone: ${company.timezone}. Target gross margin: ${Math.round(company.target_margin_pct * 100)}%. Default tax rate: ${(company.default_tax_rate * 100).toFixed(2)}%.`);
  if (company.deposit_rule) lines.push(`Deposit rule: ${JSON.stringify(company.deposit_rule)}`);

  const factKeys = Object.keys(facts).sort();
  if (factKeys.length) {
    lines.push(`\n## Facts the owner told us (treat as ground truth)`);
    for (const k of factKeys) {
      const v = facts[k];
      lines.push(`- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }

  if (priceBook.length) {
    lines.push(`\n## Price book (${priceBook.length} items). Use draft_estimate — never compute prices yourself.`);
    let cat: string | null | undefined;
    for (const it of priceBook) {
      if (it.category !== cat) {
        cat = it.category;
        lines.push(`### ${cat ?? "Uncategorized"}`);
      }
      lines.push(`- [${it.id}] ${it.name}: ${describeModel(it.model)}${it.minimum_cents ? `, min ${formatCents(it.minimum_cents)}` : ""}${it.taxable ? "" : ", non-taxable"}`);
    }
  }

  if (sops.length) {
    lines.push(`\n## Standard operating procedures`);
    for (const s of sops) lines.push(`### ${s.title}${s.trigger_hint ? ` (when: ${s.trigger_hint})` : ""}\n${s.body}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Embeddings + similarity search (Voyage AI)
// ---------------------------------------------------------------------------

export async function embed(texts: string[]): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY not set");
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: texts, model: "voyage-3.5", output_dimension: 1536 }),
  });
  if (!res.ok) throw new Error(`Voyage error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

export async function rememberChunk(
  db: SupabaseClient,
  companyId: string,
  chunk: { kind: string; title?: string; content: string; metadata?: Record<string, unknown> },
) {
  let embedding: number[] | null = null;
  try {
    [embedding] = await embed([chunk.content]);
  } catch {
    // store without embedding; a backfill job can embed later
  }
  const { error } = await db.from("memory_chunks").insert({
    company_id: companyId,
    kind: chunk.kind,
    title: chunk.title ?? null,
    content: chunk.content,
    embedding,
    metadata: chunk.metadata ?? {},
  });
  if (error) throw error;
}

export async function searchMemory(db: SupabaseClient, companyId: string, query: string, k = 8) {
  const [q] = await embed([query]);
  const { data, error } = await db.rpc("match_memory", { cid: companyId, query: q, k });
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; kind: string; title: string | null; content: string; similarity: number }>;
}
