"use client";

import { Pin } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dollarsMoved, HOLD_ID, LIMITS, RULES, saturation, type Rule } from "@/lib/engine";
import { money, parseMoney } from "@/lib/format";
import { canEdit } from "@/lib/live/protocol";
import { gesture, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./animated-number";
import { useAnalysis } from "./analysis-context";

function niceCeil(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  for (const n of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (n * exp >= v) return n * exp;
  return 10 * exp;
}

export function RoundControls() {
  const { scenario, alloc, baseline, setBaseline, ms, total, hold } = useAnalysis();
  const setTotalBudget = useStore((s) => s.setTotalBudget);
  const setRule = useStore((s) => s.setRule);
  const seat = useStore((s) => s.live.seat);
  const booted = useStore((s) => s.booted);
  // Scaling every funder at once is a facilitator action; individual budgets live on the Funders view.
  const budgetEditable = scenario.funders.every((f) => canEdit(seat, { type: "budget", funder: f.id }));
  const ruleEditable = canEdit(seat, { type: "rule" });
  const [draft, setDraft] = useState<string | null>(null);

  // The slider's range is fixed by the round, never by the current budget (that fed back into itself).
  // Past `saturates`, every application curve has reached zero, so more budget only goes to _hold_.
  const totalAsk = scenario.applications.reduce((s, a) => s + a.ask, 0);
  const saturates = scenario.applications.reduce(
    (sum, app) =>
      app.id === HOLD_ID ? sum : sum + Math.max(0, ...scenario.recommenders.map((r) => saturation(scenario.evaluations[r.id]?.[app.id]))),
    0,
  );
  const sliderMax = Math.min(LIMITS.maxDollars, niceCeil(Math.max(totalAsk, saturates) * 1.1));
  const moved = baseline ? dollarsMoved(baseline, alloc) : 0;
  const funded = alloc.totals.filter((t, i) => t > 0 && i !== hold).length;
  const apps = scenario.applications.length - (hold >= 0 ? 1 : 0);
  const turns = Math.round(1 / scenario.turn);

  function commitDraft() {
    if (draft === null) return;
    const v = parseMoney(draft);
    if (v === null) toast.error("Enter an amount like 9M or 750k");
    else if (v > LIMITS.maxDollars) toast.error(`The budget is capped at ${money(LIMITS.maxDollars)}`);
    else setTotalBudget(v);
    setDraft(null);
  }

  return (
    <div className="flex flex-wrap items-stretch gap-x-6 gap-y-3 border-b bg-background px-4 py-3">
      <div className="flex min-w-[260px] flex-1 flex-col gap-1.5 sm:max-w-sm">
        <label htmlFor="budget" className="text-[11px] font-medium text-muted-foreground">
          Round budget · {scenario.funders.length} {scenario.funders.length === 1 ? "funder" : "funders"}
        </label>
        <div className="flex items-center gap-3">
          <Input
            id="budget"
            value={draft ?? money(total, { precise: true })}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              setDraft(money(total, { precise: true }));
              requestAnimationFrame(() => e.target.select());
            }}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setDraft(null);
            }}
            disabled={!budgetEditable}
            className="h-8 w-24 font-medium tnum"
            aria-describedby="budget-hint"
          />
          <Slider
            value={[Math.min(total, sliderMax)]}
            min={0}
            max={sliderMax}
            step={sliderMax / 400}
            disabled={!budgetEditable}
            aria-label="Round budget"
            onValueChange={(v) => {
              if (!gesture.active) gesture.begin();
              const next = Array.isArray(v) ? v[0] : v;
              gesture.update(() => setTotalBudget(Math.round(next / 10_000) * 10_000));
            }}
            onValueCommitted={() => gesture.end()}
            title={`Every application curve saturates at ${money(saturates)}`}
            className="flex-1"
          />
        </div>
        <span id="budget-hint" className="sr-only">
          Type an amount like 9M or 750k. Scales every funder&apos;s budget, keeping their shares.
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Combination rule</span>
        <ToggleGroup
          value={[scenario.rule]}
          onValueChange={(v) => v[0] && setRule(v[0] as Rule)}
          variant="outline"
          size="sm"
          disabled={!ruleEditable}
          aria-label="Combination rule"
        >
          {(Object.keys(RULES) as Rule[]).map((r) => (
            <Tooltip key={r}>
              <TooltipTrigger render={<ToggleGroupItem value={r} className="text-xs" />}>{RULES[r].short}</TooltipTrigger>
              <TooltipContent className="max-w-72">
                <span className="font-medium">{RULES[r].label}.</span> {RULES[r].description}
              </TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
      </div>

      <dl className="ml-auto flex flex-wrap items-end gap-x-6 gap-y-2">
        <Kpi label="Recommended">
          <AnimatedNumber value={alloc.granted} format={(v) => money(v)} />
        </Kpi>
        <Kpi label="Held" hint="Money Recommenders would rather keep for a future round: their _hold_ line beat every remaining option.">
          <span className="tnum">{money(alloc.held)}</span>
        </Kpi>
        <Kpi label="Unplaced" hint="Budget no one could place: funders' deference curves (or every curve) reached zero first.">
          <span className={cn("tnum", alloc.unplaced > 1 && "text-[color-mix(in_oklch,var(--warning),var(--foreground)_45%)]")}>
            {money(alloc.unplaced)}
          </span>
        </Kpi>
        <Kpi label="Funded">
          <span className="tnum">
            {funded}
            <span className="text-muted-foreground">/{apps}</span>
          </span>
        </Kpi>
        <Kpi label="Moved vs baseline" hint="Half the total absolute change across applications since the baseline was pinned.">
          <span className="flex items-center gap-1">
            <span className="tnum">{money(moved)}</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={setBaseline}
                    aria-label="Pin the current allocation as the baseline"
                    disabled={moved < 1}
                  />
                }
              >
                <Pin />
              </TooltipTrigger>
              <TooltipContent>Pin current allocation as baseline</TooltipContent>
            </Tooltip>
          </span>
        </Kpi>
      </dl>
      {booted && (
        <div
          className="hidden self-end text-[10px] text-muted-foreground tnum xl:block"
          title="Each funder hands out this share of their budget per turn"
        >
          {turns.toLocaleString("en-US")} turns × {scenario.funders.length} · {ms < 1 ? "<1" : ms.toFixed(1)} ms
        </div>
      )}
    </div>
  );
}

function Kpi({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const inner = (
    <>
      <dt className={cn("text-[11px] text-muted-foreground", hint && "cursor-help underline decoration-dotted underline-offset-2")}>
        {label}
      </dt>
      <dd className="text-lg leading-tight font-semibold tracking-tight">{children}</dd>
    </>
  );
  if (!hint) return <div className="flex flex-col">{inner}</div>;
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="flex flex-col" />}>{inner}</TooltipTrigger>
      <TooltipContent className="max-w-64">{hint}</TooltipContent>
    </Tooltip>
  );
}
