import { averageRowMs } from "@/lib/campaigns/rules";
import { fillUi } from "@/lib/ui";

export type RunTimingCopy = {
  lastRun: string;
  lastRunHint?: string;
  lastRunValue: string;
  lastRunNone?: string;
  sendTook: string;
  sendTookHint?: string;
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

function tip(label: string, hint?: string) {
  if (!hint) return label;
  return (
    <span className="campaign-tip" tabIndex={0} data-tip={hint}>
      {label}
    </span>
  );
}

/** Last run, the send itself, and the average work per recipient. */
export function RunTimingFacts({ copy, run }: { copy: RunTimingCopy; run: RunTimingValue | null }) {
  if (!run) {
    return (
      <>
        <dt>{tip(copy.lastRun, copy.lastRunHint)}</dt>
        <dd>{copy.lastRunNone ?? ""}</dd>
      </>
    );
  }
  const avg = run.lastProcessMs != null && run.lastRowCount != null ? averageRowMs(run.lastProcessMs, run.lastRowCount) : null;
  return (
    <>
      <dt>{tip(copy.lastRun, copy.lastRunHint)}</dt>
      <dd>{fillUi(copy.lastRunValue, { sec: seconds(run.lastRunMs) })}</dd>
      {run.lastSendMs != null ? (
        <>
          <dt>{tip(copy.sendTook, copy.sendTookHint)}</dt>
          <dd>{fillUi(copy.lastRunValue, { sec: seconds(run.lastSendMs) })}</dd>
        </>
      ) : null}
      <dt>{copy.avgRow}</dt>
      <dd>{avg == null ? copy.avgRowNone : fillUi(copy.avgRowValue, { ms: avg })}</dd>
    </>
  );
}
