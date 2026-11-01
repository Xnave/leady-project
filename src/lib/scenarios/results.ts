export type ResultRow = {
  scenario: string;
  variant: string;
  cadence: string;
  lastRun: string;
  result: string;
  wrong: string;
  /** Markdown link to the conversation file for this run. */
  file?: string;
};

const HEADER = "| Scenario | Variant | Cadence | Last run | Result | What went wrong | Conversation |";
const RULE = "| --- | --- | --- | --- | --- | --- | --- |";

/** Relative link from `scripts/agent-scenarios/results.md` to a review file. */
export function conversationLink(filename: string): string {
  const label = filename.replace(/^test-conversations-/, "").replace(/\.md$/, "");
  return `[${label}](../../scenario-runs/${filename})`;
}

export function resultsKey(scenario: string, variant: string): string {
  return `${scenario}\t${variant}`;
}

/** A scenario with no cadence is due every time. A pass inside the window is not. */
export function scenarioDue(
  cadenceDays: number | undefined,
  row: ResultRow | undefined,
  now: Date,
): boolean {
  if (!cadenceDays) return true;
  if (!row || row.result !== "pass") return true;
  const last = parseStamp(row.lastRun);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= cadenceDays * 24 * 60 * 60 * 1000;
}

export function parseResults(markdown: string): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("| ")) continue;
    if (line.startsWith("| Scenario ") || line.startsWith("| ---")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 6) continue;
    rows.push({
      scenario: cells[0] ?? "",
      variant: cells[1] ?? "",
      cadence: cells[2] ?? "",
      lastRun: cells[3] ?? "",
      result: cells[4] ?? "",
      wrong: cells[5] ?? "",
      file: cells[6] ?? "",
    });
  }
  return rows;
}

/** Keep rows that this run did not touch, and replace the ones it did. */
export function mergeResults(previous: string, updates: ResultRow[]): string {
  const byKey = new Map<string, ResultRow>();
  for (const row of parseResults(previous)) byKey.set(resultsKey(row.scenario, row.variant), row);
  for (const row of updates) byKey.set(resultsKey(row.scenario, row.variant), row);
  const rows = [...byKey.values()].sort((a, b) =>
    resultsKey(a.scenario, a.variant).localeCompare(resultsKey(b.scenario, b.variant)),
  );
  const lines = [
    "# Scenario results",
    "",
    "Updated by `npm run scenarios`. A row stays until that scenario runs again.",
    "Cadence is how many days a passing run can wait before `npm run scenarios -- --due` selects it.",
    "Scenarios with an empty cadence run whenever their suite runs.",
    "The link suite is not part of the default smoke run. Use `--suite link`.",
    "",
    HEADER,
    RULE,
    ...rows.map(formatRow),
    "",
  ];
  return lines.join("\n");
}

function formatRow(row: ResultRow): string {
  const cells = [row.scenario, row.variant, row.cadence, row.lastRun, row.result, row.wrong, row.file ?? ""].map(
    (cell) => cell.replace(/\|/g, "/").replace(/\s+/g, " ").trim(),
  );
  return `| ${cells.join(" | ")} |`;
}

function parseStamp(stamp: string): number {
  const match = stamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  ).getTime();
}
