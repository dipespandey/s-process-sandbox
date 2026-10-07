"use client";

import { motion, useReducedMotion } from "motion/react";
import { initials, recColor } from "@/lib/colors";
import { money } from "@/lib/format";
import { useStore, type Perspective } from "@/lib/store";
import { useAnalysis } from "./analysis-context";

const W = 340;
const H = 116;

/**
 * Σ at the top, funders in the middle, Recommenders at the bottom, as in the S-Process app's node
 * graph. Edge width shows how much money flows along it; clicking a node looks through its eyes.
 */
export function PerspectiveTree() {
  const { scenario, alloc } = useAnalysis();
  const perspective = useStore((s) => s.perspective);
  const look = useStore((s) => s.look);
  const reduced = useReducedMotion();
  const F = scenario.funders.length,
    R = scenario.recommenders.length;
  const fx = (i: number) => (W / (F + 1)) * (i + 1);
  const rx = (i: number) => (W / (R + 1)) * (i + 1);
  const Y = { sigma: 16, funder: 56, rec: 98 };
  const maxFlow = Math.max(1, ...alloc.flow.flat());
  const maxBudget = Math.max(1, ...scenario.funders.map((f) => f.budget));
  const nodeR = R > 8 ? 9 : 11;
  const is = (p: Perspective) =>
    perspective.kind === p.kind && (p.kind === "sigma" || (perspective.kind !== "sigma" && "id" in p && perspective.id === p.id));

  const node = (p: Perspective, cx: number, cy: number, label: string, title: string, fill: string, ink = "white") => (
    <g
      key={`${p.kind}-${"id" in p ? p.id : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={is(p)}
      aria-label={title}
      onClick={() => look(p)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), look(p))}
      className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-[var(--ring)]"
    >
      <title>{title}</title>
      <circle cx={cx} cy={cy} r={nodeR + 4} fill="transparent" stroke={is(p) ? "var(--foreground)" : "transparent"} strokeWidth={2} />
      <motion.circle
        cx={cx}
        cy={cy}
        r={nodeR}
        fill={fill}
        stroke="var(--sidebar)"
        strokeWidth={2}
        whileHover={reduced ? undefined : { scale: 1.12 }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      <text x={cx} y={cy} dy="0.34em" textAnchor="middle" className="pointer-events-none text-[8px] font-semibold" fill={ink}>
        {label}
      </text>
    </g>
  );

  return (
    <nav aria-label="Perspective" className="border-b px-2 pt-2 pb-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
        {scenario.funders.map((f, i) => (
          <line
            key={`s-${f.id}`}
            x1={W / 2}
            y1={Y.sigma}
            x2={fx(i)}
            y2={Y.funder}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.35}
            strokeWidth={0.75 + (f.budget / maxBudget) * 3}
          />
        ))}
        {scenario.funders.flatMap((f, i) =>
          scenario.recommenders.map((r, j) => {
            const v = alloc.flow[i]?.[j] ?? 0;
            if (v <= 0) return null;
            return (
              <motion.line
                key={`${f.id}-${r.id}`}
                x1={fx(i)}
                y1={Y.funder}
                x2={rx(j)}
                y2={Y.rec}
                stroke={recColor(j)}
                strokeOpacity={0.55}
                initial={false}
                animate={{ strokeWidth: 0.5 + (v / maxFlow) * 5 }}
                transition={reduced ? { duration: 0 } : { duration: 0.3 }}
              >
                <title>{`${f.name} → ${r.name}: ${money(v)}`}</title>
              </motion.line>
            );
          }),
        )}
        {node({ kind: "sigma" }, W / 2, Y.sigma, "Σ", "Σ: projected final allocation", "var(--foreground)", "var(--background)")}
        {scenario.funders.map((f, i) =>
          node(
            { kind: "funder", id: f.id },
            fx(i),
            Y.funder,
            initials(f.name),
            `Funder ${f.name} (${money(f.budget)})`,
            "var(--foreground)",
            "var(--background)",
          ),
        )}
        {scenario.recommenders.map((r, j) =>
          node({ kind: "rec", id: r.id }, rx(j), Y.rec, initials(r.name), `Recommender ${r.name}`, recColor(j)),
        )}
      </svg>
    </nav>
  );
}
