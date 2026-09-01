export function MeetingDecisionForm({
  meetingId,
  pending,
  summary,
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
}) {
  if (!pending) return null;
  return (
    <form action={`/api/meetings/${meetingId}/decide`} method="post" className="stack">
      {summary ? (
        <div className="stage-node">
          {summary.kind || summary.slot ? (
            <p>
              <strong>{summary.kind ?? "visit"}</strong>
              {summary.slot ? ` · ${summary.slot}` : ""}
            </p>
          ) : null}
          {summary.need ? <p>Need: {summary.need}</p> : null}
          {summary.name ? <p>Name: {summary.name}</p> : null}
          {summary.phone ? <p>Phone: {summary.phone}</p> : null}
          {summary.email ? <p>Email: {summary.email}</p> : null}
        </div>
      ) : null}
      <div className="row-actions">
        <button type="submit" name="approved" value="yes">
          Approve
        </button>
        <button type="submit" name="approved" value="no" className="btn-secondary">
          Decline / suggest another time
        </button>
      </div>
    </form>
  );
}
