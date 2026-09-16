/**
 * ChatList —— 左栏聊天列表（像正常聊天软件那样）。
 *
 * 三段，从上到下就是用户的使用顺序：
 *   1. 创作编排 —— 六师群聊。**书就是在这儿聊出来的**，所以永远置顶、永远可点，
 *      没有书的时候它是唯一能点的一条；
 *   2. 群聊     —— 仿真每推演一场自动出现一个（命名 = 章节/步骤）+ 用户自建的；
 *   3. 角色     —— 全书智能体名册，点一个就和他单独说话。
 *
 * 头像：六师用 emoji 徽章（他们是创作团队，不是故事角色，要一眼分得开），
 * 故事角色用 AvatarArt 画的 SVG（见 AvatarArt.tsx）。
 */
import { useState, useMemo } from "react";
import { Search, Plus, Users, UserRound, PenLine, Loader2, Radio, Eye } from "lucide-react";
import { SessionItem } from "./SessionItem";
import { AgentAvatar } from "./AgentAvatar";
import { hueOf, shortName } from "../../lib/sim-theater";
import type { TheaterSession } from "../../lib/sim-theater";
import type { GraphAgent } from "../../lib/api";
import { SIX_AGENTS } from "../../types/agents";
import type { TheaterSimState } from "../../hooks/use-simulation-theater";

/** 六师群在列表里的固定 id（不是后端会话 id，纯前端路由用）。 */
export const MASTERS_CHAT_ID = "masters";

interface ChatListProps {
  /** 六师群的副标题：最后一条消息，或当前跑到哪一步。 */
  readonly mastersSubtitle: string;
  readonly mastersBusy: boolean;
  /** 顶部状态条：仿真跑到哪了。 */
  readonly simState: TheaterSimState;
  readonly sessions: ReadonlyArray<TheaterSession>;
  readonly activeId: string;
  readonly liveSessionId: string | null;
  readonly agents: ReadonlyArray<GraphAgent>;
  /** 仿真里发过言、但画像还没生成的名字（也要能点进去）。 */
  readonly extraNames: ReadonlyArray<string>;
  readonly onSelect: (id: string) => void;
  readonly onOpenDirect: (agentName: string) => void;
  readonly onCreateGroup: () => void;
  /**
   * 此刻在看这本书的人（含自己）。
   *
   * 只有**多于一个人**时才显示——一个人看的时候标一句「1 人在看」是废话，
   * 还会让人以为这是个需要处理的状态。
   */
  readonly spectators?: ReadonlyArray<{ readonly userId: string; readonly name: string }>;
}

export function ChatList({
  mastersSubtitle, mastersBusy, simState, sessions, activeId, liveSessionId,
  agents, extraNames, onSelect, onOpenDirect, onCreateGroup, spectators,
}: ChatListProps) {
  const [q, setQ] = useState("");
  const kw = q.trim().toLowerCase();

  const cast = useMemo(() => {
    const all = [
      ...agents.map((a) => ({
        id: a.name,
        name: shortName(a.name),
        hue: hueOf(a.name),
        agentType: a.agentType,
        desc: a.bio || a.persona || "",
        weight: a.plotWeight,
      })),
      ...extraNames.map((n) => ({
        id: n, name: shortName(n), hue: hueOf(n), agentType: "",
        desc: "（画像待生成）", weight: 0,
      })),
    ];
    if (!kw) return all;
    return all.filter((c) => c.name.toLowerCase().includes(kw) || c.desc.toLowerCase().includes(kw));
  }, [agents, extraNames, kw]);

  const shownSessions = useMemo(
    () => (kw ? sessions.filter((s) => s.name.toLowerCase().includes(kw)) : sessions),
    [sessions, kw],
  );

  const showMasters = !kw || "创作编排六师".includes(kw) || "masters".includes(kw);

  return (
    <aside className="chat-list">
      {/* 顶部状态：仿真在不在跑、跑了几场几轮。如实显示，没有播放/暂停按钮——
          轮次是后端编排自己推的，前端造一个「播放」只是假的掌控感。 */}
      <div className="chat-list-status">
        <span className="chat-list-brand"><Radio size={12} /> 仿真剧场</span>
        {simState.isRunning
          ? <span className="chat-list-run"><Loader2 size={10} className="spin" />推演中</span>
          : simState.awaitingReview
            ? <span className="chat-list-run is-gate">等你拍板</span>
            : null}
        {simState.totalRuns > 0 && (
          <span className="chat-list-stat">{simState.totalRuns} 场 · {simState.totalRounds} 轮</span>
        )}
        {/* 建群入口放在最顶上（面板右上角），聊天列表里只放聊天。 */}
        <button
          type="button"
          className={`chat-list-new${simState.totalRuns > 0 ? "" : " is-alone"}`}
          onClick={onCreateGroup}
          title="拉角色建群"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* 一起看的人。一个人时不显示——那句「1 人在看」纯属噪音。 */}
      {(spectators?.length ?? 0) > 1 && (
        <div className="chat-list-live" title={spectators!.map((s) => s.name).join("、")}>
          <Eye size={11} />
          <span className="chat-list-live-faces">
            {spectators!.slice(0, 5).map((s) => (
              <AgentAvatar key={s.userId} name={s.name} hue={hueOf(s.userId)} size="sm" />
            ))}
          </span>
          <span className="chat-list-live-text">{spectators!.length} 人在看</span>
        </div>
      )}

      <div className="chat-list-search">
        <Search size={12} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜聊天 / 角色…" />
      </div>

      <div className="chat-list-body">
        {/* ── 创作编排：六师群 ── */}
        {showMasters && (
          <>
            <div className="chat-list-head"><PenLine size={11} /> 创作</div>
            <button
              type="button"
              className={`sim-session${activeId === MASTERS_CHAT_ID ? " is-active" : ""}`}
              onClick={() => onSelect(MASTERS_CHAT_ID)}
            >
              <div className="chat-masters-faces">
                {SIX_AGENTS.slice(0, 3).map((a) => (
                  <span key={a.role} className="chat-master-face" title={`${a.name}·${a.title}`}>
                    {a.emoji}
                  </span>
                ))}
              </div>
              <div className="sim-session-body">
                <div className="sim-session-top">
                  <span className="sim-session-name">六师 · 创作编排</span>
                  {mastersBusy && <span className="sim-session-live">生成中</span>}
                </div>
                <div className="sim-session-last" title={mastersSubtitle}>
                  {mastersSubtitle || "和六师聊聊你想写什么"}
                </div>
                <div className="sim-session-meta">
                  <span className="sim-session-tag is-custom">六师</span>
                  <span>{SIX_AGENTS.length} 人</span>
                </div>
              </div>
            </button>
          </>
        )}

        {/* ── 群聊 ── */}
        <div className="chat-list-head"><Users size={11} /> 群聊</div>
        {shownSessions.length === 0 ? (
          <p className="sim-sidebar-empty">
            {agents.length === 0
              ? "还没有角色。先在上面和六师聊出一本书，仿真跑起来后每推演一场会自动建一个群。"
              : "还没有群聊。仿真每推演一场会自动建一个群，也可以点右上角的 ＋ 拉角色开一场。"}
          </p>
        ) : (
          shownSessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              active={s.id === activeId}
              live={s.id === liveSessionId}
              onSelect={onSelect}
            />
          ))
        )}

        {/* ── 角色 ── */}
        {cast.length > 0 && (
          <>
            <div className="chat-list-head"><UserRound size={11} /> 角色 <i>{cast.length}</i></div>
            {cast.map((c) => (
              <button
                key={c.id}
                type="button"
                className="sim-cast"
                onClick={() => onOpenDirect(c.id)}
                title={`和 ${c.name} 单独说话`}
              >
                <AgentAvatar name={c.name} hue={c.hue} agentType={c.agentType} size="sm" />
                <span className="sim-cast-body">
                  <span className="sim-cast-name">{c.name}</span>
                  <span className="sim-cast-desc">{c.desc || "（暂无简介）"}</span>
                </span>
                {c.weight > 0 && <span className="sim-cast-weight">{c.weight}</span>}
              </button>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
