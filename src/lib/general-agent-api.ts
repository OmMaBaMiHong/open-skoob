import { AgentMessageInputSchema, GeneralAttachmentSchema, GeneralSessionSnapshotSchema, GeneralSkillSummarySchema, IdSchema, PublicEventSchema, RunStatusSchema,
  GENERAL_ATTACHMENT_MAX_BYTES, type AgentMessageInput, type PublicEvent } from "./general-agent-contracts";
import { apiUrl, CREDENTIALS } from "./api-origin";
import { AUTH_CHANGED_EVENT, readAuth } from "./auth-storage";
import { ApiError } from "./api";

const base = "/api/v1/general-agent";
const segment = (value: string) => encodeURIComponent(IdSchema.parse(value));
async function request<T>(path: string, init: RequestInit, consume: (response: Response, signal: AbortSignal) => Promise<T>) {
  const identity = readAuth();
  if (!identity) throw new ApiError(401, "请先登录", "LOGIN_REQUIRED");
  const controller = new AbortController();
  const assertIdentity = () => {
    const current = readAuth();
    if (current?.userId !== identity.userId || current?.token !== identity.token) throw new ApiError(409, "登录身份已变化，请重新打开会话", "IDENTITY_CHANGED");
  };
  const identityChanged = () => { try { assertIdentity(); } catch (error) { controller.abort(error); } };
  const abort = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) abort();
  if (typeof window !== "undefined") {
    window.addEventListener(AUTH_CHANGED_EVENT, identityChanged);
    window.addEventListener("storage", identityChanged);
  }
  try {
    controller.signal.throwIfAborted();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${identity.token}`); headers.set("X-Skoob-User", identity.userId);
    const response = await fetch(apiUrl(`${base}${path}`), { ...init, signal: controller.signal, credentials: CREDENTIALS, headers });
    assertIdentity(); controller.signal.throwIfAborted();
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(response.status, body?.error?.message ?? "智能体服务请求失败", body?.error?.code);
    }
    const result = await consume(response, controller.signal);
    assertIdentity(); controller.signal.throwIfAborted();
    return result;
  } finally {
    init.signal?.removeEventListener("abort", abort);
    if (typeof window !== "undefined") {
      window.removeEventListener(AUTH_CHANGED_EVENT, identityChanged);
      window.removeEventListener("storage", identityChanged);
    }
  }
}
async function json(path: string, body?: unknown, signal?: AbortSignal) {
  return request(path, { signal, ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }, response => response.json());
}
export async function createGeneralSession(clientRequestId: string, signal?: AbortSignal) {
  const result = await json("/sessions", { clientRequestId: IdSchema.parse(clientRequestId) }, signal);
  return { sessionId: IdSchema.parse(result.sessionId) };
}
export interface RecentAgentSession { id: string; title: string; updatedAt: string; kind: string; status: string }
export async function fetchRecentAgentSessions(cursor?: string, signal?: AbortSignal): Promise<{ sessions: RecentAgentSession[]; nextCursor: string | null }> {
  return json(`/sessions?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, undefined, signal);
}
export async function fetchGeneralSnapshot(sessionId: string, signal?: AbortSignal) {
  const snapshot = GeneralSessionSnapshotSchema.parse(await json(`/sessions/${segment(sessionId)}`, undefined, signal));
  if (snapshot.sessionId !== sessionId) throw new ApiError(502, "返回了错误的会话", "SESSION_MISMATCH");
  return snapshot;
}
export async function fetchGeneralAttachments(sessionId: string, signal?: AbortSignal) {
  return GeneralAttachmentSchema.array().parse((await json(`/sessions/${segment(sessionId)}/attachments`, undefined, signal)).attachments);
}
export async function fetchGeneralSkills(signal?: AbortSignal) {
  return GeneralSkillSummarySchema.array().parse((await json("/skills", undefined, signal)).skills);
}
export async function sendGeneralMessage(input: AgentMessageInput, signal?: AbortSignal) {
  const message = AgentMessageInputSchema.parse(input);
  const result = await json(`/sessions/${segment(message.sessionId)}/messages`, message, signal);
  if (result.messageId !== message.messageId) throw new ApiError(502, "消息回执不一致，请重试确认", "MESSAGE_MISMATCH");
  return { messageId: message.messageId, runId: IdSchema.parse(result.runId), status: RunStatusSchema.parse(result.status) };
}
export async function uploadGeneralAttachment(sessionId: string, clientUploadId: string, file: Blob, filename: string, signal?: AbortSignal) {
  if (file.size > GENERAL_ATTACHMENT_MAX_BYTES) throw new ApiError(413, "文件超过 80 MiB 上传限制", "RESOURCE_LIMIT");
  const result = await request(`/sessions/${segment(sessionId)}/attachments`, { method: "POST", body: file, signal,
    headers: { "Content-Type": "application/octet-stream", "X-Upload-Id": IdSchema.parse(clientUploadId), "X-File-Name": encodeURIComponent(filename) } }, response => response.json());
  return GeneralAttachmentSchema.parse(result.attachment);
}
export async function cancelGeneralRun(runId: string, signal?: AbortSignal) {
  return RunStatusSchema.parse((await json(`/runs/${segment(runId)}/cancel`, {}, signal)).status);
}
export async function answerGeneralQuestion(runId: string, questionId: string, revision: number, input: AgentMessageInput, selectedOption?: number, signal?: AbortSignal) {
  const result = await json(`/runs/${segment(runId)}/answer`, { questionId, revision, input: AgentMessageInputSchema.parse(input), ...(selectedOption !== undefined ? { selectedOption } : {}) }, signal);
  if (result.runId !== runId) throw new ApiError(502, "回答回执不一致，请重试确认", "RUN_MISMATCH");
  return { runId, status: RunStatusSchema.parse(result.status) };
}
export async function fetchGeneralArtifact(sessionId: string, artifactId: string, revision: number, signal?: AbortSignal) {
  return request(`/sessions/${segment(sessionId)}/artifacts/${segment(artifactId)}/content?revision=${revision}`, { signal }, response => response.blob());
}
export async function fetchGeneralOriginal(sessionId: string, attachmentId: string, revision: number, signal?: AbortSignal) {
  return request(`/sessions/${segment(sessionId)}/attachments/${segment(attachmentId)}/original?revision=${revision}`, { signal }, response => response.blob());
}
export async function retryGeneralAttachment(sessionId: string, attachmentId: string, revision: number, signal?: AbortSignal) {
  return GeneralAttachmentSchema.parse((await json(`/sessions/${segment(sessionId)}/attachments/${segment(attachmentId)}/retry`, { revision }, signal)).attachment);
}

/** Handles arbitrary UTF-8/chunk boundaries and CRLF, not just one JSON per fetch
 * chunk. Browser EventSource cannot carry the required Authorization header. */
export async function consumeGeneralEventStream(response: Response, sessionId: string, onEvent: (event: PublicEvent) => void, signal?: AbortSignal) {
  if (!response.body) throw new Error("事件连接没有可读内容");
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let text = "", data: string[] = [];
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  const line = (value: string) => {
    if (!value) {
      if (data.length) {
        const value = JSON.parse(data.join("\n")); data = [];
        if (value && typeof value === "object" && "eventId" in value) {
          const event = PublicEventSchema.parse(value);
          if (event.sessionId !== sessionId) throw new ApiError(502, "事件会话不一致", "SESSION_MISMATCH");
          onEvent(event);
        } else if (!(value && Object.keys(value).length === 1 && Number.isSafeInteger(value.cursor) && value.cursor >= 0)) throw new Error("事件连接返回了无效数据");
      }
    } else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = text.indexOf("\n")) >= 0) { line(text.slice(0, end).replace(/\r$/, "")); text = text.slice(end + 1); }
    }
    signal?.throwIfAborted();
    // A disconnected, incomplete event is replayed from the last committed cursor.
  } finally { signal?.removeEventListener("abort", abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function readGeneralEvents(sessionId: string, after: number, onEvent: (event: PublicEvent) => void, signal: AbortSignal) {
  if (!Number.isSafeInteger(after) || after < 0) throw new Error("无效事件位置");
  await request(`/sessions/${segment(sessionId)}/events?after=${after}`, { signal, headers: { Accept: "text/event-stream" } },
    (response, requestSignal) => {
      if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "text/event-stream") throw new Error("事件连接返回格式不正确");
      return consumeGeneralEventStream(response, sessionId, event => {
        requestSignal.throwIfAborted(); onEvent(event);
      }, requestSignal);
    });
}

export async function openDeconstructionConversation(sourceId: string, signal?: AbortSignal) {
  const result = await json(`/sources/${segment(sourceId)}/conversation`, {}, signal);
  return { sessionId: IdSchema.parse(result.sessionId), model: result.model as AgentMessageInput["model"] | undefined };
}
