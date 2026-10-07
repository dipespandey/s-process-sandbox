"use client";

import { ArrowRight, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { allocate } from "@/lib/engine";
import { money } from "@/lib/format";
import { useStore } from "@/lib/store";
import { useAnalysis } from "./analysis-context";

const KEY = "s-process-sandbox:guide-dismissed";
const subscribe = () => () => {};
const readDismissed = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/** First-visit orientation. The examples are computed from the current round, not hard-coded. */
export function Guide() {
  const stored = useSyncExternalStore(subscribe, readDismissed, () => true);
  const [closed, setClosed] = useState(false);
  const { scenario, alloc } = useAnalysis();
  const select = useStore((s) => s.select);
  const setTab = useStore((s) => s.setTab);
  const look = useStore((s) => s.look);
  const setRule = useStore((s) => s.setRule);
  const isLive = useStore((s) => s.live.status !== "off");

  const specialist = useMemo(() => {
    const delegated = scenario.rule === "delegated" ? alloc : allocate({ ...scenario, rule: "delegated" });
    const pooled = allocate({ ...scenario, rule: "pooled" });
    let best = -1,
      drop = 0;
    delegated.totals.forEach((t, a) => {
      if (t - pooled.totals[a] > drop) {
        drop = t - pooled.totals[a];
        best = a;
      }
    });
    return best >= 0 ? { a: best, from: delegated.totals[best], to: pooled.totals[best] } : null;
  }, [scenario, alloc]);

  const dismiss = () => {
    setClosed(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  };

  const show = !stored && !closed && !isLive;
  const steps: { text: React.ReactNode; action: string; run(): void }[] = [
    {
      text: (
        <>
          <span className="font-medium text-foreground">Look through {scenario.recommenders[0].name}&apos;s eyes.</span> Click a node in the
          tree (Σ, a funder or a Recommender). Drag a curve&apos;s first-dollar value, threshold or concavity and the whole round re-runs
          live.
        </>
      ),
      action: "Show me",
      run: () => look({ kind: "rec", id: scenario.recommenders[0].id }),
    },
    ...(specialist
      ? [
          {
            text: (
              <>
                <span className="font-medium text-foreground">Switch the rule to Average.</span> {scenario.applications[specialist.a].name}{" "}
                goes from {money(specialist.from)} to {money(specialist.to)}: averaging penalizes what only one specialist values.
              </>
            ),
            action: "Try it",
            run: () => {
              select(scenario.applications[specialist.a].id);
              setTab("application");
              setRule("pooled");
            },
          },
        ]
      : []),
    {
      text: (
        <>
          <span className="font-medium text-foreground">Open the disagreement matrix.</span> FDV, LDT, concavity and each Recommender&apos;s
          difference from the projection, side by side: the prompt for a meeting.
        </>
      ),
      action: "Open",
      run: () => setTab("matrix"),
    },
    {
      text: (
        <>
          <span className="font-medium text-foreground">Go live.</span> Each seat gets its own link; the server decides who can move what.
        </>
      ),
      action: "How it works",
      run: () => setTab("method"),
    },
  ];

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.section
          aria-label="Getting started"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="mt-4 max-w-[1480px] px-4 lg:px-6">
            <div className="relative rounded-xl border bg-card p-4">
              <Button variant="ghost" size="icon-xs" onClick={dismiss} className="absolute top-2 right-2" aria-label="Dismiss guide">
                <X />
              </Button>
              <p className="pr-8 text-sm text-pretty">
                <span className="font-semibold">A working model of S-Process grant allocation</span>, built from Andrew Critch&apos;s public
                talk and SFF&apos;s pages. Recommenders draw marginal value functions, funders draw curves over the Recommenders they trust,
                and a simulation in which the funders take turns turns all of that into amounts. Everything here is fictional.
              </p>
              <ol className="mt-3 grid gap-2 md:grid-cols-2">
                {steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5 rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
                    <span className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
                      {i + 1}
                    </span>
                    <span className="flex-1">{s.text}</span>
                    <button
                      onClick={s.run}
                      className="inline-flex shrink-0 items-center gap-0.5 font-medium text-foreground hover:underline"
                    >
                      {s.action} <ArrowRight className="size-3" />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
