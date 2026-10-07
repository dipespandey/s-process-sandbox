"use client";

import { create } from "zustand";
import { temporal } from "zundo";
import { allocate, budgetShares, normalizeCurve, scaleBudgets, type Curve, type Rule, type Scenario } from "./engine";
import { applyOp, type Op, type Peer, type Seat } from "./live/protocol";
import { demoScenario } from "./seed";

export type Tab = "overview" | "recommender" | "application" | "funders" | "matrix" | "path" | "further" | "sensitivity" | "method";
export type SortKey = "allocation" | "name" | "ask" | "contested" | "change";
/** Whose eyes the sidebar sees through: Σ (the projected final allocation), a funder, or a Recommender. */
export type Perspective = { kind: "sigma" } | { kind: "funder"; id: string } | { kind: "rec"; id: string };

export interface LiveState {
  status: "off" | "connecting" | "live" | "closed" | "error";
  room: string | null;
  seat: Seat | null;
  peers: Peer[];
  you: string | null;
  message: string | null;
  version: number;
}

interface State {
  scenario: Scenario;
  selectedApp: string | null;
  activeRec: string | null;
  activeFunder: string | null;
  perspective: Perspective;
  tab: Tab;
  sort: SortKey;
  live: LiveState;
  /** True once the URL, a draft or a live session has decided which round to show. */
  booted: boolean;
  /** Set by the live client: routes edits to the server instead of applying them only locally. */
  sender: ((op: Op) => void) | null;
}

interface Actions {
  load(s: Scenario): void;
  edit(op: Op): void;
  /** Several ops as one change (one undo entry, one render). */
  editMany(ops: Op[]): void;
  /** Apply an op that already happened elsewhere (no echo, no undo entry). */
  receive(op: Op): void;
  replace(s: Scenario): void;
  setEvaluation(rec: string, app: string, curve: Curve | null): void;
  setDeference(funder: string, rec: string, curve: Curve): void;
  setFunderBudget(funder: string, v: number): void;
  /** Scale every funder's budget so they sum to `total`, keeping their proportions. */
  setTotalBudget(total: number): void;
  setVeto(funder: string, app: string, declined: boolean): void;
  setSimBudget(rec: string, v: number): void;
  setRule(v: Rule): void;
  select(app: string | null): void;
  setActiveRec(rec: string | null): void;
  setActiveFunder(funder: string | null): void;
  /** Look through someone's eyes; also opens the matching view. */
  look(p: Perspective): void;
  setTab(t: Tab): void;
  setSort(s: SortKey): void;
  setLive(p: Partial<LiveState>): void;
  setSender(fn: State["sender"]): void;
  setBooted(): void;
}

export const OFFLINE: LiveState = {
  status: "off",
  room: null,
  seat: null,
  peers: [],
  you: null,
  message: null,
  version: 0,
};

/** Each funder's share of the round, from the last time the total was above zero. */
let lastShares: Record<string, number> | null = null;

export const useStore = create<State & Actions>()(
  temporal(
    (set, get) => ({
      scenario: demoScenario(),
      selectedApp: null,
      activeRec: null,
      activeFunder: null,
      perspective: { kind: "sigma" },
      tab: "overview",
      sort: "allocation",
      live: OFFLINE,
      booted: false,
      sender: null,

      load(s) {
        lastShares = budgetShares(s.funders);
        // Open on the round's top-funded application rather than whichever happens to be listed first.
        const a = allocate(s);
        const top = a.totals.reduce((best, t, i) => (i !== a.hold && t > (a.totals[best] ?? -1) ? i : best), a.hold === 0 ? 1 : 0);
        set({
          scenario: s,
          selectedApp: s.applications[top]?.id ?? null,
          activeRec: s.recommenders[0]?.id ?? null,
          activeFunder: s.funders[0]?.id ?? null,
          perspective: { kind: "sigma" },
        });
        useStore.temporal.getState().clear();
      },
      edit(op) {
        get().sender?.(op);
        set((st) => ({ scenario: applyOp(st.scenario, op) }));
      },
      editMany(ops) {
        const send = get().sender;
        ops.forEach((op) => send?.(op));
        set((st) => ({ scenario: ops.reduce(applyOp, st.scenario) }));
      },
      receive(op) {
        withoutHistory(() => set((st) => ({ scenario: applyOp(st.scenario, op) })));
      },
      replace(s) {
        withoutHistory(() => set({ scenario: s }));
      },
      setEvaluation(rec, app, curve) {
        get().edit({ type: "evaluation", rec, app, curve: curve ? normalizeCurve(curve) : null });
      },
      setDeference(funder, rec, curve) {
        get().edit({ type: "deference", funder, rec, curve: normalizeCurve(curve) });
      },
      setFunderBudget(funder, value) {
        get().edit({ type: "budget", funder, value });
      },
      setTotalBudget(total) {
        const s = get().scenario;
        // Remember the split while there is one, so scaling down to $0 and back up keeps it.
        lastShares = budgetShares(s.funders) ?? lastShares;
        const values = scaleBudgets(s.funders, total, lastShares);
        get().editMany(s.funders.map((f, i) => ({ type: "budget", funder: f.id, value: values[i] })));
      },
      setVeto(funder, app, declined) {
        get().edit({ type: "veto", funder, app, declined });
      },
      setSimBudget(rec, value) {
        get().edit({ type: "simBudget", rec, value });
      },
      setRule(value) {
        get().edit({ type: "rule", value });
      },
      select(app) {
        set({ selectedApp: app });
      },
      setActiveRec(rec) {
        set({ activeRec: rec });
      },
      setActiveFunder(funder) {
        set({ activeFunder: funder });
      },
      look(p) {
        if (p.kind === "sigma") set({ perspective: p, tab: "overview" });
        else if (p.kind === "funder") set({ perspective: p, activeFunder: p.id, tab: "funders" });
        else set({ perspective: p, activeRec: p.id, tab: "recommender" });
      },
      setTab(tab) {
        // The sidebar follows the view: Σ for the overview, the focused funder or Recommender for theirs.
        const st = get();
        if (tab === "overview") set({ tab, perspective: { kind: "sigma" } });
        else if (tab === "recommender") {
          const id = st.activeRec ?? st.scenario.recommenders[0]?.id;
          set(id ? { tab, perspective: { kind: "rec", id }, activeRec: id } : { tab });
        } else if (tab === "funders") {
          const id = st.activeFunder ?? st.scenario.funders[0]?.id;
          set(id ? { tab, perspective: { kind: "funder", id }, activeFunder: id } : { tab });
        } else set({ tab });
      },
      setSort(sort) {
        set({ sort });
      },
      setLive(p) {
        set((st) => ({ live: { ...st.live, ...p } }));
      },
      setSender(sender) {
        set({ sender });
      },
      setBooted() {
        set({ booted: true });
      },
    }),
    {
      // Only the scenario is undoable; selection, tabs and live status are view state.
      partialize: (s) => ({ scenario: s.scenario }),
      equality: (a, b) => a.scenario === b.scenario,
      limit: 200,
    },
  ),
);

function withoutHistory(fn: () => void) {
  const t = useStore.temporal.getState();
  const wasTracking = t.isTracking;
  t.pause();
  fn();
  if (wasTracking) t.resume();
}

/**
 * Continuous gestures (dragging a curve handle, scrubbing the budget) should
 * produce one undo entry. The first update records the pre-gesture state; later
 * updates run untracked until the gesture ends.
 */
export const gesture = {
  active: false,
  begin() {
    this.active = true;
  },
  update(fn: () => void) {
    const t = useStore.temporal.getState();
    fn();
    if (this.active && t.isTracking) t.pause();
  },
  end() {
    this.active = false;
    useStore.temporal.getState().resume();
  },
};
