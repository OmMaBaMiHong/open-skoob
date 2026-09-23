import { AUTH_CHANGED_EVENT, clearAuth, readAuth } from "../lib/auth-storage";
/**
 * 会员状态 —— 登录态 + 官网订阅。
 *
 * 全局共享一份：多个组件同时挂载只发一次请求（inflight 去重），
 * 登录/登出后调 refresh() 让所有订阅者一起更新。
 */
import { useCallback, useEffect, useState } from "react";
import {
  fetchAccountStatus, fetchMembership,
  type AccountUser,
} from "../lib/account";
import { setLoginRequiredHandler } from "../lib/api";

export interface MembershipState {
  readonly loggedIn: boolean;
  readonly isMember: boolean;
  readonly plan: string | null;
  readonly expiresAt: string | null;
  readonly sub2apiUrl: string | null;
  readonly user: AccountUser | null;
  readonly loading: boolean;
  readonly entitlements: ReadonlyArray<string>;
  readonly stale: boolean;
}

const INITIAL: MembershipState = {
  loggedIn: false, isMember: false, plan: null, expiresAt: null,
  sub2apiUrl: null, user: null, loading: true, entitlements: [], stale: false,
};

/* ── 模块级共享状态：避免每个组件各查一次 ── */
let shared: MembershipState = INITIAL;
let inflight: Promise<MembershipState> | null = null;
let revision = 0;
const subscribers = new Set<(s: MembershipState) => void>();

function publish(next: MembershipState): void {
  shared = next;
  for (const fn of subscribers) fn(next);
}

async function load(force = false): Promise<MembershipState> {
  if (inflight) return inflight;
  const currentRevision = revision;
  inflight = (async () => {
    let next: MembershipState = { ...INITIAL, loading: false };
    try {
      const status = await fetchAccountStatus();
      if (!status.loggedIn) {
        next = { ...INITIAL, loading: false, sub2apiUrl: status.sub2apiUrl };
      } else {
        // 登录了但会员查询失败（官网不可达）：按非会员处理，不要整个挂掉
        const m = await fetchMembership(force).catch(() => null);
        next = {
          loggedIn: true,
          isMember: m?.isMember ?? false,
          plan: m?.plan ?? null,
          expiresAt: m?.expiresAt ?? null,
          sub2apiUrl: status.sub2apiUrl,
          user: status.user,
          loading: false,
          entitlements: m?.entitlements ?? [],
          stale: m?.stale ?? true,
        };
      }
    } catch {
      // 账号服务整体不可用：静默降级为未登录，不阻塞创作主流程
      next = { ...INITIAL, loading: false };
    } finally {
      if (revision === currentRevision) inflight = null;
    }
    if (revision !== currentRevision) return shared;
    publish(next);
    return next;
  })();
  return inflight;
}

/** 后端回 401 LOGIN_REQUIRED：本地登录态已失效，立刻翻成未登录，闸门随之切到登录页。 */
export function markLoggedOut(): void {
  if (readAuth()) { clearAuth(); return; }
  if (!shared.loggedIn && !shared.loading) return;
  revision += 1;
  inflight = null;
  publish({ ...INITIAL, loading: false, sub2apiUrl: shared.sub2apiUrl });
}
setLoginRequiredHandler(markLoggedOut);

if (typeof window !== "undefined") {
  const changed = () => {
    revision += 1;
    inflight = null;
    publish({ ...INITIAL, loading: Boolean(readAuth()) });
    if (readAuth()) void load();
  };
  window.addEventListener(AUTH_CHANGED_EVENT, changed);
  window.addEventListener("skoob:cloud-account-changed", () => { revision++; inflight = null; void load(true); });
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === "skoob.auth.token" || event.key === "skoob.auth.userId") changed();
  });
}

export function useMembership(): MembershipState & {
  readonly refresh: () => Promise<MembershipState>;
} {
  const [state, setState] = useState<MembershipState>(shared);

  useEffect(() => {
    subscribers.add(setState);
    // 首次挂载（或上次加载失败）时拉一次
    if (shared.loading) void load();
    else setState(shared);
    return () => { subscribers.delete(setState); };
  }, []);

  const refresh = useCallback(async () => {
    publish({ ...shared, loading: true });
    return load(true);
  }, []);

  return { ...state, refresh };
}
