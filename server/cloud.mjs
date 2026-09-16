import { ApiError, endpoint } from './models.mjs';

// Explicit engine namespaces only. Local books, credentials and chat never enter this proxy.
export function isCloudPath(path) {
  return /^\/api\/v1\/(?:tianmo|tianwang|tianwang-library|tianyan|deai|deconstructions|covers|cover-studio)(?:\/|$)/.test(path);
}
export function cloudOptions(store, env = process.env) {
  const saved = store.get('settings', 'cloud', {});
  return { baseUrl: saved.baseUrl || env.SKOOB_CLOUD_URL || 'https://skoob.cc', key: saved.disabled ? '' : store.secret('cloud') || env.SKOOB_CLOUD_API_KEY || '', userId: saved.userId || env.SKOOB_CLOUD_USER_ID || '' };
}
export async function forwardCloud(request, store, env, publicRead = false) {
  const incoming = new URL(request.url);
  if (!isCloudPath(incoming.pathname) || /(?:\/admin\/|\/settings|\/prompt-templates|\/scorer|\/brainstorm\/strategies)/.test(incoming.pathname)) throw new ApiError(403, 'CLOUD_ROUTE_DENIED', '该接口不属于公开引擎调用范围');
  const cfg = cloudOptions(store, env);
  if (!publicRead && !cfg.key) throw new ApiError(503, 'CLOUD_NOT_CONFIGURED', '此能力由 Skoob 云端引擎提供，请先在云端连接设置中配置已获授权的凭证。本地基础创作不受影响。');
  const base = endpoint(cfg.baseUrl);
  if (new URL(base).pathname !== '/') throw new ApiError(400, 'INVALID_CLOUD_URL', '云端地址必须是源地址，不附加路径');
  incoming.searchParams.delete('access_token'); incoming.searchParams.delete('uid');
  const selection = store.get('settings', 'freeAccess');
  const key = publicRead ? selection && store.secret(selection.service) : cfg.key;
  if (!key) throw new ApiError(403, 'FREE_KEY_REQUIRED', '请先连接官方 Key');
  const headers = new Headers({ Authorization: `Bearer ${key}` });
  if (!publicRead && cfg.userId) headers.set('X-Skoob-User', cfg.userId);
  for (const name of ['content-type', 'accept', 'idempotency-key', 'last-event-id']) {
    const value = request.headers.get(name); if (value) headers.set(name, value);
  }
  const response = await fetch(base + (publicRead ? incoming.pathname.replace('/api/v1/', '/api/v1/open/catalog/') : incoming.pathname) + incoming.search, {
    method: request.method, headers, ...(request.method !== 'GET' && request.method !== 'HEAD' ? { body: await request.arrayBuffer() } : {}),
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(300000)]), redirect: 'error',
  });
  const out = new Headers({ 'Cache-Control': 'no-store' });
  for (const name of ['content-type', 'content-disposition']) { const value = response.headers.get(name); if (value) out.set(name, value); }
  return new Response(response.body, { status: response.status, headers: out });
}
