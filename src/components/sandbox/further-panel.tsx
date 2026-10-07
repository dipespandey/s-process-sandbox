"use client";

import { Check, Minus } from "lucide-react";
import { useDeferredValue, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { allocate, furtherOpportunities } from "@/lib/engine";
import { money } from "@/lib/format";
import { useStore } from "@/lib/store";
import { useAnalysis } from "./analysis-context";

const config: ChartConfig = {
  base: { label: "Base round", color: "var(--seq-600)" },
  add5: { label: "+ first $5M", color: "var(--seq-400)" },
  add15: { label: "+ next $10M", color: "var(--seq-200)" },
};

export function FurtherPanel() {
  const { scenario } = useAnalysis();
  const deferred = useDeferredValue(scenario);
  const select = useStore((s) => s.select);
  const fo = useMemo(() => furtherOpportunities(deferred, allocate(deferred)), [deferred]);
  const stale = deferred !== scenario;

  const rows = fo.rows.filter((r) => r.plus15 > 0.5 || r.base > 0).sort((p, q) => q.plus15 - p.plus15 || q.base - p.base);
  const added = rows.filter((r) => r.plus15 > 0.5);
  const data = added.slice(0, 16).map((r) => ({
    name: scenario.applications[r.app]?.name ?? "",
    base: r.base,
    add5: r.plus5,
    add15: r.plus15 - r.plus5,
  }));

  return (
    <div className="flex flex-col gap-5" style={{ opacity: stale ? 0.7 : 1, transition: "opacity 150ms" }}>
      <header className="max-w-3xl">
        <h2 className="text-xl font-semibold tracking-tight">Further funding opportunities</h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          A reimplementation of the method SFF describes for its published 2025 &ldquo;further opportunities&rdquo;: continue the round with
          the funders&apos; deference curves for an extra $5M (split by budget share); split a further $10M among Recommenders in proportion
          to their delegation so far; publish additions of at least $100k or 10% of the ask.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Applications gaining funding" value={`${added.length}`} />
        <Stat
          label="Held or unplaced in the first $5M"
          value={money(fo.heldFirst + fo.unspentFirst)}
          hint={`${money(fo.heldFirst)} below Recommenders' _hold_ lines · ${money(fo.unspentFirst)} where deference ran out`}
        />
        <Stat
          label="Held or unplaced in the next $10M"
          value={money(fo.heldSecond + fo.unspentSecond)}
          hint={`${money(fo.heldSecond)} held · ${money(fo.unspentSecond)} with no positive-value use left`}
        />
      </div>

      {data.length > 0 && (
        <div className="rounded-xl border p-4">
          <h3 className="mb-2 text-sm font-medium">Allocation under each budget scenario</h3>
          <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 52 + data.length * 26 }}>
            <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke="var(--grid)" />
              <XAxis type="number" tickFormatter={(v) => money(v)} tickLine={false} axisLine={false} fontSize={10} />
              <YAxis
                type="category"
                dataKey="name"
                width={220}
                tickLine={false}
                axisLine={false}
                interval={0}
                tick={({ x, y, payload }) => (
                  <text x={x} y={y} dy="0.32em" textAnchor="end" className="fill-foreground text-[11px]">
                    {payload.value.length > 34 ? `${payload.value.slice(0, 33)}…` : payload.value}
                  </text>
                )}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md tnum">
                      <div className="mb-0.5 font-medium">{p.name}</div>
                      <div>Base {money(p.base)}</div>
                      <div>+$5M scenario: +{money(p.add5)}</div>
                      <div>+$15M scenario: +{money(p.add5 + p.add15)}</div>
                    </div>
                  );
                }}
              />
              <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
              <Bar dataKey="base" stackId="s" fill="var(--color-base)" stroke="var(--background)" strokeWidth={2} maxBarSize={18} />
              <Bar dataKey="add5" stackId="s" fill="var(--color-add5)" stroke="var(--background)" strokeWidth={2} maxBarSize={18} />
              <Bar
                dataKey="add15"
                stackId="s"
                fill="var(--color-add15)"
                stroke="var(--background)"
                strokeWidth={2}
                radius={[0, 4, 4, 0]}
                maxBarSize={18}
              />
            </BarChart>
          </ChartContainer>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Application</TableHead>
            <TableHead className="text-right">Base</TableHead>
            <TableHead className="text-right">Additional at +$5M</TableHead>
            <TableHead className="text-right">Additional at +$15M</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const app = scenario.applications[r.app];
            if (!app) return null;
            return (
              <TableRow key={app.id} onClick={() => select(app.id)} className="cursor-pointer">
                <TableCell className="max-w-80 truncate">{app.name}</TableCell>
                <TableCell className="text-right tnum">{r.base > 0 ? money(r.base) : "—"}</TableCell>
                <TableCell className="text-right tnum">
                  <Published shown={r.shown5} amount={r.plus5} />
                </TableCell>
                <TableCell className="text-right tnum">
                  <Published shown={r.shown15} amount={r.plus15} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        <Check className="mr-1 inline size-3" />
        meets the publication threshold. <Minus className="mx-1 inline size-3" />
        below it (shown here, but would not be published). The &ldquo;proportional&rdquo; split is the one interpretive choice; SFF&apos;s
        page does not specify the weights.
      </p>
    </div>
  );
}

function Published({ shown, amount }: { shown: boolean; amount: number }) {
  if (amount <= 0.5) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={shown ? "" : "text-muted-foreground"}>
      {shown ? (
        <Check className="mr-1 inline size-3" aria-label="meets threshold" />
      ) : (
        <Minus className="mr-1 inline size-3" aria-label="below threshold" />
      )}
      +{money(amount)}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight tnum">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
