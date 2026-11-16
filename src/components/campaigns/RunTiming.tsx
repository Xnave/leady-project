import { averageRowMs } from "@/lib/campaigns/rules";
import { fillUi } from "@/lib/ui";

export type RunTimingCopy = {
  lastRun: string;
  lastRunValue: string;
  lastRunNone?: string;
  sendTook: string;
  avgRow: string;
  avgRowValue: string;
  avgRowNone: string;
};

export type RunTimingValue = {
  lastRunMs: number;
  lastSendMs: number | null;
  lastProcessMs: number | null;
  lastRowCount: number | null;
};

function seconds(ms: number): string {
  const sec = ms / 1000;
  return sec < 10 ? sec.toFixed(1) : String(Math.round(sec));
}

/** Last run, the send itself, and the average work per recipient. */
export function RunTimingFacts({ copy, run }: { copy: RunTimingCopy; run: RunTimingValue | null }) {
  if (!run) {
    return (
      <>
        <dt>{copy.lastRun}</dt>
        <dd>{copy.lastRunNone ?? ""}</dd>
      </>
    );
  }
  const avg = run.lastProcessMs != null && run.lastRowCount != null ? averageRowMs(run.lastProcessMs, run.lastRowCount) : null;
  return (
    <>
      <dt>{copy.lastRun}</dt>
      <dd>{fillUi(copy.lastRunValue, { sec: seconds(run.lastRunMs) })}</dd>
      {run.lastSendMs != null ? (
        <>
          <dt>{copy.sendTook}</dt>
          <dd>{fillUi(copy.lastRunValue, { sec: seconds(run.lastSendMs) })}</dd>
        </>
      ) : null}
      <dt>{copy.avgRow}</dt>
      <dd>{avg == null ? copy.avgRowNone : fillUi(copy.avgRowValue, { ms: avg })}</dd>
    </>
  );
}
