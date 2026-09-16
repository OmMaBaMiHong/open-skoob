/**
 * ChatMessage —— 群里的一条消息。
 *
 * 三种来源分别长得不一样：智能体发言（左，带头像与动作标签）、
 * 导演发言（右，橙气泡）、剧场系统回话（居中细条）。
 */
import { AgentAvatar } from "./AgentAvatar";
import { SIM_ACTION_LABELS } from "../../lib/sim-feed";
import type { TheaterMessage, TheaterMember } from "../../lib/sim-theater";

interface ChatMessageProps {
  readonly message: TheaterMessage;
  readonly member: TheaterMember | undefined;
  /** 连续同一个人说话时只在第一条显示头像与名字。 */
  readonly showHead: boolean;
  /** 导演（用户）自己的化身：名字与头像底色。没登录时给个默认的。 */
  readonly me: { readonly name: string; readonly hue: number };
  /** 点头像看档案。 */
  readonly onOpenProfile: (target: { kind: "agent"; name: string } | { kind: "user" }) => void;
}

function clock(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ChatMessage({
  message, member, showHead, me, onOpenProfile,
}: ChatMessageProps) {
  if (message.kind === "user") {
    // 用户也是一个智能体（账号自带的创作化身），所以他的头像同样点得开档案。
    return (
      <div className="sim-msg is-user">
        <div className="sim-msg-main">
          <div className="sim-msg-bubble">{message.content}</div>
          <div className="sim-msg-foot">{me.name} · {clock(message.ts)}</div>
        </div>
        <button
          type="button"
          className="sim-msg-avatar is-clickable"
          onClick={() => onOpenProfile({ kind: "user" })}
          title={`${me.name}（我的智能体）`}
        >
          <AgentAvatar name={me.name} hue={me.hue} size="md" />
        </button>
      </div>
    );
  }

  if (message.kind === "system") {
    return (
      <div className="sim-msg is-system">
        <div className="sim-msg-system">{message.content}</div>
      </div>
    );
  }

  const label = SIM_ACTION_LABELS[message.action];
  return (
    <div className={`sim-msg is-agent${showHead ? "" : " is-cont"}`}>
      {showHead && member ? (
        <button
          type="button"
          className="sim-msg-avatar is-clickable"
          onClick={() => onOpenProfile({ kind: "agent", name: member.id })}
          title="看档案"
        >
          <AgentAvatar
            name={member.name}
            hue={member.hue}
            agentType={member.agentType}
            size="md"
            status={member.status}
          />
        </button>
      ) : (
        <div className="sim-msg-avatar" />
      )}
      <div className="sim-msg-main">
        {showHead && (
          <div className="sim-msg-head">
            <span className="sim-msg-name">{message.senderName}</span>
            {label && <span className="sim-msg-action">{label}</span>}
            {message.round >= 0 && <span className="sim-msg-round">第 {message.round} 轮</span>}
            <span className="sim-msg-time">{clock(message.ts)}</span>
          </div>
        )}
        <div className="sim-msg-bubble">{message.content}</div>
      </div>
    </div>
  );
}
