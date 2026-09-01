type Labels = {
  need: string;
  name: string;
  phone: string;
  email: string;
  approve: string;
  decline: string;
  visitDefault: string;
};

export function MeetingDecisionForm({
  meetingId,
  pending,
  summary,
  labels,
}: {
  meetingId: string;
  pending: boolean;
  summary?: {
    name?: string;
    phone?: string;
    email?: string;
    need?: string;
    slot?: string;
    kind?: string;
  };
  labels: Labels;
}) {
  if (!pending) return null;
  return (
    <form action={`/api/meetings/${meetingId}/decide`} method="post" className="stack">
      {summary ? (
        <div className="stage-node">
          {summary.kind || summary.slot ? (
            <p>
              <strong>{summary.kind ?? labels.visitDefault}</strong>
              {summary.slot ? ` · ${summary.slot}` : ""}
            </p>
          ) : null}
          {summary.need ? (
            <p>
              {labels.need}: {summary.need}
            </p>
          ) : null}
          {summary.name ? (
            <p>
              {labels.name}: {summary.name}
            </p>
          ) : null}
          {summary.phone ? (
            <p>
              {labels.phone}: {summary.phone}
            </p>
          ) : null}
          {summary.email ? (
            <p>
              {labels.email}: {summary.email}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="row-actions">
        <button type="submit" name="approved" value="yes">
          {labels.approve}
        </button>
        <button type="submit" name="approved" value="no" className="btn-secondary">
          {labels.decline}
        </button>
      </div>
    </form>
  );
}
