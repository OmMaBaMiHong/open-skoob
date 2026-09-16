import { useEffect, useState } from "react";
import { API_ORIGIN } from "./api-origin";
import { AUTH_CHANGED_EVENT, readAuth } from "./auth-storage";

interface TianmoView {
  platform?: string;
}

/** 只存浏览选择，不存报告内容；切换账号后重挂载，清空旧账号的阅读状态。 */
export function useTianmoScope(): string {
  const scopeOf = () => JSON.stringify([API_ORIGIN, readAuth()?.userId ?? "anonymous"]);
  const [scope, setScope] = useState(scopeOf);
  useEffect(() => {
    const changed = () => setScope(scopeOf());
    window.addEventListener(AUTH_CHANGED_EVENT, changed);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, changed);
      window.removeEventListener("storage", changed);
    };
  }, []);
  return scope;
}

export function readTianmoView(scope: string): TianmoView {
  try { return JSON.parse(localStorage.getItem(`skoob.tianmo.view:v1:${scope}`) ?? "{}") ?? {}; }
  catch { return {}; }
}

export function saveTianmoView(scope: string, patch: TianmoView): void {
  try { localStorage.setItem(`skoob.tianmo.view:v1:${scope}`, JSON.stringify({ ...readTianmoView(scope), ...patch })); }
  catch { /* 浏览选择持久化不可用时仍可正常使用。 */ }
}
