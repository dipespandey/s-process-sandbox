import type { Allocation } from "./allocate";
import { marginal } from "./curve";
import type { Scenario } from "./types";

export type RecStatus = "not-evaluated" | "saturated" | "no-budget" | "on-margin" | "below-line" | "above-line";

export interface RecExplanation {
  rec: number;
  amount: number;
  status: RecStatus;
  /** This Recommender's marginal value for the application's next dollar. */
  uNow: number;
  cutoff: number | null;
  /** How much higher uNow would need to be for this Recommender to fund the next dollar here. */
  gap: number | null;
}

export interface Explanation {
  total: number;
  ask: number;
  contributions: { rec: number; amount: number }[];
  funders: { funder: number; amount: number }[];
  vetoedBy: number[];
  recs: RecExplanation[];
  headline: string;
}

const MARGIN = 0.02;

export function explainApplication(scenario: Scenario, alloc: Allocation, a: number): Explanation {
  const app = scenario.applications[a];
  const total = alloc.totals[a];
  const recs: RecExplanation[] = scenario.recommenders.map((rec, r) => {
    const curve = scenario.evaluations[rec.id]?.[app.id];
    const amount = alloc.byRec[r][a];
    const cutoff = alloc.cutoff[r];
    if (!curve) return { rec: r, amount, status: "not-evaluated", uNow: 0, cutoff, gap: null };
    const uNow = marginal(curve, total);
    if (uNow <= 0) return { rec: r, amount, status: "saturated", uNow, cutoff, gap: null };
    if (cutoff === null) return { rec: r, amount, status: "no-budget", uNow, cutoff, gap: null };
    const rel = (uNow - cutoff) / cutoff;
    const status: RecStatus = Math.abs(rel) <= MARGIN ? "on-margin" : rel > 0 ? "above-line" : "below-line";
    return { rec: r, amount, status, uNow, cutoff, gap: status === "below-line" ? cutoff - uNow : null };
  });
  const contributions = recs
    .filter((r) => r.amount > 0)
    .map((r) => ({ rec: r.rec, amount: r.amount }))
    .sort((x, y) => y.amount - x.amount);
  const funders = alloc.byFunder
    .map((row, f) => ({ funder: f, amount: row[a] }))
    .filter((x) => x.amount > 0)
    .sort((x, y) => y.amount - x.amount);
  const vetoedBy = scenario.funders.flatMap((f, i) => ((scenario.vetoes[f.id] ?? []).includes(app.id) ? [i] : []));
  return {
    total,
    ask: app.ask,
    contributions,
    funders,
    vetoedBy,
    recs,
    headline: headline(scenario, total, app.ask, contributions, recs, vetoedBy),
  };
}

function headline(
  scenario: Scenario,
  total: number,
  ask: number,
  contributions: { rec: number; amount: number }[],
  recs: RecExplanation[],
  vetoedBy: number[],
): string {
  const name = (r: number) => scenario.recommenders[r]?.name ?? "Pooled";
  const veto = vetoedBy.length
    ? ` Declined by ${list(vetoedBy.map((f) => scenario.funders[f].name))} (funder final say), so their money goes elsewhere.`
    : "";
  const evaluated = recs.filter((r) => r.status !== "not-evaluated");
  if (evaluated.length === 0) return "No Recommender has evaluated this application yet.";
  if (total <= 0) {
    const closest = evaluated.filter((r) => r.gap !== null).sort((x, y) => (x.gap ?? Infinity) - (y.gap ?? Infinity))[0];
    return (
      (closest
        ? `Unfunded. Closest is ${name(closest.rec)}: the first dollar here is worth ${fmt(closest.uNow)} to them, below the ${fmt(closest.cutoff!)} their last dollar went for.`
        : "Unfunded: its evaluators received no delegated budget.") + veto
    );
  }
  const lead = contributions[0];
  const share = Math.round((lead.amount / total) * 100);
  const pctAsk = ask > 0 ? Math.round((total / ask) * 100) : null;
  const margin = evaluated.filter((r) => r.status === "on-margin").map((r) => name(r.rec));
  const parts = [
    pctAsk !== null ? `${pctAsk}% of ask.` : "",
    contributions.length > 1 ? `${share}% via ${name(lead.rec)}.` : `All via ${name(lead.rec)}.`,
    margin.length ? `On the margin for ${list(margin)}: more budget would likely fund more here.` : "",
  ];
  return parts.filter(Boolean).join(" ") + veto;
}

function list(xs: string[]) {
  return xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

export function fmt(v: number) {
  return v.toFixed(2);
}
