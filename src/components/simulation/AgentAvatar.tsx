/**
 * AgentAvatar —— 智能体头像。
 *
 * 生成过画像就用画像，没有就用本地 SVG 模板（见 AvatarArt.tsx）——
 * 后者不是占位符而是**正经兜底**：原型按画像分类挑（主角像少年剑客、
 * 反派戴面具、导师是长须老者……），配色按名字哈希取，同一个人到哪个群都是
 * 同一张脸，且不依赖任何外部素材。
 *
 * 所以「没生成画像」不是一种缺失状态，不该显示空白或问号。
 */
import { AvatarArt } from "./AvatarArt";
import { usePortrait } from "./PortraitContext";
import type { AgentStatus } from "../../types/simulation";

interface AgentAvatarProps {
  readonly name: string;
  readonly hue: number;
  /** 画像分类，决定挑哪个原型；没有画像时留空，按名字哈希取。 */
  readonly agentType?: string;
  readonly size?: "sm" | "md" | "lg";
  readonly status?: AgentStatus;
  readonly title?: string;
  /**
   * 生成/上传的画像地址（短期签名）。
   *
   * 不传时按名字去上层的画像索引里查（见 PortraitContext）——头像出现在
   * 七八处，逐处传 prop 漏掉一处就是同一个人两张脸。显式传值优先，
   * 用于刚生成完、索引还没刷新的那一瞬。
   */
  readonly portraitUrl?: string | null;
}

export function AgentAvatar({
  name, hue, agentType, size = "md", status, title, portraitUrl,
}: AgentAvatarProps) {
  const fromIndex = usePortrait(name);
  const portrait = portraitUrl ?? fromIndex;
  return (
    <span
      className={`sim-avatar sim-avatar-${size}${status ? ` is-${status}` : ""}`}
      title={title ?? name}
    >
      {portrait
        ? <img className="sim-avatar-img" src={portrait} alt={name} loading="lazy" />
        : <AvatarArt name={name} hue={hue} {...(agentType ? { agentType } : {})} />}
      {status && <i className={`sim-avatar-dot is-${status}`} />}
    </span>
  );
}
