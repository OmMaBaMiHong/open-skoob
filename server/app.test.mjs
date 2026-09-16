import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const implementation = await import('./app.mjs').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw e;
});

async function fixture(t, options = {}) {
  assert.equal(typeof implementation.createApplication, 'function', 'standalone backend must exist');
  const dir = mkdtempSync(join(tmpdir(), 'skoob-local-test-'));
  let app = implementation.createApplication({ dataDir: dir, ...options });
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const login = await app.app.request('/api/v1/local/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Skoob-Local': '1' }, body: JSON.stringify({}) });
  assert.equal(login.status, 200);
  const auth = await login.json();
  const request = (path, method = 'GET', body, extra = {}) => app.app.request('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Skoob-Local': '1', Authorization: `Bearer ${auth.token}`, 'X-Skoob-User': auth.userId, ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const json = async (path, method, body, extra) => { const r = await request(path, method, body, extra); const b = await r.json(); assert.ok(r.ok, JSON.stringify(b)); return b; };
  return { request, json, auth, get app() { return app; }, restart: async () => { await app.close(); app = implementation.createApplication({ dataDir: dir, ...options }); } };
}

test('local deployment protects credentials and retains books, chapters and configuration after restart', async t => {
  const f = await fixture(t);
  assert.equal((await f.app.app.request('/api/v1/books')).status, 401);
  assert.equal((await f.app.app.request('/api/v1/local/session', { method: 'POST' })).status, 403);
  assert.equal((await f.app.app.request('http://evil.example/api/v1/local/session', { method: 'POST', headers: { 'X-Skoob-Local': '1' } })).status, 403);
  assert.equal((await f.app.app.request('/api/v1/local/session', { method: 'POST', headers: { 'X-Skoob-Local': '1', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await f.request('/books/create', 'POST', { title: 'forged' }, { Origin: 'https://evil.example' })).status, 403);
  const created = await f.json('/books/create', 'POST', { title: '本地故事', genre: '悬疑', targetChapters: 2, chapterWordCount: 2000 });
  await f.json(`/books/${created.bookId}/chapters/1`, 'PUT', { content: '第一章，真正保存在本地的内容。', title: '开篇' });
  await f.json('/services/custom:owned/secret', 'PUT', { apiKey: 'test-key-1234' });
  await f.json('/services/config', 'PUT', { services: [{ service: 'custom', name: 'owned', baseUrl: 'http://127.0.0.1:9876/v1', models: ['chosen'] }], service: 'custom:owned', defaultModel: 'chosen' });
  await f.restart();
  assert.equal((await f.json('/books')).books[0].title, '本地故事');
  assert.equal((await f.json(`/books/${created.bookId}/chapters/1`)).content, '第一章，真正保存在本地的内容。');
  assert.equal((await f.json('/services/config')).defaultModel, 'chosen');
  assert.deepEqual(await f.json('/services/custom:owned/secret'), { configured: true, last4: '1234' });
  assert.ok(!(JSON.stringify(await f.json('/services/config'))).includes('test-key'));
  await f.json('/services/custom:owned', 'DELETE');
  await f.restart();
  assert.equal((await f.json('/services')).services.some(s => s.service === 'custom:owned'), false);
  assert.equal((await f.request('/books/unknown')).status, 404);
});

test('six-step creation uses only the chosen provider, preserves reviews and writes exportable chapters', async t => {
  const calls = [];
  const upstream = createServer(async (req, res) => {
    let text = ''; for await (const part of req) text += part;
    if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'chosen' }] })); return; }
    const body = JSON.parse(text); calls.push({ path: req.url, auth: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    const system = body.messages?.[0]?.content ?? '';
    const payload = system.includes('意图卡') ? { title: '雨夜来信', titleCandidates: ['雨夜来信'], genre: '悬疑', synopsis: '寻找失踪的信使', targetChapters: 1, chapterWordCount: 1000 }
      : system.includes('JSON') ? { storyFrame: '雨夜追踪', worldSettings: '港口城', bookRules: '事实一致', title: '雨夜来信', synopsis: '寻找信使', volumeMap: '第一卷：发现来信', pendingHooks: '信使身份', summary: '开篇', outline: '第1章：来信', content: '雨落在信封上。他推开门，发现失踪信使留下的最后一封信。' }
      : '他读完来信，知道自己必须在天亮之前赶往港口。';
    res.end(JSON.stringify({ choices: [{ message: { content: typeof payload === 'string' ? payload : JSON.stringify(payload) } }], usage: { total_tokens: 40 } }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const f = await fixture(t);
  const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  await f.json('/services/custom:chosen/secret', 'PUT', { apiKey: 'own-key' });
  await f.json('/services/config', 'PUT', { service: 'custom:chosen', defaultModel: 'chosen', services: [{ service: 'custom', name: 'chosen', baseUrl, models: ['chosen'], stream: false }] });
  const { session } = await f.json('/sessions', 'POST', { sessionKind: 'book-create' });
  const proposal = await f.json('/agent', 'POST', { sessionId: session.sessionId, sessionKind: 'book-create', instruction: '写一个雨夜送信的悬疑故事', service: 'custom:chosen', model: 'chosen', creationStrategy: 'fast' });
  const intent = proposal.details.toolExecutions.find(x => x.tool === 'propose_action').args.createBook;
  const created = await f.json('/agent', 'POST', { sessionId: session.sessionId, requestedIntent: 'create_book', actionSource: 'button', actionPayload: { createBook: intent }, instruction: '写一个雨夜送信的悬疑故事', creationStrategy: 'fast' });
  const id = created.creationLoop.bookId;
  async function settled() {
    for (let n = 0; n < 100; n++) { const state = await f.json(`/books/${id}/creation-loop-state`); if (!['running', 'queued'].includes(state.snapshot.status)) return state; await new Promise(r => setTimeout(r, 10)); }
    assert.fail('creation did not settle');
  }
  for (let n = 0; n < 5; n++) {
    const state = await settled(); assert.equal(state.snapshot.status, 'awaiting_review');
    await f.json('/agent', 'POST', { sessionId: session.sessionId, activeBookId: id, requestedIntent: 'loop_review', actionPayload: { loop: { loopId: state.loopId, stepId: state.snapshot.currentStepId, decision: 'confirm' } }, instruction: '确认' });
  }
  assert.equal((await settled()).snapshot.status, 'succeeded');
  const chapter = await f.json(`/books/${id}/chapters/1`);
  assert.ok(chapter.content.includes('来信'));
  assert.ok((await (await f.request(`/books/${id}/export?format=txt`)).text()).includes(chapter.content));
  assert.ok(calls.length >= 6);
  assert.ok(calls.every(c => c.path === '/v1/chat/completions' && c.auth === 'Bearer own-key' && c.body.model === 'chosen'));
  const { sessionId } = await f.json('/general-agent/sessions', 'POST', { clientRequestId: 'chat-after-book' });
  const message = { sessionId, messageId: 'first-chat', parts: [{ type: 'text', text: '请续写来信的故事' }], model: { service: 'custom:chosen', model: 'chosen' }, selectedSkillAssetIds: [], selectedAgentAssetIds: [], capabilityRefs: [], creationStrategy: 'fast' };
  const run = await f.json(`/general-agent/sessions/${sessionId}/messages`, 'POST', message);
  assert.equal((await f.json(`/general-agent/sessions/${sessionId}/messages`, 'POST', message)).runId, run.runId);
  let general;
  for (let n = 0; n < 100; n++) { general = await f.json(`/general-agent/sessions/${sessionId}`); if (general.runs[0].status === 'succeeded') break; await new Promise(r => setTimeout(r, 10)); }
  assert.equal(general.runs[0].status, 'succeeded');
  assert.deepEqual(general.events.map(e => e.seq), Array.from({ length: general.cursor }, (_,i) => i+1));
  assert.ok(general.events.some(e => e.type === 'message' && e.payload.role === 'assistant' && e.payload.final));
  assert.ok(general.events.some(e => e.type === 'input_applied' && e.payload.messageId === message.messageId && e.payload.appliedTo === 'current_turn'));
  assert.equal((await f.request(`/general-agent/sessions/${sessionId}/messages`, 'POST', { ...message, parts: [{ type: 'text', text: 'different' }] })).status, 409);
  const group = (await f.json(`/books/${id}/theater/groups`, 'POST', { title: '灯塔讨论', memberNames: ['信使'], chapter: null })).group;
  await f.json(`/books/${id}/theater/groups/${group.id}/messages`, 'POST', { content: '下一步去哪里？' });
  assert.equal((await f.json(`/books/${id}/theater/groups/${group.id}/reply`, 'POST', { content: '下一步去哪里？', max: 1 })).replies[0].name, '信使');
  await f.restart();
  assert.equal((await f.json(`/books/${id}/creation-loop-state`)).snapshot.status, 'succeeded');
  assert.equal((await f.json(`/sessions/${session.sessionId}`)).session.messages.length > 0, true);
});

test('general sessions are idempotent and survive restart', async t => {
  const f = await fixture(t);
  const first = await f.json('/general-agent/sessions', 'POST', { clientRequestId: 'once' });
  assert.equal((await f.json('/general-agent/sessions', 'POST', { clientRequestId: 'once' })).sessionId, first.sessionId);
  await f.restart();
  const snapshot = await f.json(`/general-agent/sessions/${first.sessionId}`);
  assert.equal(snapshot.sessionKind, 'general');
  assert.equal(snapshot.cursor, 0);
  assert.deepEqual(snapshot.messages, []);
});

test('general event connections stay open when caught up and can be cancelled', async t => {
  const f = await fixture(t);
  const { sessionId } = await f.json('/general-agent/sessions', 'POST', { clientRequestId: 'stream' });
  assert.equal((await f.request(`/general-agent/sessions/${sessionId}/events?after=-1`)).status, 400);
  const response = await f.request(`/general-agent/sessions/${sessionId}/events?after=0`);
  assert.ok(response.headers.get('content-type').startsWith('text/event-stream'));
  const reader = response.body.getReader();
  assert.ok(new TextDecoder().decode((await reader.read()).value).includes('"cursor":0'));
  let settled = false; const next = reader.read().then(value => { settled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(settled, false, 'idle connection must not trigger browser reconnect errors');
  await reader.cancel(); assert.equal((await next).done, true);
});

test('cloud engines require explicit credentials and never run a local fallback', async t => {
  const f = await fixture(t);
  for (const path of ['/deai/detect', '/tianmo/inspiration/plan', '/tianyan/pipeline/initial', '/tianwang/retrieve']) {
    const r = await f.request(path, 'POST', { content: 'text' });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, 'CLOUD_NOT_CONFIGURED');
  }
});


test('cloud lifecycle preserves upstream task IDs and separates local and cloud credentials', async t => {
  const calls = [];
  const upstream = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/account/verify-key') { res.end(JSON.stringify({ok:true,user:{id:'cloud-owner'}})); return; }
    if (req.url === '/api/v1/account/status') { res.end(JSON.stringify({loggedIn:true,user:{id:'cloud-owner'}})); return; }
    calls.push({ path: req.url, authorization: req.headers.authorization, user: req.headers['x-skoob-user'], cookie: req.headers.cookie, body });
    res.setHeader('Set-Cookie', 'cloud-secret=must-not-forward');
    res.end(JSON.stringify({ id: 'remote-123', status: 'paused' }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => upstream.close(resolve)));
  const f = await fixture(t);
  await f.json('/local/cloud', 'PUT', { baseUrl: `http://127.0.0.1:${upstream.address().port}`, apiKey: 'cloud-only-key', userId: 'cloud-owner' });
  for (const [path, method] of [['/tianyan/pipeline/initial', 'POST'], ['/tianyan/simulations/remote-123?access_token=local-secret&uid=local', 'GET'], ['/tianyan/simulations/remote-123/pause', 'POST'], ['/tianyan/simulations/remote-123/resume', 'POST']]) {
    const r = await f.request(path, method, method === 'POST' ? { id: 'remote-123' } : undefined); assert.equal(r.status, 200); assert.equal(r.headers.get('set-cookie'), null); assert.equal((await r.json()).id, 'remote-123');
  }
  assert.equal(calls.length, 4); assert.ok(calls.every(c => c.authorization === 'Bearer cloud-only-key' && c.user === 'cloud-owner' && !c.cookie && !c.path.includes('local-secret')));
  assert.equal((await f.request('/tianyan/admin/settings')).status, 403);
  await f.restart(); assert.equal((await f.json('/local/cloud')).configured, true);
  await f.json('/local/cloud', 'PUT', { apiKey: '' }); assert.equal((await f.request('/deai/detect', 'POST', {})).status, 503);
});

test('film analysis detects broken links, unreachable branches and cycles instead of inventing successful paths', async () => {
  const { analyzeGraph } = await import('./film.mjs');
  const graph = { variables: [], nodes: [{ id: 'a', type: 'start', choices: [{ targetNodeId: 'b' }] }, { id: 'b', type: 'ending', choices: [] }], endings: [{ id: 'end', nodeId: 'b' }] };
  assert.equal(analyzeGraph(graph).distribution.total, 1);
  assert.equal(analyzeGraph(graph).report.ok, true);
  assert.equal(analyzeGraph({ ...graph, nodes: [{ ...graph.nodes[0], choices: [{ targetNodeId: 'missing' }] }, graph.nodes[1]] }).report.ok, false);
  assert.equal(analyzeGraph({ ...graph, nodes: [{ ...graph.nodes[0], choices: [{ targetNodeId: 'a' }] }] }).distribution.truncated, true);
});

test('a truncated model stream is not accepted as a completed chapter', async t => {
  const upstream = createServer((req,res) => { res.setHeader('Content-Type','text/event-stream'); res.end('data: {"choices":[{"delta":{"content":"未完成的正文"}}]}\n\n'); });
  await new Promise(resolve => upstream.listen(0,'127.0.0.1',resolve)); t.after(() => new Promise(resolve => upstream.close(resolve)));
  const f = await fixture(t); await f.json('/services/custom:stream/secret','PUT',{ apiKey:'test-key' });
  await f.json('/services/config','PUT',{service:'custom:stream',defaultModel:'chosen',services:[{service:'custom',name:'stream',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,stream:true}]});
  const { complete } = await import('./models.mjs');
  await assert.rejects(complete(f.app.store,{},[{role:'user',content:'继续写作'}],{onDelta:()=>{}}), error => error.code === 'MODEL_STREAM_INCOMPLETE');
});


test('EPUB export is a real archive with escaped text and a navigation manifest', async () => {
  const { exportBook } = await import('./export.mjs'); const { unzipSync, strFromU8 } = await import('fflate');
  const book = { id: 'test', title: '灯塔 & 来信', language: 'zh' }; const chapters = [{ number: 1, title: '第一章', content: '<script>文字</script>\n另一段' }];
  const output = exportBook(book, chapters, 'epub'); const files = unzipSync(output.body);
  assert.equal(output.mime, 'application/epub+zip'); assert.equal(strFromU8(files.mimetype), 'application/epub+zip');
  assert.ok(strFromU8(files['OEBPS/content.opf']).includes('灯塔 &amp; 来信'));
  assert.ok(strFromU8(files['OEBPS/chapter-1.xhtml']).includes('&lt;script&gt;文字&lt;/script&gt;'));
  assert.ok(strFromU8(files['OEBPS/nav.xhtml']).includes('chapter-1.xhtml'));
  assert.ok(exportBook(book, chapters, 'md').body.startsWith('# 灯塔'));
});


test('text attachments persist, duplicate upload IDs cannot replace data, and binary content is not pretended to be readable', async t => {
  const f = await fixture(t); const {sessionId} = await f.json('/general-agent/sessions','POST',{clientRequestId:'files'});
  const upload = (key,filename,bytes) => f.app.app.request(`/api/v1/general-agent/sessions/${sessionId}/attachments`,{method:'POST',headers:{Authorization:`Bearer ${f.auth.token}`,'X-Upload-Id':key,'X-File-Name':encodeURIComponent(filename)},body:bytes});
  const first = await upload('text','灯塔.txt','午夜灯塔响起钟声'); assert.equal(first.status,200); const {attachment} = await first.json(); assert.equal(attachment.status,'ready');
  assert.equal((await upload('text','灯塔.txt','不同的内容')).status,409);
  assert.equal((await (await upload('binary','book.pdf',new Uint8Array([0,255,3]))).json()).attachment.status,'failed');
  await f.restart(); const list = await f.json(`/general-agent/sessions/${sessionId}/attachments`); assert.equal(list.attachments.length,2);
  const original = await f.request(`/general-agent/sessions/${sessionId}/attachments/${attachment.id}/original?revision=1`); assert.equal(await original.text(),'午夜灯塔响起钟声');
  await f.json('/services/custom:encrypted/secret','PUT',{apiKey:'never-store-me-as-plaintext'});
  assert.ok(!JSON.stringify(f.app.store.get('secrets','custom:encrypted')).includes('never-store-me-as-plaintext'));
});
