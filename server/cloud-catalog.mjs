import { ApiError, endpoint } from './models.mjs';
import { cloudOptions } from './cloud.mjs';

export const CLOUD_ID = 'official:';
export const isOfficialId = id => typeof id === 'string' && id.startsWith(CLOUD_ID);
export function assertLocalId(id) { if (isOfficialId(id)) throw new ApiError(403, 'CLOUD_READ_ONLY', '官方目录是只读内容，请创建自己的本地模板。'); }
export function isPublicCloudRead(path) {
  return /^\/api\/v1\/(?:tianmo\/(?:brainstorm\/cards(?:\/[^/]+\/image)?|hotboard\/(?:boards|aggregate|search)|scan\/platforms)|tianwang\/catalog|tianwang-library\/templates(?:\/[^/]+)?|covers\/file\/asset\/[^/]+)$/.test(path);
}
const collections = { skills: ['skills', 'skills'], agentTemplates: ['agent-templates', 'templates'], genres: ['genres', 'genres'], prototypes: ['agent-prototypes', 'prototypes'] };
export function cloudCatalog(store, env, access) {
  async function read(path) {
    const grant = await access.requireFree(); const cfg = cloudOptions(store, env);
    const key = store.secret(grant.service);
    let response;
    try { response = await fetch(endpoint(cfg.baseUrl) + '/api/v1/open/catalog' + path, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new ApiError(502, 'CLOUD_CATALOG_UNAVAILABLE', '官方目录暂时无法读取，请重试。本地内容仍保留。'); }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, data?.error?.code || (typeof data?.error === 'string' ? data.error : 'CLOUD_CATALOG_FAILED'), data?.error?.message || data?.message || '官方平台拒绝了本次内容请求');
    const now = cloudOptions(store, env);
    if (now.key !== cfg.key || now.userId !== cfg.userId || now.baseUrl !== cfg.baseUrl || store.secret(grant.service) !== key || store.get("settings", "freeAccess")?.service !== grant.service) throw new ApiError(409, 'CLOUD_CONNECTION_CHANGED', '账号已改变，请刷新目录。');
    return data;
  }
  async function remote(collection) {
    const [path, field] = collections[collection]; const result = await read('/' + path);
    if (!Array.isArray(result?.[field])) throw new ApiError(502, 'CLOUD_CATALOG_INVALID', '官方目录返回格式不正确');
    return result[field].map(item => ({ ...item, id: CLOUD_ID + item.id, officialId: item.id, source: 'official', isMine: false, editable: false }));
  }
  return {
    read,
    async list(collection) {
      const local = collection === 'prototypes' ? store.list('agentTemplates').map(t => ({ id: t.id, kind: 'agent', name: t.name, role: t.domain || '', tags: t.keywords || [], description: t.content || '', assetId: t.id })) : store.list(collection);
      // No selected Key means a deliberately local-only library, not an empty official catalog.
      if (!store.get('settings', 'freeAccess')) return local;
      try { if (!(await access.requireFree()).entitlements.includes('templates.read')) return local; return [...local, ...await remote(collection)]; }
      catch (e) { if (['FREE_PLAN_DISABLED', 'FREE_ENTITLEMENT_REQUIRED', 'FREE_KEY_REQUIRED', 'FREE_KEY_INVALID', 'FREE_KEY_CHANGED', 'FREE_VERIFY_UNAVAILABLE', 'FREE_VERIFY_FAILED', 'CLOUD_LOGIN_REQUIRED'].includes(e.code)) return local; throw e; }
    },
    async material(collection, id) {
      if (!isOfficialId(id)) return store.get(collection, id);
      const item = (await remote(collection)).find(x => x.id === id);
      if (!item) throw new ApiError(404, 'CLOUD_ASSET_NOT_FOUND', '该官方内容已不可用，请刷新目录');
      if (collection === 'genres') {
        const details = await read('/genres/' + encodeURIComponent(item.officialId) + '/cluster');
        return { ...item, profile: details.profile, body: details.body };
      }
      return item;
    },
  };
}
