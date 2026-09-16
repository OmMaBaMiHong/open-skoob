/**
 * AgentProfileModal —— 点头像看档案。
 *
 * 两种档案共用一个壳：
 *   1. 故事角色 —— 天衍画像（14 个字段，来自图谱 / agent_cards.json）；
 *   2. 用户创作智能体 —— 每个账号一个化身，可参与任何书的创作
 *      （后端 .skoob/user-agent.json，见 studio/src/api/user-agent.ts）。
 *
 * 空字段不占位：画像是逐步生成的，写一堆「（无）」只会让人以为坏了。
 */
import { useState } from "react";
import { X, MessageSquare, Sparkles, Loader2 } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { hueOf, shortName } from "../../lib/sim-theater";
import { generateCover, type GraphAgent, type UserAgentCard } from "../../lib/api";
import { agentTypeOf, tierLabel } from "../../types/experts";

export type ProfileTarget =
  | { readonly kind: "agent"; readonly name: string; readonly profile: GraphAgent | null }
  | { readonly kind: "user"; readonly card: UserAgentCard | null };

interface AgentProfileModalProps {
  readonly target: ProfileTarget;
  readonly onClose: () => void;
  /** 故事角色才有：直接开私聊。 */
  readonly onChat?: (agentName: string) => void;
  /**
   * 画像生成完通知外面。
   *
   * 档案卡自己那张图改了不算完——同一个角色在聊天列表、消息气泡、群成员里
   * 都有头像，不回写名册的话关掉卡片就又变回 SVG 了，看着像没生成成功。
   */
  readonly onPortrait?: (uid: string, url: string | null) => void;
}

export function AgentProfileModal({ target, onClose, onChat, onPortrait }: AgentProfileModalProps) {
  const isUser = target.kind === "user";

  /*
   * 画像：本地保存一份生成结果，免得为看一眼新图去刷整个列表。
   * 初值取列表里带来的那张（后端一次给全，见 tianyan-routes）。
   */
  const uid = !isUser ? target.profile?.uid ?? "" : "";
  const [portrait, setPortrait] = useState<string | null>(
    !isUser ? target.profile?.portraitUrl ?? null : null,
  );
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);

  const drawPortrait = async (): Promise<void> => {
    if (!uid) return;
    setDrawing(true);
    setDrawError(null);
    try {
      const { url } = await generateCover("agent", uid);
      setPortrait(url);
      onPortrait?.(uid, url);
    } catch (e) {
      setDrawError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setDrawing(false);
    }
  };
  const name = isUser
    ? target.card?.name ?? "我"
    : shortName(target.name);
  const hue = hueOf(isUser ? (target.card?.username ?? "me") : target.name);

  const fields: ReadonlyArray<readonly [string, string]> = isUser
    ? [
      ["简介", target.card?.bio ?? ""],
      ["人设", target.card?.persona ?? ""],
      ["引导风格", target.card?.style ?? ""],
    ]
    : [
      ["人设", target.profile?.persona ?? ""],
      ["背景", target.profile?.bio ?? ""],
      ["外貌", target.profile?.appearance ?? ""],
      ["目标", target.profile?.goal ?? ""],
      ["冲突", target.profile?.conflict ?? ""],
      ["能力", target.profile?.abilities ?? ""],
      ["关系", target.profile?.relationships ?? ""],
      ["成长", target.profile?.growth ?? ""],
      ["行为", target.profile?.behavior ?? ""],
    ];
  const shown = fields.filter(([, v]) => v.trim());

  const typeInfo = !isUser && target.profile ? agentTypeOf(target.profile.agentType) : null;
  const tier = !isUser && target.profile ? tierLabel(target.profile.tier) : null;
  const weight = isUser ? target.card?.plotParticipation ?? null : target.profile?.plotWeight ?? null;

  return (
    <div className="sim-dialog-mask" onClick={onClose}>
      <div className="prof-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="prof-close" onClick={onClose}><X size={14} /></button>

        <header className="prof-head">
          <AgentAvatar
            name={name}
            hue={hue}
            {...(!isUser && target.profile?.agentType ? { agentType: target.profile.agentType } : {})}
            {...(portrait ? { portraitUrl: portrait } : {})}
            size="lg"
          />
          <div className="prof-id">
            <div className="prof-name">
              {name}
              {isUser && <span className="prof-badge"><Sparkles size={10} />我的智能体</span>}
            </div>
            <div className="prof-sub">
              {isUser
                ? `@${target.card?.username ?? "me"}`
                : [typeInfo?.label, tier].filter(Boolean).join(" · ") || "（画像待生成）"}
              {weight !== null && weight > 0 && ` · 剧情权重 ${weight}`}
            </div>
          </div>
        </header>

        {isUser && (
          <p className="prof-note">
            这是你在故事世界里的化身，任何一本书的创作都能参与：聊天里 @它引导剧情，
            仿真里它按参与度持续在场。在「设置 · 我的智能体」里可以改人设。
          </p>
        )}

        <div className="prof-body">
          {shown.length === 0 ? (
            <p className="prof-empty">
              {isUser ? "还没有配置人设。" : "这个角色的画像还没生成——天衍跑完世界观/大纲后会补上。"}
            </p>
          ) : (
            shown.map(([label, value]) => (
              <section key={label} className="prof-field">
                <span className="prof-field-label">{label}</span>
                <p className="prof-field-text">{value}</p>
              </section>
            ))
          )}

          {!isUser && (target.profile?.flowTags?.length ?? 0) > 0 && (
            <div className="prof-tags">
              {target.profile!.flowTags.map((t) => <span key={t} className="prof-tag">{t}</span>)}
            </div>
          )}
        </div>

        {!isUser && (
          <footer className="prof-foot">
            {/*
              生成画像：按这个角色的**人设**出图（后端拼提示词时会带上
              persona/bio）——只给名字的话模型无从下手。
              生成前后都不会出现空白：没有画像时用的是 SVG 兜底。
            */}
            {uid && (
              <button
                type="button"
                className="sim-dialog-cancel"
                disabled={drawing}
                onClick={() => void drawPortrait()}
                title="按人设生成一张画像"
              >
                {drawing
                  ? <><Loader2 size={12} className="spin" /> 生成中…</>
                  : <><Sparkles size={12} /> {portrait ? "重新生成画像" : "生成画像"}</>}
              </button>
            )}
            {onChat && (
              <button
                type="button"
                className="sim-dialog-ok"
                onClick={() => { onChat(target.name); onClose(); }}
              >
                <MessageSquare size={12} /> 和 {name} 单独聊
              </button>
            )}
            {drawError && <span className="prof-err">{drawError}</span>}
          </footer>
        )}
      </div>
    </div>
  );
}
