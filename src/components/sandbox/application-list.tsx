"use client";

import { ArrowDownUp, Ban, PauseCircle, Search } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { initials, recColor } from "@/lib/colors";
import { money } from "@/lib/format";
import { useStore, type SortKey } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AllocBar } from "./alloc-bar";
import { useAnalysis, usePerspectiveAllocation } from "./analysis-context";
import { PerspectiveTree } from "./perspective-tree";

const SORTS: Record<SortKey, string> = {
  allocation: "Allocation",
  change: "Change vs baseline",
  contested: "Most contested",
  ask: "Ask",
  name: "Name",
};

export function ApplicationList() {
  const { scenario, alloc, baseline, contested, hold } = useAnalysis();
  const view = usePerspectiveAllocation();
  const selected = useStore((s) => s.selectedApp);
  const select = useStore((s) => s.select);
  const sort = useStore((s) => s.sort);
  const setSort = useStore((s) => s.setSort);
  const peers = useStore((s) => s.live.peers);
  const you = useStore((s) => s.live.you);
  const reduced = useReducedMotion();
  const [query, setQuery] = useState("");
  const totals = view.totals;
  const isSigma = view.perspective.kind === "sigma";

  const max = useMemo(
    () => Math.max(1, ...scenario.applications.map((a, i) => (i === hold ? 0 : Math.max(a.ask, totals[i])))),
    [scenario.applications, totals, hold],
  );
  const vetoed = useMemo(() => {
    const set = new Set<string>();
    if (view.perspective.kind === "funder") (scenario.vetoes[view.perspective.id] ?? []).forEach((a) => set.add(a));
    else if (isSigma) Object.values(scenario.vetoes).forEach((l) => l.forEach((a) => set.add(a)));
    return set;
  }, [scenario.vetoes, view.perspective, isSigma]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const idx = scenario.applications
      .map((_, i) => i)
      .filter((i) => i !== hold)
      .filter(
        (i) => !q || scenario.applications[i].name.toLowerCase().includes(q) || scenario.applications[i].area.toLowerCase().includes(q),
      );
    const delta = (i: number) => (isSigma && baseline ? alloc.totals[i] - (baseline.totals[i] ?? 0) : 0);
    const by: Record<SortKey, (a: number, b: number) => number> = {
      allocation: (a, b) => totals[b] - totals[a] || a - b,
      change: (a, b) => Math.abs(delta(b)) - Math.abs(delta(a)) || totals[b] - totals[a],
      contested: (a, b) => contested[b] - contested[a] || a - b,
      ask: (a, b) => scenario.applications[b].ask - scenario.applications[a].ask,
      name: (a, b) => scenario.applications[a].name.localeCompare(scenario.applications[b].name),
    };
    return idx.sort(by[sort]);
  }, [scenario.applications, totals, alloc.totals, baseline, contested, sort, query, hold, isSigma]);

  const funded = rows.filter((i) => totals[i] > 0).length;
  const heldHere = hold >= 0 ? totals[hold] : 0;

  function onKey(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "j" && e.key !== "k") return;
    e.preventDefault();
    const pos = rows.findIndex((i) => scenario.applications[i].id === selected);
    const next = e.key === "ArrowDown" || e.key === "j" ? Math.min(rows.length - 1, pos + 1) : Math.max(0, pos - 1);
    const id = scenario.applications[rows[next]]?.id;
    if (id) {
      select(id);
      document.getElementById(`app-${id}`)?.scrollIntoView({ block: "nearest" });
    }
  }

  return (
    <section aria-label="Applications" className="flex min-h-0 flex-col">
      <PerspectiveTree />
      <div className="px-3 pt-2">
        <h2 className="text-xs font-semibold tracking-wide uppercase">{view.title}</h2>
        <p className="text-[11px] text-muted-foreground">{view.subtitle}</p>
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${scenario.applications.length - (hold >= 0 ? 1 : 0)} applications`}
            aria-label="Search applications"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger size="sm" className="h-7 w-auto gap-1 text-xs" aria-label="Sort applications">
            <ArrowDownUp className="size-3.5" />
            <SelectValue>{(v: SortKey) => SORTS[v]}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {Object.entries(SORTS).map(([k, label]) => (
              <SelectItem key={k} value={k} className="text-xs">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between px-3 pb-1.5 text-[11px] text-muted-foreground tnum">
        <span>
          {funded} of {rows.length} funded
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-px bg-foreground/50" aria-hidden /> ask
        </span>
      </div>
      <LayoutGroup>
        <ul
          role="listbox"
          aria-label="Applications by allocation"
          tabIndex={0}
          onKeyDown={onKey}
          className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 outline-none"
        >
          {rows.map((i) => {
            const app = scenario.applications[i];
            const total = totals[i];
            const delta = isSigma && baseline ? total - (baseline.totals[i] ?? 0) : 0;
            const isSel = app.id === selected;
            const here = peers.filter((p) => p.viewing === app.id && p.id !== you);
            const declined = vetoed.has(app.id);
            return (
              <motion.li
                layout={reduced ? false : "position"}
                transition={{ type: "spring", stiffness: 420, damping: 40 }}
                key={app.id}
                id={`app-${app.id}`}
                role="option"
                aria-selected={isSel}
                onClick={() => select(app.id)}
                className={cn(
                  "group relative cursor-pointer rounded-md px-2.5 py-2 transition-colors",
                  isSel ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                {isSel && (
                  <motion.span
                    layoutId={reduced ? undefined : "sel-rail"}
                    className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-foreground"
                  />
                )}
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn("truncate text-[13px]", isSel ? "font-medium" : "")}>{app.name}</span>
                  <span className={cn("shrink-0 text-[13px] tnum", total > 0 ? "font-medium" : "text-muted-foreground")}>
                    {total > 0 ? money(total) : "—"}
                  </span>
                </div>
                <div className="mt-0.5 mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1 truncate">
                    {declined && (
                      <span className="inline-flex items-center gap-0.5 text-foreground" title="Declined by a funder (final say)">
                        <Ban className="size-3" /> declined ·
                      </span>
                    )}
                    <span className="truncate">
                      {app.area} · ask {money(app.ask)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {here.map((p) => (
                      <span
                        key={p.id}
                        title={`${p.label} is viewing`}
                        className="inline-flex size-4 items-center justify-center rounded-full text-[8px] font-semibold text-white ring-2 ring-background"
                        style={{
                          background: p.rec ? recColor(scenario.recommenders.findIndex((r) => r.id === p.rec)) : "var(--foreground)",
                        }}
                      >
                        {initials(p.label)}
                      </span>
                    ))}
                    {Math.abs(delta) >= 500 && (
                      <motion.span
                        key={Math.round(delta / 1000)}
                        initial={reduced ? false : { opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          "rounded px-1 font-medium tnum",
                          delta > 0
                            ? "bg-[color-mix(in_oklch,var(--good)_14%,transparent)] text-[color-mix(in_oklch,var(--good),var(--foreground)_35%)]"
                            : "bg-[color-mix(in_oklch,var(--critical)_12%,transparent)] text-[color-mix(in_oklch,var(--critical),var(--foreground)_25%)]",
                        )}
                      >
                        {delta > 0 ? "▲" : "▼"} {money(Math.abs(delta))}
                      </motion.span>
                    )}
                  </span>
                </div>
                <AllocBar parts={view.parts(i)} max={max} ask={app.ask} />
              </motion.li>
            );
          })}
        </ul>
      </LayoutGroup>
      {hold >= 0 && (
        <div
          className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs"
          title="Money a Recommender would rather keep for a future round"
        >
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <PauseCircle className="size-3.5" /> <span className="font-mono">_hold_</span> kept for future rounds
          </span>
          <span className={cn("tnum", heldHere > 0 ? "font-medium" : "text-muted-foreground")}>{heldHere > 0 ? money(heldHere) : "—"}</span>
        </div>
      )}
    </section>
  );
}
