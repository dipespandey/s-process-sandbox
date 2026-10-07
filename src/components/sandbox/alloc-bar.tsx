"use client";

import { motion, useReducedMotion } from "motion/react";
import { recColor, SLOTS } from "@/lib/colors";

/**
 * Stacked allocation bar: one segment per Recommender (2px surface gaps), scaled to a shared
 * domain so rows compare. A hairline tick marks the application's ask.
 */
export function AllocBar({ parts, max, ask, height = 6 }: { parts: number[]; max: number; ask?: number; height?: number }) {
  const reduced = useReducedMotion();
  const folded: { key: string; color: string; v: number }[] = [];
  let other = 0;
  parts.forEach((v, r) => {
    if (v <= 0) return;
    if (r < SLOTS) folded.push({ key: `r${r}`, color: recColor(r), v });
    else other += v;
  });
  if (other > 0) folded.push({ key: "other", color: recColor(-1), v: other });
  const total = folded.reduce((s, p) => s + p.v, 0);
  const pctOf = (v: number) => (max > 0 ? (v / max) * 100 : 0);
  return (
    <div className="relative w-full rounded-full bg-muted" style={{ height }}>
      <motion.div
        className="absolute inset-y-0 left-0 flex gap-[2px] overflow-hidden rounded-full"
        initial={false}
        animate={{ width: `${pctOf(total)}%` }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 32 }}
      >
        {folded.map((p) => (
          <motion.div
            key={p.key}
            className="h-full min-w-[2px] basis-0 first:rounded-l-full last:rounded-r-full"
            style={{ background: p.color }}
            initial={false}
            animate={{ flexGrow: p.v }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 32 }}
          />
        ))}
      </motion.div>
      {ask !== undefined && ask > 0 && (
        <div
          className="absolute -top-0.5 -bottom-0.5 w-px bg-foreground/50"
          style={{ left: `${Math.min(100, pctOf(ask))}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}
