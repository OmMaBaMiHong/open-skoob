/**
 * ChatComposer —— 导演输入区。
 *
 * 三种身份决定这句话怎么进上下文：围观（不能发）、参与（建议）、引导（指令）。
 * 默认围观——推演本来就是自动跑的，用户不介入时不该有个输入框逼他说话。
 * `@` 唤出在场角色，点名让谁回应。
 */
import { useState, useRef, useCallback, useMemo } from "react";
import { Send, Eye, MessageCircle, Compass, Loader2, AtSign, FastForward } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { USER_MODE_LABELS, type UserMode } from "../../types/simulation";
import type { TheaterMember } from "../../lib/sim-theater";

interface ChatComposerProps {
  readonly userMode: UserMode;
  /** 自动群（仿真推演出来的）和自建群，发言的去向不一样，提示语也不一样。 */
  readonly sessionKind: "round" | "custom" | "direct";
  readonly members: ReadonlyArray<TheaterMember>;
  readonly sending: boolean;
  readonly onSend: (content: string) => void;
  readonly onModeChange: (mode: UserMode) => void;
  /**
   * 推进到下一轮（自动群里就是下一章）。
   * 不给这个回调时不渲染按钮——自建群/私聊没有"下一章"这回事。
   */
  readonly onAdvance?: () => void;
  readonly advancing?: boolean;
  /** 按钮文案：章节场景预演里叫「下一章」，其他叫「下一轮」。 */
  readonly advanceLabel?: string;
}

const MODES: ReadonlyArray<{ value: UserMode; icon: typeof Eye }> = [
  { value: "observe", icon: Eye },
  { value: "participate", icon: MessageCircle },
  { value: "guide", icon: Compass },
];

/**
 * 提示语要说清这句话**去哪儿**：
 * - 自动群：这一场是仿真推演出来的，你说的话进创作链，影响后续生成；
 * - 自建群/私聊：角色当场按人设回你。
 * 写成一样的会让人以为在自动群里角色会立刻搭话。
 */
const PLACEHOLDER: Readonly<Record<"round" | "user", Record<UserMode, string>>> = {
  round: {
    observe: "围观中 —— 切到「参与」或「引导」才能发言",
    participate: "说一句，作为建议进入后续推演与生成…",
    guide: "以导演身份下指令，直接影响后续生成…",
  },
  user: {
    observe: "围观中 —— 切到「参与」或「引导」才能发言",
    participate: "说点什么，在场的角色会按人设回你…",
    guide: "给角色下指令，他们会顺着演…",
  },
};

export function ChatComposer({
  userMode, sessionKind, members, sending, onSend, onModeChange,
  onAdvance, advancing = false, advanceLabel = "下一轮",
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const readOnly = userMode === "observe";

  const mentionable = useMemo(() => members.slice(0, 12), [members]);

  const send = useCallback(() => {
    const t = text.trim();
    if (!t || readOnly || sending) return;
    onSend(t);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  }, [text, readOnly, sending, onSend]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  const grow = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  }, []);

  const mention = useCallback((name: string) => {
    setText((t) => (t ? `${t} @${name} ` : `@${name} `));
    setShowMentions(false);
    ref.current?.focus();
  }, []);

  return (
    <div className="sim-composer">
      <div className="sim-composer-modes">
        {MODES.map(({ value, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className={`sim-mode${userMode === value ? " is-active" : ""}`}
            onClick={() => onModeChange(value)}
          >
            <Icon size={11} /> {USER_MODE_LABELS[value]}
          </button>
        ))}
        {!readOnly && mentionable.length > 0 && (
          <button
            type="button"
            className="sim-mode sim-mode-at"
            onClick={() => setShowMentions((v) => !v)}
            title="点名让谁回应"
          >
            <AtSign size={11} /> 点名
          </button>
        )}
        {/*
          推进按钮。演完这一场之后要往下走，从前只能退出剧场回工作台点「写下一章」——
          而人正看着这一场的结尾，最想做的就是接着往下。放在身份切换这一排，
          因为它和「我要怎么参与」是同一类操作：都决定下一步发生什么。
        */}
        {onAdvance && (
          <button
            type="button"
            className="sim-mode sim-mode-next"
            onClick={onAdvance}
            disabled={advancing}
            title={`${advanceLabel} —— 先跑场景预演，再据此成文`}
          >
            {advancing ? <Loader2 size={11} className="spin" /> : <FastForward size={11} />} {advanceLabel}
          </button>
        )}
      </div>

      {showMentions && !readOnly && (
        <div className="sim-mentions">
          {mentionable.map((m) => (
            <button key={m.id} type="button" className="sim-mention" onClick={() => mention(m.name)}>
              <AgentAvatar name={m.name} hue={m.hue} agentType={m.agentType} size="sm" />
              {m.name}
            </button>
          ))}
        </div>
      )}

      <div className="sim-composer-row">
        <textarea
          ref={ref}
          value={text}
          onChange={grow}
          onKeyDown={onKeyDown}
          placeholder={PLACEHOLDER[sessionKind === "round" ? "round" : "user"][userMode]}
          disabled={readOnly}
          rows={1}
        />
        <button
          type="button"
          className="sim-send"
          onClick={send}
          disabled={readOnly || sending || !text.trim()}
        >
          {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}
