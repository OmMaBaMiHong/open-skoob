import { selectedContext } from './context.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { ApiError, complete, resolveModel } from './models.mjs';

const id = z.string().min(1).max(256);
const inputSchema = z.object({
  messageId: id, sessionId: id,
  parts: z.array(z.union([z.object({ type: z.literal('text'), text: z.string().max(1048576) }).strict(), z.object({ type: z.literal('resource'), ref: z.object({ kind: z.literal('attachment'), id, revision: z.number().int().positive() }).strict() }).strict()])).min(1).max(32),
  model: z.object({ service: id, model: id }).strict(), selectedSkillAssetIds: z.array(id).max(64), selectedAgentAssetIds: z.array(id).max(64),
  selectedSkillVersions: z.record(z.string(), z.number().int().positive()).optional(),
  capabilityRefs: z.array(z.object({ kind: id, id }).strict()).max(64), creationStrategy: z.enum(['fast', 'simulate']), creationMode: z.enum(['guided', 'conversation', 'film']).optional(), officialPersonaId: id.optional(),
}).strict();
const stamp = () => new Date().toISOString();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function mountGeneral(app, store, material) {
  const base = '/api/v1/general-agent'; const running = new Map(); const listeners = new Set(); let closing = false;
  const get = sid => { const s = store.get('generalSessions', sid); if (!s) throw new ApiError(404, 'SESSION_NOT_FOUND', '会话不存在'); return s; };
  const save = s => { s.updatedAt = stamp(); store.set('generalSessions', s.sessionId, s); };
  const add = (s, runId, type, payload) => { const event = { eventId: randomUUID(), sessionId: s.sessionId, runId, seq: ++s.cursor, createdAt: stamp(), type, payload }; s.events.push(event); save(s); for (const notify of listeners) notify(s.sessionId); };
  const attachment = (sid, aid) => { const a = store.get('attachments', aid); if (!a || a.sessionId !== sid) throw new ApiError(404, 'ATTACHMENT_NOT_FOUND', '附件不存在'); return a; };
  for (const s of store.list('generalSessions')) {
    for (const run of s.runs.filter(r => ['running', 'queued', 'cancelling'].includes(r.status))) { run.status = 'interrupted'; run.summary = '服务重启，请确认已保存内容后重新发送'; add(s, run.id, 'status', { status: run.status, summary: run.summary }); }
  }
  app.post(base + '/sessions', async c => {
    const b = await c.req.json(); const key = id.parse(b.clientRequestId); const existing = store.get('generalRequestIds', key);
    if (existing) return c.json({ sessionId: existing });
    const sid = randomUUID(); store.transaction(() => { save({ sessionId: sid, title: '新对话', sessionKind: 'general', cursor: 0, messages: [], runs: [], events: [], artifacts: [], attachments: [] }); store.set('generalRequestIds', key, sid); }); return c.json({ sessionId: sid });
  });
  app.get(base + '/sessions', c => c.json({ sessions: store.list('generalSessions').sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(s => ({ id: s.sessionId, title: s.title, updatedAt: s.updatedAt, kind: 'general', status: s.runs.at(-1)?.status || 'succeeded' })), nextCursor: null }));
  app.get(base + '/sessions/:id', c => { const { title, updatedAt, ...snapshot } = get(c.req.param('id')); return c.json(snapshot); });
  app.get(base + '/sessions/:id/events', c => {
    const sid = get(c.req.param('id')).sessionId; let cursor = Number(c.req.query('after') || 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new ApiError(400, 'INVALID_CURSOR', '无效事件位置');
    return streamSSE(c, async stream => {
      let wake; const notify = changed => { if (changed === sid || closing) wake?.(); };
      listeners.add(notify); stream.onAbort(() => wake?.());
      try {
        while (!closing && !stream.aborted) {
          const current = get(sid);
          for (const event of current.events.filter(e => e.seq > cursor)) { await stream.writeSSE({ data: JSON.stringify(event) }); cursor = event.seq; }
          await stream.writeSSE({ data: JSON.stringify({ cursor }) });
          if (get(sid).cursor > cursor) continue;
          if (closing || stream.aborted) break;
          await new Promise(resolve => { const timer = setTimeout(done, 15000); function done() { clearTimeout(timer); wake = undefined; resolve(); } wake = done; });
        }
      } finally { listeners.delete(notify); }
    });
  });
  app.get(base + '/skills', c => c.json({ skills: store.list('skills').map(s => ({ assetId: s.id, id: s.id, title: s.name || s.title || s.id, description: s.description || '', version: 1, creatorName: '本地工作室' })) }));
  app.get(base + '/sessions/:id/attachments', c => c.json({ attachments: get(c.req.param('id')).attachments }));
  app.post(base + '/sessions/:id/attachments', async c => {
    const s = get(c.req.param('id')); const uploadId = id.parse(c.req.header('X-Upload-Id')); const aid = digest([s.sessionId, uploadId]);
    const bytes = Buffer.from(await c.req.arrayBuffer()); if (bytes.length > 80 * 1024 * 1024) throw new ApiError(413, 'RESOURCE_LIMIT', '文件不能超过 80 MiB');
    const previous = store.get('attachments', aid); if (previous) { if (previous.digest !== digest(bytes.toString('base64'))) throw new ApiError(409, 'UPLOAD_CONFLICT', '同一上传标识的内容不同'); return c.json({ attachment: previous.meta }); }
    const filename = decodeURIComponent(c.req.header('X-File-Name') || 'attachment.txt').slice(0,512);
    let content; try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (content.includes('\0')) content = undefined; } catch { /* Preserve original binary; do not invent extracted text. */ }
    const readable = /\.(txt|md|json|csv|log|xml|html|yaml|yml)$/i.test(filename) && content !== undefined;
    const meta = { id: aid, revision: 1, filename, mimeType: readable ? 'text/plain' : 'application/octet-stream', byteLength: bytes.length, status: readable ? 'ready' : 'failed', ...(readable ? { kind: 'text', charCount: content.length, encoding: 'utf-8' } : { error: { code: 'TEXT_REQUIRED', message: '本地附件支持 UTF-8 文本、Markdown、JSON、CSV；请将此文件转换为文本后上传。' } }) };
    store.set('attachments', aid, { sessionId: s.sessionId, meta, original: bytes.toString('base64'), content: readable ? content : null, digest: digest(bytes.toString('base64')) }); s.attachments.push(meta); save(s); return c.json({ attachment: meta });
  });
  app.get(base + '/sessions/:id/attachments/:aid/original', c => { const a = attachment(c.req.param('id'), c.req.param('aid')); c.header('Content-Type', a.meta.mimeType); c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.meta.filename)}`); return c.body(Buffer.from(a.original, 'base64')); });
  app.post(base + '/sessions/:id/messages', async c => {
    const parsed = inputSchema.safeParse(await c.req.json()); if (!parsed.success) throw new ApiError(400, 'INVALID_MESSAGE', '消息或附件格式不正确');
    const input = parsed.data; const s = get(c.req.param('id')); if (input.sessionId !== s.sessionId) throw new ApiError(409, 'SESSION_MISMATCH', '会话不一致');
    const existing = store.get('generalMessages', input.messageId); if (existing) { if (existing.digest !== digest(input)) throw new ApiError(409, 'MESSAGE_CONFLICT', '消息标识已被不同内容使用'); return c.json(existing.receipt); }
    if (running.has(s.sessionId)) throw new ApiError(409, 'SESSION_BUSY', '请等待当前回复，或先停止生成');
    if (input.creationStrategy === 'simulate' || input.capabilityRefs.some(r => ['source','engine'].includes(r.kind))) throw new ApiError(409, 'CLOUD_TOOL_REQUIRED', '此操作需要官方引擎，请从对应云端工具入口使用。普通对话和基础创作可直接使用自选模型。');
    resolveModel(store, input.model);
    const resourceText = input.parts.filter(p => p.type === 'resource').map(p => { const a = attachment(s.sessionId, p.ref.id); if (a.meta.revision !== p.ref.revision || a.meta.status !== 'ready') throw new ApiError(409, 'ATTACHMENT_NOT_READY', '附件尚不能读取'); return `附件 ${a.meta.filename}：\n${a.content}`; });
    const selected = await selectedContext(store, { requestedSkills: input.selectedSkillAssetIds, capabilityRefs: [...input.capabilityRefs, ...input.selectedAgentAssetIds.map(id => ({ kind: 'template', id }))] }, material);
    const prompt = input.parts.filter(p => p.type === 'text').map(p => p.text).join('\n'); if (!prompt.trim() && !resourceText.length) throw new ApiError(400, 'EMPTY_MESSAGE', '请填写内容');
    const run = { id: randomUUID(), status: 'running', summary: '正在调用你选定的模型', revision: 1, cancelRequested: false }; s.runs.push(run); s.messages.push({ ...input, state: 'applied' });
    if (s.messages.length === 1) s.title = prompt.slice(0,40) || '附件对话';
    add(s, run.id, 'message', { messageId: input.messageId, role: 'user', parts: input.parts, final: true }); add(s, run.id, 'status', { status: run.status, summary: run.summary });
    add(s, run.id, 'input_applied', { messageId: input.messageId, appliedTo: 'current_turn' });
    const receipt = { messageId: input.messageId, runId: run.id, status: run.status }; store.set('generalMessages', input.messageId, { digest: digest(input), receipt });
    const controller = new AbortController();
    const history = s.events.filter(e => e.type === 'message' && e.payload.final && e.payload.messageId !== input.messageId).slice(-20).map(e => ({ role: e.payload.role, content: e.payload.parts.filter(p => p.type === 'text').map(p => p.text).join('\n') }));
    const assistantId = randomUUID(); let accumulated = ''; let lastPartial = 0;
    const work = complete(store, input.model, [{ role: 'system', content: '你是本地创作助手，帮助写作和分析用户提供的资料。没有调用工具时不要声称调用四大引擎、联网检索或修改了作品。\n用户自定义能力：' + selected }, ...history, { role: 'user', content: [prompt, ...resourceText].join('\n\n') }], { signal: controller.signal, onDelta: delta => { accumulated += delta; if (Date.now() - lastPartial < 1000) return; lastPartial = Date.now(); const current = get(s.sessionId); add(current, run.id, 'message', { messageId: assistantId, role: 'assistant', parts: [{ type: 'text', text: accumulated }], final: false }); } })
      .then(answer => { const current = get(s.sessionId); add(current, run.id, 'message', { messageId: assistantId, role: 'assistant', parts: [{ type: 'text', text: answer }], final: true }); const r = current.runs.find(r => r.id === run.id); r.status = 'succeeded'; r.summary = '已完成'; r.revision++; add(current, run.id, 'status', { status: r.status, summary: r.summary }); })
      .catch(error => { const current = get(s.sessionId); const r = current.runs.find(r => r.id === run.id); r.status = controller.signal.aborted ? 'cancelled' : 'failed'; r.summary = controller.signal.aborted ? '已停止，已生成内容保留在会话中' : error instanceof ApiError ? error.message : '模型调用失败，请检查服务连接'; r.revision++; add(current, run.id, 'status', { status: r.status, summary: r.summary }); })
      .finally(() => running.delete(s.sessionId));
    running.set(s.sessionId, { controller, work, runId: run.id }); return c.json(receipt, 202);
  });
  app.post(base + '/runs/:id/cancel', c => { const target = [...running.entries()].find(([,r]) => r.runId === c.req.param('id')); if (!target) { const run = store.list('generalSessions').flatMap(s => s.runs).find(r => r.id === c.req.param('id')); if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', '任务不存在'); return c.json({ status: run.status }); } const [sid, r] = target; const s = get(sid); const run = s.runs.find(x => x.id === r.runId); run.cancelRequested = true; save(s); r.controller.abort(); return c.json({ status: 'cancelling' }); });
  return async () => { closing = true; for (const notify of listeners) notify(); for (const r of running.values()) r.controller.abort(); await Promise.allSettled([...running.values()].map(r => r.work)); };
}
