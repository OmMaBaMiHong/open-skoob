import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { History, X } from "lucide-react";
import { AUTH_CHANGED_EVENT, readAuth } from "../../lib/auth-storage";
import { fetchRecentAgentSessions, type RecentAgentSession } from "../../lib/general-agent-api";
import "../../styles/agent-history.css";

export function RecentAgentSessions() {
  const [owner, setOwner] = useState(() => readAuth()?.userId), [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<RecentAgentSession[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef<AbortController>(), panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); setSessions([]); request.current?.abort(); }, [pathname]);
  useEffect(() => {
    const changed = () => { request.current?.abort(); setOpen(false); setSessions([]); setCursor(null); setOwner(readAuth()?.userId); };
    window.addEventListener(AUTH_CHANGED_EVENT, changed); window.addEventListener("storage", changed);
    return () => { request.current?.abort(); window.removeEventListener(AUTH_CHANGED_EVENT, changed); window.removeEventListener("storage", changed); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    window.addEventListener("keydown", close); window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("pointerdown", outside); };
  }, [open]);
  const load = async (after?: string) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const result = await fetchRecentAgentSessions(after, controller.signal);
      if (controller.signal.aborted) return;
      setSessions(previous => after ? [...previous, ...result.sessions.filter(item => !previous.some(old => old.id === item.id))] : result.sessions);
      setCursor(result.nextCursor);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取会话失败"); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  if (!owner) return null;
  return <><button ref={trigger} className="agent-history-trigger" aria-expanded={open} aria-controls="agent-history" title="最近会话" onClick={() => { setOpen(!open); if (!open) void load(); }}><History size={16} /><span>最近会话</span></button>
    {open && createPortal(<div ref={panel} id="agent-history" className="agent-history" aria-label="最近会话">
      <header><strong>最近会话</strong><button aria-label="关闭最近会话" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button></header>
      <Link className="agent-history-new" to="/agent" onClick={() => setOpen(false)}>新会话</Link>
      <div className="agent-history-list">{sessions.map(session => <Link key={session.id} to={`/agent/${encodeURIComponent(session.id)}`} state={{ restoreConversation: true }} onClick={() => setOpen(false)}>
        <strong>{session.title}</strong><small>{session.kind === "deconstruction" ? "拆书" : session.kind === "creation" ? "创作" : "对话"} · {new Date(session.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}{["running", "waiting_external", "queued"].includes(session.status) ? " · 进行中" : ""}</small>
      </Link>)}</div>
      {error && <p role="alert">{error}<button onClick={() => void load()}>重试</button></p>}
      {busy ? <p role="status">正在读取…</p> : !sessions.length && !error ? <p>还没有会话，聊过的内容会保存在这里。</p> : cursor && <button className="agent-history-more" onClick={() => void load(cursor)}>加载更早的会话</button>}
    </div>, document.body)}</>;
}
