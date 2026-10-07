"use client";

import { scaleLinear } from "d3-scale";
import { line as d3line } from "d3-shape";
import { useEffect, useMemo, useRef, useState } from "react";
import { money } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useAnalysis } from "./analysis-context";

const M = { top: 16, right: 176, bottom: 34, left: 52 };

export function PathPanel() {
  const { scenario, alloc, appIndex, hold } = useAnalysis();
  const selected = useStore((s) => s.selectedApp);
  const select = useStore((s) => s.select);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ spent: number; app: number | null } | null>(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const height = 380;
  const innerW = width - M.left - M.right,
    innerH = height - M.top - M.bottom;
  const sel = appIndex.get(selected ?? "") ?? -1;
  const yMaxVal = Math.max(1, ...alloc.totals.filter((_, a) => a !== hold));
  const x = scaleLinear()
    .domain([0, Math.max(1, alloc.budget)])
    .range([0, innerW]);
  const y = scaleLinear().domain([0, yMaxVal]).nice().range([innerH, 0]);
  const ln = d3line<{ spent: number; totals: number[] }>().x((p) => x(p.spent));
  const paths = scenario.applications.map((_, a) => ln.y((p) => y(p.totals[a]))(alloc.path) ?? "");

  // First budget level at which each application receives money.
  const entry = useMemo(() => {
    const first = new Array(scenario.applications.length).fill(Infinity);
    for (const s of alloc.segments) if (s.app !== hold && s.from < first[s.app]) first[s.app] = s.from;
    return first
      .map((v, a) => ({ a, at: v }))
      .filter((e) => Number.isFinite(e.at))
      .sort((p, q) => p.at - q.at);
  }, [alloc.segments, scenario.applications.length, hold]);

  const atIndex = hover
    ? Math.min(
        alloc.path.length - 1,
        Math.max(
          0,
          alloc.path.findIndex((p) => p.spent >= hover.spent),
        ),
      )
    : -1;
  const snap = atIndex >= 0 ? alloc.path[atIndex] : null;
  const fundedAt = snap ? snap.totals.filter((t) => t > 0).length : null;
  const focus = hover?.app ?? sel;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const spent = x.invert(e.clientX - rect.left);
    const py = e.clientY - rect.top;
    const idx = Math.min(
      alloc.path.length - 1,
      Math.max(
        0,
        alloc.path.findIndex((p) => p.spent >= spent),
      ),
    );
    const p = alloc.path[idx];
    let best: number | null = null,
      dist = 14;
    p?.totals.forEach((t, a) => {
      const d = Math.abs(y(t) - py);
      if (t > 0 && d < dist) {
        dist = d;
        best = a;
      }
    });
    setHover({ spent, app: best });
  }

  // Direct-label the top few end values only, skipping any that would collide.
  const endLabels = (() => {
    const top = alloc.totals
      .map((t, a) => ({ a, t }))
      .filter((e) => e.t > 0 && e.a !== hold)
      .sort((p, q) => q.t - p.t);
    const placed: { a: number; yy: number }[] = [];
    for (const e of top) {
      const yy = y(e.t);
      if (placed.every((p) => Math.abs(p.yy - yy) > 12) || e.a === sel) placed.push({ a: e.a, yy });
      if (placed.length >= 8) break;
    }
    return placed;
  })();

  return (
    <div className="flex flex-col gap-5">
      <header className="max-w-3xl">
        <h2 className="text-xl font-semibold tracking-tight">Budget path</h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          Greedy allocation has a useful property: the allocation at a smaller budget is exactly where the larger budget passed through on
          its way. Each line is one application&apos;s funding as the budget is spent, so you can read off what any smaller round would have
          funded.
        </p>
      </header>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div ref={ref} className="relative rounded-xl border bg-[var(--surface-chart)] p-3">
          <svg width={width - 24} height={height} role="img" aria-label="Allocation of each application as the budget is spent">
            <g transform={`translate(${M.left},${M.top})`}>
              {y.ticks(5).map((t) => (
                <g key={t}>
                  <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
                  <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tnum">
                    {money(t)}
                  </text>
                </g>
              ))}
              {x.ticks(6).map((t) => (
                <text key={t} x={x(t)} y={innerH + 18} textAnchor="middle" className="fill-muted-foreground text-[10px] tnum">
                  {money(t)}
                </text>
              ))}
              <text x={innerW} y={innerH + 31} textAnchor="end" className="fill-muted-foreground text-[10px]">
                Budget spent →
              </text>
              {paths.map((d, a) =>
                a === focus || a === hold ? null : (
                  <path key={a} d={d} fill="none" stroke="var(--rec-other)" strokeOpacity={focus >= 0 ? 0.35 : 0.6} strokeWidth={1.25} />
                ),
              )}
              {focus >= 0 && <path d={paths[focus]} fill="none" stroke="var(--rec-1)" strokeWidth={2.5} strokeLinejoin="round" />}
              {endLabels.map(({ a, yy }) => (
                <text
                  key={a}
                  x={innerW + 6}
                  y={yy}
                  dy="0.32em"
                  className={cn("text-[10px]", a === focus ? "fill-foreground font-medium" : "fill-muted-foreground")}
                >
                  {truncate(scenario.applications[a].name, 24)} · {money(alloc.totals[a])}
                </text>
              ))}
              {hover && (
                <line
                  x1={x(hover.spent)}
                  x2={x(hover.spent)}
                  y1={0}
                  y2={innerH}
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.4}
                  pointerEvents="none"
                />
              )}
              <rect
                width={innerW}
                height={innerH}
                fill="transparent"
                onPointerMove={onMove}
                onPointerLeave={() => setHover(null)}
                onClick={() => hover?.app != null && select(scenario.applications[hover.app].id)}
                className={cn(hover?.app != null && "cursor-pointer")}
              />
            </g>
          </svg>
          {hover && snap && (
            <div
              className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md tnum"
              style={{ left: Math.min(M.left + x(hover.spent) + 20, width - 220), top: 24 }}
            >
              <div className="font-medium">At {money(snap.spent)} spent</div>
              <div className="text-muted-foreground">{fundedAt} applications funded</div>
              {focus >= 0 && (
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-3 rounded-full bg-[var(--rec-1)]" />
                  {truncate(scenario.applications[focus].name, 28)}: {money(snap.totals[focus])}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="rounded-xl border">
          <h3 className="border-b px-3 py-2 text-sm font-medium">Funding order</h3>
          <ol className="max-h-[360px] overflow-y-auto py-1 text-xs">
            {entry.map((e, i) => (
              <li key={e.a}>
                <button
                  onClick={() => select(scenario.applications[e.a].id)}
                  onPointerEnter={() => setHover({ spent: e.at, app: e.a })}
                  onPointerLeave={() => setHover(null)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1 text-left hover:bg-accent",
                    e.a === sel && "bg-accent font-medium",
                  )}
                >
                  <span className="truncate">
                    <span className="mr-1.5 text-muted-foreground tnum">{i + 1}.</span>
                    {scenario.applications[e.a].name}
                  </span>
                  <span className="shrink-0 text-muted-foreground tnum">at {money(e.at)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
