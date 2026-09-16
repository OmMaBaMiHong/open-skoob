import type { AgentDestination } from "./general-agent-contracts";
import { fetchGeneralOriginal, fetchGeneralSkills, fetchGeneralSnapshot } from "./general-agent-api";
import type { PendingFile, Summoned } from "../types/composer";
import { MODE_TO_BACKEND } from "../types/creation-loop";
import type { CapabilityRef } from "./api";
import { isPromptRef } from "./prompt-library";

export function destinationPath(destination: AgentDestination) {
  return destination.kind === "deconstruction" ? `/deconstruction/${encodeURIComponent(destination.sourceId)}`
    : destination.mode === "conversation" ? "/conversation" : destination.mode === "film" ? "/film" : "/workbench";
}
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("无法读取创作附件")); reader.readAsDataURL(blob);
});
/** Restore the accepted input from the server so refresh never loses model/files. */
export async function creationNavigationState(sessionId: string, destination: Extract<AgentDestination, { kind: "creation" }>) {
  const snapshot = await fetchGeneralSnapshot(sessionId);
  const input = snapshot.messages.find(message => message.messageId === destination.messageId);
  if (!input) throw new Error("未找到创作请求，请重新连接会话");
  const files: PendingFile[] = await Promise.all(input.parts.flatMap(part => part.type === "resource" && part.ref.kind === "attachment" ? [part.ref] : []).map(async ref => {
    const attachment = snapshot.attachments.find(file => file.id === ref.id && file.revision === ref.revision);
    if (!attachment) throw new Error("创作附件不可读取，请检查原文件");
    const blob = await fetchGeneralOriginal(sessionId, ref.id, ref.revision);
    return { id: ref.id, filename: attachment.filename, mediaType: attachment.mimeType, size: attachment.byteLength,
      dataUrl: await dataUrl(blob), deconstructable: attachment.kind === "text" };
  }));
  const catalog = input.selectedSkillAssetIds.length ? await fetchGeneralSkills() : [];
  const promptRefs = (destination.promptRefs ?? input.capabilityRefs.filter(isPromptRef)).map(ref => ({ kind: ref.kind, id: ref.id }));
  const summoned: Summoned = { skills: input.selectedSkillAssetIds.map(id => {
    const skill = catalog.find(item => item.assetId === id);
    if (!skill) throw new Error("创作所选技能已不可用，请检查订阅状态");
    return { id: skill.id, name: skill.title };
  }), agents: [], caps: input.capabilityRefs.filter(ref => ["genre", "agent-template", "book-team", "book-agent"].includes(ref.kind))
    .map(ref => ({ ref: ref as CapabilityRef, label: ref.id })).concat(promptRefs.map(ref => ({ ref, label: ref.id }))) };
  const model = { id: input.model.model, service: input.model.service, name: input.model.model, serviceLabel: input.model.service };
  return { instruction: destination.instruction, mode: destination.mode, strategy: input.creationStrategy,
    approvalPolicy: MODE_TO_BACKEND[destination.mode].approvalPolicy, promptRefs,
    initialInput: { text: destination.instruction, files, summoned, model },
  };
}
