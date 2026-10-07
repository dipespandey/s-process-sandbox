/** Categorical slots are assigned by Recommender order and never cycled; past eight, fold to "other". */
export const SLOTS = 8;
export function recColor(index: number) {
  return index >= 0 && index < SLOTS ? `var(--rec-${index + 1})` : "var(--rec-other)";
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Sequential step (1–7) for a 0..1 intensity. */
export function seqColor(t: number | null) {
  if (t === null || Number.isNaN(t)) return "var(--seq-empty)";
  const step = Math.min(7, Math.max(1, Math.ceil(t * 7)));
  return `var(--seq-${step}00)`;
}
