import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { Store } from './store.mjs';
import { ApiError, config, presets, serviceId, endpoint, resolveModel, listModels, complete } from './models.mjs';
import { exportBook } from './export.mjs';
import { selectedContext } from './context.mjs';
import { mountFilms } from './film.mjs';
import { mountTheater } from './theater.mjs';
import { mountGeneral } from './general.mjs';
import { Creation } from './creation.mjs';
import { mountCloudLink } from './cloud-link.mjs';
import { cloudOptions, isCloudPath, forwardCloud } from './cloud.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const stamp = () => new Date().toISOString();
const text = (value, name, max = 20000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, 'INVALID_INPUT', `${name}不能为空，且不能超过 ${max} 字符`);
  return value;
};
async function body(c) {
  try { const b = await c.req.json(); if (!b || Array.isArray(b) || typeof b !== 'object') throw new Error(); return b; }
  catch { throw new ApiError(400, 'INVALID_JSON', '请求体必须是 JSON 对象'); }
}

export function createApplication({ dataDir, password, origins = [], cloudEnv = process.env } = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  const store = new Store(dataDir); const app = new Hono();
  let firstRunPassword = null;
  let savedAuth = store.get('settings', 'auth');
  if (!savedAuth || password) {
    const candidate = password || randomBytes(16).toString('base64url');
    if (password && password.length < 10) throw new Error('SKOOB_LOCAL_PASSWORD must have at least 10 characters');
    if (!savedAuth || !timingSafeEqual(Buffer.from(savedAuth.digest, 'hex'), scryptSync(candidate, savedAuth.salt, 32))) {
      const salt = randomBytes(16).toString('hex'); savedAuth = { salt, digest: scryptSync(candidate, salt, 32).toString('hex') };
      store.set('settings', 'auth', savedAuth);
      for (const login of store.list('logins')) store.remove('logins', login.id);
    }
    if (!password) firstRunPassword = candidate;
  }
  const subscribers = new Set(); let closed = false;
  function emit(event, data) {
    if (closed) return;
    const seq = store.get('settings', 'eventSeq', 0) + 1; store.set('settings', 'eventSeq', seq);
    const frame = { id: seq, event, data }; store.set('events', String(seq), frame); if (seq > 1000) store.remove('events', String(seq - 1000));
    for (const fn of subscribers) fn(frame);
  }
  const creation = new Creation(store, emit); const jobs = new Map();
  for (const job of store.list('jobs')) if (['queued', 'running'].includes(job.status)) store.set('jobs', job.id, { ...job, status: 'interrupted', error: '服务已重启；任务结果未确认，请查看已保存内容后手动重试。' });
  for (const book of store.list('books')) if (['running', 'queued'].includes(book.snapshot?.status)) {
    book.snapshot.status = 'paused'; const s = book.snapshot.steps.find(s => s.id === book.snapshot.currentStepId); if (s) s.status = 'paused'; store.set('books', book.id, book);
  }

  const allowedOrigin = (origin, c) => origin === new URL(c.req.url).origin || origins.includes(origin);
  app.use('*', async (c, next) => { c.header('X-Content-Type-Options', 'nosniff'); c.header('Referrer-Policy', 'no-referrer'); c.header('Cache-Control', 'no-store'); await next(); });
  app.use('/api/*', bodyLimit({ maxSize: 90 * 1024 * 1024, onError: c => c.json({ error: { code: 'TOO_LARGE', message: '上传内容过大' } }, 413) }));
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && !allowedOrigin(origin, c)) return c.json({ error: { code: 'ORIGIN_DENIED', message: '此网站来源未获本地服务授权' } }, 403);
    await next();
  });
  app.use('/api/*', cors({ origin: (origin, c) => allowedOrigin(origin, c) ? origin : undefined, credentials: true, allowHeaders: ['Content-Type', 'Authorization', 'X-Skoob-User', 'X-Skoob-Refresh', 'Idempotency-Key', 'X-Upload-Id', 'X-File-Name'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
  app.onError((error, c) => { if (error instanceof SyntaxError || error.name === 'ZodError') return c.json({ error: { code: 'INVALID_INPUT', message: '请求数据格式不正确' } }, 400); return c.json({ error: { code: error.code || 'INTERNAL_ERROR', message: error instanceof ApiError ? error.message : '本地服务执行失败，请查看服务终端并检查输入' } }, error instanceof ApiError ? error.status : 500); });
  app.get('/api/health', c => c.json({ ok: true, mode: 'self-hosted' }));
  app.get('/api/v1/local/info', c => c.json({ mode: 'self-hosted', singleOwner: true }));
  let failedLogins = 0; let loginWindow = Date.now();
  app.post('/api/v1/local/login', async c => {
    if (Date.now() - loginWindow > 60000) { failedLogins = 0; loginWindow = Date.now(); }
    if (failedLogins >= 20) throw new ApiError(429, 'LOGIN_RATE_LIMIT', '尝试过多，请一分钟后重试');
    const b = await body(c); const candidate = typeof b.password === 'string' && b.password.length <= 1024 ? b.password : '';
    if (!timingSafeEqual(Buffer.from(savedAuth.digest, 'hex'), scryptSync(candidate, savedAuth.salt, 32))) { failedLogins++; throw new ApiError(401, 'LOGIN_FAILED', '本地访问密码不正确'); }
    const token = randomBytes(32).toString('base64url'); const id = hash(token); const expiresAt = Date.now() + 7 * 86400000;
    store.set('logins', id, { id, expiresAt }); failedLogins = 0;
    setCookie(c, 'skoob_local', token, { httpOnly: true, sameSite: 'Strict', secure: new URL(c.req.url).protocol === 'https:', path: '/', maxAge: 7 * 86400 });
    return c.json({ token, userId: 'local', expiresAt });
  });
  app.use('/api/v1/*', async (c, next) => {
    const header = c.req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : c.req.path === '/api/v1/events' ? c.req.query('access_token') : getCookie(c, 'skoob_local');
    const auth = token ? store.get('logins', hash(token)) : null;
    if (!auth || auth.expiresAt <= Date.now()) return c.json({ error: { code: 'LOGIN_REQUIRED', message: '请使用本地访问密码登录' } }, 401);
    c.set('loginId', auth.id); await next();
  });
  app.get('/api/v1/account/status', c => c.json({ loggedIn: true, user: { username: '本地工作室', role: 'owner', platformAdmin: false }, expiresAt: null, sub2apiUrl: 'https://gaotk.com' }));
  app.get('/api/v1/account/membership', async c => {
    const cfg = cloudOptions(store, cloudEnv); let cloud = null;
    if (cfg.key && cfg.userId) {
      try {
        const response = await fetch(endpoint(cfg.baseUrl) + '/api/v1/account/membership', { headers: { Authorization: `Bearer ${cfg.key}`, 'X-Skoob-User': cfg.userId }, signal: AbortSignal.timeout(5000), redirect: 'error' });
        if (response.ok) cloud = await response.json();
      } catch { /* Cloud unavailable must never lock local work. */ }
    }
    return c.json({ loggedIn: true, isMember: cloud?.isMember === true, entitlements: Array.isArray(cloud?.entitlements) ? cloud.entitlements : [], plan: cloud?.plan ?? null, expiresAt: cloud?.expiresAt ?? null, stale: Boolean(cfg.key && !cloud) });
  });
  app.post('/api/v1/account/logout', c => { store.remove('logins', c.get('loginId')); deleteCookie(c, 'skoob_local', { path: '/' }); return c.json({ ok: true }); });
  mountCloudLink(app, store, cloudEnv);
  app.get('/api/v1/tianyan/agents', async (c, next) => { if (c.req.query('graphId')) return next(); return c.json({ agents: store.list('agents') }); });
  app.use('/api/v1/*', async (c, next) => { if (isCloudPath(c.req.path)) return forwardCloud(c.req.raw, store, cloudEnv); await next(); });

  function services() {
    const entries = config(store).services; const ids = new Map(presets.map(p => [p.service, { ...p, connected: Boolean(store.secret(p.service)) }]));
    for (const e of entries) { const id = serviceId(e); ids.set(id, { service: id, label: e.name || presets.find(p => p.service === id)?.label || id, group: presets.find(p => p.service === id)?.group || 'custom', connected: Boolean(store.secret(id)) || e.allowNoKey === true }); }
    return [...ids.values()].map(({ baseUrl, ...entry }) => entry);
  }
  app.get('/api/v1/services', c => c.json({ services: services() }));
  app.get('/api/v1/services/config', c => c.json(config(store)));
  async function updateConfig(c) {
    const b = await body(c); const cfg = config(store); const cleared = [];
    if (b.services !== undefined) {
      if (!Array.isArray(b.services) || b.services.length > 100) throw new ApiError(400, 'INVALID_SERVICES', '服务商配置无效');
      for (const e of b.services) {
        text(e.service, 'service', 200); if (e.service === 'custom') text(e.name, '服务名称', 100);
        if (!presets.some(p => p.service === e.service) && e.service !== 'custom') throw new ApiError(400, 'UNKNOWN_PROVIDER', '请通过自定义服务配置此服务商');
        if (e.baseUrl) endpoint(e.baseUrl);
        if (e.models && (!Array.isArray(e.models) || e.models.some(m => typeof m !== 'string'))) throw new ApiError(400, 'INVALID_MODELS', 'models 必须是模型 ID 数组');
        const allowed = Object.fromEntries(['service','name','baseUrl','models','apiFormat','stream','temperature','allowNoKey'].filter(k => e[k] !== undefined).map(k => [k,e[k]]));
        const id = serviceId(e); const index = cfg.services.findIndex(s => serviceId(s) === id);
        if (index < 0) cfg.services.push(allowed); else cfg.services[index] = { ...cfg.services[index], ...allowed };
      }
    }
    if (b.service !== undefined && b.service !== cfg.service && b.defaultModel === undefined) { cfg.defaultModel = null; cleared.push('defaultModel'); }
    if (b.service !== undefined) cfg.service = text(b.service, 'service', 200);
    if (b.defaultModel !== undefined) cfg.defaultModel = text(b.defaultModel, '模型 ID', 256);
    store.set('settings', 'models', cfg); return c.json({ ok: true, cleared });
  }
  app.put('/api/v1/services/config', updateConfig);
  app.get('/api/v1/project/default-model', c => { const cfg = config(store); return c.json({ service: cfg.service, defaultModel: cfg.defaultModel }); });
  app.put('/api/v1/project/default-model', updateConfig);
  app.get('/api/v1/services/models', c => c.json({ groups: services().filter(s => s.connected).map(s => ({ service: s.service, label: s.label, models: (config(store).services.find(e => serviceId(e) === s.service)?.models || store.get('modelCatalogs', s.service, [])).map(m => typeof m === 'string' ? { id: m, name: m } : m) })) }));
  app.get('/api/v1/services/:service/secret', c => { const key = store.secret(c.req.param('service')); return c.json({ configured: Boolean(key), last4: key.length >= 4 ? key.slice(-4) : '' }); });
  app.put('/api/v1/services/:service/secret', async c => { const b = await body(c); if (typeof b.apiKey !== 'string' || b.apiKey.length > 10000) throw new ApiError(400, 'INVALID_KEY', '无效的 API Key'); store.secret(c.req.param('service'), b.apiKey.trim()); return c.json({ ok: true }); });
  app.get('/api/v1/services/:service/models', async c => {
    const id = c.req.param('service'); const e = config(store).services.find(e => serviceId(e) === id);
    const saved = e?.models || store.get('modelCatalogs', id);
    if (saved && c.req.query('refresh') !== '1') return c.json({ models: saved.map(m => typeof m === 'string' ? { id: m, name: m } : m) });
    const models = await listModels(store, id); store.set('modelCatalogs', id, models); return c.json({ models });
  });
  app.post('/api/v1/services/:service/test', async c => {
    try { const b = await body(c); const models = await listModels(store, c.req.param('service'), b); store.set('modelCatalogs', c.req.param('service'), models); return c.json({ ok: true, modelCount: models.length, models, selectedModel: models[0]?.id, detected: { apiFormat: b.apiFormat || 'chat', stream: b.stream !== false, ...(b.baseUrl ? { baseUrl: endpoint(b.baseUrl) } : {}) } }); }
    catch (error) { return c.json({ ok: false, error: error instanceof ApiError ? error.message : '连接失败，请检查服务地址和网络' }, 400); }
  });
  app.delete('/api/v1/services/:service', c => {
    const id = c.req.param('service'); const cfg = config(store); cfg.services = cfg.services.filter(e => serviceId(e) !== id);
    if (cfg.service === id) { cfg.service = null; cfg.defaultModel = null; }
    store.transaction(() => { store.set('settings', 'models', cfg); store.secret(id, ''); store.remove('modelCatalogs', id); }); return c.json({ ok: true });
  });
  app.get('/api/v1/project', c => { const cfg = config(store); const e = cfg.services.find(e => serviceId(e) === cfg.service); return c.json({ model: cfg.defaultModel, provider: cfg.service, baseUrl: e?.baseUrl, stream: e?.stream ?? true, temperature: e?.temperature }); });
  app.get('/api/v1/project/model-overrides', c => c.json({ overrides: store.get('settings', 'overrides', {}) }));
  app.put('/api/v1/project/model-overrides', async c => { const b = await body(c); if (!b.overrides || Array.isArray(b.overrides) || typeof b.overrides !== 'object') throw new ApiError(400, 'INVALID_OVERRIDES', '模型路由必须是对象'); store.set('settings', 'overrides', b.overrides); return c.json({ ok: true }); });
  app.get('/api/v1/project/route-purposes', c => c.json({ purposes: ['worldview','title_synopsis','outline','chapter_plan','planner','composer','writer','auditor','reviser','settler'].map(id => ({ id, label: id, description: '本地创作步骤的默认模型', needsStrong: false })) }));

  function chapterList(id) { return store.list('chapters').filter(ch => ch.bookId === id).sort((a, b) => a.number - b.number); }
  function summary(book) { const { snapshot, instruction, model, autoRun, ...base } = book; return { ...base, chaptersWritten: chapterList(book.id).length, creationLoop: { loopId: snapshot.workflowId, status: snapshot.status === 'succeeded' ? 'done' : snapshot.status === 'failed' ? 'error' : snapshot.status, strategy: 'fast' } }; }
  function bookDetail(book) { return { book: { ...summary(book), creationLoop: { loopId: book.snapshot.workflowId, status: book.snapshot.status, strategy: 'fast', snapshot: book.snapshot } }, chapters: chapterList(book.id).map(({ content, ...c }) => c), nextChapter: chapterList(book.id).length + 1, truth: book.snapshot.steps.filter(s => s.output && s.type !== 'chapter_write').map(s => ({ name: `${s.id}.json`, size: JSON.stringify(s.output).length, preview: JSON.stringify(s.output).slice(0, 200) })), sessions: store.list('sessions').filter(s => s.bookId === book.id).map(s => ({ sessionId: s.sessionId, messageCount: s.messages.length, updatedAt: s.updatedAt })) }; }
  app.get('/api/v1/books', c => c.json({ books: store.list('books').map(summary) }));
  app.post('/api/v1/books/create', async c => { const b = await body(c); const book = creation.create(b, null, b.blurb || ''); return c.json({ status: 'ready', bookId: book.id }); });
  app.get('/api/v1/books/:id', c => c.json(bookDetail(creation.book(c.req.param('id')))));
  app.put('/api/v1/books/:id', async c => { const b = await body(c); const book = creation.book(c.req.param('id')); if (b.title) book.title = text(b.title, '书名', 120); if (b.genre) book.genre = text(b.genre, '题材', 120); creation.save(book); return c.json({ ok: true, book: summary(book) }); });
  app.delete('/api/v1/books/:id', async c => { const id = c.req.param('id'); await creation.pause(id); store.transaction(() => { store.remove('books', id); for (const ch of chapterList(id)) store.remove('chapters', `${id}:${ch.number}`); for (const s of store.list('sessions').filter(s => s.bookId === id)) store.remove('sessions', s.sessionId); }); return c.json({ ok: true }); });
  app.get('/api/v1/books/:id/create-status', c => { creation.book(c.req.param('id')); return c.json({ status: 'ready' }); });
  app.get('/api/v1/books/:id/chapters/:num', c => { const id = c.req.param('id'); creation.book(id); const ch = store.get('chapters', `${id}:${Number(c.req.param('num'))}`); if (!ch) throw new ApiError(404, 'CHAPTER_NOT_FOUND', '章节不存在'); return c.json(ch); });
  app.put('/api/v1/books/:id/chapters/:num', async c => { const id = c.req.param('id'); creation.book(id); if (creation.running.has(id)) throw new ApiError(409, 'BOOK_BUSY', '请先暂停创作再编辑'); const n = Number(c.req.param('num')); if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'INVALID_CHAPTER', '章节号无效'); const b = await body(c); const content = text(b.content, '正文', 2000000); store.set('chapters', `${id}:${n}`, { bookId: id, number: n, title: b.title || `第 ${n} 章`, content, wordCount: [...content].filter(c => !/\s/u.test(c)).length, status: 'draft', updatedAt: stamp() }); const book = creation.book(id); const step = book.snapshot.steps.find(s => s.id === `chapter_write-${n}`); if (step?.output) { step.output = { ...step.output, content, wordCount: [...content].filter(c => !/\s/u.test(c)).length, summary: '本章已由作者修改，连续性以上一章正文为准。' }; step.version++; creation.save(book); } return c.json({ ok: true }); });
  app.get('/api/v1/books/:id/export', c => { const id = c.req.param('id'); const book = creation.book(id); const format = c.req.query('format') || 'txt'; const output = exportBook(book, chapterList(id), format); c.header('Content-Type', output.mime); c.header('Content-Disposition', `attachment; filename="skoob-${id}.${format}"; filename*=UTF-8''${encodeURIComponent(book.title)}.${format}`); return c.body(output.body); });
  app.get('/api/v1/books/:id/creation-loop-state', c => { const book = creation.book(c.req.param('id')); return c.json({ loopId: book.snapshot.workflowId, snapshot: book.snapshot, strategy: 'fast', pipelineState: null, hasSimulation: false, executionModel: book.model }); });
  app.get('/api/v1/books/:id/creation-loop/:loopId', c => { const book = creation.book(c.req.param('id')); if (book.snapshot.workflowId !== c.req.param('loopId')) throw new ApiError(404, 'LOOP_NOT_FOUND', '创作流程不存在'); return c.json({ snapshot: book.snapshot }); });
  app.get('/api/v1/books/:id/creation-preview', c => { const book = creation.book(c.req.param('id')); const stepId = c.req.query('stepId') || book.snapshot.currentStepId; return c.json({ activity: store.get('activities', `${book.id}:${stepId}`), preview: null, outline: null }); });
  app.post('/api/v1/books/:id/creation-loop/pause', async c => c.json({ snapshot: await creation.pause(c.req.param('id')) }));
  app.post('/api/v1/books/:id/creation-loop/resume', async c => { const id = c.req.param('id'); const b = await body(c); const book = creation.book(id); if (b.service && b.model) book.model = { service: b.service, model: b.model }; if (book.snapshot.status === 'awaiting_review') throw new ApiError(409, 'REVIEW_REQUIRED', '请先确认或重写当前步骤'); creation.save(book); creation.start(id); return c.json({ snapshot: creation.book(id).snapshot }); });
  app.post('/api/v1/books/:id/creation-loop/regenerate', async c => { const b = await body(c); return c.json({ snapshot: await creation.regenerate(c.req.param('id'), b.stepId, b.feedback) }); });
  app.get('/api/v1/books/:id/creation-loop/auto-run', c => c.json({ autoRun: creation.book(c.req.param('id')).autoRun }));
  app.put('/api/v1/books/:id/creation-loop/auto-run', async c => { const b = await body(c); const id = c.req.param('id'); const book = creation.book(id); book.autoRun = b.autoRun === true; creation.save(book); let resumed = false; if (book.autoRun && book.snapshot.status === 'awaiting_review') { creation.confirm(id, book.snapshot.currentStepId); creation.start(id); resumed = true; } return c.json({ autoRun: book.autoRun, resumed }); });
  app.put('/api/v1/books/:id/creation-mode', async c => { const b = await body(c); if (!['guided', 'conversation'].includes(b.creationMode)) throw new ApiError(400, 'INVALID_MODE', '请选择引导或剧场模式'); const book = creation.book(c.req.param('id')); book.creationMode = b.creationMode; creation.save(book); return c.json({ bookId: book.id, creationMode: book.creationMode }); });
  app.get('/api/v1/books/:id/truth/:file', c => { const book = creation.book(c.req.param('id')); const s = book.snapshot.steps.find(s => `${s.id}.json` === c.req.param('file')); if (!s?.output) throw new ApiError(404, 'FILE_NOT_FOUND', '设定文件不存在'); return c.json({ content: JSON.stringify(s.output, null, 2) }); });
  app.put('/api/v1/books/:id/truth/:file', async c => { const book = creation.book(c.req.param('id')); const s = book.snapshot.steps.find(s => `${s.id}.json` === c.req.param('file')); if (!s) throw new ApiError(404, 'FILE_NOT_FOUND', '设定文件不存在'); if (creation.running.has(book.id)) throw new ApiError(409, 'BOOK_BUSY', '请先暂停创作再编辑'); const b = await body(c); try { s.output = JSON.parse(b.content); } catch { throw new ApiError(400, 'INVALID_JSON', '请保留 JSON 设定格式'); } creation.save(book); return c.json({ ok: true }); });

  function session(id) { const s = store.get('sessions', id); if (!s) throw new ApiError(404, 'SESSION_NOT_FOUND', '会话不存在'); return s; }
  app.get('/api/v1/sessions', c => c.json({ sessions: store.list('sessions').filter(s => !c.req.query('bookId') || s.bookId === c.req.query('bookId')) }));
  app.post('/api/v1/sessions', async c => { const b = await body(c); if (b.bookId) creation.book(b.bookId); const s = { sessionId: randomUUID(), bookId: b.bookId || null, title: null, sessionKind: b.sessionKind || 'chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() }; store.set('sessions', s.sessionId, s); return c.json({ session: s }); });
  app.get('/api/v1/sessions/:id', c => c.json({ session: session(c.req.param('id')) }));
  app.delete('/api/v1/sessions/:id', c => { session(c.req.param('id')); store.remove('sessions', c.req.param('id')); return c.json({ ok: true }); });
  async function agent(input, signal) {
    const s = session(input.sessionId);
    if (input.creationStrategy === 'simulate' || input.creationStrategy === 'orchestrate') throw new ApiError(409, 'CLOUD_WORKFLOW_REQUIRED', '仿真创作由官方天衍服务提供。请到云端入口使用，或选择本地快速直出。');
    const instruction = text(input.instruction, '创作要求');
    s.messages.push({ role: 'user', content: instruction, timestamp: Date.now() }); store.set('sessions', s.sessionId, s);
    let result;
    if (input.requestedIntent === 'create_book') {
      const cb = input.actionPayload?.createBook;
      if (!cb) throw new ApiError(400, 'INTENT_REQUIRED', '缺少确认的建书意图卡');
      const selected = resolveModel(store, input);
      const book = creation.create({ ...cb, creationMode: input.creationMode }, { service: selected.service, model: selected.model }, s.creationBrief || instruction);
      book.autoRun = input.approvalPolicy === 'auto'; store.set('books', book.id, book); s.bookId = book.id; s.sessionKind = 'book';
      emit('book:created', { bookId: book.id, sessionId: s.sessionId }); creation.start(book.id);
      result = { response: '作品已建立，开始生成世界观。', creationLoop: { bookId: book.id, loopId: book.snapshot.workflowId }, session: { sessionId: s.sessionId, sessionKind: 'book', activeBookId: book.id } };
    } else if (input.requestedIntent === 'loop_review') {
      const loop = input.actionPayload?.loop; const book = creation.book(input.activeBookId);
      if (!loop || loop.loopId !== book.snapshot.workflowId || (s.bookId && s.bookId !== book.id)) throw new ApiError(409, 'LOOP_MISMATCH', '步骤与当前作品不匹配');
      if (loop.decision === 'retry') await creation.regenerate(book.id, loop.stepId, loop.feedback || instruction);
      else { creation.confirm(book.id, loop.stepId); creation.start(book.id); }
      result = { response: loop.decision === 'retry' ? '已开始重新生成。' : '已确认，继续下一步。', snapshot: creation.book(book.id).snapshot };
    } else if (s.sessionKind === 'book-create' && !s.bookId) {
      s.creationBrief = [instruction, selectedContext(store, input)].filter(Boolean).join('\n\n');
      result = await creation.propose({ ...input, instruction: s.creationBrief }, signal, delta => emit('intent:delta', { sessionId: s.sessionId, text: delta, structured: true }));
    }
    else {
      const book = s.bookId ? creation.book(s.bookId) : null;
      const context = book ? '\n作品上下文：' + creation.context(book, { id: 'discussion' }) : '';
      const response = await complete(store, input, [{ role: 'system', content: '你是用户的本地创作助手，帮助讨论、写作与修改。不要声称执行了未调用的四大引擎。' + context + '\n' + selectedContext(store, input) }, ...s.messages.slice(-20).map(m => ({ role: m.role, content: m.content }))], { signal, onDelta: delta => emit('draft:delta', { sessionId: s.sessionId, text: delta }) });
      result = { response };
    }
    s.messages.push({ role: 'assistant', content: result.response || '', toolExecutions: result.details?.toolExecutions || [], timestamp: Date.now() }); s.updatedAt = Date.now();
    store.set('sessions', s.sessionId, s); emit('agent:complete', { sessionId: s.sessionId }); return result;
  }
  app.post('/api/v1/agent', async c => c.json(await agent(await body(c), c.req.raw.signal)));
  app.post('/api/v1/agent/jobs', async c => {
    const b = await body(c); session(b.sessionId); const idempotency = c.req.header('Idempotency-Key');
    if (idempotency) { const previous = store.get('jobKeys', idempotency); if (previous) return c.json({ jobId: previous.id }); }
    const id = randomUUID(); const controller = new AbortController();
    store.set('jobs', id, { id, sessionId: b.sessionId, status: 'running' }); if (idempotency) store.set('jobKeys', idempotency, { id });
    const work = agent(b, controller.signal).then(response => store.set('jobs', id, { id, sessionId: b.sessionId, status: 'completed', response, httpStatus: 200 })).catch(error => store.set('jobs', id, { id, sessionId: b.sessionId, status: 'completed', response: { error: { code: error.code || 'TASK_FAILED', message: controller.signal.aborted ? '任务已取消' : error.message } }, httpStatus: error.status || 500 })).finally(() => { jobs.delete(id); emit('agent:job', { jobId: id, sessionId: b.sessionId }); });
    jobs.set(id, { controller, work, sessionId: b.sessionId }); return c.json({ jobId: id }, 202);
  });
  app.get('/api/v1/agent/jobs/:id', c => { const job = store.get('jobs', c.req.param('id')); if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', '任务不存在'); return c.json(job); });
  app.post('/api/v1/agent/jobs/:id/cancel', c => { const job = jobs.get(c.req.param('id')); job?.controller.abort(); return c.json({ cancelled: Boolean(job) }); });
  app.post('/api/v1/sessions/:id/abort', async c => { const s = session(c.req.param('id')); for (const job of jobs.values()) if (job.sessionId === s.sessionId) job.controller.abort(); const b = await body(c); if (b.scope !== 'chat' && s.bookId) await creation.pause(s.bookId); return c.json({ ok: true }); });
  app.get('/api/v1/events', c => streamSSE(c, async stream => {
    const after = Number(c.req.query('after') || 0); const bookId = c.req.query('book');
    const send = frame => { if (!bookId || frame.data?.bookId === bookId || frame.data?.sessionId) void stream.writeSSE({ id: String(frame.id), event: frame.event, data: JSON.stringify(frame.data) }).catch(() => {}); };
    for (const frame of store.list('events').filter(e => e.id > after).slice(-500)) send(frame);
    subscribers.add(send); let timer;
    await new Promise(resolve => { timer = setInterval(() => void stream.writeSSE({ event: 'heartbeat', data: '{}' }).catch(resolve), 15000); stream.onAbort(resolve); });
    clearInterval(timer); subscribers.delete(send);
  }));

  // Local editable libraries start empty; these are persisted collections, not cloud catalog replicas.
  for (const [path, collection, key] of [['skills','skills','skills'], ['agent-templates','agentTemplates','templates'], ['genres','genres','genres']]) {
    app.get(`/api/v1/${path}`, c => c.json({ [key]: store.list(collection) }));
    app.post(`/api/v1/${path}`, async c => { const b = await body(c); const id = typeof b.id === 'string' ? b.id : randomUUID(); const value = { ...b, id, isMine: true, editable: true, source: 'project' }; store.set(collection, id, value); return c.json({ ok: true, id, [key.slice(0, -1)]: value }); });
    app.put(`/api/v1/${path}/:id`, async c => { const b = await body(c); store.set(collection, c.req.param('id'), { ...b, id: c.req.param('id'), isMine: true, editable: true, source: 'project' }); return c.json({ ok: true }); });
    app.delete(`/api/v1/${path}/:id`, c => { store.remove(collection, c.req.param('id')); return c.json({ ok: true }); });
  }
  app.get('/api/v1/skills/store', c => c.json({ skills: store.list('skills') }));
  app.post('/api/v1/skills/:id/install', c => { store.set('installedSkills', c.req.param('id'), { id: c.req.param('id') }); return c.json({ ok: true }); });
  app.post('/api/v1/skills/:id/uninstall', c => { store.remove('installedSkills', c.req.param('id')); return c.json({ ok: true }); });
  app.get('/api/v1/agent-prototypes', c => c.json({ prototypes: store.list('agentTemplates').map(t => ({ id: t.id, kind: 'agent', name: t.name, role: t.domain || '', tags: t.keywords || [], description: t.content || '', assetId: t.id })) }));
  app.get('/api/v1/agents', c => c.json({ agents: store.list('agents') }));
  app.get('/api/v1/graph/agents', c => c.json({ agents: store.list('agents') }));
  app.get('/api/v1/chat/sessions', c => c.json({ sessions: [] }));
  app.get('/api/v1/official-personas', c => c.json({ personas: [] }));
  app.get('/api/v1/user-agent', c => c.json({ agent: store.get('settings', 'userAgent', { name: '我的智能体', username: 'local', bio: '', persona: '', style: '', plotParticipation: 0, enabled: true, owner: 'local', updatedAt: stamp() }) }));
  app.put('/api/v1/user-agent', async c => { const agent = { ...await body(c), owner: 'local', updatedAt: stamp() }; store.set('settings', 'userAgent', agent); return c.json({ agent }); });
  app.get('/api/v1/prompt-library', c => c.json({ templates: store.list('promptTemplates'), routes: [], agents: [], steps: { writing: {}, deconstruction: {}, style: { style: '写作风格' } } }));
  app.get('/api/v1/capabilities', c => c.json({ skills: store.list('skills'), templates: store.list('agentTemplates'), installed: store.list('installedSkills').map(x => x.id) }));
  mountFilms(app, store);
  mountTheater(app, store, creation, emit);
  const closeGeneral = mountGeneral(app, store);
  app.notFound(c => c.json({ error: { code: 'NOT_FOUND', message: '本地接口不存在' } }, 404));
  return { app, store, creation, firstRunPassword, async close() { await closeGeneral(); for (const job of jobs.values()) job.controller.abort(); await Promise.allSettled([...jobs.values()].map(j => j.work)); await creation.close(); closed = true; subscribers.clear(); store.close(); } };
}
