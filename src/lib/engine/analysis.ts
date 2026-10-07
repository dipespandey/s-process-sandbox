import { AllocationRun, allocate, unilateralFor, type Allocation } from "./allocate";
import { marginal, scaleCurve } from "./curve";
import { totalBudget, type Curve, type Scenario } from "./types";

/* ------------------------------------------------------------------------------------------
 * Further funding opportunities
 *
 * Follows SFF's public description of how its 2025 "further opportunities" were produced:
 *  - +$5M: continue the round using the funders' existing deference curves (here split across
 *    funders in proportion to their budgets).
 *  - +$15M: the first $5M as above; the remaining $10M split among Recommenders in proportion to
 *    the funders' deference, then spent on each Recommender's own curves.
 *  - Publish only additions of at least $100k or at least 10% of the application's ask.
 * The page does not say exactly what "proportionally ... based on the Funder's marginal utility
 * functions" weights by. Here it is each Recommender's share of dollars delegated so far: an
 * explicit, swappable assumption.
 * ---------------------------------------------------------------------------------------- */

export interface Opportunity {
  app: number;
  base: number;
  plus5: number;
  plus15: number;
  shown5: boolean;
  shown15: boolean;
}

export interface FurtherOpportunities {
  first: number;
  second: number;
  unspentFirst: number;
  unspentSecond: number;
  heldFirst: number;
  heldSecond: number;
  rows: Opportunity[];
}

export function furtherOpportunities(
  scenario: Scenario,
  base: Allocation,
  first = 5_000_000,
  second = 10_000_000,
  thresholds = { minDollars: 100_000, minAskFraction: 0.1 },
): FurtherOpportunities {
  const total = totalBudget(scenario) || 1;
  const run = new AllocationRun(scenario);
  run.runTo(scenario.funders.map((f) => f.budget + (first * f.budget) / total));
  const plus5 = Array.from(run.t);
  const spentAfterFirst = run.spent;
  run.runProportional(second, run.delegatedPerRec());
  const plus15 = Array.from(run.t);
  const h = base.hold;
  const shown = (a: number, extra: number) =>
    extra >= thresholds.minDollars ||
    (scenario.applications[a].ask > 0 && extra >= thresholds.minAskFraction * scenario.applications[a].ask);
  const rows = scenario.applications.flatMap((_, a) => {
    if (a === h) return [];
    const add5 = plus5[a] - base.totals[a];
    const add15 = plus15[a] - base.totals[a];
    return [
      {
        app: a,
        base: base.totals[a],
        plus5: add5,
        plus15: add15,
        shown5: add5 > 0.5 && shown(a, add5),
        shown15: add15 > 0.5 && shown(a, add15),
      },
    ];
  });
  return {
    first,
    second,
    unspentFirst: Math.max(0, base.spent + first - spentAfterFirst),
    unspentSecond: Math.max(0, second - (run.spent - spentAfterFirst)),
    heldFirst: h >= 0 ? plus5[h] - base.totals[h] : 0,
    heldSecond: h >= 0 ? plus15[h] - plus5[h] : 0,
    rows,
  };
}

/* ------------------------------------------------------------------------------------------
 * Sensitivity: how many dollars move when one input changes?
 * ---------------------------------------------------------------------------------------- */

export function dollarsMoved(a: Allocation, b: Allocation): number {
  let moved = 0;
  for (let i = 0; i < a.totals.length; i++) moved += Math.abs(a.totals[i] - (b.totals[i] ?? 0));
  return moved / 2;
}

export interface SensitivityRow {
  rec: number;
  down: number;
  up: number;
}

export interface Sensitivity {
  factor: number;
  deference: SensitivityRow[];
  evaluations: SensitivityRow[];
  /** Per-application allocation range across every perturbation. */
  range: { min: number; max: number }[];
}

export function sensitivity(scenario: Scenario, base: Allocation, factor = 0.2): Sensitivity {
  const range = base.totals.map((t) => ({ min: t, max: t }));
  const track = (alloc: Allocation) =>
    alloc.totals.forEach((t, i) => {
      range[i].min = Math.min(range[i].min, t);
      range[i].max = Math.max(range[i].max, t);
    });
  const scaleRow = (row: Record<string, Curve> | undefined, f: number) =>
    Object.fromEntries(Object.entries(row ?? {}).map(([k, c]) => [k, scaleCurve(c, f)]));
  const perturb = (rec: string, kind: "deference" | "evaluations", f: number) => {
    const next: Scenario =
      kind === "deference"
        ? {
            ...scenario,
            // Every funder's trust in this Recommender moves together.
            deference: Object.fromEntries(
              Object.entries(scenario.deference).map(([fid, row]) => [fid, row[rec] ? { ...row, [rec]: scaleCurve(row[rec], f) } : row]),
            ),
          }
        : { ...scenario, evaluations: { ...scenario.evaluations, [rec]: scaleRow(scenario.evaluations[rec], f) } };
    const alloc = allocate(next);
    track(alloc);
    return dollarsMoved(base, alloc);
  };
  const rows = (kind: "deference" | "evaluations") =>
    scenario.recommenders.map((r, i) => ({ rec: i, down: perturb(r.id, kind, 1 - factor), up: perturb(r.id, kind, 1 + factor) }));
  return { factor, deference: rows("deference"), evaluations: rows("evaluations"), range };
}

/* ------------------------------------------------------------------------------------------
 * Disagreement, in the four column groups of the S-Process app's matrix: each Recommender's
 * first-dollar value, last-dollar threshold and concavity, and the difference between their
 * unilateral allocation and the projected final allocation. A margin ratio is kept as well:
 * the Recommender's value of the application's next dollar over the value of their own last dollar.
 * ---------------------------------------------------------------------------------------- */

export interface DisagreementCell {
  evaluated: boolean;
  fdv: number | null;
  ldt: number | null;
  conc: number | null;
  unilateral: number;
  /** unilateral − projected. */
  delta: number;
  u: number;
  cutoff: number | null;
  ratio: number | null;
}

export function unilaterals(scenario: Scenario): number[][] {
  return scenario.recommenders.map((_, r) => unilateralFor(scenario, r));
}

export function disagreement(scenario: Scenario, alloc: Allocation, uni: number[][]): DisagreementCell[][] {
  return scenario.applications.map((app, a) =>
    scenario.recommenders.map((rec, r) => {
      const c = scenario.evaluations[rec.id]?.[app.id];
      const unilateral = uni[r]?.[a] ?? 0;
      const delta = unilateral - alloc.totals[a];
      if (!c) return { evaluated: false, fdv: null, ldt: null, conc: null, unilateral, delta, u: 0, cutoff: alloc.cutoff[r], ratio: null };
      const u = marginal(c, alloc.totals[a]);
      const cut = alloc.cutoff[r];
      return {
        evaluated: true,
        fdv: c.fdv,
        ldt: c.ldt,
        conc: c.conc,
        unilateral,
        delta,
        u,
        cutoff: cut,
        ratio: cut && cut > 0 ? u / cut : null,
      };
    }),
  );
}

/** Spread of unilateral-vs-projected gaps, relative to the application's size: one "how contested?" number. */
export function contestedness(cells: DisagreementCell[], scale: number): number {
  const ds = cells.filter((c) => c.evaluated).map((c) => c.delta / Math.max(scale, 1));
  if (ds.length < 2) return 0;
  const mean = ds.reduce((s, x) => s + x, 0) / ds.length;
  return Math.sqrt(ds.reduce((s, x) => s + (x - mean) ** 2, 0) / ds.length);
}

/** Σ's disagreements with one Recommender: the change if their unilateral allocation replaced the projection. */
export function sigmaDisagreements(scenario: Scenario, alloc: Allocation, uni: number[]) {
  return scenario.applications
    .map((app, a) => ({ app: a, delta: (uni[a] ?? 0) - alloc.totals[a] }))
    .filter((d) => Math.abs(d.delta) >= 1)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}
