/**
 * 已安装技能 —— 跨页面共享的「系统已装」状态。
 *
 * 用户在「技能」栏点 ＋ 安装，回到对话页时它应该已经在编队条里，不用再打一次
 * `/`。所以这份状态不能是某个页面的局部 state：模块级共享 + 持久化，刷新和换页
 * 都保留。
 *
 * 它只是**预置**：进对话页时把已安装技能填进召唤队列，用户仍可在编队条里临时
 * 增减本轮的技能。安装 ≠ 锁死。
 *
 * 结构上分两层：{@link SkillInstallStore} 是不依赖 React/DOM 的纯状态机（可直接
 * 测），hook 只做订阅与重渲染。
 */
import { useCallback, useEffect, useState } from "react";
import { AUTH_CHANGED_EVENT, readAuth } from "../lib/auth-storage";
import { apiUrl } from "../lib/api-origin";

const STORAGE_KEY = "skoob.installedSkills";

/** 存储后端。抽出来是为了让 store 能在没有 DOM 的环境里测。 */
export interface SkillStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 拿不到 localStorage（SSR / 隐私模式）时的退路：内存态照常工作，只是不跨刷新。 */
function memoryStorage(): SkillStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
  };
}

function defaultStorage(): SkillStorage {
  try {
    if (typeof localStorage === "undefined") return memoryStorage();
    localStorage.getItem(STORAGE_KEY);   // 隐私模式下这一步就会抛
    return localStorage;
  } catch {
    return memoryStorage();
  }
}

export class SkillInstallStore {
  private ids: ReadonlyArray<string>;
  private currentKey: string;
  private readonly listeners = new Set<(v: ReadonlyArray<string>) => void>();

  constructor(
    private readonly storage: SkillStorage = defaultStorage(),
    private readonly storageKey: () => string = () => STORAGE_KEY,
  ) {
    this.currentKey = storageKey();
    this.ids = this.read();
  }

  private syncScope(): void {
    const key = this.storageKey();
    if (key === this.currentKey) return;
    this.currentKey = key;
    this.ids = this.read();
  }

  /** 登录/登出或其他标签页改了安装偏好，通知已经挂载的输入框。 */
  refresh(): void {
    this.syncScope();
    this.ids = this.read();
    for (const fn of this.listeners) fn(this.ids);
  }

  private read(): ReadonlyArray<string> {
    try {
      const raw = this.storage.getItem(this.currentKey);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  private commit(next: ReadonlyArray<string>): void {
    this.ids = next;
    try {
      this.storage.setItem(this.currentKey, JSON.stringify(next));
    } catch {
      // 写不进去不影响内存态。
    }
    for (const fn of this.listeners) fn(next);
  }

  list(): ReadonlyArray<string> { this.syncScope(); return this.ids; }
  isInstalled(id: string): boolean { this.syncScope(); return this.ids.includes(id); }

  install(id: string): void {
    this.syncScope();
    if (!id.trim() || this.ids.includes(id)) return;
    this.commit([...this.ids, id]);
  }

  uninstall(id: string): void {
    this.syncScope();
    if (!this.ids.includes(id)) return;
    this.commit(this.ids.filter((x) => x !== id));
  }

  toggle(id: string): void {
    this.syncScope();
    if (!id.trim()) return;
    if (this.ids.includes(id)) this.uninstall(id); else this.install(id);
  }

  subscribe(fn: (v: ReadonlyArray<string>) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}

/** 应用级单例：多个组件看到的是同一份，不会各自为政。 */
export const skillInstallStore = new SkillInstallStore(defaultStorage(), () =>
  `${STORAGE_KEY}:v2:${JSON.stringify([apiUrl("/api/v1"), readAuth()?.userId ?? null])}`);

if (typeof window !== "undefined") {
  window.addEventListener(AUTH_CHANGED_EVENT, () => skillInstallStore.refresh());
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === "skoob.auth.token" || event.key === "skoob.auth.userId"
      || event.key.startsWith(`${STORAGE_KEY}:v2:`)) skillInstallStore.refresh();
  });
}

export function useInstalledSkills(): {
  readonly installed: ReadonlyArray<string>;
  readonly isInstalled: (id: string) => boolean;
  readonly toggle: (id: string) => void;
  readonly install: (id: string) => void;
  readonly uninstall: (id: string) => void;
} {
  const [value, setValue] = useState(skillInstallStore.list());

  useEffect(() => {
    // 挂载时对齐一次：别的组件可能在本组件挂载前改过。
    setValue(skillInstallStore.list());
    return skillInstallStore.subscribe(setValue);
  }, []);

  return {
    installed: value,
    isInstalled: useCallback((id: string) => value.includes(id), [value]),
    toggle: useCallback((id: string) => skillInstallStore.toggle(id), []),
    install: useCallback((id: string) => skillInstallStore.install(id), []),
    uninstall: useCallback((id: string) => skillInstallStore.uninstall(id), []),
  };
}
