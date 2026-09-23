/** Self-hosted catalogs must reach the local server so it can revalidate the selected Free Key. */
let revision = 0;
export function invalidateApiCache(_group?: "catalog" | "hotboard"): void { revision++; }
export function resetApiCacheIdentity(): void {
  revision++;
  try { for (const key of Object.keys(localStorage)) if (key.startsWith("skoob.api-cache.")) localStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
}
export function invalidateApiCacheForMutation(_path: string): void { revision++; }
export async function cachedApiRequest<T>(_scope: string, _path: string, _init: RequestInit | undefined, load: () => Promise<T>): Promise<T> {
  const before = revision;
  try { const value = await load(); if (before !== revision) throw new DOMException("接入状态已改变，请重试", "AbortError"); return value; }
  catch (error) {
    if (/^(FREE_|CLOUD_LOGIN_REQUIRED|CLOUD_CONNECTION_CHANGED)/.test((error as { code?: string }).code || "")) window.dispatchEvent(new Event("skoob:cloud-access-invalid"));
    throw error;
  }
}
