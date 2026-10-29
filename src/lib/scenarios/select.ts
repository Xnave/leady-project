import type { Scenario, ScenarioVariant } from "./types";

export type PlannedRun = {
  scenario: Scenario;
  variant: ScenarioVariant;
  sampled: boolean;
};

function primaryVariant(scenario: Scenario): ScenarioVariant {
  return scenario.variants.find((variant) => variant.primary) ?? scenario.variants[0]!;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const current = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = current;
  }
  return copy;
}

/**
 * Primary variant of each selected scenario, plus up to `sample` extra variants
 * marked `sample` on that same set. `--only` ignores the suite filter.
 */
export function planRuns(
  scenarios: Scenario[],
  opts: { suite: "smoke" | "full"; only?: string[]; sample?: number; rng?: () => number },
): { runs: PlannedRun[]; unknownIds: string[] } {
  const only = opts.only?.filter(Boolean) ?? [];
  const selected = only.length
    ? scenarios.filter((scenario) => only.includes(scenario.id))
    : scenarios.filter((scenario) => opts.suite === "full" || scenario.suite === "smoke");
  const known = new Set(scenarios.map((scenario) => scenario.id));
  const unknownIds = only.filter((id) => !known.has(id));

  const runs: PlannedRun[] = selected
    .filter((scenario) => scenario.variants.length > 0)
    .map((scenario) => ({ scenario, variant: primaryVariant(scenario), sampled: false }));

  const sample = Math.max(0, opts.sample ?? 0);
  if (sample > 0) {
    const pool = selected.flatMap((scenario) =>
      scenario.variants
        .filter((variant) => variant.sample && !variant.primary)
        .map((variant) => ({ scenario, variant, sampled: true as const })),
    );
    runs.push(...shuffle(pool, opts.rng ?? Math.random).slice(0, sample));
  }
  return { runs, unknownIds };
}
