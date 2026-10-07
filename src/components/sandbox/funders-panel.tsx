"use client";

import { Ban, Lock } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { curve, saturation } from "@/lib/engine";
import { recColor } from "@/lib/colors";
import { gestureHandler } from "@/lib/edit";
import { money, parseMoney, pct, value } from "@/lib/format";
import { canEdit } from "@/lib/live/protocol";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useAnalysis } from "./analysis-context";
import { CurveEditor, type EditorCurve } from "./curve-editor";

export function FundersPanel() {
  const { scenario, alloc, funderIndex, hold, total } = useAnalysis();
  const activeFunder = useStore((s) => s.activeFunder);
  const look = useStore((s) => s.look);
  const activeRec = useStore((s) => s.activeRec);
  const setActiveRec = useStore((s) => s.setActiveRec);
  const setDeference = useStore((s) => s.setDeference);
  const setFunderBudget = useStore((s) => s.setFunderBudget);
  const setVeto = useStore((s) => s.setVeto);
  const select = useStore((s) => s.select);
  const seat = useStore((s) => s.live.seat);

  const f = funderIndex.get(activeFunder ?? "") ?? 0;
  const funder = scenario.funders[f];
  const editable = canEdit(seat, { type: "deference", funder: funder.id });
  const row = scenario.deference[funder.id] ?? {};

  const curves: EditorCurve[] = scenario.recommenders.map((rec, r) => ({
    key: rec.id,
    label: rec.name,
    color: recColor(r),
    curve: row[rec.id] ?? curve(0, 1, 0),
    editable,
  }));
  const activeKey = curves.some((c) => c.key === activeRec) ? activeRec : curves[0].key;
  const ar = scenario.recommenders.findIndex((r) => r.id === activeKey);
  const xMax = Math.max(
    funder.budget * 0.8,
    ...curves.map((c) => saturation(c.curve) * 1.05),
    ...alloc.flow[f].map((d) => d * 1.1),
    100_000,
  );
  const onChange = gestureHandler((c) => activeKey && setDeference(funder.id, activeKey, c));
  const vetoes = new Set(scenario.vetoes[funder.id] ?? []);
  const reached = scenario.applications
    .map((_, a) => a)
    .filter((a) => a !== hold && (alloc.byFunder[f][a] > 0 || vetoes.has(scenario.applications[a].id)))
    .sort((x, y) => alloc.byFunder[f][y] - alloc.byFunder[f][x]);
  const funderHeld = hold >= 0 ? alloc.byFunder[f][hold] : 0;
  const spent = alloc.byFunder[f].reduce((s, v) => s + v, 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <div className="mb-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Funder">
            {scenario.funders.map((x) => (
              <button
                key={x.id}
                role="radio"
                aria-checked={x.id === funder.id}
                onClick={() => look({ kind: "funder", id: x.id })}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-[background-color,transform] active:scale-[0.96]",
                  x.id === funder.id ? "border-foreground/25 bg-accent font-medium" : "hover:bg-accent/60",
                )}
              >
                {x.name}
                <span className="text-muted-foreground tnum">{money(x.budget)}</span>
              </button>
            ))}
          </div>
          <h2 className="text-xl font-semibold tracking-tight">{funder.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            {funder.name}&apos;s marginal value for routing more money through each Recommender: a first-dollar value (how much they trust
            that person&apos;s first calls) and a last-dollar threshold (how far they would keep trusting them). Funders have the final say:
            declining an application keeps every dollar of theirs away from it.
          </p>
        </div>
        <div className="flex items-end gap-4">
          <BudgetInput
            value={funder.budget}
            disabled={!canEdit(seat, { type: "budget", funder: funder.id })}
            onCommit={(v) => setFunderBudget(funder.id, v)}
          />
          <dl className="text-right">
            <dt className="text-[11px] text-muted-foreground">Placed · held · share of round</dt>
            <dd className="text-lg font-semibold tracking-tight tnum">
              {money(spent - funderHeld)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · {money(funderHeld)} · {pct(total ? funder.budget / total : 0)}
              </span>
            </dd>
          </dl>
        </div>
      </header>

      <div className="rounded-xl border bg-[var(--surface-chart)] p-3 pt-4">
        <CurveEditor
          curves={curves}
          activeKey={activeKey}
          onActivate={setActiveRec}
          onChange={onChange}
          xMax={xMax}
          xLabel={`Dollars of ${funder.name}'s routed through the Recommender`}
          yLabel={`${funder.name}'s value of routing the next dollar`}
          markers={scenario.recommenders.map((rec, r) => ({
            key: rec.id,
            x: alloc.flow[f][r],
            label: rec.id === activeKey ? `${rec.name}: ${money(alloc.flow[f][r])}` : "",
            color: recColor(r),
          }))}
          fundedTo={ar >= 0 ? alloc.flow[f][ar] : undefined}
          hLine={
            scenario.rule === "delegated" && alloc.fundingLine[f] !== null
              ? { y: alloc.fundingLine[f]!, label: `${funder.name}'s last dollar · ${value(alloc.fundingLine[f])}` }
              : null
          }
          ariaLabel={`${funder.name}'s deference curves`}
          xStep={20_000}
          readOnlyReason={editable ? null : `Only ${funder.name} (or the facilitator) can change these curves.`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recommender</TableHead>
              <TableHead className="text-right">FDV</TableHead>
              <TableHead className="text-right">LDT</TableHead>
              <TableHead className="text-right">CONC</TableHead>
              <TableHead className="text-right">Routed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scenario.recommenders.map((rec, r) => {
              const c = row[rec.id];
              return (
                <TableRow
                  key={rec.id}
                  data-state={rec.id === activeKey ? "selected" : undefined}
                  onClick={() => setActiveRec(rec.id)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ background: recColor(r) }} aria-hidden />
                      {rec.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tnum">{c ? value(c.fdv) : "—"}</TableCell>
                  <TableCell className="text-right tnum">{c ? money(c.ldt) : "—"}</TableCell>
                  <TableCell className="text-right tnum">{c ? c.conc.toFixed(2) : "—"}</TableCell>
                  <TableCell className="text-right tnum">{money(alloc.flow[f][r])}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <section className="rounded-xl border">
          <h3 className="flex items-center gap-1.5 border-b px-3 py-2 text-sm font-medium">
            <Ban className="size-3.5" /> {funder.name}&apos;s final say
            {!canEdit(seat, { type: "veto", funder: funder.id }) && <Lock className="ml-auto size-3 text-muted-foreground" />}
          </h3>
          <ul className="max-h-80 overflow-y-auto py-1 text-xs">
            {reached.map((a) => {
              const app = scenario.applications[a];
              const declined = vetoes.has(app.id);
              return (
                <li key={app.id} className="flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-accent/50">
                  <button
                    onClick={() => select(app.id)}
                    className={cn("min-w-0 flex-1 truncate text-left", declined && "text-muted-foreground line-through")}
                  >
                    {app.name}
                  </button>
                  <span className="shrink-0 text-muted-foreground tnum">{declined ? "declined" : money(alloc.byFunder[f][a])}</span>
                  <Switch
                    checked={!declined}
                    disabled={!canEdit(seat, { type: "veto", funder: funder.id })}
                    onCheckedChange={(on) => setVeto(funder.id, app.id, !on)}
                    aria-label={`${declined ? "Accept" : "Decline"} ${app.name} for ${funder.name}`}
                  />
                </li>
              );
            })}
            {reached.length === 0 && <li className="px-3 py-2 text-muted-foreground">No recommendations reach this funder yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function BudgetInput({ value: v, disabled, onCommit }: { value: number; disabled: boolean; onCommit(v: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      Budget
      <Input
        value={draft ?? money(v, { precise: true })}
        disabled={disabled}
        onFocus={(e) => {
          setDraft(money(v, { precise: true }));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = draft === null ? null : parseMoney(draft);
          if (n !== null && n <= 500_000_000) onCommit(n);
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 w-28 font-medium text-foreground tnum"
        aria-label="Funder budget"
      />
    </label>
  );
}
