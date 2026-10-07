"use client";

import { Fragment, useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DisagreementCell } from "@/lib/engine";
import { initials, recColor } from "@/lib/colors";
import { money, value } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useAnalysis } from "./analysis-context";

type View = "parameters" | "margin";
type Group = { key: "fdv" | "ldt" | "conc" | "delta"; label: string; hint: string };

const GROUPS: Group[] = [
  { key: "fdv", label: "First-dollar value", hint: "How much each Recommender values the first dollar here (best dollar = 1)" },
  { key: "ldt", label: "Last-dollar threshold", hint: "Where each Recommender's value for more funding reaches zero" },
  { key: "conc", label: "Concavity", hint: "Positive holds value until near the threshold; negative drops off fast" },
  {
    key: "delta",
    label: "Difference from projected",
    hint: "That Recommender's unilateral allocation minus Σ's projected final allocation",
  },
];

/** A cell's fill: blue steps for positive magnitude, neutral ink for negative, never colour alone (the value is printed). */
function fill(t: number, negative = false) {
  const k = Math.min(1, Math.max(0, t));
  if (k < 0.04) return { bg: "transparent", dark: false };
  if (negative) return { bg: `color-mix(in oklch, var(--foreground) ${Math.round(6 + k * 38)}%, transparent)`, dark: k > 0.7 };
  const step = Math.min(7, Math.max(1, Math.ceil(k * 7)));
  return { bg: `var(--seq-${step}00)`, dark: step >= 5 };
}

export function MatrixPanel() {
  const { scenario, alloc, matrix, contested, hold } = useAnalysis();
  const select = useStore((s) => s.select);
  const setActiveRec = useStore((s) => s.setActiveRec);
  const setTab = useStore((s) => s.setTab);
  const [view, setView] = useState<View>("parameters");
  const [hover, setHover] = useState<{ a: number; r: number } | null>(null);
  const R = scenario.recommenders.length;

  const order = useMemo(() => {
    const apps = scenario.applications.map((_, i) => i).filter((i) => i !== hold);
    apps.sort((x, y) => alloc.totals[y] - alloc.totals[x] || x - y);
    return hold >= 0 ? [...apps, hold] : apps;
  }, [scenario.applications, alloc.totals, hold]);
  const maxLdt = Math.max(
    1,
    ...matrix
      .flat()
      .map((c) => c.ldt ?? 0)
      .filter((v, i) => Number.isFinite(v) && i >= 0),
  );
  const appLdtMax = Math.max(1, ...order.filter((a) => a !== hold).flatMap((a) => matrix[a].map((c) => c.ldt ?? 0)));
  const maxDelta = Math.max(1, ...order.flatMap((a) => matrix[a].map((c) => Math.abs(c.delta))));
  const maxContest = Math.max(0.01, ...contested);

  const cellFor = (g: Group["key"], c: DisagreementCell, a: number) => {
    if (g === "delta") {
      const show = Math.abs(c.delta) >= 1000;
      return { text: show ? money(c.delta, { sign: true }) : c.evaluated ? "0" : "", ...fill(Math.abs(c.delta) / maxDelta, c.delta < 0) };
    }
    if (!c.evaluated) return { text: "", bg: "transparent", dark: false };
    if (g === "fdv") return { text: value(c.fdv!), ...fill(c.fdv!) };
    if (g === "ldt") return { text: money(c.ldt!), ...fill(c.ldt! / (a === hold ? maxLdt : appLdtMax)) };
    return { text: c.conc!.toFixed(2), ...fill(Math.abs(c.conc!), c.conc! < 0) };
  };

  const h = hover ? matrix[hover.a][hover.r] : null;
  const open = (a: number, r: number) => {
    if (a === hold) return;
    select(scenario.applications[a].id);
    if (matrix[a][r].evaluated) setActiveRec(scenario.recommenders[r].id);
    setTab("application");
  };
  const groups = view === "parameters" ? GROUPS : [];
  const colsPerGroup = R;
  const template =
    view === "parameters"
      ? `minmax(170px, 230px) 64px ${GROUPS.map(() => `repeat(${colsPerGroup}, minmax(44px, 1fr))`).join(" 8px ")} 64px`
      : `minmax(180px, 260px) 72px repeat(${R}, minmax(30px, 1fr)) 72px`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold tracking-tight">Disagreement matrix</h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            The discussion prompt for a meeting. Each row puts every Recommender&apos;s curve parameters side by side with how far their own
            unilateral allocation sits from Σ&apos;s projection. Large differences show where a conversation is most likely to move money.
            Click a cell to open it.
          </p>
        </div>
        <ToggleGroup
          value={[view]}
          onValueChange={(v) => v[0] && setView(v[0] as View)}
          variant="outline"
          size="sm"
          aria-label="Matrix view"
        >
          <ToggleGroupItem value="parameters" className="text-xs">
            Parameters
          </ToggleGroupItem>
          <ToggleGroupItem value="margin" className="text-xs">
            Margin
          </ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="min-h-5 text-xs text-muted-foreground tnum" aria-live="polite">
        {hover && h ? (
          <>
            <span className="font-medium text-foreground">{scenario.recommenders[hover.r].name}</span> on{" "}
            <span className="font-medium text-foreground">{scenario.applications[hover.a].name}</span>:{" "}
            {h.evaluated
              ? `FDV ${value(h.fdv!)} · LDT ${money(h.ldt!)} · CONC ${h.conc!.toFixed(2)} · next $ worth ${value(h.u)} vs their last dollar ${value(h.cutoff)} · unilateral ${money(h.unilateral)}, projected ${money(alloc.totals[hover.a])}`
              : "not evaluated"}
          </>
        ) : view === "margin" ? (
          "Dark: about where this Recommender would put their next dollar. Pale: funded beyond what they alone would choose."
        ) : (
          "Hover a cell for the full picture."
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <div
          role="grid"
          aria-label="Disagreement matrix"
          className="grid min-w-fit text-[11px]"
          style={{ gridTemplateColumns: template }}
          onPointerLeave={() => setHover(null)}
        >
          {view === "parameters" && (
            <div role="row" className="contents">
              <div className="sticky left-0 z-20 bg-background" />
              <div className="bg-background" />
              {groups.map((g, gi) => (
                <Fragment key={g.key}>
                  {gi > 0 && <div className="bg-background" />}
                  <div
                    role="columnheader"
                    title={g.hint}
                    className="border-b bg-background px-1 pt-2 pb-1 text-center font-medium"
                    style={{ gridColumn: `span ${colsPerGroup}` }}
                  >
                    {g.label}
                  </div>
                </Fragment>
              ))}
              <div className="bg-background" />
            </div>
          )}
          <div role="row" className="contents">
            <div role="columnheader" className="sticky top-0 left-0 z-20 border-b bg-background px-3 py-1.5 font-medium">
              Application
            </div>
            <div role="columnheader" className="sticky top-0 z-10 border-b bg-background px-2 py-1.5 text-right font-medium">
              Projected
            </div>
            {(view === "parameters" ? GROUPS : [null]).map((g, gi) => (
              <Fragment key={g?.key ?? "m"}>
                {gi > 0 && <div className="border-b bg-background" />}
                {scenario.recommenders.map((rec, r) => (
                  <div
                    role="columnheader"
                    key={`${g?.key}-${rec.id}`}
                    title={`${rec.name} · ${rec.focus}`}
                    className={cn(
                      "sticky top-0 z-10 flex flex-col items-center gap-0.5 border-b bg-background py-1 font-medium",
                      hover?.r === r && "bg-accent",
                    )}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: recColor(r) }} aria-hidden />
                    <span>{initials(rec.name)}</span>
                  </div>
                ))}
              </Fragment>
            ))}
            <div
              role="columnheader"
              className="sticky top-0 z-10 border-b bg-background px-2 py-1.5 text-right font-medium"
              title="Spread of unilateral-vs-projected gaps"
            >
              Contested
            </div>
          </div>

          {order.map((a) => {
            const app = scenario.applications[a];
            const isHold = a === hold;
            return (
              <div role="row" key={app.id} className="group contents">
                <div
                  role="rowheader"
                  className={cn(
                    "sticky left-0 z-10 truncate border-b bg-background px-3 py-1 group-hover:bg-accent",
                    hover?.a === a && "bg-accent",
                    isHold && "border-t font-mono",
                  )}
                >
                  {isHold ? "_hold_" : app.name}
                </div>
                <div
                  className={cn(
                    "border-b px-2 py-1 text-right tnum group-hover:bg-accent/60",
                    alloc.totals[a] === 0 && "text-muted-foreground",
                    isHold && "border-t",
                  )}
                >
                  {alloc.totals[a] > 0 ? money(alloc.totals[a]) : "—"}
                </div>
                {view === "parameters"
                  ? GROUPS.map((g, gi) => (
                      <Fragment key={g.key}>
                        {gi > 0 && <div className={cn("border-b", isHold && "border-t")} />}
                        {matrix[a].map((c, r) => {
                          const cell = cellFor(g.key, c, a);
                          return (
                            <button
                              role="gridcell"
                              key={r}
                              aria-label={`${scenario.recommenders[r].name}, ${app.name}, ${g.label}: ${cell.text || "not evaluated"}`}
                              onPointerEnter={() => setHover({ a, r })}
                              onFocus={() => setHover({ a, r })}
                              onClick={() => open(a, r)}
                              className={cn(
                                "m-[1px] min-h-5 rounded-[3px] px-0.5 text-center tnum outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                cell.dark ? "text-white" : "text-foreground",
                                !c.evaluated && g.key !== "delta" && "text-muted-foreground",
                                hover?.a === a && hover.r === r && "ring-2 ring-foreground/60",
                              )}
                              style={{ background: cell.bg }}
                            >
                              {cell.text}
                            </button>
                          );
                        })}
                      </Fragment>
                    ))
                  : matrix[a].map((c, r) => {
                      const t = c.ratio === null ? null : Math.min(1, Math.max(0, c.ratio));
                      const f = t === null ? null : fill(t);
                      return (
                        <button
                          role="gridcell"
                          key={r}
                          aria-label={`${scenario.recommenders[r].name}, ${app.name}: ${c.evaluated ? `ratio ${c.ratio === null ? "n/a" : c.ratio.toFixed(2)}` : "not evaluated"}`}
                          onPointerEnter={() => setHover({ a, r })}
                          onFocus={() => setHover({ a, r })}
                          onClick={() => open(a, r)}
                          className={cn(
                            "relative m-[1px] min-h-5 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            !c.evaluated && "border border-dashed",
                            hover?.a === a && hover.r === r && "ring-2 ring-foreground/60",
                          )}
                          style={{ background: c.evaluated ? (f?.bg ?? "var(--seq-empty)") : "var(--seq-empty)" }}
                        />
                      );
                    })}
                <div className={cn("flex items-center border-b px-2", isHold && "border-t")}>
                  {!isHold && (
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div className="h-full rounded-full bg-foreground/60" style={{ width: `${(contested[a] / maxContest) * 100}%` }} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Fill strength shows magnitude: blue for positive values, grey for negative. Every value is printed in its cell, so colour is never
        the only cue.
      </p>
    </div>
  );
}
