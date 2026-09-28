import type {
  Adjustment,
  Cents,
  EstimateInput,
  EstimateLineInput,
  EstimateLineResult,
  EstimateResult,
  PricingModel,
} from "./types";

/** Round half away from zero to an integer number of cents. */
export function roundCents(value: number): Cents {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Parse a dollars string/number into cents, throwing on garbage. */
export function toCents(dollars: number | string): Cents {
  const n = typeof dollars === "string" ? Number(dollars.replace(/[$,\s]/g, "")) : dollars;
  if (!Number.isFinite(n)) throw new Error(`Invalid money value: ${dollars}`);
  return roundCents(n * 100);
}

export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${rem.toString().padStart(2, "0")}`;
}

interface UnitBreakdown {
  unitPriceCents: Cents;
  unitMaterialCostCents: Cents;
  unitLaborCostCents: Cents;
  unit: string;
}

/** Compute the per-unit price and cost basis for a pricing model. */
export function unitBreakdown(model: PricingModel): UnitBreakdown {
  switch (model.kind) {
    case "unit":
      return {
        unitPriceCents: model.unitPriceCents,
        unitMaterialCostCents: 0,
        unitLaborCostCents: 0,
        unit: model.unit,
      };
    case "flat":
      return {
        unitPriceCents: model.priceCents,
        unitMaterialCostCents: 0,
        unitLaborCostCents: 0,
        unit: "each",
      };
    case "material_markup": {
      const raw = model.materialCostCents;
      const markedUp = raw * (1 + model.markupPct);
      const laborBase = model.laborOnMarkedUp ? markedUp : raw;
      const labor = laborBase * model.laborPctOfMaterial;
      return {
        unitPriceCents: roundCents(markedUp + labor),
        unitMaterialCostCents: raw,
        // Labor "cost" here is the labor charge; the business's real labor cost
        // is captured at job-costing time. We treat labor charge as cost basis
        // conservatively so margin reflects material markup only.
        unitLaborCostCents: roundCents(labor),
        unit: model.unit,
      };
    }
    case "material_plus_labor": {
      const mat = model.materialCostCents * (1 + model.materialMarkupPct);
      const lab = model.laborCostCents * (1 + model.laborMarkupPct);
      return {
        unitPriceCents: roundCents(mat + lab),
        unitMaterialCostCents: model.materialCostCents,
        unitLaborCostCents: model.laborCostCents,
        unit: model.unit,
      };
    }
  }
}

export function computeLine(input: EstimateLineInput): EstimateLineResult {
  if (!(input.quantity >= 0) || !Number.isFinite(input.quantity)) {
    throw new Error(`Invalid quantity for ${input.item.name}: ${input.quantity}`);
  }
  const { item } = input;
  const bd = unitBreakdown(item.model);
  const isFlat = item.model.kind === "flat";
  const qty = isFlat ? (input.quantity > 0 ? 1 : 0) : input.quantity;

  const overrideApplied = input.overrideUnitPriceCents !== undefined;
  const unitPriceCents = overrideApplied ? (input.overrideUnitPriceCents as Cents) : bd.unitPriceCents;

  let subtotal = roundCents(unitPriceCents * qty);
  let minimumApplied = false;
  if (item.minimumCents !== undefined && qty > 0 && subtotal < item.minimumCents) {
    subtotal = item.minimumCents;
    minimumApplied = true;
  }

  return {
    itemId: item.id,
    name: item.name,
    quantity: qty,
    unit: bd.unit,
    unitPriceCents,
    materialCostCents: roundCents(bd.unitMaterialCostCents * qty),
    laborCostCents: roundCents(bd.unitLaborCostCents * qty),
    subtotalCents: subtotal,
    taxable: item.taxable,
    minimumApplied,
    overrideApplied,
  };
}

function applyAdjustments(subtotal: Cents, adjustments: Adjustment[] | undefined): Cents {
  if (!adjustments?.length) return 0;
  let total = 0;
  for (const a of adjustments) {
    const hasAmt = a.amountCents !== undefined;
    const hasPct = a.pct !== undefined;
    if (hasAmt === hasPct) throw new Error(`Adjustment "${a.label}" must set exactly one of amountCents or pct`);
    total += hasAmt ? (a.amountCents as Cents) : roundCents(subtotal * (a.pct as number));
  }
  return total;
}

export function computeEstimate(input: EstimateInput): EstimateResult {
  if (!(input.taxRate >= 0 && input.taxRate < 1)) throw new Error(`Invalid tax rate: ${input.taxRate}`);
  const warnings: string[] = [];
  const lines = input.lines.map(computeLine);

  const subtotalCents = lines.reduce((s, l) => s + l.subtotalCents, 0);
  const adjustmentsCents = applyAdjustments(subtotalCents, input.adjustments);
  const adjustedSubtotalCents = subtotalCents + adjustmentsCents;
  if (adjustedSubtotalCents < 0) warnings.push("Adjustments exceed subtotal; total is negative.");

  // Tax applies to taxable lines only; adjustments are pro-rated across taxable share.
  const taxableLines = lines.reduce((s, l) => s + (l.taxable ? l.subtotalCents : 0), 0);
  const taxableShare = subtotalCents === 0 ? 0 : taxableLines / subtotalCents;
  const taxableBaseCents = roundCents(taxableLines + adjustmentsCents * taxableShare);
  const taxCents = roundCents(taxableBaseCents * input.taxRate);
  const totalCents = adjustedSubtotalCents + taxCents;

  let depositCents = 0;
  if (input.deposit) {
    depositCents =
      input.deposit.kind === "pct" ? roundCents(totalCents * input.deposit.pct) : input.deposit.amountCents;
    if (depositCents > totalCents) {
      warnings.push("Deposit exceeds total; capped at total.");
      depositCents = totalCents;
    }
  }

  const costBasisCents = lines.reduce((s, l) => s + l.materialCostCents + l.laborCostCents, 0);
  const grossMarginPct =
    adjustedSubtotalCents > 0 ? (adjustedSubtotalCents - costBasisCents) / adjustedSubtotalCents : null;
  const belowTargetMargin =
    input.targetMarginPct !== undefined && grossMarginPct !== null && grossMarginPct < input.targetMarginPct;
  if (belowTargetMargin) {
    warnings.push(
      `Gross margin ${(grossMarginPct! * 100).toFixed(1)}% is below target ${(input.targetMarginPct! * 100).toFixed(0)}%.`,
    );
  }
  for (const l of lines) {
    if (l.minimumApplied) warnings.push(`Minimum charge applied to "${l.name}".`);
    if (l.overrideApplied) warnings.push(`Owner price override on "${l.name}".`);
  }

  return {
    lines,
    subtotalCents,
    adjustmentsCents,
    adjustedSubtotalCents,
    taxableBaseCents,
    taxCents,
    totalCents,
    depositCents,
    costBasisCents,
    grossMarginPct,
    belowTargetMargin,
    warnings,
  };
}
