type Msg = { id: string; role: string; text: string };

export function ChatThread({ messages }: { messages: Msg[] }) {
  return (
    <div className="thread">
      {messages.length === 0 ? (
        <p className="muted">No messages yet. Say hello as the customer.</p>
      ) : null}
      {messages.map((m) => (
        <div key={m.id} className={`bubble ${m.role}`}>
          <div className="muted">{m.role}</div>
          {m.text}
        </div>
      ))}
    </div>
  );
}
