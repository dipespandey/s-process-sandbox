import { HOLD_ID, curve, type Application, type Curve, type Funder, type Recommender, type Scenario } from "./engine";

/** Small deterministic PRNG so every visitor sees the same fictional round. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AREAS = [
  "Interpretability",
  "Evaluations",
  "Governance",
  "Biosecurity",
  "Field-building",
  "Epistemics",
  "Resilience",
  "Security",
] as const;
type Area = (typeof AREAS)[number];

const DEMO_APPS: [string, Area, number, string][] = [
  ["Lantern Interpretability Commons", "Interpretability", 1_800_000, "Open tooling and shared datasets for circuit-level model analysis."],
  ["Harbor Evals Reliability Lab", "Evaluations", 1_200_000, "Measures how reproducible dangerous-capability evaluations are across labs."],
  ["Meridian Policy Fellows", "Governance", 900_000, "Places technical fellows in legislative offices for one-year terms."],
  ["Quarry Compute Governance Initiative", "Governance", 1_500_000, "Research on hardware-level verification for compute agreements."],
  ["Sentinel Pathogen Early Warning", "Biosecurity", 2_000_000, "Metagenomic wastewater sequencing pilots in four port cities."],
  ["Clearlight Far-UVC Trials", "Biosecurity", 1_100_000, "Field trials of far-UVC fixtures in schools and transit hubs."],
  ["Tidewater Forecasting Group", "Epistemics", 700_000, "Forecasting infrastructure and question-writing for policymakers."],
  ["Northstar Alignment Bootcamp", "Field-building", 600_000, "Ten-week research bootcamp for early-career ML researchers."],
  ["Keystone Weights Security Project", "Security", 1_300_000, "Red-teaming and hardening guidance for frontier model weight storage."],
  ["Commonplace Deliberation Tools", "Epistemics", 500_000, "Open-source tools for structured public deliberation at scale."],
  ["Bellwether Lab Safety Standards", "Governance", 800_000, "Drafts auditable safety-case templates with standards bodies."],
  ["Overwatch Agent Oversight Benchmarks", "Evaluations", 950_000, "Benchmarks for monitoring long-horizon autonomous agents."],
  ["Seedling Student Research Grants", "Field-building", 400_000, "Small grants for undergraduate safety research projects."],
  ["Granary Catastrophe-Resilient Foods", "Resilience", 750_000, "Scaling seaweed and single-cell protein for sunlight-loss scenarios."],
  ["Signal Epistemics Newsletter", "Epistemics", 250_000, "A weekly digest translating safety research for a general audience."],
  ["Longview Policy Studio", "Governance", 1_000_000, "Long-term policy research on institutional resilience."],
];

type RecSeed = Recommender & { interests: Partial<Record<Area, number>> };

const DEMO_RECS: RecSeed[] = [
  {
    id: "avery",
    name: "Avery",
    focus: "Technical alignment",
    interests: { Interpretability: 1, Evaluations: 0.9, Security: 0.6, "Field-building": 0.5 },
  },
  { id: "bram", name: "Bram", focus: "AI governance", interests: { Governance: 1, Security: 0.85, Evaluations: 0.6, Epistemics: 0.35 } },
  { id: "chen", name: "Chen", focus: "Biosecurity", interests: { Biosecurity: 1, Resilience: 0.8, Governance: 0.4, Security: 0.3 } },
  {
    id: "dara",
    name: "Dara",
    focus: "Field-building",
    interests: { "Field-building": 1, Epistemics: 0.6, Interpretability: 0.5, Governance: 0.45 },
  },
  {
    id: "eli",
    name: "Eli",
    focus: "Forecasting & epistemics",
    interests: { Epistemics: 1, Governance: 0.6, Resilience: 0.5, Evaluations: 0.45 },
  },
];

/** Three fictional funders with different trust in each Recommender (first-dollar deference, 0–1). */
const DEMO_FUNDERS: (Funder & { trust: Record<string, number> })[] = [
  { id: "harlow", name: "Harlow", budget: 5_000_000, trust: { avery: 1, bram: 0.85, chen: 0.6, dara: 0.55, eli: 0.5 } },
  { id: "ines", name: "Ines", budget: 3_000_000, trust: { avery: 0.6, bram: 0.7, chen: 1, dara: 0.65, eli: 0.75 } },
  { id: "mateo", name: "Mateo", budget: 1_000_000, trust: { avery: 0.8, bram: 0.5, chen: 0.7, dara: 1, eli: 0.9 } },
];

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export const HOLD_APP: Application = {
  id: HOLD_ID,
  name: "_hold_",
  area: "Hold",
  ask: 0,
  summary: "Keep money for a future round: a flat value below which a Recommender would rather wait.",
};

function build(
  name: string,
  apps: Application[],
  recs: RecSeed[],
  funders: (Funder & { trust: Record<string, number> })[],
  seed: number,
  coverage: number,
): Scenario {
  const rand = mulberry32(seed);
  const total = funders.reduce((s, f) => s + f.budget, 0);
  const quality = Object.fromEntries(apps.map((a) => [a.id, 0.5 + rand() * 0.5]));
  const evaluations: Scenario["evaluations"] = {};
  for (const r of recs) {
    const raw: [string, number, number, number][] = [];
    for (const a of apps) {
      const interest = r.interests[a.area as Area] ?? (rand() < 0.25 ? 0.25 : 0);
      if (interest <= 0 || rand() > coverage) continue;
      raw.push([a.id, interest * quality[a.id] * (0.75 + rand() * 0.5), a.ask * (0.95 + rand() * 0.65), -0.5 + rand() * 1.1]);
    }
    // Each Recommender's most valuable dollar is worth 1.0, as in the app.
    const best = Math.max(...raw.map((x) => x[1]), 1e-9);
    evaluations[r.id] = Object.fromEntries(raw.map(([id, v, ldt, conc]) => [id, curve(v / best, ldt, conc)]));
    evaluations[r.id][HOLD_ID] = curve(0.08 + rand() * 0.1, total * 3, 0);
  }
  return {
    version: 2,
    name,
    rule: "delegated",
    turn: 0.001,
    funders: funders.map(({ id, name, budget }) => ({ id, name, budget })),
    applications: [...apps, HOLD_APP],
    recommenders: recs.map(({ id, name, focus }) => ({ id, name, focus })),
    evaluations,
    deference: Object.fromEntries(
      funders.map((f) => [
        f.id,
        Object.fromEntries(recs.map((r) => [r.id, curve(f.trust[r.id] ?? 0.5, f.budget * (0.35 + (f.trust[r.id] ?? 0.5) * 0.45), 0.2)])),
      ]),
    ),
    vetoes: {},
    simBudget: {},
  };
}

export function demoScenario(): Scenario {
  const apps = DEMO_APPS.map(([name, area, ask, summary]) => ({ id: slug(name), name, area, ask, summary }));
  return build("Demo round (fictional)", apps, DEMO_RECS, DEMO_FUNDERS, 2026, 0.95);
}

const SYLLABLES = [
  "al",
  "ber",
  "cor",
  "dan",
  "el",
  "fen",
  "gar",
  "hal",
  "ion",
  "jun",
  "kel",
  "lor",
  "mar",
  "nor",
  "or",
  "pel",
  "quin",
  "ros",
  "sil",
  "tor",
  "ul",
  "ven",
  "wyn",
  "yar",
  "zel",
];
const NOUNS = ["Institute", "Lab", "Project", "Collective", "Initiative", "Foundation", "Network", "Studio", "Group", "Center"];
const NAMES = ["Ash", "Blake", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper", "Indy", "Jules", "Kai", "Logan"];

/** 115 applications × 12 Recommenders × 3 funders: the size of a real 2026 round, all fictional. */
export function stressScenario(): Scenario {
  const rand = mulberry32(115);
  const word = () => {
    const w = SYLLABLES[Math.floor(rand() * SYLLABLES.length)] + SYLLABLES[Math.floor(rand() * SYLLABLES.length)];
    return w[0].toUpperCase() + w.slice(1);
  };
  const used = new Set<string>();
  const apps: Application[] = [];
  while (apps.length < 115) {
    const area = AREAS[Math.floor(rand() * AREAS.length)];
    const name = `${word()} ${area === "Field-building" ? "Fellowship" : NOUNS[Math.floor(rand() * NOUNS.length)]}`;
    if (used.has(name)) continue;
    used.add(name);
    const ask = Math.round((150_000 + Math.pow(rand(), 1.8) * 3_200_000) / 10_000) * 10_000;
    apps.push({ id: slug(name), name, area, ask, summary: `Fictional ${area.toLowerCase()} application.` });
  }
  const recs: RecSeed[] = NAMES.map((name, i) => {
    const interests: Partial<Record<Area, number>> = { [AREAS[i % AREAS.length]]: 1 };
    for (const area of AREAS) if (!interests[area] && rand() < 0.45) interests[area] = 0.3 + rand() * 0.55;
    return { id: slug(name), name, focus: AREAS[i % AREAS.length], interests };
  });
  const funders = [
    { id: "north", name: "North", budget: 36_000_000 },
    { id: "west", name: "West", budget: 16_000_000 },
    { id: "south", name: "South", budget: 8_000_000 },
  ].map((f) => ({ ...f, trust: Object.fromEntries(recs.map((r) => [r.id, Math.round((0.35 + rand() * 0.65) * 100) / 100])) }));
  return build("Stress test: 115 × 12 × 3 (fictional)", apps, recs, funders, 9115, 0.8);
}

export function blankScenario(): Scenario {
  const apps = ["Application A", "Application B", "Application C"].map((name, i) => ({
    id: `app-${i + 1}`,
    name,
    area: "General",
    ask: 1_000_000,
    summary: "",
  }));
  const recs = ["Recommender 1", "Recommender 2"].map((name, i) => ({ id: `rec-${i + 1}`, name, focus: "" }));
  const ev = (fdvs: number[]): Record<string, Curve> => ({
    ...Object.fromEntries(apps.map((a, i) => [a.id, curve(fdvs[i], 1_200_000, 0)])),
    [HOLD_ID]: curve(0.1, 6_000_000, 0),
  });
  return {
    version: 2,
    name: "Blank round",
    rule: "delegated",
    turn: 0.001,
    funders: [{ id: "funder", name: "Funder", budget: 2_000_000 }],
    applications: [...apps, HOLD_APP],
    recommenders: recs,
    evaluations: { "rec-1": ev([1, 0.7, 0.4]), "rec-2": ev([0.5, 1, 0.8]) },
    deference: { funder: { "rec-1": curve(1, 1_400_000, 0.2), "rec-2": curve(0.8, 1_200_000, 0.2) } },
    vetoes: {},
    simBudget: {},
  };
}

export const PRESETS = {
  demo: { label: "Demo round", detail: "16 applications · 5 Recommenders · 3 funders · $9M", make: demoScenario },
  stress: { label: "Stress test", detail: "115 applications · 12 Recommenders · 3 funders · $60M", make: stressScenario },
  blank: { label: "Blank round", detail: "3 applications · 2 Recommenders · 1 funder", make: blankScenario },
} as const;
export type PresetId = keyof typeof PRESETS;
