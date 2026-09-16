import { buildAgentDirective } from "../types/experts";
import type { CreationMode, CreationStrategy } from "../types/creation-loop";
import type { WorkbenchMessageInput } from "./workbench-chat";
import { fetchGeneralSkills } from "./general-agent-api";
import { GeneralAgentDraft } from "./general-agent-draft";

/** Preserve the existing homepage composer while submitting a durable general turn. */
export async function sendHomeAgent(draft: GeneralAgentDraft, input: WorkbenchMessageInput, mode: CreationMode, strategy: CreationStrategy) {
  const pending = draft.getSnapshot().pending;
  if (pending) return draft.send(pending);
  if (!input.model) throw new Error("请先选择一个已配置的模型");
  const catalog = input.summoned.skills.length ? await fetchGeneralSkills() : [];
  const skills = input.summoned.skills.map(skill => {
    const match = catalog.find(item => item.id === skill.id || item.assetId === skill.id);
    if (!match) throw new Error(`所选技能「${skill.name}」当前不可用，请检查订阅或移除后发送`);
    return match;
  });
  const directive = buildAgentDirective(input.summoned.agents);
  draft.setText(directive ? `${directive}\n\n${input.text}` : input.text);
  for (const file of draft.getSnapshot().files) draft.removeFile(file.uploadId);
  if (input.files.length) {
    const files = await Promise.all(input.files.map(async file => {
      const blob = await (await fetch(file.dataUrl)).blob();
      return new File([blob], file.filename, { type: file.mediaType });
    }));
    draft.addFiles(files);
  }
  return draft.send({ model: { service: input.model.service, model: input.model.id },
    selectedSkillAssetIds: skills.map(skill => skill.assetId), selectedSkillVersions: Object.fromEntries(skills.map(skill => [skill.assetId, skill.version])),
    selectedAgentAssetIds: [], capabilityRefs: input.summoned.caps.map(cap => cap.ref), creationMode: mode, creationStrategy: strategy });
}
