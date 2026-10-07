"use client";

import * as Comlink from "comlink";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AnalysisWorker } from "@/lib/analysis.worker";
import type { Scenario, Sensitivity } from "@/lib/engine";
import { recColor } from "@/lib/colors";
import { money } from "@/lib/format";
import { useStore } from "@/lib/store";
import { useAnalysis, useDeferredScenario } from "./analysis-context";

type Result = Sensitivity & { ms: number };

function useSensitivity(scenario: Scenario, factor: number) {
  const worker = useRef<Comlink.Remote<AnalysisWorker> | null>(null);
  const [state, setState] = useState<{ result: Result | null; pending: boolean; key: Scenario | null }>({
    result: null,
    pending: true,
    key: null,
  });
  useEffect(() => {
    const w = new Worker(new URL("../../lib/analysis.worker.ts", import.meta.url), { type: "module" });
    worker.current = Comlink.wrap<AnalysisWorker>(w);
    return () => w.terminate();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!worker.current) return;
      setState((s) => ({ ...s, pending: true }));
      const result = await worker.current.sensitivity(scenario, factor);
      if (!cancelled) setState({ result, pending: false, key: scenario });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [scenario, factor]);
  return state;
}

const config: ChartConfig = {
  down: { label: "Decrease", color: "color-mix(in oklch, var(--foreground) 32%, transparent)" },
  up: { label: "Increase", color: "color-mix(in oklch, var(--foreground) 72%, transparent)" },
};

export function SensitivityPanel() {
  const { scenario, alloc } = useAnalysis();
  const deferred = useDeferredScenario();
  const select = useStore((s) => s.select);
  const [factor, setFactor] = useState(0.2);
  const { result, pending } = useSensitivity(deferred, factor);

  const tornado = (rows: Sensitivity["deference"]) =>
    rows
      .map((r) => ({ name: scenario.recommenders[r.rec]?.name ?? "", r: r.rec, down: -r.down, up: r.up }))
      .sort((p, q) => q.up - q.down - (p.up - p.down));

  const ranges = result
    ? result.range
        .map((rg, a) => ({ a, ...rg, base: alloc.totals[a] }))
        .filter((r) => r.max - r.min > 1 && scenario.applications[r.a])
        .sort((p, q) => q.max - q.min - (p.max - p.min))
        .slice(0, 14)
    : [];
  const rangeMax = Math.max(1, ...ranges.map((r) => r.max));
  const pctLabel = `${Math.round(factor * 100)}%`;
  const evalMoved = result ? result.evaluations.reduce((s, r) => s + r.up + r.down, 0) : 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold tracking-tight">Sensitivity</h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Which inputs matter? Each bar re-runs the whole round with one Recommender&apos;s inputs scaled down or up, and reports how many
            dollars change hands.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Computing" />}
          {result && !pending && (
            <span className="text-xs text-muted-foreground tnum">
              {result.deference.length * 4} runs · {Math.round(result.ms)} ms in a worker
            </span>
          )}
          <ToggleGroup
            value={[String(factor)]}
            onValueChange={(v) => v[0] && setFactor(Number(v[0]))}
            variant="outline"
            size="sm"
            aria-label="Perturbation size"
          >
            {[0.1, 0.2, 0.5].map((f) => (
              <ToggleGroupItem key={f} value={String(f)} className="text-xs tnum">
                ±{Math.round(f * 100)}%
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </header>

      {result ? (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Tornado
              title={`Funder deference ±${pctLabel}`}
              subtitle="Scale one Recommender's deference curve"
              data={tornado(result.deference)}
            />
            {evalMoved < 1 ? (
              <div className="flex flex-col rounded-xl border p-4">
                <h3 className="text-sm font-medium">Recommender values ±{pctLabel}</h3>
                <p className="text-xs text-muted-foreground">Scale every curve one Recommender entered · dollars moved</p>
                <div className="flex flex-1 items-center justify-center py-8 text-center text-sm text-muted-foreground">
                  $0 moves for every Recommender.
                </div>
              </div>
            ) : (
              <Tornado
                title={`Recommender values ±${pctLabel}`}
                subtitle="Scale every curve one Recommender entered"
                data={tornado(result.evaluations)}
              />
            )}
          </div>
          {scenario.rule === "delegated" && evalMoved < 1 && (
            <p className="rounded-lg border bg-card px-3 py-2.5 text-sm">
              <span className="font-medium">Nothing moves when a Recommender scales all their own curves.</span>{" "}
              <span className="text-muted-foreground">
                Under two-stage delegation a Recommender only ranks their own options; the Funder alone decides how much they spend. So only
                the
                <em> shape</em> of a Recommender&apos;s curves matters, not their units. Switch to the joint rule to see scale start to
                matter.
              </span>
            </p>
          )}
          <div className="rounded-xl border p-4">
            <h3 className="text-sm font-medium">Least robust allocations</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Range of each application&apos;s allocation across every perturbation above; the dot is the current allocation.
            </p>
            <ul className="flex flex-col gap-1.5">
              {ranges.map((r) => (
                <li key={r.a}>
                  <button
                    onClick={() => select(scenario.applications[r.a].id)}
                    className="grid w-full grid-cols-[minmax(0,220px)_1fr_120px] items-center gap-3 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                  >
                    <span className="truncate">{scenario.applications[r.a].name}</span>
                    <span className="relative h-4">
                      <span className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-[var(--grid)]" />
                      <span
                        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/25"
                        style={{ left: `${(r.min / rangeMax) * 100}%`, width: `${Math.max(0.5, ((r.max - r.min) / rangeMax) * 100)}%` }}
                      />
                      <span
                        className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
                        style={{ left: `${(r.base / rangeMax) * 100}%` }}
                      />
                    </span>
                    <span className="text-right text-muted-foreground tnum">
                      {money(r.min)}–{money(r.max)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Running perturbations…
        </div>
      )}
    </div>
  );
}

function Tornado({
  title,
  subtitle,
  data,
}: {
  title: string;
  subtitle: string;
  data: { name: string; r: number; down: number; up: number }[];
}) {
  return (
    <div className="rounded-xl border p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mb-2 text-xs text-muted-foreground">{subtitle} · dollars moved</p>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 48 + data.length * 26 }}>
        <BarChart data={data} layout="vertical" stackOffset="sign" margin={{ left: 0, right: 12, top: 0, bottom: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tickFormatter={(v) => money(Math.abs(v))} tickLine={false} axisLine={false} fontSize={10} />
          <YAxis
            type="category"
            dataKey="name"
            width={72}
            tickLine={false}
            axisLine={false}
            tick={({ x, y, payload, index }) => (
              <g transform={`translate(${x},${y})`}>
                <circle cx={-62} cy={0} r={3.5} fill={recColor(data[index]?.r ?? -1)} />
                <text x={-54} dy="0.32em" className="fill-foreground text-[11px]">
                  {payload.value}
                </text>
              </g>
            )}
          />
          <ReferenceLine x={0} stroke="var(--border)" />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!p) return null;
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md tnum">
                  <div className="font-medium">{p.name}</div>
                  <div>Decrease: {money(-p.down)} moves</div>
                  <div>Increase: {money(p.up)} moves</div>
                </div>
              );
            }}
          />
          <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
          <Bar
            dataKey="down"
            stackId="t"
            fill="var(--color-down)"
            stroke="var(--background)"
            strokeWidth={2}
            radius={[4, 0, 0, 4]}
            maxBarSize={18}
          />
          <Bar
            dataKey="up"
            stackId="t"
            fill="var(--color-up)"
            stroke="var(--background)"
            strokeWidth={2}
            radius={[0, 4, 4, 0]}
            maxBarSize={18}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
