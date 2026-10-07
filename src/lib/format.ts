export function money(v: number, opts: { sign?: boolean; precise?: boolean } = {}): string {
  const sign = opts.sign && v > 0.5 ? "+" : v < -0.5 ? "−" : "";
  const a = Math.abs(v);
  let body: string;
  if (a >= 1_000_000_000) body = `$${trim((a / 1_000_000_000).toFixed(a >= 10_000_000_000 ? 1 : 2))}B`;
  else if (a >= 1_000_000) body = `$${trim((a / 1_000_000).toFixed(opts.precise ? 3 : a >= 10_000_000 ? 1 : 2))}M`;
  else if (a >= 1_000) body = `$${trim((a / 1_000).toFixed(a >= 100_000 || !opts.precise ? 0 : 1))}k`;
  else body = `$${Math.round(a)}`;
  return sign + body;
}

export function moneyFull(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

export function value(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

export function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

function trim(s: string) {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Parse "1.5M", "$250k", "1,200,000" into dollars. Returns null if unparseable. */
export function parseMoney(input: string): number | null {
  const m = input
    .trim()
    .replace(/[$,\s]/g, "")
    .match(/^(\d+(?:\.\d+)?)([kKmMbB]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase() as "" | "k" | "m" | "b"];
  return n * mult;
}
