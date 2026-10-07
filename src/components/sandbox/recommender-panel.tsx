"use client";

import { Lock, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HOLD_ID, curve, normalizeCurve, type Curve } from "@/lib/engine";
import { recColor } from "@/lib/colors";
import { gestureHandler } from "@/lib/edit";
import { money, parseMoney, value } from "@/lib/format";
import { canEdit } from "@/lib/live/protocol";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useAnalysis } from "./analysis-context";
import { CurveEditor, type EditorCurve } from "./curve-editor";

const NONE: Record<string, Curve> = {};

function niceCeil(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  for (const n of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (n * exp >= v) return n * exp;
  return 10 * exp;
}

/** A Recommender's whole slate, as in the S-Process app: every curve they entered, their _hold_ line and the FDV / LDT / CONC table. */
export function RecommenderPanel() {
  const { scenario, alloc, uni, recIndex, appIndex, total, hold } = useAnalysis();
  const activeRec = useStore((s) => s.activeRec);
  const look = useStore((s) => s.look);
  const selected = useStore((s) => s.selectedApp);
  const select = useStore((s) => s.select);
  const setEvaluation = useStore((s) => s.setEvaluation);
  const setSimBudget = useStore((s) => s.setSimBudget);
  const seat = useStore((s) => s.live.seat);

  const r = recIndex.get(activeRec ?? "") ?? 0;
  const rec = scenario.recommenders[r];
  const row = scenario.evaluations[rec.id] ?? NONE;
  const editable = canEdit(seat, { type: "evaluation", rec: rec.id });
  const simBudget = scenario.simBudget[rec.id] ?? total;
  const selIndex = appIndex.get(selected ?? "") ?? -1;

  const curves: EditorCurve[] = scenario.applications.flatMap((app) => {
    const c = row[app.id];
    if (!c) return [];
    const isSel = app.id === selected;
    return [
      {
        key: app.id,
        label: app.id === HOLD_ID ? "_hold_" : app.name,
        color: app.id === HOLD_ID ? "var(--line)" : isSel ? recColor(r) : "var(--rec-other)",
        curve: c,
        editable,
        pinned: app.id === HOLD_ID ? `_hold_ ${value(c.fdv)}` : undefined,
      },
    ];
  });
  const activeKey = row[selected ?? ""] ? selected : (curves.find((c) => c.key !== HOLD_ID)?.key ?? null);
  const activeApp = appIndex.get(activeKey ?? "") ?? -1;
  // Fit the applications' thresholds; the _hold_ line usually runs far past them and is drawn to the edge.
  const xMax = niceCeil(
    Math.max(
      1_000_000,
      ...scenario.applications.map((a) => (a.id === HOLD_ID ? 0 : (row[a.id]?.ldt ?? 0) * 1.05)),
      activeApp >= 0 ? Math.max(uni[r][activeApp], alloc.totals[activeApp]) * 1.1 : 0,
    ),
  );
  const onChange = gestureHandler((c) => activeKey && setEvaluation(rec.id, activeKey, c));

  const tableRows = useMemo(() => {
    const evaluated = scenario.applications
      .map((_, a) => a)
      .filter((a) => row[scenario.applications[a].id] && a !== hold)
      .sort((x, y) => row[scenario.applications[y].id]!.fdv - row[scenario.applications[x].id]!.fdv);
    const rest = scenario.applications.map((_, a) => a).filter((a) => !row[scenario.applications[a].id] && a !== hold);
    return { evaluated, rest };
  }, [scenario.applications, row, hold]);

  const uniGranted = uni[r].reduce((s, v, a) => s + (a === hold ? 0 : v), 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <div className="mb-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Recommender">
            {scenario.recommenders.map((x, i) => (
              <button
                key={x.id}
                role="radio"
                aria-checked={x.id === rec.id}
                onClick={() => look({ kind: "rec", id: x.id })}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-[background-color,transform] active:scale-[0.96]",
                  x.id === rec.id ? "border-foreground/25 bg-accent font-medium" : "hover:bg-accent/60",
                )}
              >
                <span className="size-2 rounded-full" style={{ background: recColor(i) }} aria-hidden />
                {x.name}
              </button>
            ))}
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            {rec.name} <span className="text-base font-normal text-muted-foreground">· {rec.focus}</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Every curve {rec.name} entered. Values are relative to their most valuable dollar (1.0). The{" "}
            <span className="font-mono text-foreground">_hold_</span> line is the value of keeping money for a future round: below it,{" "}
            {rec.name} would rather wait.
          </p>
        </div>
        <div className="flex items-end gap-4">
          <SimBudget
            value={simBudget}
            disabled={!canEdit(seat, { type: "simBudget", rec: rec.id })}
            onCommit={(v) => setSimBudget(rec.id, v)}
          />
          <dl className="text-right">
            <dt className="text-[11px] text-muted-foreground">Unilateral grants · held</dt>
            <dd className="text-lg font-semibold tracking-tight tnum">
              {money(uniGranted)} <span className="text-sm font-normal text-muted-foreground">· {money(hold >= 0 ? uni[r][hold] : 0)}</span>
            </dd>
          </dl>
        </div>
      </header>

      <div className="rounded-xl border bg-[var(--surface-chart)] p-3 pt-4">
        <CurveEditor
          curves={curves}
          activeKey={activeKey}
          onActivate={(k) => select(k)}
          onChange={onChange}
          xMax={xMax}
          xLabel="Funding to the application"
          yLabel="Value of the next dollar (best dollar = 1)"
          markers={
            activeApp >= 0 && activeApp !== hold
              ? [
                  { key: "uni", x: uni[r][activeApp], label: `Unilateral ${money(uni[r][activeApp])}`, color: recColor(r) },
                  { key: "proj", x: alloc.totals[activeApp], label: `Projected ${money(alloc.totals[activeApp])}` },
                ]
              : []
          }
          fundedTo={activeApp >= 0 ? uni[r][activeApp] : undefined}
          ariaLabel={`${rec.name}'s marginal value curves`}
          readOnlyReason={
            editable ? null : seat?.role === "observer" ? "View-only link." : `Only ${rec.name} (or the facilitator) can edit these curves.`
          }
        />
        {editable && (
          <p className="mt-1 px-1 text-[11px] text-muted-foreground">
            Click a curve to focus it. Drag the dot on the y-axis (first-dollar value), the dot on the x-axis (last-dollar threshold) or the
            diamond (concavity); every handle also takes arrow keys.
          </p>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Application</TableHead>
            <TableHead className="w-20 text-right" title="First-dollar value">
              FDV
            </TableHead>
            <TableHead className="w-24 text-right" title="Last-dollar threshold">
              LDT
            </TableHead>
            <TableHead className="w-20 text-right" title="Concavity (−1 drops fast … +1 holds value)">
              CONC
            </TableHead>
            <TableHead className="text-right">Unilateral</TableHead>
            <TableHead className="text-right">Projected</TableHead>
            <TableHead className="text-right" title="Unilateral − projected">
              Δ
            </TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...tableRows.evaluated, ...(hold >= 0 && row[HOLD_ID] ? [hold] : [])].map((a) => {
            const app = scenario.applications[a];
            const c = row[app.id]!;
            const d = uni[r][a] - alloc.totals[a];
            const set = (next: Curve) => setEvaluation(rec.id, app.id, normalizeCurve(next));
            return (
              <TableRow
                key={app.id}
                data-state={a === selIndex ? "selected" : undefined}
                onClick={() => select(app.id)}
                className="cursor-pointer"
              >
                <TableCell className="max-w-64 truncate">
                  {app.id === HOLD_ID ? <span className="font-mono">_hold_</span> : app.name}
                </TableCell>
                <TableCell className="text-right">
                  <NumberCell
                    label={`${app.name} FDV`}
                    value={c.fdv}
                    format={(v) => value(v)}
                    parse={Number}
                    disabled={!editable}
                    onCommit={(v) => set({ ...c, fdv: v })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <NumberCell
                    label={`${app.name} LDT`}
                    value={c.ldt}
                    format={(v) => money(v)}
                    parse={(s) => parseMoney(s) ?? NaN}
                    disabled={!editable}
                    onCommit={(v) => set({ ...c, ldt: v })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <NumberCell
                    label={`${app.name} CONC`}
                    value={c.conc}
                    format={(v) => v.toFixed(2)}
                    parse={Number}
                    disabled={!editable}
                    onCommit={(v) => set({ ...c, conc: v })}
                  />
                </TableCell>
                <TableCell className="text-right tnum">{uni[r][a] > 0 ? money(uni[r][a]) : "—"}</TableCell>
                <TableCell className="text-right tnum">{alloc.totals[a] > 0 ? money(alloc.totals[a]) : "—"}</TableCell>
                <TableCell className={cn("text-right tnum", Math.abs(d) < 1000 ? "text-muted-foreground" : "")}>
                  {Math.abs(d) < 1000 ? "0" : money(d, { sign: true })}
                </TableCell>
                <TableCell>
                  {editable && app.id !== HOLD_ID && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${rec.name}'s evaluation of ${app.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEvaluation(rec.id, app.id, null);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {tableRows.rest.map((a) => {
            const app = scenario.applications[a];
            return (
              <TableRow key={app.id} className="text-muted-foreground">
                <TableCell className="max-w-64 truncate">{app.name}</TableCell>
                <TableCell colSpan={6} className="text-xs">
                  Not evaluated
                </TableCell>
                <TableCell>
                  {editable ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Evaluate ${app.name}`}
                      onClick={() => {
                        setEvaluation(rec.id, app.id, curve(0.3, Math.max(app.ask, 100_000), 0));
                        select(app.id);
                      }}
                    >
                      <Plus />
                    </Button>
                  ) : (
                    <Lock className="size-3" />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SimBudget({ value: v, disabled, onCommit }: { value: number; disabled: boolean; onCommit(v: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      Simulated budget
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
      />
    </label>
  );
}

function NumberCell({
  label,
  value: v,
  format,
  parse,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  format(v: number): string;
  parse(s: string): number;
  disabled: boolean;
  onCommit(v: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  if (disabled) return <span className="tnum">{format(v)}</span>;
  return (
    <input
      aria-label={label}
      value={draft ?? format(v)}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        setDraft(format(v));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = draft === null || cancelled.current ? NaN : parse(draft);
        cancelled.current = false;
        if (Number.isFinite(n) && format(n) !== format(v)) onCommit(n);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-right tnum outline-none hover:border-border focus:border-ring focus:bg-background"
    />
  );
}
