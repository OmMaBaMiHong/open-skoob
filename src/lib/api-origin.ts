/**
 * 后端源地址 —— 前端独立运行的唯一入口。
 *
 * 这个前端**不走 vite 代理**。代理模式看着省事，实际有三处硬伤：
 *   1. 只在 `vite dev` 下成立。`vite build` 出来的静态站点没有代理，
 *      一部署就是满屏 404——前端根本不算"能独立跑"。
 *   2. 后端地址藏在 vite.config 里，换环境（本地 / 局域网 / 线上）要改代码重新构建。
 *   3. 同源假象掩盖了真实的跨源问题：cookie、CORS、SSE 的 withCredentials
 *      在开发期全被代理糊住，上线才一次性爆出来。
 *
 * 所以一律用**绝对地址**直连后端，解析顺序：
 *   1. `VITE_API_BASE_URL` —— 构建期/运行期环境变量，部署时想指哪指哪；
 *   2. `__API_ORIGIN__` —— vite.config 注入的开发期默认值；
 *   3. 同源 —— 前端和后端确实同域部署时的兜底（此时为空串，走相对路径）。
 */
declare const __API_ORIGIN__: string | undefined;

function resolveOrigin(): string {
  const fromEnv = import.meta.env?.VITE_API_BASE_URL;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim().replace(/\/+$/u, "");
  if (typeof __API_ORIGIN__ === "string" && __API_ORIGIN__) {
    return __API_ORIGIN__.replace(/\/+$/u, "");
  }
  return "";
}

/** 后端源，如 `http://127.0.0.1:4579`；同源部署时是空串。 */
export const API_ORIGIN = resolveOrigin();

/** 拼接后端地址。`apiUrl("/api/v1/books")` → `http://127.0.0.1:4579/api/v1/books`。 */
export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * 跨源请求必须带上凭证，否则后端的会话 cookie 不会随请求发出，
 * 登录态在前端看来永远是"未登录"。后端相应地要允许 credentials 并回显具体 origin
 * （`Access-Control-Allow-Origin: *` 与 credentials 不能共存）。
 */
export const CREDENTIALS: RequestCredentials = "include";
