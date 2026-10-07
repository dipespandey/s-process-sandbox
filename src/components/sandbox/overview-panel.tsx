"use client";

import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from "d3-sankey";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RULES, sigmaDisagreements } from "@/lib/engine";
import { recColor } from "@/lib/colors";
import { money } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useAnalysis } from "./analysis-context";

type N = { id: string; label: string; kind: "funder" | "rec" | "app" | "hold" | "other"; color: string };
type L = { source: string; target: string; value: number; color: string };

const TOP_APPS = 12;

export function OverviewPanel() {
  const { scenario, alloc, uni, hold, total } = useAnalysis();
  const select = useStore((s) => s.select);
  const setTab = useStore((s) => s.setTab);
  const look = useStore((s) => s.look);
  const reduced = useReducedMotion();
  const [vs, setVs] = useState(scenario.recommenders[0]?.id ?? "");
  const [hover, setHover] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const vsIndex = Math.max(
    0,
    scenario.recommenders.findIndex((r) => r.id === vs),
  );
  const disagreements = useMemo(
    () => sigmaDisagreements(scenario, alloc, uni[vsIndex] ?? []).slice(0, 12),
    [scenario, alloc, uni, vsIndex],
  );
  const maxD = Math.max(1, ...disagreements.map((d) => Math.abs(d.delta)));

  const height = 420;
  // Below this the labels can't fit; the chart scrolls sideways inside its frame instead.
  const chartW = width ? Math.max(width - 24, 680) : null;
  const graph = useMemo(() => {
    if (!chartW) return null;
    const ranked = scenario.applications
      .map((_, a) => a)
      .filter((a) => a !== hold && alloc.totals[a] > 0)
      .sort((x, y) => alloc.totals[y] - alloc.totals[x]);
    const shown = new Set(ranked.slice(0, TOP_APPS));
    const appNode = (a: number) => (a === hold ? HOLD_NODE : shown.has(a) ? `a:${a}` : "other");
    const nodes: N[] = [
      ...scenario.funders.map((f) => ({ id: `f:${f.id}`, label: f.name, kind: "funder" as const, color: "var(--foreground)" })),
      ...scenario.recommenders.map((r, i) => ({ id: `r:${r.id}`, label: r.name, kind: "rec" as const, color: recColor(i) })),
      ...[...shown].map((a) => ({ id: `a:${a}`, label: scenario.applications[a].name, kind: "app" as const, color: "var(--rec-other)" })),
    ];
    if (ranked.length > TOP_APPS)
      nodes.push({ id: "other", label: `${ranked.length - TOP_APPS} more applications`, kind: "other", color: "var(--rec-other)" });
    if (hold >= 0 && alloc.totals[hold] > 0) nodes.push({ id: HOLD_NODE, label: "_hold_", kind: "hold", color: "var(--line)" });
    const links: L[] = [];
    scenario.funders.forEach((f, fi) =>
      scenario.recommenders.forEach((r, ri) => {
        const v = alloc.flow[fi][ri];
        if (v > 1) links.push({ source: `f:${f.id}`, target: `r:${r.id}`, value: v, color: recColor(ri) });
      }),
    );
    scenario.recommenders.forEach((r, ri) => {
      const agg = new Map<string, number>();
      alloc.byRec[ri].forEach((v, a) => v > 1 && agg.set(appNode(a), (agg.get(appNode(a)) ?? 0) + v));
      agg.forEach(
        (v, target) => nodes.some((n) => n.id === target) && links.push({ source: `r:${r.id}`, target, value: v, color: recColor(ri) }),
      );
    });
    if (!links.length) return null;
    // A funder with no budget (or a Recommender nobody routes through) has no links; leave it out of the flow.
    const linked = new Set(links.flatMap((l) => [l.source, l.target]));
    const usedNodes = nodes.filter((n) => linked.has(n.id));
    const layout = sankey<N, L>()
      .nodeId((d) => d.id)
      .nodeWidth(10)
      .nodePadding(scenario.recommenders.length > 8 ? 6 : 10)
      .nodeSort(null)
      .extent([
        [90, 8],
        [chartW - 230, height - 8],
      ]);
    return layout({ nodes: usedNodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) });
  }, [chartW, scenario, alloc, hold]);

  const lit = (l: SankeyLink<N, L>) => {
    if (!hover) return true;
    const s = (l.source as SankeyNode<N, L>).id,
      t = (l.target as SankeyNode<N, L>).id;
    return s === hover || t === hover;
  };

  const vetoCount = Object.values(scenario.vetoes).reduce((n, l) => n + l.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="max-w-3xl">
        <h2 className="text-xl font-semibold tracking-tight">Σ: projected final allocation</h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          {scenario.funders.length} funders take turns handing out {(scenario.turn * 100).toFixed(1)}% of their budget at a time (
          {RULES[scenario.rule].label.toLowerCase()}
          ), so nobody goes first and nobody waits for someone else to fund the obvious. Each funder routes money through the Recommenders
          they trust; each Recommender spends it where their curves say the next dollar is worth most.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Recommended" value={money(alloc.granted)} hint={`of ${money(total)} across ${scenario.funders.length} funders`} />
        <Stat label="Held for future rounds" value={money(alloc.held)} hint="Money below Recommenders' _hold_ lines" />
        <Stat label="Unplaced" value={money(alloc.unplaced)} hint="Funders' deference ran out first" />
        <Stat label="Funder final say" value={`${vetoCount} declined`} hint="Declined applications get none of that funder's money" />
      </div>

      <div ref={ref} className="overflow-x-auto rounded-xl border bg-[var(--surface-chart)] p-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground" style={{ minWidth: chartW ?? undefined }}>
          <span>Funders</span>
          <span>Recommenders</span>
          <span>Applications</span>
        </div>
        {graph && chartW ? (
          <svg width={chartW} height={height} role="img" aria-label="Money flowing from funders through Recommenders to applications">
            <g fill="none">
              {graph.links.map((l, i) => (
                <motion.path
                  key={`${(l.source as SankeyNode<N, L>).id}-${(l.target as SankeyNode<N, L>).id}-${i}`}
                  d={sankeyLinkHorizontal()(l) ?? ""}
                  stroke={l.color}
                  strokeWidth={Math.max(1, l.width ?? 1)}
                  initial={false}
                  animate={{ strokeOpacity: lit(l) ? 0.42 : 0.07 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.15 }}
                >
                  <title>{`${(l.source as SankeyNode<N, L>).label} → ${(l.target as SankeyNode<N, L>).label}: ${money(l.value)}`}</title>
                </motion.path>
              ))}
            </g>
            {graph.nodes.map((n) => {
              const left = n.kind === "funder";
              const right = n.kind === "app" || n.kind === "other" || n.kind === "hold";
              const h = Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0));
              const onClick = () => {
                if (n.kind === "funder") look({ kind: "funder", id: n.id.slice(2) });
                else if (n.kind === "rec") look({ kind: "rec", id: n.id.slice(2) });
                else if (n.kind === "app") {
                  select(scenario.applications[Number(n.id.slice(2))].id);
                  setTab("application");
                }
              };
              return (
                <g
                  key={n.id}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(null)}
                  onClick={onClick}
                  className={cn(n.kind !== "other" && n.kind !== "hold" && "cursor-pointer")}
                >
                  <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={h} rx={2} fill={n.color} />
                  <text
                    x={left ? (n.x0 ?? 0) - 6 : right ? (n.x1 ?? 0) + 6 : (n.x1 ?? 0) + 6}
                    y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
                    dy="0.32em"
                    textAnchor={left ? "end" : "start"}
                    className={cn("text-[11px]", hover === n.id ? "fill-foreground font-medium" : "fill-foreground")}
                  >
                    {n.kind === "hold" ? <tspan className="font-mono">_hold_</tspan> : truncate(n.label, right ? 30 : 14)}
                    <tspan className="fill-muted-foreground"> {money(n.value ?? 0)}</tspan>
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <div style={{ height }} />
        )}
      </div>

      <section className="rounded-xl border p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Σ&apos;s disagreements with</h3>
            <p className="text-xs text-muted-foreground">
              The change if this Recommender&apos;s unilateral allocation replaced the projected final allocation, largest first.
            </p>
          </div>
          <Select value={vs} onValueChange={(v) => setVs(String(v))}>
            <SelectTrigger size="sm" className="h-7 text-xs" aria-label="Recommender to compare">
              <SelectValue>{(v: string) => scenario.recommenders.find((r) => r.id === v)?.name ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {scenario.recommenders.map((r) => (
                <SelectItem key={r.id} value={r.id} className="text-xs">
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="flex flex-col gap-1">
          {disagreements.map((d) => {
            const app = scenario.applications[d.app];
            const pos = d.delta > 0;
            const w = (Math.abs(d.delta) / maxD) * 50;
            return (
              <li key={d.app}>
                <button
                  onClick={() => {
                    if (d.app !== hold) {
                      select(app.id);
                      setTab("application");
                    }
                  }}
                  className="grid w-full grid-cols-[minmax(0,220px)_1fr_80px] items-center gap-3 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                >
                  <span className="truncate">{d.app === hold ? <span className="font-mono">_hold_</span> : app.name}</span>
                  <span className="relative h-3">
                    <span className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                    <span
                      className="absolute top-0.5 bottom-0.5 rounded-sm"
                      style={{
                        left: pos ? "50%" : `${50 - w}%`,
                        width: `${w}%`,
                        background: pos ? "var(--seq-500)" : "color-mix(in oklch, var(--foreground) 45%, transparent)",
                        opacity: 0.8,
                      }}
                    />
                  </span>
                  <span className="text-right tnum">{money(d.delta, { sign: true })}</span>
                </button>
              </li>
            );
          })}
          {disagreements.length === 0 && <li className="text-xs text-muted-foreground">No differences: this Recommender agrees with Σ.</li>}
        </ul>
      </section>
    </div>
  );
}

const HOLD_NODE = "hold";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight tnum">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
