import { TERMINAL_RUN_STATUSES, type GeneralSessionSnapshot, type PublicEvent, type RunStatus } from "./general-agent-contracts";

type Message = Extract<PublicEvent, { type: "message" }>["payload"] & { runId: string };
type Tool = Extract<PublicEvent, { type: "tool" }>["payload"] & { runId: string };
type Question = Extract<PublicEvent, { type: "question" }>["payload"];
type Progress = Extract<PublicEvent, { type: "status" }>["payload"]["progress"];
export interface GeneralAgentState {
  sessionId: string; cursor: number; messages: Message[]; tools: Record<string, Tool>; questions: Record<string, Question>;
  runs: Record<string, { id: string; status: RunStatus; summary: string; cancelRequested: boolean; progress?: Progress }>;
  artifacts: GeneralSessionSnapshot["artifacts"]; attachments: GeneralSessionSnapshot["attachments"];
  inputs: GeneralSessionSnapshot["messages"]; applied: Record<string, "current_turn" | "next_task">;
  seen: Set<string>; buffered: Record<number, PublicEvent>; cancelling: Set<string>;
}
export function emptyGeneralAgentState(sessionId: string): GeneralAgentState {
  return { sessionId, cursor: 0, messages: [], tools: {}, questions: {}, runs: {}, artifacts: [], attachments: [], inputs: [], applied: {}, seen: new Set(), buffered: {}, cancelling: new Set() };
}
const upsert = <T>(items: T[], value: T, key: (item: T) => string) => items.some(item => key(item) === key(value))
  ? items.map(item => key(item) === key(value) ? value : item) : [...items, value];

function applyEvent(state: GeneralAgentState, event: PublicEvent): GeneralAgentState {
  const next = { ...state, cursor: event.seq, seen: new Set(state.seen).add(event.eventId) };
  switch (event.type) {
    case "message": next.messages = upsert(state.messages, { ...event.payload, runId: event.runId }, item => item.messageId); break;
    case "tool": next.tools = { ...state.tools, [`${event.runId}:${event.payload.callId}`]: {
      ...state.tools[`${event.runId}:${event.payload.callId}`], ...event.payload, runId: event.runId,
    } }; break;
    case "artifact": next.artifacts = upsert(state.artifacts, event.payload.artifact, item => `${item.id}:${item.revision}`); break;
    case "question": next.questions = { ...state.questions, [event.runId]: event.payload }; break;
    case "input_applied": next.applied = { ...state.applied, [event.payload.messageId]: event.payload.appliedTo }; break;
    case "status": {
      const terminal = TERMINAL_RUN_STATUSES.has(event.payload.status);
      const cancelling = state.cancelling.has(event.runId) && !terminal;
      next.runs = { ...state.runs, [event.runId]: { id: event.runId, status: cancelling ? "cancelling" : event.payload.status,
        summary: cancelling ? "正在停止" : event.payload.summary, cancelRequested: cancelling || event.payload.status === "cancelling", progress: event.payload.progress } };
      if (terminal) { next.cancelling = new Set(state.cancelling); next.cancelling.delete(event.runId); }
      if (event.payload.status !== "waiting_user") { next.questions = { ...state.questions }; delete next.questions[event.runId]; }
    }
  }
  return next;
}

/** Advance only over contiguous, session-owned events. A transport reconnect
 * starts from cursor, never from the highest out-of-order event received. */
export function receiveGeneralEvent(state: GeneralAgentState, event: PublicEvent): GeneralAgentState {
  if (event.sessionId !== state.sessionId || event.seq <= state.cursor || state.seen.has(event.eventId)) return state;
  let next = { ...state, buffered: { ...state.buffered, [event.seq]: event } };
  while (next.buffered[next.cursor + 1]) {
    const pending = next.buffered[next.cursor + 1]!;
    const buffered = { ...next.buffered }; delete buffered[pending.seq];
    next = { ...applyEvent(next, pending), buffered };
  }
  return next;
}

export function hydrateGeneralSnapshot(state: GeneralAgentState, snapshot: GeneralSessionSnapshot): GeneralAgentState {
  if (state.sessionId !== snapshot.sessionId || snapshot.cursor < state.cursor) return state;
  let next = emptyGeneralAgentState(snapshot.sessionId);
  for (const event of [...snapshot.events].sort((a, b) => a.seq - b.seq)) next = receiveGeneralEvent(next, event);
  if (next.cursor !== snapshot.cursor) throw new Error("会话事件不完整，请重新连接");
  next.inputs = snapshot.messages; next.attachments = snapshot.attachments; next.artifacts = snapshot.artifacts;
  next.runs = Object.fromEntries(snapshot.runs.map(run => [run.id, { ...run,
    ...(next.runs[run.id]?.status === run.status ? { progress: next.runs[run.id]?.progress } : {}) }]));
  next.cancelling = new Set([...state.cancelling].filter(id => !TERMINAL_RUN_STATUSES.has(next.runs[id]?.status ?? "queued")));
  for (const id of next.cancelling) if (next.runs[id]) next.runs[id] = { ...next.runs[id]!, status: "cancelling", summary: "正在停止", cancelRequested: true };
  for (const event of Object.values(state.buffered)) next = receiveGeneralEvent(next, event);
  return next;
}

export function confirmGeneralCancellation(state: GeneralAgentState, runId: string, status: RunStatus): GeneralAgentState {
  const run = state.runs[runId]; if (!run) return state;
  if (TERMINAL_RUN_STATUSES.has(run.status) && !TERMINAL_RUN_STATUSES.has(status)) return state;
  const cancelling = new Set(state.cancelling);
  if (status === "cancelling") cancelling.add(runId); else cancelling.delete(runId);
  return { ...state, cancelling, runs: { ...state.runs, [runId]: { ...run, status, cancelRequested: true,
    summary: status === "cancelling" ? "正在停止" : status === "cancelled" ? "已停止" : run.summary } } };
}
