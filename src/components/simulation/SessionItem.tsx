/**
 * SessionItem —— 左侧一条群聊。
 *
 * 一行要交代清楚四件事：这是哪一场（群名 = 章节/步骤）、谁在里面（成员头像）、
 * 最后一句说了什么、这场跑了多少轮。仿真在跑的那一场额外标「进行中」。
 */
import { AgentAvatar } from "./AgentAvatar";
import type { TheaterSession } from "../../lib/sim-theater";

interface SessionItemProps {
  readonly session: TheaterSession;
  readonly active: boolean;
  readonly live: boolean;
  readonly onSelect: (id: string) => void;
}

const KIND_TAG: Readonly<Record<TheaterSession["kind"], string>> = {
  round: "自动",
  custom: "自建",
  direct: "私聊",
};

export function SessionItem({ session, active, live, onSelect }: SessionItemProps) {
  return (
    <button
      type="button"
      className={`sim-session${active ? " is-active" : ""}`}
      onClick={() => onSelect(session.id)}
    >
      <div className="sim-session-faces">
        {session.members.slice(0, 3).map((m) => (
          <AgentAvatar key={m.id} name={m.name} hue={m.hue} agentType={m.agentType} size="sm" />
        ))}
        {session.members.length === 0 && <span className="sim-session-empty">·</span>}
      </div>
      <div className="sim-session-body">
        <div className="sim-session-top">
          <span className="sim-session-name" title={session.name}>{session.name}</span>
          {live && <span className="sim-session-live">进行中</span>}
        </div>
        <div className="sim-session-last" title={session.lastMessage ?? ""}>
          {session.lastMessage ?? (session.kind === "round" ? "（本场没有实质发言）" : "还没有人说话")}
        </div>
        <div className="sim-session-meta">
          <span className={`sim-session-tag is-${session.kind}`}>{KIND_TAG[session.kind]}</span>
          {session.members.length > 0 && <span>{session.members.length} 人</span>}
          {session.rounds > 0 && <span>{session.rounds} 轮</span>}
        </div>
      </div>
    </button>
  );
}
