"use client";

import { scaleLinear } from "d3-scale";
import { area as d3area, line as d3line } from "d3-shape";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { concFromK, concHandle, curvePoints, marginal, normalizeCurve, totalUtility, type Curve } from "@/lib/engine";
import { money, value as fmtValue } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface EditorCurve {
  key: string;
  label: string;
  color: string;
  curve: Curve;
  editable: boolean;
  /** Always drawn at full strength with a label at the right edge (used for _hold_). */
  pinned?: string;
}

export interface Marker {
  key: string;
  x: number;
  label: string;
  color?: string;
}

export type Phase = "start" | "move" | "end";
type Handle = "fdv" | "ldt" | "conc";

interface Props {
  curves: EditorCurve[];
  activeKey: string | null;
  onActivate?(key: string): void;
  onChange?(key: string, curve: Curve, phase: Phase): void;
  xMax: number;
  xLabel: string;
  yLabel: string;
  markers?: Marker[];
  /** Shade the active curve from 0 up to this x (dollars actually given). */
  fundedTo?: number;
  hLine?: { y: number; label: string } | null;
  mode?: "marginal" | "total";
  height?: number;
  ariaLabel: string;
  xStep?: number;
  readOnlyReason?: string | null;
}

const M = { top: 34, right: 18, bottom: 34, left: 44 };
const spring = { type: "spring", stiffness: 380, damping: 34, mass: 0.8 } as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  // Null until measured, so nothing animates in from a guessed size.
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceCeil(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const n of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (n * exp >= v) return n * exp;
  return 10 * exp;
}

const HANDLE_LABEL: Record<Handle, string> = {
  fdv: "First-dollar value",
  ldt: "Last-dollar threshold",
  conc: "Concavity",
};

/**
 * Edits marginal value functions the way the S-Process app parameterizes them: drag the first-dollar
 * value up and down the y-axis, the last-dollar threshold along the x-axis, and the middle handle along
 * the diagonal to bend the curve. Every handle also works from the keyboard.
 */
export function CurveEditor({
  curves,
  activeKey,
  onActivate,
  onChange,
  xMax: xMaxProp,
  xLabel,
  yLabel,
  markers = [],
  fundedTo,
  hLine,
  mode = "marginal",
  height = 320,
  ariaLabel,
  xStep = 10_000,
  readOnlyReason,
}: Props) {
  const [wrapRef, measured] = useWidth<HTMLDivElement>();
  const width = measured ?? 640;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Handle | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [focused, setFocused] = useState<Handle | null>(null);
  const reduced = useReducedMotion();
  const clipId = useId();
  const transition = reduced ? { duration: 0 } : spring;

  const active = curves.find((c) => c.key === activeKey) ?? null;
  const editable = mode === "marginal" && !!active?.editable && !!onChange;

  // Freeze both domains while dragging so the scales don't slide under the cursor.
  const [frozen, setFrozen] = useState({ x: xMaxProp, y: 1 });
  const xMax = drag === null ? xMaxProp : frozen.x;
  const rawYMax = useMemo(() => {
    if (mode === "total") return niceCeil(Math.max(1, ...curves.map((c) => totalUtility(c.curve, xMax))) * 1.05);
    return Math.max(1.1, niceCeil(Math.max(...curves.map((c) => c.curve.fdv), hLine?.y ?? 0) * 1.1));
  }, [curves, mode, xMax, hLine?.y]);
  const yMax = drag === null ? rawYMax : frozen.y;

  const innerW = width - M.left - M.right;
  const innerH = height - M.top - M.bottom;
  const x = useMemo(() => scaleLinear().domain([0, xMax]).range([0, innerW]), [xMax, innerW]);
  const y = useMemo(() => scaleLinear().domain([0, yMax]).range([innerH, 0]), [yMax, innerH]);

  const pathFor = useMemo(() => {
    const ln = d3line<{ x: number; y: number }>()
      .x((p) => x(Math.min(p.x, xMax)))
      .y((p) => y(p.y));
    return (c: Curve) => {
      if (mode === "total") {
        return ln(Array.from({ length: 121 }, (_, i) => ({ x: (i / 120) * xMax, y: totalUtility(c, (i / 120) * xMax) }))) ?? "";
      }
      const pts = curvePoints(c).filter((p) => p.x <= xMax);
      if (c.ldt <= xMax) pts.push({ x: c.ldt, y: 0 }, { x: xMax, y: 0 });
      else pts.push({ x: xMax, y: marginal(c, xMax) });
      return ln(pts) ?? "";
    };
  }, [x, y, mode, xMax]);

  const fundedPath = useMemo(() => {
    if (!active || fundedTo === undefined || fundedTo <= 0 || mode !== "marginal") return null;
    const to = Math.min(fundedTo, xMax, active.curve.ldt);
    const pts = curvePoints(active.curve, 96).filter((p) => p.x < to);
    pts.push({ x: to, y: marginal(active.curve, to - 1e-6) });
    return (
      d3area<{ x: number; y: number }>()
        .x((p) => x(p.x))
        .y0(innerH)
        .y1((p) => y(p.y))(pts) ?? null
    );
  }, [active, fundedTo, xMax, mode, x, y, innerH]);

  const xTicks = x.ticks(Math.max(3, Math.floor(innerW / 90)));
  const yTicks = y.ticks(5);

  function toData(e: { clientX: number; clientY: number }) {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(xMax, x.invert(e.clientX - rect.left - M.left))),
      y: Math.max(0, y.invert(e.clientY - rect.top - M.top)),
    };
  }

  function commit(next: Curve, phase: Phase) {
    if (active && onChange) onChange(active.key, normalizeCurve(next), phase);
  }

  function moved(h: Handle, p: { x: number; y: number }): Curve {
    const c = active!.curve;
    if (h === "fdv") return { ...c, fdv: Math.round(p.y * 100) / 100 };
    if (h === "ldt") return { ...c, ldt: Math.max(xStep, Math.round(p.x / xStep) * xStep) };
    // Project the pointer onto the diagonal from (0, 0) to (LDT, FDV).
    const k = (p.x / c.ldt + (c.fdv > 0 ? p.y / c.fdv : 0)) / 2;
    return { ...c, conc: concFromK(k) };
  }

  function onHandleDown(e: PointerEvent, h: Handle) {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setFrozen({ x: xMaxProp, y: rawYMax });
    setDrag(h);
    commit(active!.curve, "start");
  }
  function onHandleMove(e: PointerEvent, h: Handle) {
    if (drag !== h || !active) return;
    commit(moved(h, toData(e)), "move");
  }
  function onHandleUp(e: PointerEvent, h: Handle) {
    if (drag !== h) return;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    setDrag(null);
    commit(active!.curve, "end");
  }

  function onHandleKey(e: KeyboardEvent, h: Handle) {
    if (!editable || !active) return;
    const c = active.curve;
    const big = e.shiftKey ? 10 : 1;
    const up = e.key === "ArrowUp" || e.key === "ArrowRight";
    const down = e.key === "ArrowDown" || e.key === "ArrowLeft";
    if (!up && !down) return;
    const dir = up ? 1 : -1;
    let next: Curve;
    if (h === "fdv") next = { ...c, fdv: c.fdv + dir * 0.01 * big };
    else if (h === "ldt") next = { ...c, ldt: Math.max(xStep, c.ldt + dir * xStep * big) };
    else next = { ...c, conc: c.conc + dir * 0.05 * (e.shiftKey ? 4 : 1) };
    e.preventDefault();
    commit(next, "start");
    commit(next, "move");
    commit(next, "end");
  }

  const hover =
    hoverX === null
      ? null
      : curves
          .map((c) => ({ ...c, v: mode === "total" ? totalUtility(c.curve, hoverX) : marginal(c.curve, hoverX) }))
          .sort((a, b) => b.v - a.v);

  // Nearby markers: alternate label rows, and put the left label on the left of its line.
  const labelRow: Record<string, number> = {};
  const anchorEnd: Record<string, boolean> = {};
  const labeled = [...markers].filter((m) => m.label).sort((a, b) => a.x - b.x);
  labeled.forEach((m, i) => {
    const px = x(Math.min(m.x, xMax));
    const prev = labeled[i - 1],
      next = labeled[i + 1];
    const closePrev = prev && px - x(Math.min(prev.x, xMax)) < 110;
    const closeNext = next && x(Math.min(next.x, xMax)) - px < 110;
    labelRow[m.key] = closePrev && labelRow[prev.key] === 0 ? 1 : 0;
    anchorEnd[m.key] = closeNext ? true : px > innerW * 0.8;
  });
  for (const m of markers) labelRow[m.key] ??= 0;

  const ordered = [...curves].sort((a, b) => (a.key === activeKey ? 1 : 0) - (b.key === activeKey ? 1 : 0));

  const handles: { h: Handle; px: number; py: number; valueText: string; now: number; min: number; max: number; offscreen?: boolean }[] =
    editable && active
      ? (() => {
          const c = active.curve;
          const ch = concHandle(c);
          return [
            { h: "fdv", px: 0, py: y(c.fdv), valueText: `First-dollar value ${fmtValue(c.fdv)}`, now: c.fdv, min: 0, max: 2 },
            {
              h: "ldt",
              px: x(Math.min(c.ldt, xMax)),
              py: innerH,
              valueText: `Last-dollar threshold ${money(c.ldt)}`,
              now: c.ldt,
              min: xStep,
              max: xMax,
              offscreen: c.ldt > xMax,
            },
            ...(c.fdv > 0 && c.ldt <= xMax * 1.5
              ? [
                  {
                    h: "conc" as const,
                    px: x(Math.min(ch.x, xMax)),
                    py: y(ch.y),
                    valueText: `Concavity ${c.conc.toFixed(2)}`,
                    now: c.conc,
                    min: -1,
                    max: 1,
                  },
                ]
              : []),
          ];
        })()
      : [];

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ minHeight: height }}>
      {measured !== null && (
        <svg ref={svgRef} width={width} height={height} role="group" aria-label={ariaLabel} className="block touch-none overflow-visible">
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={-4} width={innerW} height={innerH + 8} />
            </clipPath>
          </defs>
          <g transform={`translate(${M.left},${M.top})`}>
            {yTicks.map((t) => (
              <g key={`y${t}`}>
                <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tnum">
                  {mode === "total" ? compactNumber(t) : t.toFixed(1)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={`x${t}`} x={x(t)} y={innerH + 18} textAnchor="middle" className="fill-muted-foreground text-[10px] tnum">
                {money(t)}
              </text>
            ))}
            <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="var(--border)" />
            <text x={innerW} y={innerH + 31} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {xLabel} →
            </text>
            <text x={-M.left + 2} y={-22} className="fill-muted-foreground text-[10px]">
              ↑ {mode === "total" ? "Total value" : yLabel}
            </text>

            <rect
              x={0}
              y={0}
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={(e) => setHoverX(toData(e).x)}
              onPointerLeave={() => setHoverX(null)}
            />

            <g clipPath={`url(#${clipId})`} pointerEvents="none">
              {fundedPath && <path d={fundedPath} fill={active!.color} fillOpacity={0.12} />}
            </g>

            {hLine && (
              <motion.g initial={false} animate={{ y: y(hLine.y) }} transition={transition} pointerEvents="none">
                <line x1={0} x2={innerW} y1={0} y2={0} stroke="var(--line)" strokeWidth={1} strokeOpacity={0.55} />
                <text x={innerW} y={-5} textAnchor="end" className="fill-foreground text-[10px] font-medium">
                  {hLine.label}
                </text>
              </motion.g>
            )}

            <g clipPath={`url(#${clipId})`}>
              {ordered.map((c) => {
                const isActive = c.key === activeKey;
                const d = pathFor(c.curve);
                return (
                  <g key={c.key}>
                    <path
                      d={d}
                      fill="none"
                      stroke={c.color}
                      strokeWidth={isActive ? 2.5 : c.pinned ? 2 : 1.5}
                      strokeOpacity={activeKey === null || isActive || c.pinned ? 1 : 0.32}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                    {c.pinned && (
                      <text
                        x={innerW - 2}
                        y={y(marginal(c.curve, xMax * 0.98)) - 5}
                        textAnchor="end"
                        className="fill-foreground font-mono text-[10px]"
                        pointerEvents="none"
                      >
                        {c.pinned}
                      </text>
                    )}
                    {onActivate && !isActive && (
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={12}
                        className="cursor-pointer"
                        onClick={() => onActivate(c.key)}
                      >
                        <title>{`Focus ${c.label}`}</title>
                      </path>
                    )}
                  </g>
                );
              })}
            </g>

            {markers.map((m) => (
              // Labels of nearby markers go on separate rows instead of overprinting.
              <motion.g
                key={m.key}
                initial={false}
                animate={{ x: x(Math.min(m.x, xMax)) }}
                transition={drag !== null ? { duration: 0.08 } : transition}
                pointerEvents="none"
              >
                <line y1={-6 - labelRow[m.key] * 12} y2={innerH} stroke={m.color ?? "var(--line)"} strokeWidth={1.25} />
                <circle cy={-6 - labelRow[m.key] * 12} r={3} fill={m.color ?? "var(--line)"} />
                <text
                  y={-12 - labelRow[m.key] * 12}
                  textAnchor={anchorEnd[m.key] ? "end" : "start"}
                  dx={anchorEnd[m.key] ? -4 : 4}
                  className="fill-foreground text-[10px] font-medium tnum"
                >
                  {m.label}
                </text>
              </motion.g>
            ))}

            {hoverX !== null && drag === null && (
              <line
                x1={x(hoverX)}
                x2={x(hoverX)}
                y1={0}
                y2={innerH}
                stroke="var(--muted-foreground)"
                strokeOpacity={0.35}
                pointerEvents="none"
              />
            )}

            {editable && active && active.curve.fdv > 0 && (
              // The diagonal the concavity handle slides along.
              <line
                x1={0}
                y1={innerH}
                x2={x(Math.min(active.curve.ldt, xMax))}
                y2={y(active.curve.fdv * Math.min(1, xMax / active.curve.ldt))}
                stroke={active.color}
                strokeOpacity={focused === "conc" || drag === "conc" ? 0.4 : 0.12}
                pointerEvents="none"
              />
            )}

            {handles.map(({ h, px, py, valueText, now, min, max, offscreen }) => {
              const on = drag === h || focused === h;
              return (
                <g
                  key={h}
                  transform={`translate(${px},${py})`}
                  role="slider"
                  tabIndex={0}
                  aria-label={`${active!.label}: ${HANDLE_LABEL[h]}`}
                  aria-valuemin={min}
                  aria-valuemax={max}
                  aria-valuenow={Math.round(now * 1000) / 1000}
                  aria-valuetext={valueText}
                  onPointerDown={(e) => onHandleDown(e, h)}
                  onPointerMove={(e) => onHandleMove(e, h)}
                  onPointerUp={(e) => onHandleUp(e, h)}
                  onPointerCancel={(e) => onHandleUp(e, h)}
                  onKeyDown={(e) => onHandleKey(e, h)}
                  onFocus={() => setFocused(h)}
                  onBlur={() => setFocused(null)}
                  className={cn("outline-none", h === "fdv" ? "cursor-ns-resize" : h === "ldt" ? "cursor-ew-resize" : "cursor-move")}
                >
                  <circle r={14} fill="transparent" />
                  {h === "conc" ? (
                    <motion.rect
                      x={-5}
                      y={-5}
                      width={10}
                      height={10}
                      rx={2}
                      transform="rotate(45)"
                      animate={{ scale: on ? 1.3 : 1 }}
                      transition={{ duration: 0.12 }}
                      fill="var(--surface-chart)"
                      stroke={active!.color}
                      strokeWidth={2}
                    />
                  ) : (
                    <motion.circle
                      r={5}
                      animate={{ r: on ? 7 : 5 }}
                      transition={{ duration: 0.12 }}
                      fill={offscreen ? "var(--surface-chart)" : active!.color}
                      stroke={offscreen ? active!.color : "var(--surface-chart)"}
                      strokeWidth={2}
                    />
                  )}
                  {on && <circle r={11} fill="none" stroke="var(--ring)" strokeWidth={2} />}
                  {on && (
                    <text
                      y={h === "ldt" ? -14 : -12}
                      x={h === "fdv" ? 10 : 0}
                      textAnchor={h === "fdv" ? "start" : "middle"}
                      className="fill-foreground text-[10px] font-medium tnum"
                    >
                      {h === "fdv" ? `FDV ${fmtValue(now)}` : h === "ldt" ? `LDT ${money(now)}` : `CONC ${now.toFixed(2)}`}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {hover && hoverX !== null && drag === null && (
        <div
          className="pointer-events-none absolute z-10 min-w-40 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md"
          style={{ left: Math.min(M.left + x(hoverX) + 12, width - 190), top: M.top + 4 }}
        >
          <div className="mb-1 font-medium tnum">{money(hoverX)}</div>
          {hover.slice(0, 8).map((h) => (
            <div key={h.key} className="flex items-center justify-between gap-3 tnum">
              <span className="flex items-center gap-1.5 truncate">
                <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: h.color }} />
                <span className={cn("truncate", h.key === activeKey ? "text-foreground" : "text-muted-foreground")}>{h.label}</span>
              </span>
              <span>{mode === "total" ? compactNumber(h.v) : fmtValue(h.v)}</span>
            </div>
          ))}
        </div>
      )}
      {readOnlyReason && active && <p className="mt-1 text-xs text-muted-foreground">{readOnlyReason}</p>}
    </div>
  );
}

function compactNumber(v: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}
