/**
 * GroupInfoPanel —— 右上角「⋯」打开的群信息。
 *
 * 一个群里能做的事都收在这儿：看这是哪一场推演、谁在场、点某个人看档案或直接
 * 私聊、把这段戏分享出去。
 *
 * 分享是**真的**：后端存一份只读快照 + token，`/share/<token>` 是任何人都能打开
 * 的页面（不需要登录）。二维码在前端本地画，不外发。
 */
import { useState } from "react";
import { X, Share2, Link2, Check, Loader2, MessageSquare, QrCode } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { QrCanvas } from "./QrCanvas";
import { stageLabel } from "../../lib/sim-theater";
import type { TheaterSession, TheaterMessage } from "../../lib/sim-theater";
import { createTheaterShare } from "../../lib/api";

interface GroupInfoPanelProps {
  readonly session: TheaterSession;
  readonly messages: ReadonlyArray<TheaterMessage>;
  readonly bookId: string | null;
  readonly onClose: () => void;
  readonly onOpenProfile: (agentName: string) => void;
  readonly onChat: (agentName: string) => void;
}

const KIND_TEXT: Readonly<Record<TheaterSession["kind"], string>> = {
  round: "仿真自动建的群 —— 这一场推演的全部发言",
  custom: "你拉起来的群",
  direct: "私聊",
};

export function GroupInfoPanel({
  session, messages, bookId, onClose, onOpenProfile, onChat,
}: GroupInfoPanelProps) {
  const [share, setShare] = useState<{ url: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const makeShare = async () => {
    if (!bookId) { setError("这本书还没建好，暂时不能分享"); return; }
    setSharing(true);
    setError(null);
    try {
      const s = await createTheaterShare(bookId, session.id, {
        title: session.name,
        memberNames: session.members.map((m) => m.id),
        messages: messages.map((m) => ({
          senderId: m.senderId, senderName: m.senderName, kind: m.kind,
          content: m.content, round: m.round, ts: m.ts,
        })),
      });
      setShare({ url: s.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成分享链接失败");
    } finally {
      setSharing(false);
    }
  };

  const copy = async () => {
    if (!share) return;
    await navigator.clipboard.writeText(share.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="ginfo-mask" onClick={onClose}>
      <aside className="ginfo" onClick={(e) => e.stopPropagation()}>
        <header className="ginfo-head">
          <h3>群信息</h3>
          <button type="button" onClick={onClose}><X size={14} /></button>
        </header>

        <div className="ginfo-body">
          <section className="ginfo-meta">
            <div className="ginfo-title">{session.name}</div>
            <p className="ginfo-sub">{KIND_TEXT[session.kind]}</p>
            <ul className="ginfo-facts">
              {session.chapter !== null && <li>第 {session.chapter} 章</li>}
              <li>{stageLabel(session.stage)}</li>
              {session.rounds > 0 && <li>{session.rounds} 轮推演</li>}
              <li>{messages.length} 条消息</li>
              <li>{session.members.length} 个角色</li>
            </ul>
          </section>

          <section>
            <div className="ginfo-label">在场角色</div>
            {session.members.length === 0 ? (
              <p className="prof-empty">这个群还没有角色。</p>
            ) : (
              session.members.map((m) => (
                <div key={m.id} className="ginfo-member">
                  <button
                    type="button"
                    className="ginfo-member-main"
                    onClick={() => onOpenProfile(m.id)}
                    title="看档案"
                  >
                    <AgentAvatar name={m.name} hue={m.hue} agentType={m.agentType} size="sm" status={m.status} />
                    <span className="ginfo-member-body">
                      <span className="ginfo-member-name">{m.name}</span>
                      <span className="ginfo-member-desc">
                        {m.bio || (m.speeches > 0 ? `本场 ${m.speeches} 次发言` : "（画像待生成）")}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ginfo-member-chat"
                    onClick={() => { onChat(m.id); onClose(); }}
                    title={`和 ${m.name} 私聊`}
                  >
                    <MessageSquare size={12} />
                  </button>
                </div>
              ))
            )}
          </section>

          <section>
            <div className="ginfo-label">分享这场戏</div>
            {!share ? (
              <>
                <p className="prof-empty">
                  生成一个只读链接，任何人打开都能看这段群聊（不需要登录，也看不到你的其他内容）。
                </p>
                <button type="button" className="ginfo-share" disabled={sharing} onClick={makeShare}>
                  {sharing ? <Loader2 size={12} className="spin" /> : <Share2 size={12} />}
                  生成分享链接
                </button>
              </>
            ) : (
              <>
                <div className="ginfo-link">
                  <Link2 size={12} />
                  <input readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" onClick={copy} title="复制">
                    {copied ? <Check size={12} /> : <Link2 size={12} />}
                  </button>
                </div>
                <button type="button" className="ginfo-share" onClick={() => setShowQr((v) => !v)}>
                  <QrCode size={12} /> {showQr ? "收起二维码" : "二维码"}
                </button>
                {showQr && (
                  <div className="ginfo-qr">
                    <QrCanvas text={share.url} size={168} />
                    <p className="prof-empty">长按 / 右键保存图片即可分享出去。</p>
                  </div>
                )}
              </>
            )}
            {error && <p className="ginfo-error">{error}</p>}
          </section>
        </div>
      </aside>
    </div>
  );
}
