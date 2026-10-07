import { LIMITS, type Curve } from "./types";

/*
 * Curves follow the parameters shown in the S-Process app: first-dollar value (FDV), last-dollar
 * threshold (LDT) and concavity (CONC). The shape between (0, FDV) and (LDT, 0) is a superellipse
 * with exponent p = 2^(3·conc): conc = 0 is a straight line, positive bulges upward (value holds up
 * until close to the threshold), negative drops off quickly. Every shape is non-increasing, so total
 * utility stays concave and greedy allocation stays optimal. The exact family is my choice; the
 * three parameters are theirs.
 */

export function exponent(conc: number) {
  return Math.pow(2, Math.max(-1, Math.min(1, conc)) * 3);
}

/** Marginal value of the next dollar after x dollars. */
export function marginal(c: Curve, x: number): number {
  if (c.fdv <= 0 || x >= c.ldt) return 0;
  if (x <= 0) return c.fdv;
  const p = exponent(c.conc);
  const t = x / c.ldt;
  return c.fdv * Math.pow(Math.max(0, 1 - Math.pow(t, p)), 1 / p);
}

/** Total value of the first x dollars (numeric integral; exact enough for display). */
export function totalUtility(c: Curve, x: number): number {
  const end = Math.min(x, c.ldt);
  if (end <= 0 || c.fdv <= 0) return 0;
  const n = 96;
  const h = end / n;
  let s = marginal(c, 0) + marginal(c, end - 1e-9);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * marginal(c, i * h);
  return (s * h) / 3;
}

export function saturation(c: Curve | null | undefined) {
  return c ? c.ldt : 0;
}

/** Points along the curve for drawing, using the superellipse's own parameterization so steep shapes stay smooth. */
export function curvePoints(c: Curve, n = 72): { x: number; y: number }[] {
  const p = exponent(c.conc);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * (Math.PI / 2);
    pts.push({ x: c.ldt * Math.pow(Math.sin(th), 2 / p), y: c.fdv * Math.pow(Math.cos(th), 2 / p) });
  }
  return pts;
}

/** The concavity handle sits where the curve crosses the diagonal from (0,0) to (LDT, FDV). */
export function concHandle(c: Curve) {
  const k = Math.pow(2, -1 / exponent(c.conc));
  return { x: k * c.ldt, y: k * c.fdv, k };
}

/** Inverse of concHandle: which concavity puts the crossing at fraction k of the diagonal? */
export function concFromK(k: number) {
  const kk = Math.min(0.97, Math.max(0.005, k));
  const p = -1 / Math.log2(kk);
  return round(Math.max(-1, Math.min(1, Math.log2(p) / 3)), 100);
}

export function normalizeCurve(c: Curve): Curve {
  const fdv = Number.isFinite(c.fdv) ? c.fdv : 0;
  const ldt = Number.isFinite(c.ldt) ? c.ldt : 1;
  const conc = Number.isFinite(c.conc) ? c.conc : 0;
  return {
    fdv: round(Math.min(Math.max(fdv, 0), LIMITS.maxValue), 1000),
    ldt: Math.min(Math.max(Math.round(ldt / 1000) * 1000, 1000), LIMITS.maxDollars),
    conc: round(Math.min(Math.max(conc, -1), 1), 100),
  };
}

export function curve(fdv: number, ldt: number, conc = 0): Curve {
  return normalizeCurve({ fdv, ldt, conc });
}

export function scaleCurve(c: Curve, factor: number): Curve {
  return { ...c, fdv: Math.min(c.fdv * factor, LIMITS.maxValue) };
}

function round(v: number, unit: number) {
  return Math.round(v * unit) / unit + 0; // + 0 turns -0 into 0
}
