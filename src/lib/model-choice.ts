/**
 * 使用态模型选择 —— 输入框下拉里「我现在用哪个模型」的全局选择。
 *
 * 与设置页的「默认模型」（配置态，/project/default-model）是**两种东西**：
 * 配置态是账号级兜底，只有设置页能改；这里是使用时的选择，存 localStorage，
 * 跨页面共享、匿名可用，创作请求带上它（model + service 成对）就能覆盖默认。
 *
 * 同页多实例（首页 / 工作台 / 六师随行 / 对话页各挂一份 useComposerData）
 * 靠 CustomEvent 同步；跨标签页靠 storage 事件。
 */

export interface StoredModelChoice {
  readonly service: string;
  readonly serviceLabel: string;
  readonly id: string;
  readonly name: string;
}

const KEY = "skoob.composer.model-choice";
const EVENT = "skoob:model-choice";

export function readModelChoice(): StoredModelChoice | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredModelChoice> | null;
    if (!v || typeof v.id !== "string" || !v.id) return null;
    return {
      id: v.id,
      name: typeof v.name === "string" && v.name ? v.name : v.id,
      service: typeof v.service === "string" ? v.service : "",
      serviceLabel: typeof v.serviceLabel === "string" ? v.serviceLabel : "",
    };
  } catch {
    return null;
  }
}

/** 写入并广播；null = 清除（回落配置态默认）。 */
export function writeModelChoice(choice: StoredModelChoice | null): void {
  try {
    if (choice) localStorage.setItem(KEY, JSON.stringify(choice));
    else localStorage.removeItem(KEY);
  } catch {
    // 存不进去（隐私模式等）就算了：本会话内各实例的 state 仍然可用。
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** 订阅使用态变化（同页 CustomEvent + 跨标签页 storage）。返回退订函数。 */
export function subscribeModelChoice(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * 发请求时用的形状：有使用态选择就带 model（service 成对才被后端认），
 * 没有就返回空对象——后端自然走配置态默认。
 */
export function modelChoiceParams(): { model?: string; service?: string } {
  const c = readModelChoice();
  if (!c) return {};
  return { model: c.id, ...(c.service ? { service: c.service } : {}) };
}
