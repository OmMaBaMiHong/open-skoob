/**
 * 画像索引 —— 按角色名查那张生成好的画像。
 *
 * ── 为什么走 context 而不是逐层传 prop ──
 *
 * 头像出现在七八处：聊天列表、消息气泡、群成员、建群选人、档案卡……
 * 它们各自的数据结构里只有名字和配色，没有画像地址。要传 prop，就得让
 * ChatList / ChatWindow / SessionItem / GroupInfoPanel 全都多背一个跟自己
 * 无关的字段，而且**漏掉一处就是同一个角色两张脸**——这正是最难发现的那种
 * 不一致。索引放在上层，头像自己查，加一处新的头像位不用再改一遍。
 *
 * 没有 Provider 时（比如分享页）查出来是空，头像回落到 SVG——那本来就是
 * 正经兜底，不是缺失态。
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

/** 名字 → 画像地址。 */
type PortraitIndex = ReadonlyMap<string, string>;

const PortraitCtx = createContext<PortraitIndex | null>(null);

export interface PortraitSource {
  readonly name: string;
  readonly portraitUrl?: string | null;
}

/**
 * 建索引时同时收全名和冒号前的短名。
 *
 * 名册里的名字可能是「张三：验证局执行官」这种带后缀的写法，而消息气泡上
 * 显示的是 shortName() 之后的「张三」。两边都进索引，免得同一个人在列表里
 * 有画像、在气泡上没有。
 */
export function PortraitProvider(
  { agents, children }: { readonly agents: ReadonlyArray<PortraitSource>; readonly children: ReactNode },
) {
  const index = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      const url = a.portraitUrl?.trim();
      if (!url) continue;
      map.set(a.name, url);
      const short = a.name.split(/[:：]/)[0]?.trim();
      if (short && !map.has(short)) map.set(short, url);
    }
    return map;
  }, [agents]);
  return <PortraitCtx.Provider value={index}>{children}</PortraitCtx.Provider>;
}

/** 这个名字有没有画像。没有返回 undefined，调用方回落 SVG。 */
export function usePortrait(name: string): string | undefined {
  const index = useContext(PortraitCtx);
  if (!index) return undefined;
  return index.get(name) ?? index.get(name.split(/[:：]/)[0]?.trim() ?? "");
}
