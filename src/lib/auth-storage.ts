/**
 * 登录态存在浏览器 —— 正常的前后端形态。
 *
 * 以前它存在**后端**的 `.skoob/client-auth.json` 里：一个服务进程只有一个
 * 「当前登录用户」，两个浏览器打同一个后端就共享同一个身份，第二个人一登录
 * 第一个人就变成了他。部署到线上更荒谬。
 *
 * 现在：token 在这里（localStorage），每个请求带
 * `Authorization: Bearer <token>` + `X-Skoob-User: <userId>`；
 * 后端不持久化任何登录态，按请求解析身份、去库里查资料。
 *
 * 为什么用 localStorage 而不是内存：刷新页面不该重新登录。
 * 为什么不是 cookie：前后端不同源（web 直连 studio 端口），
 * cookie 要配跨域与 SameSite，而这里没有 CSRF 面——token 是显式带的。
 */
import { resetApiCacheIdentity } from "./api-cache";

const TOKEN_KEY = "skoob.auth.token";
const USER_KEY = "skoob.auth.userId";
export const AUTH_CHANGED_EVENT = "skoob:auth-changed";

export interface StoredAuth {
  readonly token: string;
  readonly userId: string;
}

/** 拿不到 localStorage（隐私模式）时的退路：内存态照常工作，只是不跨刷新。 */
const memory = new Map<string, string>();

function store(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    if (typeof localStorage === "undefined") throw new Error("no localStorage");
    localStorage.getItem(TOKEN_KEY);   // 隐私模式下这一步就会抛
    return localStorage;
  } catch {
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => { memory.set(k, v); },
      removeItem: (k) => { memory.delete(k); },
    };
  }
}

export function readAuth(): StoredAuth | null {
  const s = store();
  const token = s.getItem(TOKEN_KEY);
  const userId = s.getItem(USER_KEY);
  return token && userId ? { token, userId } : null;
}

export function writeAuth(auth: StoredAuth): void {
  resetApiCacheIdentity();
  const s = store();
  s.setItem(TOKEN_KEY, auth.token);
  s.setItem(USER_KEY, auth.userId);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearAuth(): void {
  resetApiCacheIdentity();
  const s = store();
  s.removeItem(TOKEN_KEY);
  s.removeItem(USER_KEY);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

/** 请求头。未登录时返回空对象——不要发空的 Authorization。 */
export function authHeaders(): Record<string, string> {
  const auth = readAuth();
  return auth
    ? { Authorization: `Bearer ${auth.token}`, "X-Skoob-User": auth.userId }
    : {};
}

/** 匿名访客标识：埋点去重用。与登录态无关，首次生成后固定。 */
const VISITOR_KEY = "skoob.visitor.id";

export function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, generated);
    return generated;
  } catch {
    return "anonymous";
  }
}
