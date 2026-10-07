"use client";

import type { Curve } from "./engine";
import type { Phase } from "@/components/sandbox/curve-editor";
import { gesture } from "./store";

/** Turn editor phases into a single undo entry per gesture. */
export function gestureHandler(apply: (curve: Curve) => void) {
  return (_key: string, curve: Curve, phase: Phase) => {
    if (phase === "start") gesture.begin();
    else if (phase === "move") gesture.update(() => apply(curve));
    else gesture.end();
  };
}
