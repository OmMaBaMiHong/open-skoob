import { fetchChatMessages, type ChatMessageDto } from "./api";

export function nextWorkbenchPoll(status: string | undefined, connected: boolean, hidden: boolean): number | null {
  if (hidden || connected || (status && ["failed", "succeeded", "cancelled", "paused", "awaiting_review"].includes(status))) return null;
  return 15_000 + Math.floor(Math.random() * 5_000);
}

export async function syncChatMessages(
  bookId: string, session: { uid: string; lastSeq: number }, cached: ReadonlyArray<ChatMessageDto> = [],
): Promise<ReadonlyArray<ChatMessageDto>> {
  let after = cached.at(-1)?.seq ?? 0;
  if (after >= session.lastSeq) return cached;
  const result = [...cached];
  while (after < session.lastSeq) {
    const page = await fetchChatMessages(bookId, session.uid, { afterSeq: after, limit: 500 });
    const added = page.filter((message) => message.seq > after);
    if (!added.length) break;
    result.push(...added);
    after = added.at(-1)!.seq;
  }
  return result;
}
