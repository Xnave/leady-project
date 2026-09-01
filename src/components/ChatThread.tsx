type Msg = { id: string; role: string; text: string };

type Labels = {
  emptyThread: string;
  roles: Record<string, string>;
};

export function ChatThread({ messages, labels }: { messages: Msg[]; labels: Labels }) {
  function roleName(role: string) {
    return labels.roles[role] ?? role;
  }

  return (
    <div className="thread">
      {messages.length === 0 ? <p className="muted">{labels.emptyThread}</p> : null}
      {messages.map((m) => (
        <div key={m.id} className={`bubble ${m.role}`}>
          <div className="bubble-role">{roleName(m.role)}</div>
          {m.text}
        </div>
      ))}
    </div>
  );
}
