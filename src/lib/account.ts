/**
 * 账号与会员 —— 对接后端 /api/v1/account/*
 *
 * 产品规范（沿用老前端 use-auth-actions.ts 的定案）：
 *   **本端永远不做登录/注册表单——账号体系在中转站（OpenSkoob）。**
 * 唯一登录方式是 OAuth 授权跳转：
 *   本地 /oauth/start → 302 中转站 authorize（未注册用户会自然落到其注册页）
 *   → 授权后回调本地 /oauth/callback 写入凭证 → 302 回前端。
 *
 * 后端实现见 packages/studio/src/api/user-routes.ts。
 */

import { API_ORIGIN, apiUrl, CREDENTIALS } from "./api-origin";
import { writeAuth, clearAuth, authHeaders } from "./auth-storage.js";

const BASE = apiUrl("/api/v1/account");

/**
 * 后端源地址。
 *
 * OAuth 跳转必须用它拼绝对地址：后端的 redirect_uri 指向自己的端口，
 * 若从前端端口发起而回调落在后端端口，state cookie 跨源丢失 → state_mismatch。
 * 同源部署时 API_ORIGIN 是空串，回落到当前 origin。
 */
function apiOrigin(): string {
  return API_ORIGIN || window.location.origin.replace("localhost", "127.0.0.1");
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: CREDENTIALS,
    /*
     * 身份头必须带上。后端不持有任何登录态，认人只看
     * `Authorization` + `X-Skoob-User`——漏了这两个，账号接口
     * 一律判未登录，页面就永远停在登录墙上（实测踩过：授权明明成功，
     * 令牌也存下了，但 /account/status 还是回 loggedIn:false）。
     */
    headers: { "Content-Type": "application/json", ...authHeaders(), ...init?.headers },
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(json.message || `账号接口 ${res.status}`);
  return json as T;
}

export interface AccountUser {
  readonly platformAdmin?: boolean;
  readonly role?: string;
  readonly username?: string;
  readonly email?: string;
}

export interface AccountStatus {
  readonly loggedIn: boolean;
  readonly user: AccountUser | null;
  readonly expiresAt: number | null;
  /** 中转站地址（登录/购买/领 key 都在那边）。 */
  readonly sub2apiUrl: string | null;
}

export interface MembershipStatus {
  readonly isMember: boolean;
  readonly loggedIn: boolean;
  readonly plan: string | null;
  readonly expiresAt: string | null;
  readonly entitlements: ReadonlyArray<string>;
  readonly stale: boolean;
}

export function fetchAccountStatus(): Promise<AccountStatus> {
  return call<AccountStatus>("/status");
}

export function fetchMembership(force = false): Promise<MembershipStatus> {
  return call<MembershipStatus>(`/membership${force ? "?refresh=1" : ""}`);
}

/**
 * 登出。
 *
 * **本地令牌必须清掉**——登录态现在只存在浏览器里，后端不持有任何登录状态，
 * 所以不清就等于没登出：后续每个请求照样带着 Authorization 头。
 * 先清本地再通知官网：官网那边失败也不该让人卡在"登不出去"的状态。
 */
export async function logout(): Promise<{ code?: number }> {
  clearAuth();
  return call<{ code?: number }>("/logout", { method: "POST", body: "{}" }).catch(() => ({}));
}

/**
 * 发起授权登录（唯一登录方式）。
 *
 * 整页跳转，不是 fetch —— 后端要 302 到中转站，并靠 cookie 存 state。
 * 必须打到后端源地址：redirect_uri 指向后端端口，start 走代理会让
 * state cookie 落在前端端口，回调时读不到 → state_mismatch。
 */
export function startOAuthLogin(returnTo?: string): void {
  const to = returnTo ?? window.location.href;
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  sessionStorage.setItem("skoob.oauth.verifier", verifier);
  void crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then((digest) => {
    const challenge = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    const query = new URLSearchParams({ returnTo: to, challenge });
    const target = BASE.startsWith("http") ? BASE : `${apiOrigin()}${BASE}`;
    window.location.href = `${target}/oauth/start?${query}`;
  });
}

/** OAuth 回调带回来的结果（后端把它拼在 returnTo 的 query 上）。 */
export interface OAuthResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/** 解析回跳 query 的结果：要存什么、地址栏该剩什么。 */
export interface OAuthHandoff {
  readonly result: OAuthResult | null;
  /** 要写进 localStorage 的令牌；没有则不写。 */
  readonly auth: { readonly token: string; readonly userId: string } | null;
  /** 清理后的 query（不含前导 ?）。result 为 null 时不必改地址栏。 */
  readonly cleanedSearch: string;
}

/** 清理旧版回跳参数；URL 中的 token/uid 不再建立登录态。 */
export function parseOAuthHandoff(search: string): OAuthHandoff {
  const params = new URLSearchParams(search);
  const oauth = params.get("oauth");
  if (!oauth) return { result: null, auth: null, cleanedSearch: params.toString() };

  const reason = params.get("reason") ?? undefined;
  const ok = oauth === "success";

  for (const key of ["oauth", "reason", "token", "uid"]) params.delete(key);

  return {
    result: { ok: false, reason: reason ?? (ok ? "handoff_expired" : undefined) },
    // 旧式 URL 令牌不再作为登录凭据，必须完成浏览器绑定的一次性交接。
    auth: null,
    cleanedSearch: params.toString(),
  };
}

/*
 * 消费发生在 main.tsx（渲染之前），但想展示「授权成功」的是页面。
 * 结果在这里暂存一次，让第一个来问的页面取走——否则页面调用时 URL 早已
 * 清干净，永远看不到提示。
 */
let pendingResult: OAuthResult | null = null;

/** 页面读取渲染前完成的一次性授权结果；兼容清理旧版回跳地址。 */
export function consumeOAuthResult(): OAuthResult | null {
  const { result, auth, cleanedSearch } = parseOAuthHandoff(window.location.search);
  if (!result) {
    const held = pendingResult;
    pendingResult = null;
    return held;
  }
  if (auth) writeAuth(auth);
  window.history.replaceState(
    null, "",
    `${window.location.pathname}${cleanedSearch ? `?${cleanedSearch}` : ""}${window.location.hash}`,
  );
  pendingResult = result;
  return result;
}

/** 渲染前消费一次性凭证。令牌仅从受保护的响应体交接，不进入 URL。 */
export async function completeOAuthLogin(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("handoff");
  if (!code) { consumeOAuthResult(); return; }
  for (const key of ["handoff", "oauth", "reason", "token", "uid"]) params.delete(key);
  window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
  try {
    const auth = await call<{ token: string; userId: string }>("/oauth/exchange", { method: "POST", body: JSON.stringify({ code, verifier: sessionStorage.getItem("skoob.oauth.verifier") }) });
    sessionStorage.removeItem("skoob.oauth.verifier");
    writeAuth(auth);
    pendingResult = { ok: true };
  } catch {
    pendingResult = { ok: false, reason: "handoff_expired" };
  }
}

/** OAuth 失败原因 → 人话。 */
export function oauthReasonText(reason: string | undefined): string {
  switch (reason) {
    case "handoff_expired":
      return "授权交接已失效，请重新登录。";
    case "state_mismatch":
      return "授权状态校验失败。多为前后端不同源导致 cookie 丢失，请确认从后端地址发起授权。";
    case "token_failed":
      return "换取令牌失败，请确认中转站的 OAuth client 配置（client_id / client_secret）。";
    case "access_denied":
      return "你在中转站取消了授权。";
    default:
      return reason ? `授权失败：${reason}` : "授权失败";
  }
}

/**
 * 深链中转站收银台，带上套餐预选参数。
 *
 * 中转站按 plan_id 预选套餐；即使它忽略参数，也能正常落到收银页。
 */
export function openCheckout(
  sub2apiUrl: string | null,
  planId: string,
  numericPlanId?: number,
): void {
  openRelay(sub2apiUrl, "purchase", {
    order_type: "subscription",
    plan: planId,
    ...(numericPlanId ? { plan_id: String(numericPlanId) } : {}),
  });
}

/** 直开中转站的页面（注册/购买/领 key 都在那边完成）。 */
export function openRelay(
  sub2apiUrl: string | null,
  path: "register" | "login" | "purchase" | "redeem" | "token" | "",
  query?: Record<string, string>,
): void {
  const base = (sub2apiUrl || "https://gaotk.com").replace(/\/$/, "");
  const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
  window.open(`${base}/${path}${qs}`, "_blank", "noopener");
}
