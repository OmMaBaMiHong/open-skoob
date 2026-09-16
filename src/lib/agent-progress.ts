import { CREATION_STEP_LABELS_ZH, stepTypeOf, type WorkflowSnapshot } from "../types/creation-loop";
import type { AgentEvent } from "./api";
export interface AgentProgressItem { id: string; label: string; status: "running" | "done" | "error" }
export interface AgentProgress { items: AgentProgressItem[]; active: boolean }
export const EMPTY_PROGRESS: AgentProgress = { items: [], active: false };
export function reduceAgentProgress(previous: AgentProgress, event: AgentEvent, sessionId: string | null): AgentProgress {
  const data = (event.data ?? {}) as Record<string, unknown>;
  if (!sessionId || data.sessionId !== sessionId) return previous;
  // Raw thinking deltas are never rendered. Only public execution metadata is used.
  if (event.type === "thinking:delta") return previous;
  let item: AgentProgressItem | undefined;
  if (event.type === "agent:start") return { active: true, items: [{ id: "request", label: "已接收请求，正在整理思路", status: "running" }] };
  if (event.type === "thinking:start") item = { id: "thinking", label: "正在整理思路与下一步操作", status: "running" };
  if (event.type === "thinking:end") item = { id: "thinking", label: "已完成本轮思考", status: "done" };
  if (event.type === "tool:start" || event.type === "tool:end") {
    const id = `tool:${String(data.id ?? data.tool ?? "current")}`;
    const label = typeof data.label === "string" ? data.label : typeof data.tool === "string" ? data.tool : "执行创作任务";
    item = { id, label: previous.items.find(i => i.id === id)?.label ?? label, status: event.type === "tool:start" ? "running" : data.isError ? "error" : "done" };
  }
  if (event.type === "llm:progress") {
    const count = typeof data.totalChars === "number" && Number.isFinite(data.totalChars) ? Math.max(0, Math.floor(data.totalChars)) : 0;
    item = { id: "output", label: count > 0 ? `正在生成内容 · 已输出 ${count} 字符` : "正在等待模型响应", status: "running" };
  }
  if (["agent:complete", "agent:aborted", "agent:error"].includes(event.type)) {
    const failed = event.type !== "agent:complete";
    return { active: false, items: previous.items.map(i => i.status === "running" ? { ...i, status: failed ? "error" : "done" } : i) };
  }
  if (!item) return previous;
  return { active: previous.active || item.status === "running", items: [...previous.items.filter(i => i.id !== item!.id), item].slice(-20) };
}

export function withWorkflowProgress(progress: AgentProgress, snapshot: WorkflowSnapshot | null): AgentProgress {
  if (!snapshot?.currentStepId) return progress;
  const step = snapshot.steps.find(s => s.id === snapshot.currentStepId);
  const type = stepTypeOf(snapshot.currentStepId);
  if (!step || !type || type === "anchor") return progress;
  const running = snapshot.status === "running" || snapshot.status === "queued";
  return { active: progress.active || running, items: [...progress.items.filter(i => i.id !== "workflow"), {
    id: "workflow", label: `${CREATION_STEP_LABELS_ZH[type]} · ${running ? "六师正在处理" : snapshot.status === "awaiting_review" ? "等待你确认" : step.status === "failed" ? "执行失败，可重试" : "进度已保存"}`,
    status: running ? "running" : step.status === "failed" ? "error" : "done",
  }] };
}
