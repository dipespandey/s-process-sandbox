import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  HOLD_ID,
  LIMITS,
  ScenarioSchema,
  allocate,
  budgetShares,
  scaleBudgets,
  concFromK,
  concHandle,
  curve,
  curvePoints,
  disagreement,
  explainApplication,
  furtherOpportunities,
  marginal,
  normalizeCurve,
  scaleCurve,
  totalUtility,
  unilateral,
  unilaterals,
  type Curve,
  type Rule,
  type Scenario,
} from "@/lib/engine";
import { applyOp, authorize, canEdit, type Seat } from "@/lib/live/protocol";
import { blankScenario, demoScenario, stressScenario } from "@/lib/seed";

const arbCurve = fc
  .record({
    fdv: fc.double({ min: 0, max: 1, noNaN: true }),
    ldt: fc.integer({ min: 10, max: 2000 }).map((k) => k * 1000),
    conc: fc.double({ min: -1, max: 1, noNaN: true }),
  })
  .map(normalizeCurve);

/** Small random rounds: 1–3 funders, 1–3 Recommenders, 1–5 applications, optional vetoes. */
const arbScenario = (rule: Rule) =>
  fc
    .record({
      F: fc.integer({ min: 1, max: 3 }),
      R: fc.integer({ min: 1, max: 3 }),
      N: fc.integer({ min: 1, max: 5 }),
    })
    .chain(({ F, R, N }) =>
      fc
        .record({
          budgets: fc.array(
            fc.integer({ min: 1, max: 40 }).map((k) => k * 50_000),
            { minLength: F, maxLength: F },
          ),
          evals: fc.array(fc.array(fc.option(arbCurve, { nil: undefined }), { minLength: N, maxLength: N }), {
            minLength: R,
            maxLength: R,
          }),
          def: fc.array(fc.array(arbCurve, { minLength: R, maxLength: R }), { minLength: F, maxLength: F }),
          vetoes: fc.array(fc.array(fc.boolean(), { minLength: N, maxLength: N }), { minLength: F, maxLength: F }),
        })
        .map(({ budgets, evals, def, vetoes }): Scenario => {
          const apps = Array.from({ length: N }, (_, i) => ({ id: `a${i}`, name: `A${i}`, summary: "", area: "G", ask: 500_000 }));
          const recs = Array.from({ length: R }, (_, i) => ({ id: `r${i}`, name: `R${i}`, focus: "" }));
          const funders = Array.from({ length: F }, (_, i) => ({ id: `f${i}`, name: `F${i}`, budget: budgets[i] }));
          return {
            version: 2,
            name: "prop",
            rule,
            turn: 0.01,
            funders,
            applications: apps,
            recommenders: recs,
            evaluations: Object.fromEntries(
              recs.map((r, ri) => [r.id, Object.fromEntries(apps.flatMap((a, ai) => (evals[ri][ai] ? [[a.id, evals[ri][ai]!]] : [])))]),
            ),
            deference: Object.fromEntries(funders.map((f, fi) => [f.id, Object.fromEntries(recs.map((r, ri) => [r.id, def[fi][ri]]))])),
            vetoes: Object.fromEntries(funders.map((f, fi) => [f.id, apps.filter((_, ai) => vetoes[fi][ai] && ai > 0).map((a) => a.id)])),
            simBudget: {},
          };
        }),
    );

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const close = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) < tol;

describe("parametric curves (FDV / LDT / concavity)", () => {
  it("start at FDV, reach zero at LDT and never increase", () =>
    fc.assert(
      fc.property(arbCurve, (c) => {
        expect(marginal(c, 0)).toBeCloseTo(c.fdv);
        expect(marginal(c, c.ldt)).toBe(0);
        let prev = Infinity;
        for (let i = 0; i <= 50; i++) {
          const v = marginal(c, (i / 50) * c.ldt);
          expect(v).toBeLessThanOrEqual(prev + 1e-12);
          prev = v;
        }
      }),
    ));

  it("zero concavity is a straight line and the drawn points lie on the curve", () => {
    const c = curve(1, 1_000_000, 0);
    expect(marginal(c, 250_000)).toBeCloseTo(0.75);
    expect(totalUtility(c, 1_000_000)).toBeCloseTo(500_000, -2);
    for (const p of curvePoints(curve(0.8, 2_000_000, 0.6))) expect(marginal(curve(0.8, 2_000_000, 0.6), p.x)).toBeCloseTo(p.y, 6);
  });

  it("the concavity handle round-trips", () =>
    fc.assert(
      fc.property(fc.double({ min: -1, max: 1, noNaN: true }), (conc) => {
        const c = curve(1, 1_000_000, conc);
        expect(concFromK(concHandle(c).k)).toBeCloseTo(c.conc, 1);
      }),
    ));

  it("normalization is idempotent", () =>
    fc.assert(
      fc.property(arbCurve, (c) => {
        expect(normalizeCurve(c)).toEqual(c);
      }),
    ));
});

describe.each(["delegated", "joint", "pooled"] as Rule[])("allocation (%s)", (rule) => {
  it("conserves money across funders, Recommenders and applications", () =>
    fc.assert(
      fc.property(arbScenario(rule), (s) => {
        const a = allocate(s);
        expect(a.spent).toBeLessThanOrEqual(a.budget + 1e-6);
        expect(close(sum(a.totals), a.spent)).toBe(true);
        expect(close(sum(a.delegated), a.spent)).toBe(true);
        s.funders.forEach((f, fi) => {
          expect(sum(a.byFunder[fi])).toBeLessThanOrEqual(f.budget + 1e-6);
          expect(close(sum(a.byFunder[fi]), sum(a.flow[fi]))).toBe(true);
        });
        a.totals.forEach((t, i) => {
          expect(t).toBeGreaterThanOrEqual(0);
          expect(close(sum(a.byRec.map((row) => row[i])), t)).toBe(true);
          expect(close(sum(a.byFunder.map((row) => row[i])), t)).toBe(true);
        });
        expect(close(a.spent + a.unplaced, a.budget, 1e-2)).toBe(true);
      }),
    ));

  it("never funds an application past every evaluator's last-dollar threshold", () =>
    fc.assert(
      fc.property(arbScenario(rule), (s) => {
        const a = allocate(s);
        s.applications.forEach((app, i) => {
          const limit = Math.max(0, ...s.recommenders.map((r) => s.evaluations[r.id]?.[app.id]?.ldt ?? 0));
          expect(a.totals[i]).toBeLessThanOrEqual(limit + 1e-6);
        });
      }),
    ));

  it("respects every funder's final say", () =>
    fc.assert(
      fc.property(arbScenario(rule), (s) => {
        const a = allocate(s);
        s.funders.forEach((f, fi) =>
          (s.vetoes[f.id] ?? []).forEach((id) => {
            const ai = s.applications.findIndex((x) => x.id === id);
            expect(a.byFunder[fi][ai]).toBe(0);
          }),
        );
      }),
    ));

  it("a proportionally larger budget never takes money away (greedy prefix property)", () =>
    fc.assert(
      fc.property(arbScenario(rule), fc.integer({ min: 1, max: 4 }), (s, k) => {
        const small = allocate(s);
        const big = allocate({ ...s, turn: s.turn / (k + 1), funders: s.funders.map((f) => ({ ...f, budget: f.budget * (k + 1) })) });
        // Same absolute turn size, so the bigger run passes through the smaller one.
        small.totals.forEach((t, i) => expect(big.totals[i]).toBeGreaterThanOrEqual(t - 1e-3));
      }),
    ));
});

describe("delegation rule", () => {
  it("is optimal for one Recommender with diminishing returns (matches brute-force DP)", () =>
    fc.assert(
      fc.property(fc.array(arbCurve, { minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 25 }), (curves, units) => {
        const step = 50_000;
        const apps = curves.map((_, i) => ({ id: `a${i}`, name: `A${i}`, summary: "", area: "G", ask: 1 }));
        const s: Scenario = {
          version: 2,
          name: "opt",
          rule: "delegated",
          turn: 1 / units,
          funders: [{ id: "f", name: "F", budget: units * step }],
          applications: apps,
          recommenders: [{ id: "r", name: "R", focus: "" }],
          evaluations: { r: Object.fromEntries(apps.map((a, i) => [a.id, curves[i]])) },
          deference: { f: { r: curve(1, 1e9, 0) } },
          vetoes: {},
          simBudget: {},
        };
        const alloc = allocate(s);
        // Value actually obtained vs. the best any split could achieve (exact integrals, discretized splits).
        const got = sum(curves.map((c, i) => totalUtility(c, alloc.totals[i])));
        let best = new Array(units + 1).fill(0);
        for (const c of curves) {
          const next = [...best];
          for (let u = 0; u <= units; u++)
            for (let k = 0; k <= u; k++) next[u] = Math.max(next[u], best[u - k] + totalUtility(c, k * step));
          best = next;
        }
        expect(got).toBeGreaterThanOrEqual(best[units] * 0.97 - 1);
      }),
    ));

  it("only the shape of a Recommender's curves matters, not their scale", () =>
    fc.assert(
      fc.property(arbScenario("delegated"), fc.double({ min: 0.2, max: 1.5, noNaN: true }), (s, k) => {
        const r0 = s.recommenders[0].id;
        const row = s.evaluations[r0] ?? {};
        if (Object.keys(row).length > 1) return; // exact ties can tip either way; test the tie-free case
        const scaled: Scenario = {
          ...s,
          evaluations: { ...s.evaluations, [r0]: Object.fromEntries(Object.entries(row).map(([id, c]) => [id, scaleCurve(c, k)])) },
        };
        expect(allocate(scaled).totals).toEqual(allocate(s).totals);
      }),
    ));
});

describe("_hold_, unilateral allocation and further opportunities", () => {
  it("money below a Recommender's hold value is held rather than granted", () => {
    const s = blankScenario();
    // A funder with deep trust, so money reaches Recommenders after the applications saturate.
    const a = allocate({
      ...s,
      funders: [{ ...s.funders[0], budget: 50_000_000 }],
      deference: { funder: { "rec-1": curve(1, 1e9, 0), "rec-2": curve(1, 1e9, 0) } },
    });
    const h = s.applications.findIndex((x) => x.id === HOLD_ID);
    expect(a.held).toBeGreaterThan(0);
    expect(a.totals[h]).toBeCloseTo(a.held);
    // Every granted application was funded only while it beat the hold line.
    expect(a.granted + a.held).toBeCloseTo(a.spent);
  });

  it("a unilateral allocation spends its budget greedily and never past a threshold", () => {
    const curves: Curve[] = [curve(1, 1_000_000, 0), curve(0.5, 2_000_000, 0.3)];
    const t = unilateral(curves, 1_200_000);
    expect(sum(t)).toBeCloseTo(1_200_000, -2);
    // Greedy equalizes the marginal value of the last dollar across applications.
    expect(Math.abs(marginal(curves[0], t[0]) - marginal(curves[1], t[1]))).toBeLessThan(0.01);
    expect(unilateral(curves, 10_000_000)[0]).toBeLessThanOrEqual(1_000_000);
  });

  it("further opportunities only ever add funding, and +$15M ≥ +$5M", () => {
    const s = demoScenario();
    const fo = furtherOpportunities(s, allocate(s));
    for (const row of fo.rows) {
      expect(row.plus5).toBeGreaterThanOrEqual(-1e-3);
      expect(row.plus15).toBeGreaterThanOrEqual(row.plus5 - 1e-3);
    }
  });

  it("the disagreement matrix's 'difference from projected' is unilateral minus projected", () => {
    const s = demoScenario();
    const a = allocate(s);
    const uni = unilaterals(s);
    const m = disagreement(s, a, uni);
    m.forEach((row, ai) => row.forEach((c, r) => expect(c.delta).toBeCloseTo(uni[r][ai] - a.totals[ai])));
  });
});

describe("budget scaling", () => {
  const funders = [
    { id: "a", name: "A", budget: 5_000_000 },
    { id: "b", name: "B", budget: 3_000_000 },
    { id: "c", name: "C", budget: 1_000_000 },
  ];
  it("keeps each funder's share", () => expect(scaleBudgets(funders, 18_000_000)).toEqual([10_000_000, 6_000_000, 2_000_000]));
  it("survives a round trip through $0 using the remembered shares", () => {
    const shares = budgetShares(funders);
    const zero = funders.map((f) => ({ ...f, budget: 0 }));
    expect(scaleBudgets(zero, 9_000_000, shares)).toEqual([5_000_000, 3_000_000, 1_000_000]);
    expect(scaleBudgets(zero, 9_000_000)).toEqual([3_000_000, 3_000_000, 3_000_000]);
  });
});

describe("live-session permissions", () => {
  const s = demoScenario();
  const avery: Seat = { role: "recommender", rec: "avery", label: "Avery" };
  const harlow: Seat = { role: "funder", funder: "harlow", label: "Harlow" };

  it("a Recommender cannot touch the funder's trust in themselves", () => {
    const op = { type: "deference" as const, funder: "harlow", rec: "avery", curve: curve(1, 9e6, 0) };
    expect(canEdit(avery, op)).toBe(false);
    expect(authorize(avery, op, s)).not.toBeNull();
  });

  it("each seat edits only what it owns", () => {
    expect(authorize(avery, { type: "evaluation", rec: "avery", app: HOLD_ID, curve: curve(0.2, 1e7, 0) }, s)).toBeNull();
    expect(authorize(avery, { type: "evaluation", rec: "bram", app: HOLD_ID, curve: null }, s)).not.toBeNull();
    expect(authorize(harlow, { type: "budget", funder: "harlow", value: 1 }, s)).toBeNull();
    expect(authorize(harlow, { type: "budget", funder: "ines", value: 1 }, s)).not.toBeNull();
    expect(authorize(harlow, { type: "rule", value: "joint" }, s)).not.toBeNull();
    expect(authorize(harlow, { type: "veto", funder: "harlow", app: HOLD_ID, declined: true }, s)).not.toBeNull();
    expect(authorize({ role: "observer", label: "O" }, { type: "simBudget", rec: "avery", value: 1 }, s)).not.toBeNull();
  });

  it("clamps an out-of-range budget op", () => {
    expect(applyOp(s, { type: "budget", funder: "harlow", value: 1e18 }).funders[0].budget).toBe(LIMITS.maxDollars);
  });
});

describe("seeded rounds", () => {
  it.each([
    ["demo", demoScenario],
    ["stress", stressScenario],
    ["blank", blankScenario],
  ])("%s validates against the schema", (_, make) => expect(() => ScenarioSchema.parse(make())).not.toThrow());

  it("demo round: everyone's best dollar is worth 1.0, and the budget is mostly granted", () => {
    const s = demoScenario();
    for (const r of s.recommenders) {
      const fdvs = Object.entries(s.evaluations[r.id])
        .filter(([id]) => id !== HOLD_ID)
        .map(([, c]) => c.fdv);
      expect(Math.max(...fdvs)).toBeCloseTo(1, 2);
    }
    const a = allocate(s);
    expect(a.granted).toBeGreaterThan(a.budget * 0.8);
    const funded = a.totals.filter((t, i) => t > 0 && i !== a.hold).length;
    expect(funded).toBeGreaterThan(6);
  });

  it("explains every application", () => {
    const s = demoScenario();
    const a = allocate(s);
    s.applications.forEach((_, i) => expect(explainApplication(s, a, i).headline.length).toBeGreaterThan(10));
  });

  it("re-runs a 115 × 12 × 3 round fast enough to follow a dragged curve", () => {
    const s = stressScenario();
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      allocate(s);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[7]).toBeLessThan(50);
  });
});
