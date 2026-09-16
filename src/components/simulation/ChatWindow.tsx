/**
 * ChatWindow —— 中间的群聊窗口。
 *
 * 头部说清「这是哪一场、谁在场」；正文按轮次分隔（一轮 = 仿真推演的一个回合）；
 * 底部是导演输入区。新一轮进来时贴底滚动，用户往上翻时不抢滚动条。
 */
import { useRef, useEffect, useMemo, useState } from "react";
import { Loader2, MoreHorizontal, BookOpen, PanelLeft, PanelRight } from "lucide-react";
import { Link } from "react-router-dom";
import { GroupInfoPanel } from "./GroupInfoPanel";
import { ChatMessage } from "./ChatMessage";
import { ChatComposer } from "./ChatComposer";
import { AgentAvatar } from "./AgentAvatar";
import { shortName, hueOf } from "../../lib/sim-theater";
import type { TheaterSession, TheaterMessage } from "../../lib/sim-theater";
import type { UserMode } from "../../types/simulation";

interface ChatWindowProps {
  readonly session: TheaterSession | null;
  readonly messages: ReadonlyArray<TheaterMessage>;
  readonly userMode: UserMode;
  readonly live: boolean;
  readonly sending: boolean;
  readonly loading: boolean;
  readonly bookId: string | null;
  /** 导演自己的化身（账号自带的创作智能体）。 */
  readonly me: { readonly name: string; readonly hue: number };
  readonly onSend: (content: string) => void;
  readonly onModeChange: (mode: UserMode) => void;
  readonly onOpenProfile: (target: { kind: "agent"; name: string } | { kind: "user" }) => void;
  readonly onChat: (agentName: string) => void;
  /** 推进到下一章/下一轮。不给则不显示按钮。 */
  readonly onAdvance?: () => void;
  readonly advancing?: boolean;
  /**
   * 谁正在说、说到哪了（逐字流）。
   *
   * 单独一个 prop 而不是塞进 messages：它**不是消息**——刷新就没了，也不该
   * 参与去重、未读、分享。混进去的话，某天导出群聊记录就会带上半句话。
   */
  readonly typing?: { readonly name: string; readonly text: string } | null;
  /** 窄屏抽屉开关。不传就不显示按钮（宽屏两栏本来就并列）。 */
  readonly onToggleDrawer?: (which: "list" | "prod") => void;
}

export function ChatWindow({
  session, messages, userMode, live, sending, loading, bookId, me,
  onSend, onModeChange, onOpenProfile, onChat, onAdvance, advancing, typing, onToggleDrawer,
}: ChatWindowProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [info, setInfo] = useState(false);

  // 贴底滚动：只有本来就在底部附近时才跟，避免用户回看时被拽走。
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
    // 逐字流也要跟着滚，否则新出的字很快就顶到可视区外面去了。
  }, [messages.length, typing?.text]);

  const memberById = useMemo(() => {
    const map = new Map<string, TheaterSession["members"][number]>();
    for (const m of session?.members ?? []) map.set(m.id, m);
    return map;
  }, [session]);

  /*
   * 抽屉开关在**每一个分支**里都要有。
   *
   * 加载中、没有群聊这两条是早退分支，原来直接返回一块空白——窄屏上左右两栏
   * 是抽屉，没有这两个按钮用户就被困在空荡荡的中间一栏，连聊天列表都打不开，
   * 而「还没有群聊」恰恰是最需要去左边找入口的时候。
   */
  const drawerButtons = onToggleDrawer ? (
    <>
      <button
        type="button"
        className="sim-drawer-btn sim-drawer-left"
        onClick={() => onToggleDrawer("list")}
        aria-label="聊天列表"
        title="聊天列表"
      >
        <PanelLeft size={16} />
      </button>
      <button
        type="button"
        className="sim-drawer-btn sim-drawer-right"
        onClick={() => onToggleDrawer("prod")}
        aria-label="产出面板"
        title="产出面板"
      >
        <PanelRight size={16} />
      </button>
    </>
  ) : null;

  if (loading) {
    return (
      <section className="sim-chat">
        <header className="sim-chat-head sim-chat-head-bare">{drawerButtons}</header>
        <div className="sim-chat-blank"><Loader2 size={16} className="spin" /> 正在读取推演记录…</div>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="sim-chat">
        <header className="sim-chat-head sim-chat-head-bare">{drawerButtons}</header>
        <div className="sim-chat-blank">
          <p>还没有可看的群聊。</p>
          <p className="sim-dim">这本书跑起仿真后，每推演一场会自动建一个群；也可以在左侧「角色」页签里拉人开一场。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="sim-chat">
      <header className="sim-chat-head">
        {/*
          窄屏上左右两栏是抽屉，这两个按钮是唯一入口（宽屏 display:none）。
          原来窄屏上左栏照旧占 280px，中间只剩 166px，发送按钮被挤出屏幕。
        */}
        {onToggleDrawer && (
          <button
            type="button"
            className="sim-drawer-btn sim-drawer-left"
            onClick={() => onToggleDrawer("list")}
            aria-label="聊天列表"
            title="聊天列表"
          >
            <PanelLeft size={16} />
          </button>
        )}
        <div className="sim-chat-title">
          <h2>{session.name}</h2>
          {live && <span className="sim-chat-live"><i />推演中</span>}
        </div>
        <div className="sim-chat-right">
          {/*
            这一场演的是第几章，就直接跳到那一章的正文。
            没有这个入口时，用户要从剧场退出去、进作品库、找到书、切到正文
            tab、再翻到那一章——五步只为对照刚才演的内容。
          */}
          {bookId && session.chapter !== null && (
            <Link
              className="sim-chat-text-btn"
              to={`/library/${encodeURIComponent(bookId)}?tab=chapters&chapter=${session.chapter}`}
              title={`查看第 ${session.chapter} 章正文`}
            >
              <BookOpen size={13} /> 查看正文
            </Link>
          )}
          <div className="sim-chat-members">
            {session.members.slice(0, 8).map((m) => (
              <button
                key={m.id}
                type="button"
                className="sim-chat-face"
                onClick={() => onOpenProfile({ kind: "agent", name: m.id })}
                title={`${m.fullName}${m.speeches ? `｜本场 ${m.speeches} 次发言` : ""}｜点开看档案`}
              >
                <AgentAvatar name={m.name} hue={m.hue} agentType={m.agentType} size="sm" status={m.status} />
              </button>
            ))}
            {session.members.length > 8 && <span className="sim-chat-more">+{session.members.length - 8}</span>}
          </div>
          <button
            type="button"
            className="sim-chat-more-btn"
            onClick={() => setInfo(true)}
            title="群信息 · 成员 · 分享"
          >
            <MoreHorizontal size={16} />
          </button>
          {onToggleDrawer && (
            <button
              type="button"
              className="sim-drawer-btn sim-drawer-right"
              onClick={() => onToggleDrawer("prod")}
              aria-label="产出面板"
              title="产出面板"
            >
              <PanelRight size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="sim-chat-body" ref={bodyRef}>
        {messages.length === 0 ? (
          <div className="sim-chat-blank">
            {session.kind === "round" ? (
              <>
                <p>这一场还没有实质发言。</p>
                <p className="sim-dim">仿真只把「有内容的动作」算作发言，点赞/关注这类不进群聊。</p>
              </>
            ) : session.kind === "direct" ? (
              <>
                <p>还没和{session.members[0]?.name ?? "他"}说过话。</p>
                <p className="sim-dim">说一句，他会按自己的人设回你。</p>
              </>
            ) : (
              <>
                <p>群刚拉起来，还没人开口。</p>
                <p className="sim-dim">你先说一句，在场的角色会各自按人设接话。</p>
              </>
            )}
          </div>
        ) : (
          messages.map((msg, i) => {
            const prev = messages[i - 1];
            const newRound = msg.kind === "agent" && (!prev || prev.round !== msg.round);
            const showHead = !prev || prev.senderId !== msg.senderId || prev.kind !== msg.kind || newRound;
            return (
              <div key={msg.id}>
                {newRound && msg.round >= 0 && (
                  <div className="sim-round-sep"><span>第 {msg.round} 轮</span></div>
                )}
                <ChatMessage
                  message={msg}
                  member={memberById.get(msg.senderId)}
                  showHead={showHead}
                  me={me}
                  onOpenProfile={onOpenProfile}
                />
              </div>
            );
          })
        )}

        {/*
          正在打字的那一句。
          放在消息流末尾而不是浮在底部：它就该出现在「下一条消息会在的地方」，
          不然文字流完、气泡换成真消息时会跳位。
        */}
        {typing && (
          <div className="sim-typing">
            <AgentAvatar
              name={shortName(typing.name)}
              hue={hueOf(typing.name)}
              {...(memberById.get(typing.name)?.agentType
                ? { agentType: memberById.get(typing.name)!.agentType }
                : {})}
              size="sm"
            />
            <div className="sim-typing-body">
              <div className="sim-typing-name">{shortName(typing.name)}</div>
              <div className="sim-typing-text">
                {typing.text}
                <i className="sim-typing-caret" />
              </div>
            </div>
          </div>
        )}
      </div>

      <ChatComposer
        userMode={userMode}
        sessionKind={session.kind}
        members={session.members}
        sending={sending}
        onSend={onSend}
        onModeChange={onModeChange}
        {...(onAdvance && session.kind === "round" ? { onAdvance } : {})}
        advancing={advancing ?? false}
        advanceLabel={session.stage === "chapter_write" ? "下一章" : "下一轮"}
      />

      {info && (
        <GroupInfoPanel
          session={session}
          messages={messages}
          bookId={bookId}
          onClose={() => setInfo(false)}
          onOpenProfile={(name) => onOpenProfile({ kind: "agent", name })}
          onChat={onChat}
        />
      )}
    </section>
  );
}
