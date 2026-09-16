import { createHash } from 'node:crypto';
import { ApiError, config, endpoint, serviceId } from './models.mjs';
import { cloudOptions } from './cloud.mjs';

// These are user endpoints, never administrator endpoints. Tokens stay server-side.
export function freeAccess(store, env) {
  async function json(base, path, token, userId) {
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}`, ...(userId ? { 'X-Skoob-User': userId } : {}) }, redirect: 'error', signal: AbortSignal.timeout(10000) }); break; }
      catch { if (attempt === 1) throw new ApiError(502, 'FREE_VERIFY_UNAVAILABLE', '暂时无法验证官方 Free Key，请稍后重试。本地创作不受影响。'); }
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.code !== undefined && body.code !== 0) throw new ApiError([401, 403].includes(response.status) ? 403 : 502, body?.error?.code || 'FREE_VERIFY_FAILED', body?.error?.message || '官方账号或 Key 校验失败，请重新授权或刷新密钥。');
    if (!body) throw new ApiError(502, 'FREE_VERIFY_FAILED', '官方服务返回格式不正确');
    return body.data ?? body;
  }
  async function account() {
    const cfg = cloudOptions(store, env);
    if (!cfg.key || !cfg.userId) throw new ApiError(403, 'FREE_KEY_REQUIRED', '请先连接官方账号，领取并选择 Free Key 后查看云端列表。');
    const info = await json(endpoint(cfg.baseUrl), '/api/v1/account/status', cfg.key, cfg.userId);
    if (!info.loggedIn || String(info.user?.id) !== cfg.userId) throw new ApiError(403, 'CLOUD_LOGIN_REQUIRED', '官方登录已失效，请重新授权。');
    const relay = endpoint(info.sub2apiUrl || 'https://gaotk.com');
    const url = new URL(relay);
    if (url.pathname !== '/' || url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new ApiError(502, 'INVALID_RELAY_URL', '官方返回的中转站地址无效');
    return { ...cfg, relay };
  }
  function eligible(key, cfg) {
    return key && String(key.user_id) === cfg.userId && key.status === 'active'
      && (!key.expires_at || Date.parse(key.expires_at) > Date.now())
      && key.group?.status === 'active' && key.group?.name === 'openskoob-free'
      && key.group?.rate_multiplier === 0 && key.group_id === key.group?.id && typeof key.key === 'string' && key.key.length > 0;
  }
  const metadata = (k, cfg) => ({ id: String(k.id), name: k.name, last4: k.key?.slice(-4) || '', group: k.group?.name || '', eligible: eligible(k, cfg), status: k.status, expiresAt: k.expires_at });
  function unchanged(cfg) {
    const now = cloudOptions(store, env);
    if (now.key !== cfg.key || now.userId !== cfg.userId || now.baseUrl !== cfg.baseUrl) throw new ApiError(409, 'CLOUD_CONNECTION_CHANGED', '官方账号已改变，请重新选择 Key。');
  }
  async function selected(cfg, id) {
    if (!/^\d+$/.test(String(id))) throw new ApiError(400, 'INVALID_KEY_ID', '请选择本人已有的 Free Key');
    const key = await json(cfg.relay, '/api/v1/keys/' + id, cfg.key);
    if (String(key.id) !== String(id) || !eligible(key, cfg)) throw new ApiError(403, 'FREE_KEY_INVALID', '所选 Key 必须属于当前账号、有效且位于官方 openskoob-free 分组。');
    unchanged(cfg); return key;
  }
  // The official server owns Free plan configuration and validates the model Key.
  async function modelKey(key) {
    const cfg = cloudOptions(store, env);
    const grant = await json(endpoint(cfg.baseUrl), '/api/v1/open/access?refresh=1', key);
    if (grant.ready !== true || grant.plan?.id !== 'free' || grant.plan?.enabled !== true || !Array.isArray(grant.entitlements)) throw new ApiError(403, 'FREE_KEY_INVALID', '官方服务未授予有效 Free 权益，请检查 Key 或稍后重试。');
    const id = createHash('sha256').update(key).digest('hex');
    return { id, name: '官方 API Key', last4: key.slice(-4), eligible: true, status: 'active', grant };
  }
  const granted = key => ({ plan: key.grant.plan, entitlements: key.grant.entitlements });
  async function verify() {
    const selection = store.get('settings', 'freeAccess');
    if (!selection || !store.secret(selection.service)) throw new ApiError(403, 'FREE_KEY_REQUIRED', '填写有效官方 Key（含 Free Key），或授权后选择 Key，即可查看官方脑洞、热点和模板。');
    if (selection.method === 'key') {
      const key = await modelKey(store.secret(selection.service));
      if (key.id !== selection.keyId) throw new ApiError(403, 'FREE_KEY_CHANGED', '官方 Key 已改变，请重新连接。');
      const { grant, ...metadata } = key;
      return { ready: true, identity: `official-key:${key.id}`, key: metadata, service: selection.service, ...granted(key) };
    }
    const cfg = await account();
    if (selection.baseUrl !== cfg.baseUrl || selection.userId !== cfg.userId) throw new ApiError(403, 'FREE_KEY_REQUIRED', '账号已改变，请为当前账号选择 Free Key。');
    const key = await selected(cfg, selection.keyId);
    if (store.secret(selection.service) !== key.key || store.get('settings', 'freeAccess')?.keyId !== selection.keyId) throw new ApiError(403, 'FREE_KEY_CHANGED', '本地 Free Key 已删除或改变，请重新选择。');
    const official = await modelKey(key.key);
    return { ready: true, identity: `${cfg.baseUrl}:${cfg.userId}:${selection.keyId}`, key: metadata(key, cfg), service: selection.service, ...granted(official) };
  }
  // A short snapshot coalesces homepage lists and images. Expired/failed checks never use stale access.
  let checking, cached;
  function fingerprint() {
    const cfg = cloudOptions(store, env); const selected = store.get('settings', 'freeAccess');
    return JSON.stringify([cfg.baseUrl, cfg.userId, cfg.key, selected, selected && store.secret(selected.service)]);
  }
  async function requireFree(force = false) {
    const identity = fingerprint();
    if (!force && cached?.identity === identity && cached.expiresAt > Date.now()) return cached.value;
    if (checking?.identity === identity) return checking.promise;
    const promise = verify().then(value => {
      if (identity !== fingerprint()) throw new ApiError(409, 'CLOUD_CONNECTION_CHANGED', '接入状态已改变，请重新验证。');
      cached = { identity, value, expiresAt: Date.now() + 30000 }; return value;
    }).catch(error => { cached = null; throw error; }).finally(() => { if (checking?.promise === promise) checking = null; });
    checking = { identity, promise }; return promise;
  }
  return {
    requireFree,
    async connect(raw) {
      if (typeof raw !== 'string' || !raw.trim() || raw.length > 10000) throw new ApiError(400, 'INVALID_KEY', '请填写官方 API Key');
      const secret = raw.trim(); const before = fingerprint(); const key = await modelKey(secret);
      if (before !== fingerprint()) throw new ApiError(409, 'CLOUD_CONNECTION_CHANGED', '连接已改变，请重试。');
      const name = `Skoob 官方 #${key.id.slice(0, 12)}`; const service = `custom:${name}`;
      const models = config(store);
      if (store.secret(service) && store.secret(service) !== secret) throw new ApiError(409, 'SERVICE_EXISTS', '同名模型配置已存在，请先在模型设置中处理。');
      if (!models.services.some(e => serviceId(e) === service)) models.services.push({ service: 'custom', name, baseUrl: 'https://lai.gaotk.com/v1', apiFormat: 'chat', stream: true });
      store.transaction(() => { store.secret(service, secret); store.set('settings', 'models', models); store.set('settings', 'freeAccess', { method: 'key', keyId: key.id, service }); store.set('settings', 'onboarding', { choice: 'official' }); });
      cached = { identity: fingerprint(), value: { ready: true, identity: `official-key:${key.id}`, key: { id: key.id, name: key.name, last4: key.last4 }, service, ...granted(key) }, expiresAt: Date.now() + 30000 };
      return { ok: true, service };
    },
    async status(force = false) { try { return await requireFree(force); } catch (e) { if (!(e instanceof ApiError)) throw e; return { ready: false, code: e.code, message: e.message }; } },
    async keys(page = 1) {
      const cfg = await account();
      const p = Math.max(1, Math.min(10000, Number(page) || 1));
      const data = await json(cfg.relay, `/api/v1/keys?page=${p}&page_size=50`, cfg.key); unchanged(cfg);
      const rows = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(rows)) throw new ApiError(502, 'FREE_VERIFY_FAILED', '中转站未返回密钥列表');
      return { keys: rows.map(k => metadata(k, cfg)), page: p, hasMore: !Array.isArray(data) && p * 50 < data.total, createUrl: cfg.relay + '/keys' };
    },
    async select(id) {
      const cfg = await account(); const key = await selected(cfg, id); const official = await modelKey(key.key); unchanged(cfg);
      const name = `OpenSkoob Free #${key.id}`; const service = `custom:${name}`;
      const models = config(store);
      if (store.secret(service) && store.secret(service) !== key.key) throw new ApiError(409, 'SERVICE_EXISTS', '同名本地模型配置已存在，请先在模型设置中处理，避免覆盖你的配置。');
      const entry = { service: 'custom', name, baseUrl: 'https://lai.gaotk.com/v1', apiFormat: 'chat', stream: true };
      const index = models.services.findIndex(e => serviceId(e) === service);
      if (index < 0) models.services.push(entry); else models.services[index] = { ...models.services[index], ...entry };
      store.transaction(() => { store.secret(service, key.key); store.set('settings', 'models', models); store.set('settings', 'freeAccess', { keyId: String(key.id), service, baseUrl: cfg.baseUrl, userId: cfg.userId }); });
      cached = { identity: fingerprint(), value: { ready: true, identity: `${cfg.baseUrl}:${cfg.userId}:${key.id}`, key: metadata(key, cfg), service, ...granted(official) }, expiresAt: Date.now() + 30000 };
      // Model catalogs are loaded by the existing model picker; no model choice is made here.
      return { ok: true, service };
    },
  };
}
