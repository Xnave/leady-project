export function MeetingDecisionForm({
  meetingId,
  pending,
}: {
  meetingId: string;
  pending: boolean;
}) {
  if (!pending) return null;
  return (
    <form action={`/api/meetings/${meetingId}/decide`} method="post" className="row-actions">
      <button type="submit" name="approved" value="yes">
        Approve
      </button>
      <button type="submit" name="approved" value="no" className="btn-secondary">
        Decline
      </button>
    </form>
  );
}
