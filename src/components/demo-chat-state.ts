/** Identity of what the server rendered: the lead plus its message ids. */
export function threadKey(leadId: string | undefined, messages: { id: string }[]): string {
  return `${leadId ?? ""}:${messages.map((m) => m.id).join(",")}`;
}

/**
 * Replace the local thread only when the server shows something new. A refresh that re-sends
 * the same thread (e.g. `[]` on a new chat) must not wipe the optimistic bubble.
 */
export function shouldResetThread(prevKey: string, nextKey: string): boolean {
  return prevKey !== nextKey;
}
