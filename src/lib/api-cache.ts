/** 浏览目录专用：L1 内存 + L2 localStorage。权限判断、创作操作不进入缓存。 */
type Group = "catalog" | "hotboard";
interface Entry { data: unknown; expiresAt: number; }
interface MemoryEntry { entry: Entry; size: number; }

const PREFIX = "skoob.api-cache.v2:";
// 权限边界升级：旧目录缓存可能含未过滤的数据，首次加载立即清理。
try {
  const old = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .filter((key): key is string => Boolean(key?.startsWith("skoob.api-cache.v1:")));
  for (const key of old) localStorage.removeItem(key);
} catch { /* 无本地存储时仍可使用内存缓存。 */ }
// localStorage 按 UTF-16 计量：至多约 4 MB，给登录态/偏好留出空间。
const MAX_CHARS = 2_000_000;
const MAX_ENTRIES = 64;
const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<unknown>>();
const revisions: Record<Group, number> = { catalog: 0, hotboard: 0 };
let authRevision = 0;
const channel = (() => {
  try { return typeof window !== "undefined" && window.BroadcastChannel
    ? new window.BroadcastChannel("skoob.api-cache") : null; }
  catch { return null; }
})();

/** 明确的 GET 白名单，不能把 /use、会员详情或任意 API 自动缓存。 */
function policy(path: string): { group: Group; ttl: number } | null {
  const route = path.split("?")[0];
  if (route === "/tianmo/scan/platforms") return { group: "hotboard", ttl: 60_000 };
  if (route === "/tianmo/brainstorm/cards") return { group: "hotboard", ttl: 300_000 };
  if (/^\/tianmo\/hotboard\/(boards|aggregate|search)$/.test(route)) {
    return { group: "hotboard", ttl: 60_000 };
  }
  if (/^\/(tianwang\/catalog(?:\/books)?|tianyan\/agents)$/.test(route)) {
    return { group: "catalog", ttl: 30_000 };
  }
  if (/^\/skills(?:\/store)?$/.test(route)) return { group: "catalog", ttl: 60_000 };
  if (/^\/(genres(?:\/[^/]+\/cluster)?|agent-prototypes|agent-templates|tianwang\/masters)$/.test(route)) {
    return { group: "catalog", ttl: 1_800_000 };
  }
  return null;
}

function keys(): string[] {
  return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .filter((key): key is string => key !== null && key.startsWith(PREFIX));
}

function parse(raw: string | null): Entry | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
      && value.expiresAt > Date.now() && "data" in value ? value : null;
  } catch { return null; }
}

function remember(key: string, entry: Entry, size: number): void {
  memory.delete(key);
  if (size > MAX_CHARS) return;
  memory.set(key, { entry, size });
  let total = [...memory.values()].reduce((sum, item) => sum + item.size, 0);
  for (const [oldKey, item] of memory) {
    if (memory.size <= MAX_ENTRIES && total <= MAX_CHARS) break;
    memory.delete(oldKey);
    total -= item.size;
  }
}

function read(key: string): Entry | null {
  const hit = memory.get(key);
  if (hit && hit.entry.expiresAt > Date.now()) {
    remember(key, hit.entry, hit.size);
    return hit.entry;
  }
  memory.delete(key);
  try {
    const raw = localStorage.getItem(key);
    const entry = parse(raw);
    if (entry && raw && raw.length <= MAX_CHARS) {
      remember(key, entry, raw.length);
      return entry;
    }
    localStorage.removeItem(key);
  } catch { /* 隐私模式或存储禁用：继续使用网络。 */ }
  return null;
}

function write(key: string, entry: Entry): void {
  const raw = JSON.stringify(entry);
  remember(key, entry, raw.length);
  if (raw.length > MAX_CHARS) return;
  try {
    const stored: Array<{ key: string; size: number; expiresAt: number }> = [];
    let total = raw.length;
    for (const oldKey of keys()) {
      const oldRaw = localStorage.getItem(oldKey);
      const old = parse(oldRaw);
      if (oldKey === key || !old) { localStorage.removeItem(oldKey); continue; }
      total += oldRaw!.length;
      stored.push({ key: oldKey, size: oldRaw!.length, expiresAt: old.expiresAt });
    }
    stored.sort((a, b) => a.expiresAt - b.expiresAt);
    while (stored.length >= MAX_ENTRIES || total > MAX_CHARS) {
      const oldest = stored.shift();
      if (!oldest) break;
      localStorage.removeItem(oldest.key);
      total -= oldest.size;
    }
    localStorage.setItem(key, raw);
  } catch { /* 配额不足：网络结果和内存缓存仍然可用。 */ }
}

function matches(key: string, group?: Group): boolean {
  if (!group) return true;
  try { return policy(JSON.parse(key.slice(PREFIX.length))[1])?.group === group; }
  catch { return true; }
}

function invalidateMemory(group?: Group): void {
  for (const kind of ["catalog", "hotboard"] as const) {
    if (!group || kind === group) revisions[kind]++;
  }
  for (const key of memory.keys()) if (matches(key, group)) memory.delete(key);
  for (const key of inflight.keys()) if (matches(key, group)) inflight.delete(key);
}

/** 只清本站 API 缓存，不动登录令牌、主题或用户偏好。 */
export function invalidateApiCache(group?: Group): void {
  invalidateMemory(group);
  try { for (const key of keys()) if (matches(key, group)) localStorage.removeItem(key); }
  catch { /* 无本地存储时只清内存。 */ }
  channel?.postMessage({ group: group ?? "all" });
}

/** 登录/登出：连同旧账号在途响应一起作废。 */
export function resetApiCacheIdentity(): void {
  authRevision++;
  invalidateApiCache();
}

export function invalidateApiCacheForMutation(path: string): void {
  if (/^\/tianmo\/(funnel|brainstorm)\/events(?:\?|$)/.test(path)) return;
  // Evaluating or previewing a source changes neither the collected boards nor public cards.
  if (/^\/tianmo\/inspiration\/(assessment|plan)(?:\?|$)/.test(path)) return;
  if (/^\/tianmo\//.test(path)) invalidateApiCache("hotboard");
  if (/^\/(skills|genres|agent-templates|agent-prototypes|tianwang|tianwang-library|tianyan|books|deconstructions|import|assets|covers|cover-studio)(\/|\?|$)/.test(path)) {
    invalidateApiCache("catalog");
  }
}

export async function cachedApiRequest<T>(
  scope: string, path: string, init: RequestInit | undefined, load: () => Promise<T>,
): Promise<T> {
  const rule = policy(path);
  const method = init?.method?.toUpperCase() ?? "GET";
  if (!rule || method !== "GET" || init?.signal || init?.headers || init?.cache === "no-store") {
    return load();
  }
  const key = PREFIX + JSON.stringify([scope, path]);
  if (init?.cache === "reload" || init?.cache === "no-cache") invalidateApiCache(rule.group);
  const hit = read(key);
  if (hit) return structuredClone(hit.data) as T;
  const current = inflight.get(key);
  if (current) return structuredClone(await current) as T;
  const revision = revisions[rule.group];
  const identity = authRevision;
  let pending!: Promise<T>;
  pending = (async () => {
    const data = await load();
    if (identity !== authRevision) throw new DOMException("账号已变更，请重新加载", "AbortError");
    // 编辑/手动刷新期间收到的旧请求，既不能覆盖缓存，也不能覆盖新页面状态。
    if (revision !== revisions[rule.group] || inflight.get(key) !== pending) {
      throw new DOMException("数据已更新，请重新加载", "AbortError");
    }
    write(key, { data, expiresAt: Date.now() + rule.ttl });
    return data;
  })();
  inflight.set(key, pending);
  try { return structuredClone(await pending); }
  finally { if (inflight.get(key) === pending) inflight.delete(key); }
}

if (typeof window !== "undefined") {
  if (channel) channel.onmessage = ({ data }) => {
    if (data?.group === "all") invalidateMemory();
    else if (data?.group === "catalog" || data?.group === "hotboard") invalidateMemory(data.group);
  };
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === "skoob.auth.token" || event.key === "skoob.auth.userId") {
      resetApiCacheIdentity();
    } else if (event.key.startsWith(PREFIX)) {
      // 其他标签页写入/失效后，下次从共享 L2 读取；不能再把旧 L1 写回去。
      memory.delete(event.key);
      if (event.newValue === null) inflight.delete(event.key);
    }
  });
}
