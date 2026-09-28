import { formatCents } from "@/lib/domain/pricing/engine";
import type { EstimateResult } from "@/lib/domain/pricing/types";

export function EstimateTable({ result, summary }: { result: EstimateResult; summary?: string | null }) {
  return (
    <div>
      {summary && <p className="text-[15px] leading-relaxed text-ink-2 mb-4 whitespace-pre-wrap">{summary}</p>}
      <div className="divide-y divide-border border-y border-border">
        {result.lines.map((l, i) => (
          <div key={i} className="py-3 flex items-baseline justify-between gap-4">
            <div>
              <div className="font-medium">{l.name}</div>
              <div className="text-sm text-ink-2 tabular-nums">{l.quantity} {l.unit} × {formatCents(l.unitPriceCents)}</div>
            </div>
            <div className="tabular-nums font-medium">{formatCents(l.subtotalCents)}</div>
          </div>
        ))}
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <Row k="Subtotal" v={formatCents(result.subtotalCents)} />
        {result.adjustmentsCents !== 0 && <Row k="Adjustments" v={formatCents(result.adjustmentsCents)} />}
        {result.taxCents > 0 && <Row k="Tax" v={formatCents(result.taxCents)} />}
        <div className="flex justify-between text-base font-semibold pt-2 border-t border-border mt-2"><dt>Total</dt><dd className="tabular-nums">{formatCents(result.totalCents)}</dd></div>
        {result.depositCents > 0 && <Row k="Deposit to start" v={formatCents(result.depositCents)} />}
      </dl>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-ink-2"><dt>{k}</dt><dd className="tabular-nums">{v}</dd></div>
  );
}
