import { describe, expect, it } from "vitest";
import { computeEstimate, computeLine, formatCents, toCents, unitBreakdown } from "./engine";
import type { PriceBookItem } from "./types";

const base = { companyId: "c1", taxable: true, active: true };

const sodPerSqft: PriceBookItem = {
  ...base,
  id: "sod",
  name: "Sod install",
  model: { kind: "unit", unitPriceCents: 185, unit: "sq ft" }, // $1.85/sqft
};

const paverPatio: PriceBookItem = {
  ...base,
  id: "pavers",
  name: "Paver patio",
  // Blackwood model: material $10/sqft, 50% markup, labor 35% of material
  model: {
    kind: "material_markup",
    materialCostCents: 1000,
    unit: "sq ft",
    markupPct: 0.5,
    laborPctOfMaterial: 0.35,
  },
};

const tripFee: PriceBookItem = {
  ...base,
  id: "trip",
  name: "Trip charge",
  taxable: false,
  model: { kind: "flat", priceCents: 7500 },
};

describe("money helpers", () => {
  it("parses dollars to cents", () => {
    expect(toCents("$1,234.56")).toBe(123456);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(() => toCents("abc")).toThrow();
  });
  it("formats cents", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-5)).toBe("-$0.05");
  });
});

describe("unitBreakdown", () => {
  it("material_markup: material*(1+markup) + material*laborPct", () => {
    const bd = unitBreakdown(paverPatio.model);
    // 1000*1.5 = 1500 ; labor 1000*0.35 = 350 ; total 1850
    expect(bd.unitPriceCents).toBe(1850);
    expect(bd.unitMaterialCostCents).toBe(1000);
    expect(bd.unitLaborCostCents).toBe(350);
  });
  it("material_markup with labor on marked-up base", () => {
    const bd = unitBreakdown({ ...paverPatio.model, laborOnMarkedUp: true } as typeof paverPatio.model);
    // labor 1500*0.35 = 525 ; total 2025
    expect(bd.unitPriceCents).toBe(2025);
  });
  it("material_plus_labor", () => {
    const bd = unitBreakdown({
      kind: "material_plus_labor",
      unit: "lf",
      materialCostCents: 2000,
      materialMarkupPct: 0.25,
      laborCostCents: 1000,
      laborMarkupPct: 0.5,
    });
    expect(bd.unitPriceCents).toBe(2500 + 1500);
  });
});

describe("computeLine", () => {
  it("multiplies unit price by quantity", () => {
    const l = computeLine({ item: sodPerSqft, quantity: 1200 });
    expect(l.subtotalCents).toBe(222000);
  });
  it("flat items ignore quantity", () => {
    expect(computeLine({ item: tripFee, quantity: 3 }).subtotalCents).toBe(7500);
    expect(computeLine({ item: tripFee, quantity: 0 }).subtotalCents).toBe(0);
  });
  it("applies minimum charge", () => {
    const l = computeLine({ item: { ...sodPerSqft, minimumCents: 50000 }, quantity: 10 });
    expect(l.subtotalCents).toBe(50000);
    expect(l.minimumApplied).toBe(true);
  });
  it("honors owner override", () => {
    const l = computeLine({ item: sodPerSqft, quantity: 100, overrideUnitPriceCents: 200 });
    expect(l.subtotalCents).toBe(20000);
    expect(l.overrideApplied).toBe(true);
  });
  it("rejects bad quantities", () => {
    expect(() => computeLine({ item: sodPerSqft, quantity: -1 })).toThrow();
    expect(() => computeLine({ item: sodPerSqft, quantity: NaN })).toThrow();
  });
});

describe("computeEstimate", () => {
  it("computes a full Blackwood-style estimate", () => {
    const r = computeEstimate({
      lines: [
        { item: paverPatio, quantity: 400 }, // 400 * 1850 = 740000
        { item: sodPerSqft, quantity: 1000 }, // 185000
        { item: tripFee, quantity: 1 }, // 7500 non-taxable
      ],
      taxRate: 0.0725,
      targetMarginPct: 0.4,
    });
    expect(r.subtotalCents).toBe(740000 + 185000 + 7500);
    expect(r.taxableBaseCents).toBe(740000 + 185000);
    expect(r.taxCents).toBe(Math.round(925000 * 0.0725));
    expect(r.totalCents).toBe(r.subtotalCents + r.taxCents);
    // cost basis: pavers material 400000 + labor 140000 ; sod 0 ; trip 0
    expect(r.costBasisCents).toBe(540000);
    expect(r.grossMarginPct).toBeCloseTo((932500 - 540000) / 932500, 6);
    expect(r.belowTargetMargin).toBe(false);
  });

  it("applies percent and fixed adjustments and pro-rates tax", () => {
    const r = computeEstimate({
      lines: [
        { item: sodPerSqft, quantity: 1000 }, // 185000 taxable
        { item: tripFee, quantity: 1 }, // 7500 non-taxable
      ],
      adjustments: [{ label: "10% off", pct: -0.1 }, { label: "Rush", amountCents: 5000 }],
      taxRate: 0.1,
    });
    // adjustments: -19250 + 5000 = -14250
    expect(r.adjustmentsCents).toBe(-14250);
    expect(r.adjustedSubtotalCents).toBe(192500 - 14250);
    const share = 185000 / 192500;
    expect(r.taxableBaseCents).toBe(Math.round(185000 + -14250 * share));
  });

  it("flags below-target margin without changing numbers", () => {
    const cheap: PriceBookItem = {
      ...paverPatio,
      model: { ...paverPatio.model, markupPct: 0.05 } as PriceBookItem["model"],
    };
    const r = computeEstimate({ lines: [{ item: cheap, quantity: 10 }], taxRate: 0, targetMarginPct: 0.4 });
    expect(r.belowTargetMargin).toBe(true);
    expect(r.warnings.some((w) => w.includes("below target"))).toBe(true);
    // 10 * (1050 + 350) = 14000
    expect(r.totalCents).toBe(14000);
  });

  it("computes deposits", () => {
    const r = computeEstimate({
      lines: [{ item: sodPerSqft, quantity: 100 }],
      taxRate: 0,
      deposit: { kind: "pct", pct: 0.5 },
    });
    expect(r.depositCents).toBe(9250);
  });

  it("rejects an invalid tax rate", () => {
    expect(() => computeEstimate({ lines: [], taxRate: 7.25 })).toThrow();
  });
});
