import { randomUUID } from 'node:crypto';
import { ApiError, complete } from './models.mjs';

export function mountTheater(app, store, creation, emit) {
  const base = '/api/v1/books/:id/theater';
  const groups = bookId => store.list('theaterGroups').filter(g => g.bookId === bookId);
  const group = (bookId, id) => { creation.book(bookId); const g = store.get('theaterGroups', id); if (!g || g.bookId !== bookId) throw new ApiError(404, 'GROUP_NOT_FOUND', '群聊不存在'); return g; };
  const messages = g => store.get('theaterMessages', g.id, []);
  const dto = g => ({ uid: g.id, bookId: g.bookId, kind: 'custom', title: g.title, stage: g.stage, chapter: g.chapter, memberNames: g.memberNames, lastSeq: messages(g).length, unreadCount: 0, updatedAt: new Date(g.updatedAt).toISOString() });
  function append(g, b) {
    if (typeof b.content !== 'string' || !b.content.trim()) throw new ApiError(400, 'EMPTY_MESSAGE', '消息不能为空');
    const list = messages(g); const m = { id: list.length + 1, seq: list.length + 1, senderKind: b.senderKind || 'user', senderRef: b.senderRef || 'local', senderName: b.senderName || '作者', content: b.content, action: 'say', round: null, meta: b.meta || {}, createdAt: new Date().toISOString() };
    list.push(m); store.set('theaterMessages', g.id, list); g.updatedAt = Date.now(); store.set('theaterGroups', g.id, g); emit('theater:message', { bookId: g.bookId, groupId: g.id, sessionUid: g.id, message: m }); return m;
  }
  async function create(c, modern) { const id = c.req.param('id'); creation.book(id); const b = await c.req.json(); if (!Array.isArray(b.memberNames) || b.memberNames.length > 50 || b.memberNames.some(n => typeof n !== 'string')) throw new ApiError(400, 'INVALID_MEMBERS', '成员格式不正确'); const g = { id: randomUUID(), bookId: id, title: b.title || '自建群聊', memberNames: b.memberNames, stage: b.stage || 'discussion', chapter: b.chapter ?? null, createdAt: Date.now(), updatedAt: Date.now() }; store.set('theaterGroups', g.id, g); return c.json(modern ? { session: dto(g) } : { group: g }); }
  app.get(base + '/sessions', c => { creation.book(c.req.param('id')); return c.json({ sessions: groups(c.req.param('id')).map(dto) }); });
  app.post(base + '/chat-groups', c => create(c, true));
  app.get(base + '/sessions/:gid/messages', c => c.json({ messages: messages(group(c.req.param('id'), c.req.param('gid'))).filter(m => m.seq > Number(c.req.query('afterSeq') || 0)) }));
  app.post(base + '/sessions/:gid/messages', async c => c.json({ message: append(group(c.req.param('id'), c.req.param('gid')), await c.req.json()) }));
  app.post(base + '/sessions/:gid/read', c => { group(c.req.param('id'), c.req.param('gid')); return c.json({ ok: true }); });
  app.get(base + '/groups', c => { creation.book(c.req.param('id')); const all = groups(c.req.param('id')); return c.json({ groups: all, messages: Object.fromEntries(all.map(g => [g.id, messages(g).map(m => ({ ...m, senderId: m.senderRef, kind: m.senderKind === 'user' ? 'user' : 'system', createdAt: Date.parse(m.createdAt) }))])) }); });
  app.post(base + '/groups', c => create(c, false));
  app.delete(base + '/groups/:gid', c => { const g = group(c.req.param('id'), c.req.param('gid')); store.remove('theaterGroups', g.id); store.remove('theaterMessages', g.id); return c.json({ ok: true }); });
  app.post(base + '/groups/:gid/messages', async c => { const b = await c.req.json(); const m = append(group(c.req.param('id'), c.req.param('gid')), { ...b, senderKind: b.kind === 'system' ? 'agent' : 'user', senderRef: b.senderId }); return c.json({ message: { ...m, senderId: m.senderRef, kind: b.kind || 'user', createdAt: Date.parse(m.createdAt) } }); });
  app.post(base + '/groups/:gid/reply', async c => {
    const g = group(c.req.param('id'), c.req.param('gid')); const b = await c.req.json(); const book = creation.book(g.bookId); const replies = [];
    const chosen = (Array.isArray(b.mentions) && b.mentions.length ? g.memberNames.filter(n => b.mentions.includes(n)) : g.memberNames).slice(0, Math.min(Number(b.max) || 3, 8));
    for (const name of chosen) { const content = await complete(store, book.model || {}, [{ role: 'system', content: `扮演作者自建群中的角色「${name}」，依据作品上下文自然回话。这是作者讨论群，不是天衍仿真结果。\n${creation.context(book, { id: 'discussion' })}` }, ...messages(g).slice(-12).map(m => ({ role: m.senderKind === 'user' ? 'user' : 'assistant', content: `${m.senderName}：${m.content}` })), { role: 'user', content: b.content || '请接着讨论。' }], { signal: c.req.raw.signal }); replies.push({ name, content, reason: '自建群角色回话' }); append(g, { content, senderKind: 'agent', senderName: name, senderRef: name }); }
    return c.json({ replies });
  });
  app.post('/api/v1/books/:id/user-agent', c => { const b = creation.book(c.req.param('id')); b.userAgentEnabled = true; creation.save(b); return c.json({ ok: true }); });
  app.delete('/api/v1/books/:id/user-agent', c => { const b = creation.book(c.req.param('id')); b.userAgentEnabled = false; creation.save(b); return c.json({ ok: true }); });
}
