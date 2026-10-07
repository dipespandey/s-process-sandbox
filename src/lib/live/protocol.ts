import { z } from "zod";
import { CurveSchema, HOLD_ID, LIMITS, RuleSchema, normalizeCurve, type Scenario } from "../engine";

/**
 * Wire protocol for live sessions. Shared verbatim by the browser and the Durable Object,
 * so the server validates and authorizes with exactly the rules the UI assumes.
 */

const id = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-zA-Z0-9_-]+$/);
const dollars = z.number().finite().min(0).max(LIMITS.maxDollars);

export const OpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("evaluation"), rec: id, app: id, curve: CurveSchema.nullable() }),
  z.object({ type: z.literal("deference"), funder: id, rec: id, curve: CurveSchema }),
  z.object({ type: z.literal("budget"), funder: id, value: dollars }),
  z.object({ type: z.literal("veto"), funder: id, app: id, declined: z.boolean() }),
  z.object({ type: z.literal("simBudget"), rec: id, value: dollars }),
  z.object({ type: z.literal("rule"), value: RuleSchema }),
  z.object({ type: z.literal("turn"), value: z.number().finite().min(LIMITS.minTurn).max(LIMITS.maxTurn) }),
]);
export type Op = z.infer<typeof OpSchema>;

export type Role = "facilitator" | "funder" | "recommender" | "observer";
export interface Seat {
  role: Role;
  /** Recommender id, for recommender seats. */
  rec?: string;
  /** Funder id, for funder seats. */
  funder?: string;
  label: string;
}

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string().min(16).max(128) }),
  z.object({ type: z.literal("op"), op: OpSchema, seq: z.number().int().nonnegative() }),
  z.object({ type: z.literal("view"), app: id.nullable() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export interface Peer {
  id: string;
  label: string;
  role: Role;
  rec?: string;
  funder?: string;
  viewing: string | null;
}

export type ServerMessage =
  | { type: "welcome"; seat: Seat; scenario: Scenario; version: number; peers: Peer[]; you: string }
  | { type: "op"; op: Op; version: number; by: string; label: string; seq?: number }
  | { type: "presence"; peers: Peer[] }
  | { type: "reject"; seq: number; reason: string; scenario: Scenario; version: number }
  | { type: "error"; code: "auth" | "invalid" | "rate"; message: string };

export const MAX_MESSAGE_BYTES = 32 * 1024;

export type EditTarget =
  { type: "evaluation" | "simBudget"; rec: string } | { type: "deference" | "budget" | "veto"; funder: string } | { type: "rule" | "turn" };

/**
 * Who may change what. Recommenders edit only their own curves (including their _hold_ line) and
 * simulated budget; each funder owns their own deference curves, budget and final say; the
 * facilitator can change anything, including the combination rule; observers change nothing.
 */
export function canEdit(seat: Seat | null, target: EditTarget): boolean {
  if (!seat) return true; // Solo mode: everything is editable.
  if (seat.role === "facilitator") return true;
  // Decide by the edit's type, never by which fields it happens to carry: a deference op names a
  // Recommender too, and a Recommender must not be able to raise the funder's trust in themselves.
  switch (target.type) {
    case "evaluation":
    case "simBudget":
      return seat.role === "recommender" && target.rec === seat.rec;
    case "deference":
    case "budget":
    case "veto":
      return seat.role === "funder" && target.funder === seat.funder;
    default:
      return false;
  }
}

export function authorize(seat: Seat, op: Op, scenario: Scenario): string | null {
  if ("rec" in op && !scenario.recommenders.some((x) => x.id === op.rec)) return "Unknown Recommender";
  if ("funder" in op && !scenario.funders.some((x) => x.id === op.funder)) return "Unknown funder";
  if ("app" in op && !scenario.applications.some((x) => x.id === op.app)) return "Unknown application";
  if (op.type === "veto" && op.app === HOLD_ID) return "_hold_ cannot be declined";
  if (canEdit(seat, op)) return null;
  if (seat.role === "observer") return "This link is view-only";
  if (op.type === "rule" || op.type === "turn") return "Only the facilitator can change the rule";
  if (op.type === "deference" || op.type === "budget" || op.type === "veto") return "Only that funder (or the facilitator) can change this";
  return "You can only edit your own curves";
}

/** Pure, total application of a validated op. Values are re-normalized and clamped server-side too. */
export function applyOp(s: Scenario, op: Op): Scenario {
  const clamp = (v: number) => Math.min(Math.max(v, 0), LIMITS.maxDollars);
  switch (op.type) {
    case "evaluation": {
      const row = { ...(s.evaluations[op.rec] ?? {}) };
      if (op.curve) row[op.app] = normalizeCurve(op.curve);
      else delete row[op.app];
      return { ...s, evaluations: { ...s.evaluations, [op.rec]: row } };
    }
    case "deference":
      return {
        ...s,
        deference: { ...s.deference, [op.funder]: { ...(s.deference[op.funder] ?? {}), [op.rec]: normalizeCurve(op.curve) } },
      };
    case "budget":
      return { ...s, funders: s.funders.map((f) => (f.id === op.funder ? { ...f, budget: clamp(op.value) } : f)) };
    case "veto": {
      if (op.app === HOLD_ID) return s;
      const cur = new Set(s.vetoes[op.funder] ?? []);
      if (op.declined) cur.add(op.app);
      else cur.delete(op.app);
      return { ...s, vetoes: { ...s.vetoes, [op.funder]: [...cur] } };
    }
    case "simBudget":
      return { ...s, simBudget: { ...s.simBudget, [op.rec]: clamp(op.value) } };
    case "rule":
      return { ...s, rule: op.value };
    case "turn":
      return { ...s, turn: Math.min(Math.max(op.value, LIMITS.minTurn), LIMITS.maxTurn) };
  }
}

export const ROLE_LABEL: Record<Role, string> = {
  facilitator: "Facilitator",
  funder: "Funder",
  recommender: "Recommender",
  observer: "Observer",
};
