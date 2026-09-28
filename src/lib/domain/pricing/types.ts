/**
 * Pricing domain types.
 *
 * Everything here is deterministic. The AI proposes *which* items and *what*
 * quantities; this module owns every number that ends up on an estimate.
 * All money is stored in integer cents to avoid floating-point drift.
 */

export type Cents = number;

/** How a single price-book item turns a quantity into a price. */
export type PricingModel =
  /** price per unit of measure (sq ft, linear ft, each, hour, ...) */
  | { kind: "unit"; unitPriceCents: Cents; unit: string }
  /** one fixed price regardless of quantity */
  | { kind: "flat"; priceCents: Cents }
  /**
   * Material cost with markup, plus labor as a percentage of material cost.
   * This is the Blackwood model: material × (1 + markup) + material × laborPct.
   * `materialCostCents` is per unit; quantity multiplies it.
   */
  | {
      kind: "material_markup";
      materialCostCents: Cents;
      unit: string;
      /** e.g. 0.5 for 50% markup on material */
      markupPct: number;
      /** e.g. 0.35 for labor = 35% of raw material cost. Applied to raw cost, not marked-up cost. */
      laborPctOfMaterial: number;
      /** If true, labor % applies to marked-up material rather than raw cost. Default false. */
      laborOnMarkedUp?: boolean;
    }
  /** explicit material + labor per unit, each with its own markup */
  | {
      kind: "material_plus_labor";
      unit: string;
      materialCostCents: Cents;
      materialMarkupPct: number;
      laborCostCents: Cents;
      laborMarkupPct: number;
    };

export interface PriceBookItem {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  category?: string;
  model: PricingModel;
  /** Minimum charge for this item on any estimate, in cents. */
  minimumCents?: Cents;
  taxable: boolean;
  active: boolean;
}

export interface EstimateLineInput {
  priceBookItemId?: string;
  /** Snapshot of the item at time of estimate; required if no priceBookItemId resolves. */
  item: PriceBookItem;
  quantity: number;
  /** Optional per-line override the OWNER set (never the AI). */
  overrideUnitPriceCents?: Cents;
  note?: string;
}

export interface EstimateLineResult {
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  unitPriceCents: Cents;
  /** Raw material cost (pre-markup) for margin analysis. 0 if not applicable. */
  materialCostCents: Cents;
  laborCostCents: Cents;
  subtotalCents: Cents;
  taxable: boolean;
  minimumApplied: boolean;
  overrideApplied: boolean;
}

export interface Adjustment {
  /** e.g. "Senior discount", "Rush fee" */
  label: string;
  /** Positive adds, negative discounts. Exactly one of the two. */
  amountCents?: Cents;
  /** e.g. -0.10 for 10% off subtotal */
  pct?: number;
}

export interface EstimateInput {
  lines: EstimateLineInput[];
  adjustments?: Adjustment[];
  /** e.g. 0.0725 */
  taxRate: number;
  /** Company target margin, e.g. 0.40. Used only to flag, never to change numbers. */
  targetMarginPct?: number;
  /** Optional deposit rule */
  deposit?: { kind: "pct"; pct: number } | { kind: "fixed"; amountCents: Cents };
}

export interface EstimateResult {
  lines: EstimateLineResult[];
  subtotalCents: Cents;
  adjustmentsCents: Cents;
  adjustedSubtotalCents: Cents;
  taxableBaseCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  depositCents: Cents;
  /** Sum of raw material + raw labor across lines */
  costBasisCents: Cents;
  /** (adjustedSubtotal - costBasis) / adjustedSubtotal; null if subtotal is 0 */
  grossMarginPct: number | null;
  /** True if grossMarginPct < targetMarginPct (when target provided). */
  belowTargetMargin: boolean;
  warnings: string[];
}
