"use client";

import { CircleDashed, CircleSlash, Crosshair, Info, Lock, Plus, Sparkles, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { curve as makeCurve, explainApplication, saturation, type RecStatus } from "@/lib/engine";
import { recColor } from "@/lib/colors";
import { gestureHandler } from "@/lib/edit";
import { money, pct, value } from "@/lib/format";
import { canEdit } from "@/lib/live/protocol";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./animated-number";
import { useAnalysis } from "./analysis-context";
import { CurveEditor, type EditorCurve } from "./curve-editor";

const STATUS: Record<RecStatus, { label: string; icon: typeof Info; tone: string; hint: string }> = {
  "on-margin": { label: "On the margin", icon: Crosshair, tone: "text-foreground", hint: "This Recommender's next dollar would go here." },
  "below-line": {
    label: "Below their line",
    icon: TrendingDown,
    tone: "text-muted-foreground",
    hint: "Funded past the level this Recommender would choose against their other options.",
  },
  "above-line": {
    label: "Above their line",
    icon: TrendingUp,
    tone: "text-foreground",
    hint: "This Recommender values the next dollar here above their last dollar spent.",
  },
  saturated: {
    label: "Saturated",
    icon: CircleSlash,
    tone: "text-muted-foreground",
    hint: "At this funding level the Recommender sees no further value.",
  },
  "no-budget": {
    label: "No delegated budget",
    icon: CircleDashed,
    tone: "text-muted-foreground",
    hint: "The Funder never deferred a dollar to this Recommender.",
  },
  "not-evaluated": {
    label: "Not evaluated",
    icon: CircleDashed,
    tone: "text-muted-foreground",
    hint: "No curve entered for this application.",
  },
};

function niceCeil(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  for (const n of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (n * exp >= v) return n * exp;
  return 10 * exp;
}

export function ApplicationPanel() {
  const { scenario, alloc, appIndex, hold } = useAnalysis();
  const selected = useStore((s) => s.selectedApp);
  const activeRec = useStore((s) => s.activeRec);
  const setActiveRec = useStore((s) => s.setActiveRec);
  const setEvaluation = useStore((s) => s.setEvaluation);
  const seat = useStore((s) => s.live.seat);
  const [mode, setMode] = useState<"marginal" | "total">("marginal");

  // _hold_ is not an application to inspect here; fall back to the first real one.
  const picked = appIndex.get(selected ?? "");
  const a = picked === undefined || picked === hold ? (hold === 0 ? 1 : 0) : picked;
  const app = scenario.applications[a];
  const total = alloc.totals[a];
  const exp = useMemo(() => explainApplication(scenario, alloc, a), [scenario, alloc, a]);

  const curves: EditorCurve[] = scenario.recommenders.flatMap((rec, r) => {
    const curve = scenario.evaluations[rec.id]?.[app.id];
    return curve
      ? [{ key: rec.id, label: rec.name, color: recColor(r), curve, editable: canEdit(seat, { type: "evaluation", rec: rec.id }) }]
      : [];
  });
  const activeKey = curves.some((c) => c.key === activeRec) ? activeRec : (curves[0]?.key ?? null);
  const activeIndex = scenario.recommenders.findIndex((r) => r.id === activeKey);
  const activeCurve = curves.find((c) => c.key === activeKey);
  const cutoff = activeIndex >= 0 ? alloc.cutoff[activeIndex] : null;

  // Keep the x-domain stable while editing: it only grows.
  const xMax = niceCeil(Math.max(app.ask * 1.4, total * 1.15, ...curves.map((c) => saturation(c.curve) * 1.05)));

  const onChange = gestureHandler((curve) => activeKey && setEvaluation(activeKey, app.id, curve));
  const lockedReason =
    activeCurve && !activeCurve.editable
      ? seat?.role === "observer"
        ? "View-only link."
        : `Only ${activeCurve.label} (or the facilitator) can edit this curve.`
      : null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="secondary" className="font-normal">
              {app.area}
            </Badge>
            <span className="text-xs text-muted-foreground tnum">Ask {money(app.ask)}</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-balance">{app.name}</h2>
          {app.summary && <p className="mt-1 text-sm text-muted-foreground text-pretty">{app.summary}</p>}
        </div>
        <div className="text-right">
          <AnimatedNumber value={total} format={(v) => money(v)} className="text-3xl font-semibold tracking-tight" />
          <div className="text-xs text-muted-foreground tnum">{app.ask > 0 ? `${pct(total / app.ask)} of ask` : "no ask"}</div>
        </div>
      </header>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={exp.headline}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm"
        >
          <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{exp.headline}</span>
        </motion.p>
      </AnimatePresence>

      {(exp.funders.length > 0 || exp.vetoedBy.length > 0) && (
        <div className="-mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>From</span>
          {exp.funders.map((x) => (
            <span key={x.funder} className="rounded-full border px-2 py-0.5 tnum">
              <span className="text-foreground">{scenario.funders[x.funder].name}</span> {money(x.amount)}
            </span>
          ))}
          {exp.vetoedBy.map((fi) => (
            <span key={`v${fi}`} className="rounded-full border border-dashed px-2 py-0.5">
              {scenario.funders[fi].name} declined
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Focus Recommender">
          {scenario.recommenders.map((rec, r) => {
            const evaluated = !!scenario.evaluations[rec.id]?.[app.id];
            const mine = canEdit(seat, { type: "evaluation", rec: rec.id });
            if (!evaluated && !mine) return null;
            const on = rec.id === activeKey;
            return evaluated ? (
              <button
                key={rec.id}
                role="radio"
                aria-checked={on}
                onClick={() => setActiveRec(rec.id)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-[background-color,border-color,transform] active:scale-[0.96]",
                  on ? "border-foreground/25 bg-accent font-medium" : "hover:bg-accent/60",
                )}
              >
                <span className="size-2 rounded-full" style={{ background: recColor(r) }} aria-hidden />
                {rec.name}
                <span className="text-muted-foreground tnum">{money(alloc.byRec[r][a])}</span>
                {!mine && <Lock className="size-3 text-muted-foreground" aria-label="read-only" />}
              </button>
            ) : (
              <button
                key={rec.id}
                onClick={() => {
                  setEvaluation(rec.id, app.id, makeCurve(0.3, Math.max(app.ask, 100_000), 0));
                  setActiveRec(rec.id);
                }}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <Plus className="size-3" /> {rec.name}
              </button>
            );
          })}
        </div>
        <ToggleGroup
          value={[mode]}
          onValueChange={(v) => v[0] && setMode(v[0] as "marginal" | "total")}
          variant="outline"
          size="sm"
          aria-label="Curve view"
        >
          <ToggleGroupItem value="marginal" className="text-xs">
            Marginal value
          </ToggleGroupItem>
          <ToggleGroupItem value="total" className="text-xs">
            Total value
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {curves.length > 0 ? (
        <div className="rounded-xl border bg-[var(--surface-chart)] p-3 pt-4">
          <CurveEditor
            curves={curves}
            activeKey={activeKey}
            onActivate={setActiveRec}
            onChange={onChange}
            xMax={xMax}
            xLabel="Total funding to this application"
            yLabel="Value of the next dollar"
            markers={[
              { key: "ask", x: app.ask, label: `Ask ${money(app.ask)}`, color: "var(--muted-foreground)" },
              { key: "alloc", x: total, label: `Allocated ${money(total)}` },
            ]}
            fundedTo={total}
            hLine={
              mode === "marginal" && cutoff !== null && activeCurve
                ? { y: cutoff, label: `${activeCurve.label}'s funding line · ${value(cutoff)}` }
                : null
            }
            mode={mode}
            ariaLabel={`Marginal value curves for ${app.name}`}
            readOnlyReason={lockedReason}
          />
          {mode === "marginal" && activeCurve?.editable && (
            <p className="mt-1 px-1 text-[11px] text-muted-foreground">
              Drag the dot on the y-axis (first-dollar value), the dot on the x-axis (last-dollar threshold) or the diamond (concavity).
              Each handle also takes arrow keys, with Shift for bigger steps. Curves never rise: diminishing returns.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No Recommender has evaluated this application.
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recommender</TableHead>
            <TableHead className="text-right">Directed here</TableHead>
            <TableHead className="text-right">
              <Tooltip>
                <TooltipTrigger render={<span className="cursor-help underline decoration-dotted underline-offset-2" />}>
                  Next $ worth
                </TooltipTrigger>
                <TooltipContent>Their marginal value at the current allocation.</TooltipContent>
              </Tooltip>
            </TableHead>
            <TableHead className="text-right">
              <Tooltip>
                <TooltipTrigger render={<span className="cursor-help underline decoration-dotted underline-offset-2" />}>
                  Their line
                </TooltipTrigger>
                <TooltipContent>Marginal value of the last dollar this Recommender spent anywhere.</TooltipContent>
              </Tooltip>
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {exp.recs.map((rx) => {
            const rec = scenario.recommenders[rx.rec];
            const st = STATUS[rx.status];
            const Icon = st.icon;
            const mine = canEdit(seat, { type: "evaluation", rec: rec.id });
            return (
              <TableRow
                key={rec.id}
                data-state={rec.id === activeKey ? "selected" : undefined}
                className={cn(rx.status === "not-evaluated" && "opacity-60")}
                onClick={() => rx.status !== "not-evaluated" && setActiveRec(rec.id)}
              >
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: recColor(rx.rec) }} aria-hidden />
                    <span className="font-medium">{rec.name}</span>
                    <span className="hidden text-xs text-muted-foreground xl:inline">{rec.focus}</span>
                  </span>
                </TableCell>
                <TableCell className="text-right tnum">{rx.amount > 0 ? money(rx.amount) : "—"}</TableCell>
                <TableCell className="text-right tnum">{rx.status === "not-evaluated" ? "—" : value(rx.uNow)}</TableCell>
                <TableCell className="text-right tnum">{value(rx.cutoff)}</TableCell>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger render={<span className={cn("inline-flex items-center gap-1.5 text-xs", st.tone)} />}>
                      <Icon className="size-3.5" aria-hidden />
                      {st.label}
                      {rx.gap !== null && <span className="text-muted-foreground tnum">· needs +{value(rx.gap)}</span>}
                    </TooltipTrigger>
                    <TooltipContent>{st.hint}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  {mine && rx.status !== "not-evaluated" && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${rec.name}'s evaluation`}
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
        </TableBody>
      </Table>
    </div>
  );
}
