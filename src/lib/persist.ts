"use client";

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { ScenarioSchema, type Scenario } from "./engine";

const KEY = "s-process-sandbox:scenario:v1";

export function encodeScenario(s: Scenario) {
  return compressToEncodedURIComponent(JSON.stringify(s));
}

/** Shared links and stored drafts are untrusted input: parse, validate, or reject. */
export function decodeScenario(encoded: string): Scenario | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json || json.length > 2_000_000) return null;
    const parsed = ScenarioSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseScenarioJson(text: string): Scenario | null {
  try {
    const parsed = ScenarioSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function shareUrl(s: Scenario) {
  return `${window.location.origin}${window.location.pathname}#s=${encodeScenario(s)}`;
}

export function loadDraft(): Scenario | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? decodeScenario(v) : null;
  } catch {
    return null;
  }
}

export function saveDraft(s: Scenario) {
  try {
    localStorage.setItem(KEY, encodeScenario(s));
  } catch {
    // Storage may be unavailable (private mode); drafts are a convenience only.
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
