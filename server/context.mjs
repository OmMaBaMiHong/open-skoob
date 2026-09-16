import { ApiError } from './models.mjs';

// User-selected local material only; this is not an implicit cloud retrieval step.
export function selectedContext(store, input) {
  const items = [];
  for (const id of input.requestedSkills || input.summonedSkillIds || []) {
    const skill = store.get('skills', id); if (!skill) throw new ApiError(404, 'SKILL_NOT_FOUND', '所选本地技能不存在'); items.push(JSON.stringify(skill));
  }
  for (const ref of input.capabilityRefs || []) {
    const collection = { genre: 'genres', template: 'agentTemplates', 'agent-template': 'agentTemplates', 'prompt-template': 'promptTemplates', 'prompt-template-once': 'promptTemplates', skill: 'skills' }[ref.kind];
    if (!collection) throw new ApiError(409, 'CLOUD_ASSET_REQUIRED', '所选能力需要云端服务，请先通过对应入口连接');
    const item = store.get(collection, ref.id); if (!item) throw new ApiError(404, 'ASSET_NOT_FOUND', '所选本地能力不存在'); items.push(JSON.stringify(item));
  }
  for (const a of input.attachments || []) {
    if (!/\.(txt|md|json|csv|log|xml|html|yaml|yml)$/i.test(a.filename || '') || typeof a.dataUrl !== 'string') throw new ApiError(400, 'TEXT_ATTACHMENT_REQUIRED', '本地创作附件支持 UTF-8 文本，请将该文件转换为文本后上传');
    const match = a.dataUrl.match(/^data:[^,]*;base64,(.*)$/s); if (!match) throw new ApiError(400, 'ATTACHMENT_INVALID', '附件编码不正确');
    try { const content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(match[1], 'base64')); items.push(`附件 ${a.filename}：\n${content}`); } catch { throw new ApiError(400, 'ATTACHMENT_ENCODING', '请使用 UTF-8 文本附件'); }
  }
  const result = items.join('\n\n'); if (result.length > 200000) throw new ApiError(413, 'CONTEXT_TOO_LARGE', '本次附加材料超过 20 万字符，请按章节拆分'); return result;
}
