import { marginal } from "./curve";
import { HOLD_ID, type Curve, type Rule, type Scenario } from "./types";

export type StopReason = "budget" | "exhausted";

export interface LastDollar {
  /** Recommender index, or -1 for the pooled rule. */
  rec: number;
  funder: number;
  /** The Recommender's (or pooled) marginal value of that dollar. */
  u: number;
  /** The funder's deference to that Recommender when the dollar was spent. */
  d: number;
}

export interface Segment {
  rec: number;
  app: number;
  funder: number;
  /** Budget spent before this segment began. */
  from: number;
  amount: number;
}

export interface Allocation {
  rule: Rule;
  /** Each funder's budget, and the total. */
  budgets: number[];
  budget: number;
  turn: number;
  spent: number;
  /** Dollars Recommenders chose to keep for future rounds (the _hold_ line). */
  held: number;
  /** spent − held: money recommended to applications. */
  granted: number;
  /** Budget that found no positive-value use at all (curves and deference ran out). */
  unplaced: number;
  stopReason: StopReason;
  appIds: string[];
  recIds: string[];
  funderIds: string[];
  /** Index of the _hold_ pseudo-application, or -1. */
  hold: number;
  totals: number[];
  /** byRec[r][a]: dollars Recommender r directed to application a. */
  byRec: number[][];
  /** byFunder[f][a]: dollars from funder f that reached application a. */
  byFunder: number[][];
  /** flow[f][r]: dollars funder f routed through Recommender r. */
  flow: number[][];
  delegated: number[];
  /** Marginal value of the last dollar each Recommender spent (null if they spent nothing). */
  cutoff: (number | null)[];
  deferenceAtStop: number[][];
  /** Per funder: score of their final dollar under the rule. */
  fundingLine: (number | null)[];
  last: (LastDollar | null)[];
  segments: Segment[];
  path: { spent: number; totals: number[] }[];
}

/**
 * A resumable allocation run. Funders take turns; on each turn a funder hands out a fixed slice of
 * their budget (`turn`, 0.1% by default, as in the S-Process talk), so nobody goes first and nobody
 * has to wait for others to fund the obvious. Marginal values are cached per (Recommender,
 * application) in typed arrays and only the funded application's column is refreshed, so a step costs
 * O(R + N) under delegation and a 115 × 12 round re-runs within a frame.
 */
export class AllocationRun {
  readonly F: number;
  readonly R: number;
  readonly N: number;
  readonly rule: Rule;
  readonly budgets: number[];
  readonly steps: number[];
  readonly holdIndex: number;
  private evals: (Curve | null)[];
  private def: (Curve | null)[];
  private veto: Uint8Array;
  readonly t: Float64Array;
  readonly bFR: Float64Array;
  readonly by: Float64Array;
  readonly byFA: Float64Array;
  readonly spentF: Float64Array;
  private u: Float64Array;
  private exhausted: Uint8Array;
  private weights: Float64Array;
  readonly cutoff: Float64Array;
  readonly last: (LastDollar | null)[];
  readonly fundingLine: (number | null)[];
  readonly segments: Segment[] = [];
  readonly path: { spent: number; totals: number[] }[] = [];
  spent = 0;
  stopReason: StopReason = "budget";
  private nextCheckpoint = 0;
  private checkpointEvery: number;

  constructor(
    readonly scenario: Scenario,
    opts: { checkpoints?: number } = {},
  ) {
    const s = scenario;
    this.rule = s.rule;
    this.F = s.funders.length;
    this.R = s.recommenders.length;
    this.N = s.applications.length;
    const { F, R, N } = this;
    this.budgets = s.funders.map((f) => f.budget);
    this.steps = this.budgets.map((b) => Math.max(b * s.turn, 1));
    this.holdIndex = s.applications.findIndex((a) => a.id === HOLD_ID);
    this.evals = new Array(R * N).fill(null);
    s.recommenders.forEach((rec, r) => {
      const row = s.evaluations[rec.id] ?? {};
      s.applications.forEach((app, a) => (this.evals[r * N + a] = row[app.id] ?? null));
    });
    this.def = new Array(F * R).fill(null);
    s.funders.forEach((f, fi) => s.recommenders.forEach((rec, r) => (this.def[fi * R + r] = s.deference[f.id]?.[rec.id] ?? null)));
    this.veto = new Uint8Array(F * N);
    const appIndex = new Map(s.applications.map((a, i) => [a.id, i]));
    s.funders.forEach((f, fi) =>
      (s.vetoes[f.id] ?? []).forEach((id) => {
        const a = appIndex.get(id);
        if (a !== undefined && a !== this.holdIndex) this.veto[fi * N + a] = 1;
      }),
    );
    this.t = new Float64Array(N);
    this.bFR = new Float64Array(F * R);
    this.by = new Float64Array(R * N);
    this.byFA = new Float64Array(F * N);
    this.spentF = new Float64Array(F);
    this.u = new Float64Array(R * N);
    this.exhausted = new Uint8Array(F * R);
    this.cutoff = new Float64Array(R).fill(NaN);
    this.last = new Array(N).fill(null);
    this.fundingLine = new Array(F).fill(null);
    for (let i = 0; i < R * N; i++) this.u[i] = this.evals[i] ? marginal(this.evals[i]!, 0) : 0;
    // Pooled weights: each funder's first-dollar deference, normalized per funder.
    this.weights = new Float64Array(F * R);
    for (let f = 0; f < F; f++) {
      let W = 0;
      for (let r = 0; r < R; r++) W += this.d0(f, r);
      for (let r = 0; r < R; r++) this.weights[f * R + r] = W > 0 ? this.d0(f, r) / W : 0;
    }
    const total = this.budgets.reduce((a, b) => a + b, 0);
    this.checkpointEvery = total / (opts.checkpoints ?? 120) || Infinity;
    this.recordCheckpoint();
  }

  private d0(f: number, r: number) {
    const c = this.def[f * this.R + r];
    return c ? marginal(c, 0) : 0;
  }

  private deference(f: number, r: number) {
    const c = this.def[f * this.R + r];
    return c ? marginal(c, this.bFR[f * this.R + r]) : 0;
  }

  private recordCheckpoint() {
    this.path.push({ spent: this.spent, totals: Array.from(this.t) });
    this.nextCheckpoint = this.spent + this.checkpointEvery;
  }

  /** Dollars until Recommender r's curve for application a reaches zero; a step never crosses it. */
  private room(r: number, a: number): number {
    const c = this.evals[r * this.N + a];
    return c ? c.ldt - this.t[a] : 0;
  }

  /** f < 0 means money that comes from no funder in particular (the proportional extension phase). */
  private give(f: number, r: number, a: number, amount: number, last: LastDollar) {
    const { N, R } = this;
    this.t[a] += amount;
    this.by[r * N + a] += amount;
    if (f >= 0) {
      this.bFR[f * R + r] += amount;
      this.byFA[f * N + a] += amount;
      this.spentF[f] += amount;
    }
    this.cutoff[r] = last.u;
    this.last[a] = last;
    const seg = this.segments[this.segments.length - 1];
    if (seg && seg.rec === r && seg.app === a && seg.funder === f) seg.amount += amount;
    else this.segments.push({ rec: r, app: a, funder: f, from: this.spent, amount });
    this.spent += amount;
    this.refresh(a);
    if (this.spent >= this.nextCheckpoint) this.recordCheckpoint();
  }

  private refresh(a: number) {
    const { R, N } = this;
    for (let k = 0; k < R; k++) {
      const c = this.evals[k * N + a];
      this.u[k * N + a] = c ? marginal(c, this.t[a]) : 0;
    }
  }

  /** Recommender r's best use of funder f's money (respecting f's vetoes). */
  private bestApp(r: number, f: number): number {
    const { N } = this;
    let best = -1,
      bestU = 0;
    for (let a = 0; a < N; a++) {
      if (f >= 0 && this.veto[f * N + a]) continue;
      const v = this.u[r * N + a];
      if (v > bestU) {
        bestU = v;
        best = a;
      }
    }
    return best;
  }

  private stepDelegated(f: number, amount: number): boolean {
    const { R, N } = this;
    for (;;) {
      let r = -1,
        bestD = 0;
      for (let k = 0; k < R; k++) {
        if (this.exhausted[f * R + k]) continue;
        const d = this.deference(f, k);
        if (d > bestD) {
          bestD = d;
          r = k;
        }
      }
      if (r < 0) return false;
      const a = this.bestApp(r, f);
      // Marginal values only fall as funding grows, so an exhausted pair stays exhausted.
      if (a < 0) {
        this.exhausted[f * R + r] = 1;
        continue;
      }
      this.fundingLine[f] = bestD;
      this.give(f, r, a, Math.min(amount, this.room(r, a)), { rec: r, funder: f, u: this.u[r * N + a], d: bestD });
      return true;
    }
  }

  private stepJoint(f: number, amount: number): boolean {
    const { R, N } = this;
    let br = -1,
      ba = -1,
      best = 0,
      bd = 0;
    for (let r = 0; r < R; r++) {
      const d = this.deference(f, r);
      if (d <= 0) continue;
      for (let a = 0; a < N; a++) {
        if (this.veto[f * N + a]) continue;
        const score = d * this.u[r * N + a];
        if (score > best) {
          best = score;
          br = r;
          ba = a;
          bd = d;
        }
      }
    }
    if (br < 0) return false;
    this.fundingLine[f] = best;
    this.give(f, br, ba, Math.min(amount, this.room(br, ba)), { rec: br, funder: f, u: this.u[br * N + ba], d: bd });
    return true;
  }

  private stepPooled(f: number, amount: number): boolean {
    const { R, N } = this;
    let ba = -1,
      best = 0;
    for (let a = 0; a < N; a++) {
      if (this.veto[f * N + a]) continue;
      let m = 0;
      for (let r = 0; r < R; r++) m += this.weights[f * R + r] * this.u[r * N + a];
      if (m > best) {
        best = m;
        ba = a;
      }
    }
    if (ba < 0) return false;
    this.fundingLine[f] = best;
    const a = ba;
    const shares = new Float64Array(R);
    for (let r = 0; r < R; r++) shares[r] = (this.weights[f * R + r] * this.u[r * N + a]) / best;
    // Stop at the next point where a contributing Recommender saturates, so attribution stays exact.
    for (let r = 0; r < R; r++) if (shares[r] > 0) amount = Math.min(amount, this.room(r, a));
    this.t[a] += amount;
    this.spentF[f] += amount;
    this.byFA[f * N + a] += amount;
    for (let r = 0; r < R; r++) {
      const part = amount * shares[r];
      if (part <= 0) continue;
      this.bFR[f * R + r] += part;
      this.by[r * N + a] += part;
      this.cutoff[r] = this.u[r * N + a];
    }
    this.last[a] = { rec: -1, funder: f, u: best, d: 1 };
    const seg = this.segments[this.segments.length - 1];
    if (seg && seg.rec === -1 && seg.app === a && seg.funder === f) seg.amount += amount;
    else this.segments.push({ rec: -1, app: a, funder: f, from: this.spent, amount });
    this.spent += amount;
    this.refresh(a);
    if (this.spent >= this.nextCheckpoint) this.recordCheckpoint();
    return true;
  }

  /** Run every funder (in turns) until they reach `targets[f]` dollars or run out of positive-value uses. */
  runTo(targets: number[] = this.budgets): this {
    const step = this.rule === "delegated" ? this.stepDelegated : this.rule === "joint" ? this.stepJoint : this.stepPooled;
    const done = new Uint8Array(this.F);
    let anyExhausted = false;
    for (;;) {
      let active = false;
      for (let f = 0; f < this.F; f++) {
        if (done[f]) continue;
        const rem = targets[f] - this.spentF[f];
        if (rem <= 1e-6) {
          done[f] = 1;
          continue;
        }
        if (!step.call(this, f, Math.min(this.steps[f], rem))) {
          done[f] = 1;
          anyExhausted = true;
          continue;
        }
        active = true;
      }
      if (!active) break;
    }
    this.stopReason = anyExhausted ? "exhausted" : "budget";
    return this;
  }

  /**
   * Spend `extra` with fixed per-Recommender shares proportional to `weights`, each Recommender
   * spending on their own curves. A Recommender with no positive-value use left forfeits the rest.
   */
  runProportional(extra: number, weights: ArrayLike<number>): this {
    const { R, N } = this;
    const W = Array.from(weights).reduce((s, x) => s + Math.max(x, 0), 0);
    if (W <= 0 || extra <= 0) return this;
    const share = Float64Array.from(weights, (w) => (Math.max(w, 0) / W) * extra);
    const step = Math.max(extra * this.scenario.turn, 1);
    const used = new Float64Array(R);
    const done = new Uint8Array(R);
    for (;;) {
      let r = -1,
        lag = -Infinity;
      for (let k = 0; k < R; k++) {
        if (done[k] || share[k] - used[k] <= 1e-6) continue;
        const remaining = (share[k] - used[k]) / share[k];
        if (remaining > lag) {
          lag = remaining;
          r = k;
        }
      }
      if (r < 0) break;
      const a = this.bestApp(r, -1);
      if (a < 0) {
        done[r] = 1;
        continue;
      }
      const amount = Math.min(step, share[r] - used[r], this.room(r, a));
      used[r] += amount;
      this.give(-1, r, a, amount, { rec: r, funder: -1, u: this.u[r * N + a], d: 0 });
    }
    return this;
  }

  /** Total delegated per Recommender, across funders. */
  delegatedPerRec(): number[] {
    const out = new Array(this.R).fill(0);
    for (let f = 0; f < this.F; f++) for (let r = 0; r < this.R; r++) out[r] += this.bFR[f * this.R + r];
    return out;
  }

  result(): Allocation {
    const { F, R, N, scenario } = this;
    if (this.path[this.path.length - 1]?.spent !== this.spent) this.recordCheckpoint();
    const budget = this.budgets.reduce((a, b) => a + b, 0);
    const held = this.holdIndex >= 0 ? this.t[this.holdIndex] : 0;
    const spentFromFunders = Array.from(this.spentF).reduce((a, b) => a + b, 0);
    return {
      rule: this.rule,
      budgets: [...this.budgets],
      budget,
      turn: scenario.turn,
      spent: this.spent,
      held,
      granted: this.spent - held,
      unplaced: Math.max(0, budget - spentFromFunders),
      stopReason: this.stopReason,
      appIds: scenario.applications.map((a) => a.id),
      recIds: scenario.recommenders.map((r) => r.id),
      funderIds: scenario.funders.map((f) => f.id),
      hold: this.holdIndex,
      totals: Array.from(this.t),
      byRec: Array.from({ length: R }, (_, r) => Array.from(this.by.subarray(r * N, r * N + N))),
      byFunder: Array.from({ length: F }, (_, f) => Array.from(this.byFA.subarray(f * N, f * N + N))),
      flow: Array.from({ length: F }, (_, f) => Array.from(this.bFR.subarray(f * R, f * R + R))),
      delegated: this.delegatedPerRec(),
      cutoff: Array.from(this.cutoff, (c) => (Number.isNaN(c) ? null : c)),
      deferenceAtStop: Array.from({ length: F }, (_, f) => Array.from({ length: R }, (_, r) => this.deference(f, r))),
      fundingLine: [...this.fundingLine],
      last: [...this.last],
      segments: this.segments.map((s) => ({ ...s })),
      path: this.path,
    };
  }
}

export function allocate(scenario: Scenario): Allocation {
  return new AllocationRun(scenario).runTo().result();
}

/** Allocation plus wall-clock time, for the UI's performance readout. */
export function timedAllocate(scenario: Scenario): { alloc: Allocation; ms: number } {
  const t0 = performance.now();
  const alloc = allocate(scenario);
  return { alloc, ms: performance.now() - t0 };
}

/**
 * A Recommender's unilateral allocation: where their curves alone would send `budget` dollars,
 * as in the app's "XO's unilateral allocation" panel. Greedy on their own marginal values, with
 * steps capped at saturation points. Vetoes do not apply: this is the Recommender's own view.
 */
export function unilateral(curves: (Curve | null)[], budget: number, turn = 0.001): number[] {
  const N = curves.length;
  const t = new Float64Array(N);
  const step = Math.max(budget * turn, 1);
  let spent = 0;
  while (budget - spent > 1e-6) {
    let best = -1,
      bestU = 0;
    for (let a = 0; a < N; a++) {
      const c = curves[a];
      if (!c) continue;
      const v = marginal(c, t[a]);
      if (v > bestU) {
        bestU = v;
        best = a;
      }
    }
    if (best < 0) break;
    const amount = Math.min(step, budget - spent, curves[best]!.ldt - t[best]);
    t[best] += amount;
    spent += amount;
  }
  return Array.from(t);
}

export function unilateralFor(scenario: Scenario, r: number, budget?: number): number[] {
  const rec = scenario.recommenders[r];
  const row = scenario.evaluations[rec.id] ?? {};
  const total = scenario.funders.reduce((s, f) => s + f.budget, 0);
  return unilateral(
    scenario.applications.map((a) => row[a.id] ?? null),
    budget ?? scenario.simBudget[rec.id] ?? total,
    scenario.turn,
  );
}

/** Marginal value Recommender r currently places on application a at its allocated level. */
export function currentMarginal(scenario: Scenario, alloc: Allocation, r: number, a: number) {
  const c = scenario.evaluations[alloc.recIds[r]]?.[alloc.appIds[a]];
  return c ? marginal(c, alloc.totals[a]) : 0;
}
