import * as Comlink from "comlink";
import { allocate, sensitivity, type Scenario } from "./engine";

/** Sensitivity re-runs the round 4×R times; off the main thread so dragging stays smooth. */
const api = {
  sensitivity(scenario: Scenario, factor: number) {
    const t0 = performance.now();
    const result = sensitivity(scenario, allocate(scenario), factor);
    return { ...result, ms: performance.now() - t0 };
  },
};

Comlink.expose(api);
export type AnalysisWorker = typeof api;
