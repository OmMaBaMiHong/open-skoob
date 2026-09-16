import { randomBytes, createHash } from 'node:crypto';
import { ApiError, endpoint } from './models.mjs';
import { cloudOptions } from './cloud.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
function origin(value) {
  const base = endpoint(value || 'https://skoob.cc'); const u = new URL(base);
  if (u.pathname !== '/' || u.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw new ApiError(400, 'INVALID_CLOUD_URL', '官方服务请使用 HTTPS 源地址；本机测试可使用 HTTP。');
  return base;
}
async function cloudJson(cfg, path, method = 'GET', payload) {
  let response;
  try { response = await fetch(cfg.baseUrl + '/api/v1' + path, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}), ...(cfg.userId ? { 'X-Skoob-User': cfg.userId } : {}) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); }
  catch { throw new ApiError(502, 'CLOUD_UNAVAILABLE', '无法连接官方平台，请检查地址或稍后重试。'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status === 404 ? 503 : response.status, typeof data?.error === 'string' ? data.error : data?.error?.code || 'CLOUD_REQUEST_FAILED', data?.error?.message || data?.message || (response.status === 404 ? '当前官方服务尚未部署此连接接口，请使用已支持的凭证方式或稍后重试。' : '官方平台拒绝了请求，请检查授权与权益。'));
  if (!data || typeof data !== 'object') throw new ApiError(502, 'INVALID_CLOUD_RESPONSE', '官方平台返回格式不正确');
  return data;
}
export function mountCloudLink(app, store, env, access) {
  const pending = new Map(); const uploads = new Set();
  const cfg = () => cloudOptions(store, env);
  function clearPending() { pending.clear(); }
  async function validate(candidate) {
    const verified = await cloudJson({ baseUrl: candidate.baseUrl }, '/account/verify-key', 'POST', { apiKey: candidate.key });
    if (verified.ok !== true || verified.user?.id === undefined) throw new ApiError(401, 'INVALID_CLOUD_CREDENTIAL', '该凭证不能授权官方平台；普通模型 Key 请放在模型配置中。');
    const userId = String(verified.user.id);
    if (candidate.userId && candidate.userId !== userId) throw new ApiError(401, 'CLOUD_IDENTITY_MISMATCH', '凭证与云端账号不一致，请重新授权。');
    const account = await cloudJson({ ...candidate, userId }, '/account/status');
    if (!account.loggedIn || account.user?.id !== undefined && String(account.user.id) !== userId) throw new ApiError(401, 'CLOUD_LOGIN_REQUIRED', '官方凭证已失效，请重新登录授权。');
    return { userId, username: account.user?.displayName || account.user?.username || verified.user.username || '', email: account.user?.email || verified.user.email || '' };
  }
  function save(candidate, user, method) {
    store.transaction(() => { store.remove('settings', 'freeAccess'); store.secret('cloud', candidate.key); store.set('settings','cloud',{ baseUrl: candidate.baseUrl, userId: user.userId, username: user.username, email: user.email, method, verifiedAt: new Date().toISOString(), disabled: false }); });
    clearPending();
  }
  async function verifiedConfig() {
    const current = cfg(); if (!current.key) throw new ApiError(503, 'CLOUD_NOT_CONFIGURED', '请先连接官方账号或填写有效的官方访问凭证。');
    const account = await cloudJson(current, '/account/status');
    if (!account.loggedIn || !current.userId || account.user?.id !== undefined && String(account.user.id) !== current.userId) throw new ApiError(401, 'CLOUD_LOGIN_REQUIRED', '官方登录已失效，请重新授权。');
    return current;
  }
  app.get('/api/v1/local/cloud', c => { const current = cfg(); const saved = store.get('settings','cloud',{}); return c.json({ baseUrl: current.baseUrl, userId: current.userId, configured: Boolean(current.key), last4: current.key.slice(-4), username: saved.username || '', email: saved.email || '', method: saved.method || 'credential', verifiedAt: saved.verifiedAt || null }); });
  app.put('/api/v1/local/cloud', async c => {
    const b = await c.req.json(); const baseUrl = origin(b.baseUrl);
    if (b.apiKey === '') { store.transaction(() => { store.remove('settings', 'freeAccess'); store.secret('cloud',''); store.set('settings','cloud',{ baseUrl, disabled: true }); }); clearPending(); return c.json({ ok: true }); }
    const current = cfg(); const key = typeof b.apiKey === 'string' ? b.apiKey.trim() : current.baseUrl === baseUrl ? current.key : '';
    if (!key || key.length > 10000) throw new ApiError(400, 'CLOUD_CREDENTIAL_REQUIRED', '请填写有效凭证；更换云端地址后须重新授权。');
    const candidate = { baseUrl, key, userId: typeof b.userId === 'string' ? b.userId.trim() : '' }; const user = await validate(candidate); save(candidate,user,'credential'); return c.json({ ok: true, user });
  });
  app.get('/api/v1/local/cloud/status', async c => {
    const current = await verifiedConfig(); const account = await cloudJson(current,'/account/status'); const membership = await cloudJson(current,'/account/membership');
    return c.json({ connected: true, user: account.user, membership, platformUrl: current.baseUrl, relayUrl: account.sub2apiUrl || 'https://gaotk.com' });
  });
  app.post('/api/v1/local/cloud/authorize', async c => {
    const b = await c.req.json(); const baseUrl = origin(b.baseUrl || cfg().baseUrl); const localOrigin = c.req.header('origin') || new URL(c.req.url).origin; origin(localOrigin);
    for (const [id,item] of pending) if (item.expiresAt <= Date.now() || item.loginId === c.get('loginId')) pending.delete(id);
    const state = randomBytes(32).toString('hex'); const verifier = randomBytes(32).toString('hex'); const expiresAt = Date.now()+600000;
    pending.set(state,{ baseUrl, verifier, loginId: c.get('loginId'), expiresAt });
    const url = new URL(baseUrl+'/site/connect'); url.search = new URLSearchParams({ challenge: digest(verifier), state, origin: localOrigin }).toString();
    return c.json({ state, authorizeUrl: url.href, expiresAt });
  });
  app.post('/api/v1/local/cloud/exchange', async c => {
    const b = await c.req.json(); const flow = pending.get(b.state);
    if (!flow || flow.expiresAt <= Date.now() || flow.loginId !== c.get('loginId')) throw new ApiError(401,'CLOUD_HANDOFF_EXPIRED','连接请求已失效，请重新发起授权。');
    if (flow.exchanging) throw new ApiError(409,'CLOUD_HANDOFF_BUSY','正在完成授权，请勿重复提交。');
    flow.exchanging = true;
    try {
      const auth = await cloudJson({ baseUrl: flow.baseUrl },'/account/self-hosted/exchange','POST',{ code: b.code, verifier: flow.verifier });
      if (typeof auth.token !== 'string' || !auth.userId) throw new ApiError(502,'INVALID_CLOUD_RESPONSE','官方授权没有返回账号身份');
      const candidate = { baseUrl: flow.baseUrl, key: auth.token, userId: String(auth.userId) }; const user = await validate(candidate);
      if (pending.get(b.state) !== flow) throw new ApiError(409,'CLOUD_CONNECTION_CHANGED','连接设置已改变，请重新授权。');
      save(candidate,user,'authorization'); return c.json({ ok:true,user });
    } finally { pending.delete(b.state); }
  });
  const kinds = { agent: { collection:'agentTemplates', route:'/agent-templates' }, skill: { collection:'skills', route:'/skills' } };
  function kindOf(value) { const kind = kinds[value]; if (!kind) throw new ApiError(400,'INVALID_TEMPLATE_KIND','请选择智能体模板或技能'); return kind; }
  app.get('/api/v1/local/cloud/templates', c => c.json({ templates: Object.entries(kinds).flatMap(([type,kind]) => store.list(kind.collection).map(item => ({ id:item.id,type,title:item.zhName || item.name || item.id }))) }));
  app.get('/api/v1/local/cloud/assets/:kind', async c => { kindOf(c.req.param('kind')); await access.requireFree(); const current = await verifiedConfig(); const result = await cloudJson(current,'/capabilities/'+c.req.param('kind')); return c.json({ capabilities:result.capabilities || [],userId:current.userId }); });
  app.post('/api/v1/local/cloud/templates/:kind/:id/upload', async c => {
    const type = c.req.param('kind'); const kind = kindOf(type); const id = c.req.param('id'); const item = store.get(kind.collection,id); if (!item) throw new ApiError(404,'TEMPLATE_NOT_FOUND','本地模板不存在');
    const current = await verifiedConfig(); const mapping = digest(JSON.stringify([current.baseUrl,current.userId,type,id]));
    if (uploads.has(mapping)) throw new ApiError(409,'UPLOAD_BUSY','该模板正在上传'); uploads.add(mapping);
    try {
      const remoteId = 'selfhost-'+mapping.slice(0,40);
      const payload = type === 'agent' ? { id:remoteId,name:item.name || item.zhName || id,zhName:item.zhName,domain:item.domain || 'concept',form:item.form || 'entity',keywords:item.keywords || [],content:item.content || '' } : { id:remoteId,name:item.name || id,description:item.description || '',whenToUse:item.whenToUse || '',triggers:item.triggers || [],body:item.body || item.content || '' };
      if (!(type === 'agent' ? payload.content : payload.body).trim()) throw new ApiError(400,'EMPTY_TEMPLATE','模板正文为空，不能上传');
      await cloudJson(current,kind.route,'POST',payload);
      const catalog = await cloudJson(current,'/capabilities/'+type); const asset = catalog.capabilities?.find(a => a.id === remoteId && String(a.creatorUserId) === current.userId);
      if (!asset?.assetId) throw new ApiError(502,'CLOUD_ASSET_NOT_CONFIRMED','云端已接收内容，但尚未确认资产入库；请重试核对，当前不标记上传成功。');
      const result = { assetId:asset.assetId,remoteId,type,localId:id,title:asset.title,visibility:asset.visibility,uploadedAt:new Date().toISOString() };
      store.set('cloudUploads',mapping,{ ...result,baseUrl:current.baseUrl,userId:current.userId }); return c.json(result);
    } finally { uploads.delete(mapping); }
  });
  app.post('/api/v1/local/cloud/assets/:assetId/publish', async c => {
    const current = await verifiedConfig(); const assetId = c.req.param('assetId');
    const own = store.list('cloudUploads').find(a => String(a.assetId) === assetId && a.baseUrl === current.baseUrl && a.userId === current.userId);
    if (!own) throw new ApiError(403,'CLOUD_ASSET_NOT_OWNED','请先将本地模板上传到当前云端账号');
    const result = await cloudJson(current,'/capabilities/'+encodeURIComponent(assetId)+'/publish','POST',{}); return c.json(result);
  });
}
