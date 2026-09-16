import { callAgent, type AgentRequest, type AgentResponse, type AgentEvent, type SessionMessage, type ToolExecution } from "./api";
import { buildAgentDirective } from "../types/experts";
import type { PendingFile, Summoned } from "../types/composer";
import type { ModelChoice } from "../hooks/use-composer-data";

export interface WorkbenchMessageInput {
  readonly text: string;
  readonly summoned: Summoned;
  readonly files: ReadonlyArray<PendingFile>;
  readonly model: ModelChoice | null;
  readonly brainstormCardId?: string;
}

/** 与对话页相同的输入契约：不能把可见的编队、附件和模型选择丢掉。 */
export function workbenchMessageParams(input: WorkbenchMessageInput): Pick<AgentRequest, "instruction" | "requestedSkills" | "capabilityRefs" | "attachments" | "model" | "service" | "brainstormCardId"> {
  const directive = buildAgentDirective(input.summoned.agents);
  const text = input.text.trim() || (input.files.length ? "请查看附件，说明可读取的内容，并询问我希望如何处理；不要自行启动完整拆书或创作。" : "");
  return {
    instruction: directive ? `${directive}\n\n${text}` : text,
    requestedSkills: input.summoned.skills.map((s) => s.id),
    capabilityRefs: input.summoned.caps.map((c) => c.ref),
    attachments: input.files.map(({ id, filename, mediaType, dataUrl }) => ({ id, filename, mediaType, dataUrl })),
    ...(input.model ? { model: input.model.id, service: input.model.service } : {}),
    ...(input.brainstormCardId ? { brainstormCardId: input.brainstormCardId } : {}),
  };
}

export function requireAgentSuccess(response: AgentResponse): AgentResponse {
  if (response.error) throw new Error(response.error.message || "智能体请求失败");
  return response;
}

export async function discussWorkbench(input: WorkbenchMessageInput, sessionId: string, bookId: string, onJob?: (id: string) => void): Promise<AgentResponse> {
  return requireAgentSuccess(await callAgent({
    ...workbenchMessageParams(input), sessionId, activeBookId: bookId,
    sessionKind: "book", background: true,
  }, onJob));
}

export interface CopilotMessage {
  readonly id: string;
  readonly role: "agent" | "user" | "system";
  readonly author?: string;
  readonly content: string;
  readonly toolExecutions?: ReadonlyArray<ToolExecution>;
  readonly error?: string;
}

function toolsFrom(value: ReadonlyArray<unknown> | undefined): ToolExecution[] {
  return (value ?? []).filter((v): v is ToolExecution => !!v && typeof v === "object" && typeof (v as ToolExecution).id === "string" && typeof (v as ToolExecution).tool === "string")
    .map(tool => tool.tool === "novel_loop_error" ? { ...tool, status: "error", error: tool.error || toolResultText(tool.result) || "创作编排失败" } : tool);
}
function mergeTools(previous: ReadonlyArray<ToolExecution> = [], incoming: ReadonlyArray<ToolExecution> = []): ToolExecution[] {
  const all = new Map(previous.map(t => [t.id, t]));
  for (const tool of incoming) all.set(tool.id, { ...all.get(tool.id), ...tool });
  return [...all.values()];
}
export function toolResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const content = (value as { content?: unknown }).content;
  return Array.isArray(content) ? content.flatMap(v => v?.type === "text" && typeof v.text === "string" ? [v.text] : []).join("\n") : "";
}
export function restoreCopilotMessages(messages: ReadonlyArray<SessionMessage>): CopilotMessage[] {
  return messages.map((m, i) => ({ id: `restored-${i}`, role: m.role === "user" ? "user" : "agent", content: m.content, toolExecutions: toolsFrom(m.toolExecutions) }));
}
export function reduceCopilotEvent(message: CopilotMessage, event: AgentEvent, sessionId: string | null): CopilotMessage {
  const d = (event.data ?? {}) as Record<string, unknown>;
  if (!sessionId || d.sessionId !== sessionId) return message;
  if (event.type === "draft:delta" && typeof d.text === "string") return { ...message, content: message.content + d.text };
  if ((event.type === "tool:start" || event.type === "tool:end") && typeof d.id === "string" && typeof d.tool === "string") {
    const tool: ToolExecution = event.type === "tool:start"
      ? { id: d.id, tool: d.tool, ...(typeof d.label === "string" ? { label: d.label } : {}), args: d.args as ToolExecution["args"], status: "running" }
      : { id: d.id, tool: d.tool, status: d.isError ? "error" : "completed", result: toolResultText(d.result), ...(d.isError ? { error: toolResultText(d.result) || "工具执行失败" } : {}) };
    return { ...message, toolExecutions: mergeTools(message.toolExecutions, [tool]) };
  }
  return message;
}
export function finishCopilotMessage(message: CopilotMessage, response: AgentResponse): CopilotMessage {
  requireAgentSuccess(response);
  const tools = mergeTools(message.toolExecutions, response.details?.toolExecutions);
  const content = response.response?.trim() || message.content;
  if (!content && !tools.length) throw new Error("智能体没有返回回复或工具结果，请重试。");
  return { ...message, content, toolExecutions: tools };
}
