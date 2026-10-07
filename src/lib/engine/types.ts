import { z } from "zod";

/** Upper bounds keep untrusted input (shared links, realtime ops) cheap to process. */
export const LIMITS = {
  maxApplications: 200,
  maxRecommenders: 16,
  maxFunders: 8,
  maxDollars: 500_000_000,
  /** The best dollar is worth 1.0; allow a little headroom above it. */
  maxValue: 2,
  minTurn: 0.0002,
  maxTurn: 0.05,
} as const;

/** Reserved id of the pseudo-application that means "keep this money for a future round". */
export const HOLD_ID = "_hold_";

const id = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-zA-Z0-9_-]+$/);

/**
 * A marginal value function in the S-Process's own terms: the value of the first dollar (relative
 * to your most valuable dollar, which is worth 1.0), the last-dollar threshold where value reaches
 * zero, and a concavity that bends the curve between them.
 */
export const CurveSchema = z.object({
  fdv: z.number().finite().min(0).max(LIMITS.maxValue),
  ldt: z.number().finite().min(1).max(LIMITS.maxDollars),
  conc: z.number().finite().min(-1).max(1),
});

export const ApplicationSchema = z.object({
  id,
  name: z.string().min(1).max(80),
  summary: z.string().max(280).default(""),
  area: z.string().max(40).default("General"),
  ask: z.number().finite().min(0).max(LIMITS.maxDollars),
});

export const RecommenderSchema = z.object({
  id,
  name: z.string().min(1).max(40),
  focus: z.string().max(80).default(""),
});

export const FunderSchema = z.object({
  id,
  name: z.string().min(1).max(40),
  budget: z.number().finite().min(0).max(LIMITS.maxDollars),
});

export const RuleSchema = z.enum(["delegated", "joint", "pooled"]);

export const ScenarioSchema = z
  .object({
    version: z.literal(2),
    name: z.string().min(1).max(80),
    rule: RuleSchema,
    /** Each simulated turn, a funder hands out this fraction of their budget (the talk uses 0.1%). */
    turn: z.number().finite().min(LIMITS.minTurn).max(LIMITS.maxTurn),
    funders: z.array(FunderSchema).min(1).max(LIMITS.maxFunders),
    applications: z
      .array(ApplicationSchema)
      .min(1)
      .max(LIMITS.maxApplications + 1),
    recommenders: z.array(RecommenderSchema).min(1).max(LIMITS.maxRecommenders),
    /** evaluations[recommenderId][applicationId]; missing means "not evaluated" (zero value). */
    evaluations: z.record(id, z.record(id, CurveSchema)),
    /** deference[funderId][recommenderId]: the funder's marginal value of routing money through that Recommender. */
    deference: z.record(id, z.record(id, CurveSchema)),
    /** Funder final say: applications each funder declines to fund. */
    vetoes: z.record(id, z.array(id).max(LIMITS.maxApplications)).default({}),
    /** Budget each Recommender uses for their unilateral allocation; defaults to the round total. */
    simBudget: z.record(id, z.number().finite().min(0).max(LIMITS.maxDollars)).default({}),
  })
  .superRefine((s, ctx) => {
    const apps = new Set(s.applications.map((a) => a.id));
    const recs = new Set(s.recommenders.map((r) => r.id));
    const funders = new Set(s.funders.map((f) => f.id));
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (apps.size !== s.applications.length) issue("Duplicate application id");
    if (recs.size !== s.recommenders.length) issue("Duplicate recommender id");
    if (funders.size !== s.funders.length) issue("Duplicate funder id");
    for (const [r, row] of Object.entries(s.evaluations)) {
      if (!recs.has(r)) issue(`Unknown recommender ${r}`);
      for (const a of Object.keys(row)) if (!apps.has(a)) issue(`Unknown application ${a}`);
    }
    for (const [f, row] of Object.entries(s.deference)) {
      if (!funders.has(f)) issue(`Unknown funder ${f}`);
      for (const r of Object.keys(row)) if (!recs.has(r)) issue(`Unknown recommender ${r}`);
    }
    for (const [f, list] of Object.entries(s.vetoes)) {
      if (!funders.has(f)) issue(`Unknown funder ${f}`);
      for (const a of list) if (!apps.has(a) || a === HOLD_ID) issue(`Cannot veto ${a}`);
    }
    for (const r of Object.keys(s.simBudget)) if (!recs.has(r)) issue(`Unknown recommender ${r}`);
  });

export type Curve = z.infer<typeof CurveSchema>;
export type Application = z.infer<typeof ApplicationSchema>;
export type Recommender = z.infer<typeof RecommenderSchema>;
export type Funder = z.infer<typeof FunderSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;

export const isHold = (appId: string) => appId === HOLD_ID;
export const totalBudget = (s: Scenario) => s.funders.reduce((sum, f) => sum + f.budget, 0);

/**
 * Rescale every funder's budget to `total`, keeping their shares. When the current total is zero the
 * shares can't be read from the budgets, so use `fallback` (the last known shares), else split equally.
 */
export function scaleBudgets(funders: Funder[], total: number, fallback?: Record<string, number> | null): number[] {
  const cur = funders.reduce((sum, f) => sum + f.budget, 0);
  const known = fallback ? funders.reduce((sum, f) => sum + (fallback[f.id] ?? 0), 0) : 0;
  const share = (f: Funder) => (cur > 0 ? f.budget / cur : known > 0 ? (fallback![f.id] ?? 0) / known : 1 / funders.length);
  return funders.map((f) => Math.round(share(f) * total));
}

export function budgetShares(funders: Funder[]): Record<string, number> | null {
  const cur = funders.reduce((sum, f) => sum + f.budget, 0);
  return cur > 0 ? Object.fromEntries(funders.map((f) => [f.id, f.budget / cur])) : null;
}

export const RULES: Record<Rule, { label: string; short: string; description: string }> = {
  delegated: {
    label: "Two-stage delegation",
    short: "Delegation",
    description:
      "On each funder's turn, the funder routes the next slice of budget through the Recommender it most wants to defer to (its curve over Recommenders); that Recommender spends it on their highest-value use, which may be _hold_.",
  },
  joint: {
    label: "Joint marginal value",
    short: "Joint",
    description:
      "On each funder's turn, the slice goes to the (Recommender, application) pair with the highest product of the funder's deference and the Recommender's marginal value.",
  },
  pooled: {
    label: "Weighted average",
    short: "Average",
    description:
      "On each funder's turn, Recommender curves are averaged with fixed weights (the funder's first-dollar deference) and the slice goes to the application with the highest average.",
  },
};
