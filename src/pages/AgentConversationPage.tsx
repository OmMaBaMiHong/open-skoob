import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { inferGeneralPersona, TERMINAL_RUN_STATUSES, type AgentDestination, type ArtifactRef, type GeneralAttachment } from "../lib/general-agent-contracts";
import { GeneralComposer } from "../components/agent/GeneralComposer";
import { ArtifactHtmlPreview } from "../components/agent/ArtifactHtmlPreview";
import { AgentMarkdown } from "../components/agent/AgentMarkdown";
import { AgentOnboarding } from "../components/agent/AgentOnboarding";
import { SkoobLogo } from "../components/SkoobLogo";
import { fetchOfficialPersonas, ENGINE_NAMES, type PublicPersona } from "../lib/official-personas";
import { useGeneralAgent } from "../hooks/use-general-agent";
import { useFollowOutput } from "../hooks/use-follow-output";
import { fetchGeneralArtifact, fetchGeneralOriginal, retryGeneralAttachment } from "../lib/general-agent-api";
import type { GeneralAgentDraft } from "../lib/general-agent-draft";
import { creationNavigationState, destinationPath } from "../lib/agent-navigation";
import "../styles/general-agent.css";

const statuses = { queued: "已接收", waiting_resources: "等待附件", running: "执行中", waiting_user: "等你回答", waiting_external: "任务进行中",
  cancelling: "正在停止", succeeded: "已完成", failed: "执行失败", cancelled: "已停止", interrupted: "需要恢复处理" };
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function AttachmentResource({ sessionId, attachment, refresh }: { sessionId: string; attachment: GeneralAttachment; refresh: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const labels = { uploading: "正在上传", stored: "等待解析", parsing: "正在解析", ready: "可读取", failed: "解析失败" };
  const act = async (retry: boolean) => {
    setBusy(true); setError(null);
    try {
      if (retry) { await retryGeneralAttachment(sessionId, attachment.id, attachment.revision); await refresh(); }
      else saveBlob(await fetchGeneralOriginal(sessionId, attachment.id, attachment.revision), attachment.filename);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "附件操作失败"); }
    finally { setBusy(false); }
  };
  return <details className="ga-resource"><summary>{attachment.filename} · {labels[attachment.status]}</summary>
    <p>{(attachment.byteLength / 1024).toFixed(1)} KB · 版本 {attachment.revision}{attachment.charCount !== undefined ? ` · ${attachment.charCount.toLocaleString()} 字` : ""}</p>
    {(error || attachment.error) && <p className="ga-error">{error ?? attachment.error?.message}</p>}
    <button type="button" disabled={busy} onClick={() => void act(false)}>下载原文件</button>
    {attachment.status === "failed" && <button type="button" disabled={busy} onClick={() => void act(true)}>重试解析</button>}
  </details>;
}

function ArtifactContent({ sessionId, artifact, onClose, onUse }: { sessionId: string; artifact: ArtifactRef; onClose: () => void; onUse: () => void }) {
  const [content, setContent] = useState<{ image?: string; text?: string; binary?: boolean } | null>(null), [error, setError] = useState<string | null>(null), [preview, setPreview] = useState(false);
  const panel = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width:800px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width:800px)"), change = () => setNarrow(query.matches);
    query.addEventListener("change", change); return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; closeButton.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [artifact.id, artifact.revision]);
  useEffect(() => {
    const controller = new AbortController(); let url: string | undefined;
    setContent(null); setError(null); setPreview(false);
    void fetchGeneralArtifact(sessionId, artifact.id, artifact.revision, controller.signal).then(async blob => {
      if (controller.signal.aborted) return;
      if (/^image\/(png|jpeg|webp)$/.test(blob.type)) { url = URL.createObjectURL(blob); setContent({ image: url }); }
      else if (blob.type.startsWith("text/") || blob.type.includes("json")) { const text = await blob.text(); if (!controller.signal.aborted) setContent({ text }); }
      else setContent({ binary: true });
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "产物暂不可读"); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [sessionId, artifact.id, artifact.revision]);
  const download = async () => {
    try {
      const blob = await fetchGeneralArtifact(sessionId, artifact.id, artifact.revision);
      saveBlob(blob, artifact.title);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "下载失败"); }
  };
  return <aside ref={panel} className="ga-artifact-panel" role={narrow ? "dialog" : undefined} aria-modal={narrow || undefined} aria-label="产物详情" onKeyDown={event => {
    if (!narrow || event.key !== "Tab") return;
    const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe') ?? []);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <header><div><h2>{artifact.title}</h2><small>版本 {artifact.revision}</small></div><button ref={closeButton} type="button" onClick={onClose}>关闭</button></header>
    <div className="ga-artifact-actions"><button type="button" onClick={() => void download()}>下载</button><button type="button" onClick={onUse}>继续引用</button>
      {(artifact.kind === "code" || artifact.kind === "file") && <button type="button" onClick={() => setPreview(value => !value)}>{preview ? "查看文件" : "交互预览"}</button>}</div>
    {error && <p role="alert" className="ga-error">{error}</p>}
    {preview ? <ArtifactHtmlPreview sessionId={sessionId} artifact={artifact} /> : content?.image ? <img className="ga-artifact-image" src={content.image} alt={artifact.title} />
      : content?.text !== undefined ? artifact.kind === "report" ? <AgentMarkdown text={content.text} /> : <pre className="ga-artifact-text">{content.text}</pre> : content?.binary ? <p>此文件可下载后查看。</p> : !error && <p role="status">正在读取产物…</p>}
  </aside>;
}

export function AgentConversationPage() {
  const { sessionId } = useParams<{ sessionId: string }>(), navigate = useNavigate();
  const location = useLocation();
  const agent = useGeneralAgent(sessionId ?? null);
  const [personas, setPersonas] = useState<PublicPersona[]>([]), [selectedPersona, setSelectedPersona] = useState("auto");
  const [suggestion, setSuggestion] = useState("");
  const [personaError, setPersonaError] = useState("");
  useEffect(() => {
    let active = true;
    void fetchOfficialPersonas().then(result => { if (active) setPersonas(result.personas); }).catch(() => { if (active) setPersonaError("官方角色暂时无法读取，仍可继续普通聊天。"); });
    return () => { active = false; };
  }, []);
  const latestInput = agent.state?.inputs.at(-1);
  const explicitPersona = sessionId ? latestInput?.officialPersonaId : selectedPersona === "auto" ? undefined : selectedPersona;
  const personaId = explicitPersona ?? inferGeneralPersona(sessionId ? latestInput : undefined);
  const persona = personas.find(item => item.id === personaId) ?? (!explicitPersona ? personas.find(item => item.id === "zhushen") : undefined);
  const sender = (runId: string) => {
    const userMessage = agent.state?.messages.find(message => message.role === "user" && message.runId === runId);
    const input = agent.state?.inputs.find(input => input.messageId === userMessage?.messageId);
    return input ? personas.find(item => item.id === inferGeneralPersona(input)) : persona;
  };
  const draft = useRef<GeneralAgentDraft | null>(null);
  const [artifact, setArtifact] = useState<ArtifactRef | null>(null), [error, setError] = useState<string | null>(null);
  const opening = useRef(false);
  const handled = useRef(new Set<string>());
  const restoredHistory = useRef<string | null>(null);
  const destinations = Object.values(agent.state?.tools ?? {}).filter(tool => tool.status === "succeeded" && tool.destination);
  const openDestination = useCallback(async (callId: string, destination: AgentDestination) => {
    if (!sessionId || opening.current) return;
    opening.current = true; setError(null);
    try {
      const state = destination.kind === "creation" ? await creationNavigationState(sessionId, destination) : undefined;
      const key = `skoob:agent-destination:${sessionId}:${callId}`;
      handled.current.add(key);
      try { sessionStorage.setItem(key, "opened"); } catch { /* In-memory guard still prevents duplicate navigation. */ }
      navigate(destinationPath(destination), { state });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "打开任务失败，请重试"); }
    finally { opening.current = false; }
  }, [sessionId, navigate]);
  useEffect(() => {
    if (sessionId && location.state?.restoreConversation && restoredHistory.current !== sessionId) {
      if (agent.connection !== "connected") return;
      destinations.forEach(tool => handled.current.add(`skoob:agent-destination:${sessionId}:${tool.callId}`));
      restoredHistory.current = sessionId;
      return;
    }
    const tool = destinations.at(-1);
    if (!tool?.destination || !sessionId || opening.current) return;
    const key = `skoob:agent-destination:${sessionId}:${tool.callId}`;
    if (handled.current.has(key)) return;
    try { if (sessionStorage.getItem(key)) return; } catch { /* Use the in-memory guard. */ }
    handled.current.add(key);
    void openDestination(tool.callId, tool.destination);
  }, [agent.state?.tools, sessionId, openDestination, location.state, agent.connection]);
  const ready = useCallback((value: GeneralAgentDraft | null) => { draft.current = value; }, []);
  const follow = useFollowOutput(sessionId ?? "new", agent.state?.cursor, true);
  useEffect(() => { setArtifact(null); setError(null); }, [sessionId]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") setArtifact(null); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);
  const questionEntry = Object.entries(agent.state?.questions ?? {})[0];
  const question = questionEntry ? { ...questionEntry[1], runId: questionEntry[0] } : undefined;
  const resourceLabels = Object.fromEntries([
    ...(agent.state?.artifacts ?? []).map(item => [`artifact:${item.id}:${item.revision}`, item.title]),
    ...(agent.state?.attachments ?? []).map(item => [`attachment:${item.id}:${item.revision}`, item.filename]),
  ]);
  const stop = async (runId: string) => { try { await agent.cancel(runId); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "停止请求尚未确认，请重试"); } };
  const useArtifact = (ref: ArtifactRef) => {
    try { draft.current?.addReference({ kind: "artifact", id: ref.id, revision: ref.revision }); setArtifact(null); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "引用失败"); }
  };
  return <div className={`ga-conversation ${artifact ? "has-artifact" : ""}`}>
    <section className="ga-thread">
      <header className="ga-thread-header"><div className="ga-persona-heading">{persona?.avatarUrl && <img src={persona.avatarUrl} alt="" className="ga-persona-avatar" />}<div><h1>{persona?.name ?? "主神·阿伟"}</h1><span>{agent.connection === "reconnecting" ? "正在恢复连接，已有内容保留" : persona?.bio ?? "聊想法、问问题，也可以随时开始创作或拆书"}</span></div></div><Link to={sessionId ? "/agent" : "/create"}>{sessionId ? "新会话" : "返回首页"}</Link></header>
      <section className="ga-messages" ref={follow.ref} onScroll={follow.onScroll} aria-label="会话内容">
        {!sessionId && <div className="ga-empty"><SkoobLogo variant="mascot" className="ga-brand-mascot" decorative /><h2>{persona?.welcome ?? "把想做的事交给我"}</h2><p>选一个想交流的伙伴，也可以直接开始。</p>
          <div className="ga-persona-options" aria-label="选择官方角色"><button type="button" aria-pressed={selectedPersona === "auto"} onClick={() => setSelectedPersona("auto")}><span><strong>按场景选择</strong><small>根据本次需求安排助手</small></span></button>{personas.map(item => <button type="button" key={item.id} aria-pressed={selectedPersona === item.id} onClick={() => { setSelectedPersona(item.id); setSuggestion(""); }}>
            {item.avatarUrl && <img src={item.avatarUrl} alt="" className="ga-persona-avatar" />}<span><strong>{item.name}</strong><small>{ENGINE_NAMES[item.engine]}</small></span>
          </button>)}</div>
          <div className="ga-starters">{persona?.starters.map(text => <button type="button" key={text} onClick={() => setSuggestion(text)}>{text}</button>)}</div>
          {personaError && <p className="ga-note">{personaError}</p>}
        </div>}
        {sessionId && <p className="ga-note ga-welcome">{persona?.welcome ?? "我是阿伟，可以陪你讨论、整理材料，并协助创作或拆书。"}</p>}
        {(!sessionId || agent.state?.messages.filter(message => message.role === "user").length === 1) && <AgentOnboarding />}
        {agent.connection === "loading" && <p role="status">正在恢复会话…</p>}
        {agent.state?.messages.map(message => <article className={`ga-message is-${message.role}`} key={message.messageId}>
          <small className="ga-sender">{message.role === "assistant" && sender(message.runId)?.avatarUrl && <img src={sender(message.runId)!.avatarUrl} alt="" className="ga-message-avatar" />}{message.role === "user" ? "你" : sender(message.runId)?.name ?? "官方助手"}</small>
          {message.parts.map((part, index) => {
            if (part.type === "text") return message.role === "assistant" ? <AgentMarkdown key={index} text={part.text} /> : <div className="ga-message-text" key={index}>{part.text}</div>;
            const attachment = part.ref.kind === "attachment" ? agent.state?.attachments.find(item => item.id === part.ref.id && item.revision === part.ref.revision) : undefined;
            if (attachment && sessionId) return <AttachmentResource key={index} sessionId={sessionId} attachment={attachment} refresh={agent.refresh} />;
            const found = agent.state?.artifacts.find(item => item.id === part.ref.id && item.revision === part.ref.revision);
            return <button className="ga-resource" type="button" key={index} disabled={!found} onClick={() => { if (found) setArtifact(found); }}>{found?.title ?? "材料暂不可用"} · v{part.ref.revision}</button>;
          })}
          {message.role === "user" && <small className="ga-input-state">{agent.state?.applied[message.messageId] === "current_turn" ? "已应用到当前任务" : agent.state?.applied[message.messageId] === "next_task" ? "已安排为后续任务" : "已收到，等待应用"}</small>}
        </article>)}
        {Object.values(agent.state?.runs ?? {}).map(run => {
          const tools = Object.values(agent.state?.tools ?? {}).filter(tool => tool.runId === run.id);
          if (run.status === "succeeded" && !tools.length) return null;
          return <section className="ga-run" key={run.id} aria-label="任务进度"><div className="ga-run-header"><strong>{statuses[run.status]}</strong>
            {!TERMINAL_RUN_STATUSES.has(run.status) && <button type="button" disabled={run.status === "cancelling"} onClick={() => void stop(run.id)}>{run.status === "cancelling" ? "正在停止" : "停止"}</button>}</div>
            <p>{run.summary}</p>{run.progress && <p>{run.progress.label} · {run.progress.current} / {run.progress.total}</p>}
            {tools.length > 0 && <details><summary>查看执行记录</summary>{tools.map(tool => <p key={tool.callId}>{tool.label} · {tool.status === "succeeded" ? "完成" : tool.status === "failed" ? "失败" : tool.status === "cancelled" ? "已停止" : tool.status === "unknown" ? "结果待确认" : "执行中"}{tool.summary ? `：${tool.summary}` : ""}</p>)}</details>}
          </section>;
        })}
        {Boolean(agent.state?.artifacts.length) && <section className="ga-artifacts" aria-label="会话产物"><h2>产物</h2>{agent.state!.artifacts.map(ref => <button type="button" key={`${ref.id}:${ref.revision}`} onClick={() => setArtifact(ref)}>{ref.title}<small>版本 {ref.revision} · 打开</small></button>)}</section>}
        {destinations.map(tool => <button type="button" className="ga-resource" key={tool.callId} onClick={() => void openDestination(tool.callId, tool.destination!)}>
          {tool.destination!.kind === "creation" ? "打开小说创作" : "查看拆书进度与报告"}
        </button>)}
      </section>
      <div className="ga-input-area">{follow.paused && <button type="button" className="ga-latest" onClick={follow.resume}>回到最新消息</button>}
        {(error || agent.error) && <p className="ga-error" role="alert">{error ?? agent.error} {agent.connection === "error" && <button type="button" onClick={agent.reconnect}>重新连接</button>}</p>}
        <GeneralComposer key={sessionId ?? "new"} sessionId={sessionId} officialPersonaId={explicitPersona} suggestion={suggestion} initialSelection={latestInput} question={question} resourceLabels={resourceLabels} onReady={ready} onSent={id => {
          if (id !== sessionId) navigate(`/agent/${encodeURIComponent(id)}`); else void agent.refresh().catch(cause => setError(cause instanceof Error ? cause.message : "刷新失败"));
        }} />
      </div>
    </section>
    {artifact && sessionId && <ArtifactContent sessionId={sessionId} artifact={artifact} onClose={() => setArtifact(null)} onUse={() => useArtifact(artifact)} />}
  </div>;
}
