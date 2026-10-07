"use client";

import { createContext, useContext, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import {
  contestedness,
  disagreement,
  timedAllocate,
  totalBudget,
  unilaterals,
  type Allocation,
  type DisagreementCell,
  type Scenario,
} from "@/lib/engine";
import { useStore, type Perspective } from "@/lib/store";

interface Analysis {
  scenario: Scenario;
  alloc: Allocation;
  baseline: Allocation | null;
  setBaseline(): void;
  /** uni[r][a]: Recommender r's unilateral allocation (their curves alone, their simulated budget). */
  uni: number[][];
  matrix: DisagreementCell[][];
  contested: number[];
  total: number;
  /** Index of the _hold_ pseudo-application, or -1. */
  hold: number;
  appIndex: Map<string, number>;
  recIndex: Map<string, number>;
  funderIndex: Map<string, number>;
  ms: number;
}

const Ctx = createContext<Analysis | null>(null);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const scenario = useStore((s) => s.scenario);
  const computed = useMemo(() => {
    const { alloc, ms } = timedAllocate(scenario);
    const uni = unilaterals(scenario);
    const matrix = disagreement(scenario, alloc, uni);
    const contested = matrix.map((row, a) => contestedness(row, Math.max(scenario.applications[a].ask, alloc.totals[a])));
    return { alloc, ms, uni, matrix, contested };
  }, [scenario]);
  const appIndex = useMemo(() => new Map(scenario.applications.map((a, i) => [a.id, i])), [scenario.applications]);
  const recIndex = useMemo(() => new Map(scenario.recommenders.map((r, i) => [r.id, i])), [scenario.recommenders]);
  const funderIndex = useMemo(() => new Map(scenario.funders.map((f, i) => [f.id, i])), [scenario.funders]);

  // The baseline is the round as loaded, until the user pins a new one. A different set of
  // applications (a new preset or a joined session) resets it: React's derived-state pattern.
  const sig = scenario.applications.map((a) => a.id).join("|");
  const [baseline, setBaselineState] = useState<{ alloc: Allocation; sig: string } | null>(null);
  if (!baseline || baseline.sig !== sig) setBaselineState({ alloc: computed.alloc, sig });

  const value: Analysis = {
    scenario,
    ...computed,
    total: totalBudget(scenario),
    hold: computed.alloc.hold,
    baseline: baseline?.sig === sig ? baseline.alloc : null,
    setBaseline: () => setBaselineState({ alloc: computed.alloc, sig }),
    appIndex,
    recIndex,
    funderIndex,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAnalysis() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAnalysis outside AnalysisProvider");
  return v;
}

/** For expensive panels: lag behind rapid edits instead of blocking them. */
export function useDeferredScenario() {
  return useDeferredValue(useStore((s) => s.scenario));
}

/** The allocation the sidebar shows for the current perspective, with per-Recommender parts for the bars. */
export function usePerspectiveAllocation(): {
  perspective: Perspective;
  title: string;
  subtitle: string;
  totals: number[];
  parts: (a: number) => number[];
} {
  const { scenario, alloc, uni, recIndex, funderIndex, total } = useAnalysis();
  const perspective = useStore((s) => s.perspective);
  if (perspective.kind === "rec") {
    const r = recIndex.get(perspective.id) ?? 0;
    const rec = scenario.recommenders[r];
    const budget = scenario.simBudget[rec.id] ?? total;
    return {
      perspective,
      title: `${rec.name}'s unilateral allocation`,
      subtitle: `If ${rec.name}'s curves alone spent a simulated ${fmtM(budget)}`,
      totals: uni[r],
      parts: (a) => scenario.recommenders.map((_, k) => (k === r ? uni[r][a] : 0)),
    };
  }
  if (perspective.kind === "funder") {
    const f = funderIndex.get(perspective.id) ?? 0;
    const funder = scenario.funders[f];
    return {
      perspective,
      title: `${funder.name}'s grants`,
      subtitle: `Where ${funder.name}'s ${fmtM(funder.budget)} goes, by Recommender`,
      totals: alloc.byFunder[f],
      // Split this funder's money per application across Recommenders, in proportion to who directed it there.
      parts: (a) => {
        const tot = alloc.totals[a] || 1;
        return alloc.byRec.map((row) => (row[a] / tot) * alloc.byFunder[f][a]);
      },
    };
  }
  return {
    perspective,
    title: "Σ projected final allocation",
    subtitle: `All ${scenario.funders.length} funders · ${fmtM(total)}`,
    totals: alloc.totals,
    parts: (a) => alloc.byRec.map((row) => row[a]),
  };
}

function fmtM(v: number) {
  return v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : `$${Math.round(v / 1e3)}k`;
}
