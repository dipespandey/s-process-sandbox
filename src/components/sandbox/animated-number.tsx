"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

export function AnimatedNumber({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(() => format(value));
  const from = useRef(value);
  useEffect(() => {
    if (reduced) {
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        from.current = v;
        setDisplay(format(v));
      },
    });
    return () => controls.stop();
  }, [value, format, reduced]);
  return <span className={`tnum ${className ?? ""}`}>{reduced ? format(value) : display}</span>;
}
