import { ExecutionPulse } from "../ExecutionPulse";
import { useEffect, useState } from "react";
import { TERMINAL_RUN_STATUSES, type AgentMessageInput } from "../../lib/general-agent-contracts";
import { GeneralComposer } from "./GeneralComposer";
import { AgentMarkdown } from "./AgentMarkdown";
import { useGeneralAgent } from "../../hooks/use-general-agent";
import { useFollowOutput } from "../../hooks/use-follow-output";
import { openDeconstructionConversation } from "../../lib/general-agent-api";
import type { DeconstructionResourceRef } from "./DeconstructionResource";
import { fetchOfficialPersonas, type PublicPersona } from "../../lib/official-personas";

/** 本书持久会话；工具回执更新本页，不把用户带回创作或普通聊天页。 */
export function DeconstructionChat({ sourceId, title, onProgress, onOpenResource, activity }: { sourceId: string; title: string; onProgress: () => void; onOpenResource?: (resource: DeconstructionResourceRef) => void; activity?: { running: boolean; message: string } }) {
  const [session, setSession] = useState<{ sessionId: string; model?: AgentMessageInput["model"] } | null>(null);
  const [error, setError] = useState<string | null>(null), [suggestion, setSuggestion] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [persona, setPersona] = useState<PublicPersona>();
  useEffect(() => {
    let active = true;
    void fetchOfficialPersonas().then(result => { if (active) setPersona(result.personas.find(item => item.id === "tianwang")); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setSession(null); setError(null);
    void openDeconstructionConversation(sourceId, controller.signal).then(value => { if (!controller.signal.aborted) setSession(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "对话连接失败"); });
    return () => controller.abort();
  }, [sourceId, attempt]);
  const agent = useGeneralAgent(session?.sessionId ?? null);
  const follow = useFollowOutput(session?.sessionId ?? sourceId, agent.state?.cursor, true);
  const runs = Object.values(agent.state?.runs ?? {});
  const questionEntry = Object.entries(agent.state?.questions ?? {})[0];
  const question = questionEntry ? { ...questionEntry[1], runId: questionEntry[0] } : undefined;
  useEffect(() => { if (agent.state?.cursor) onProgress(); }, [agent.state?.runs, agent.state?.tools, onProgress]);
  const latest = agent.state?.inputs.at(-1);
  const resources: DeconstructionResourceRef[] = session ? [
    ...(agent.state?.attachments ?? []).map(resource => ({ sessionId: session.sessionId, kind: "attachment" as const, resource })),
    ...(agent.state?.artifacts ?? []).map(resource => ({ sessionId: session.sessionId, kind: "artifact" as const, resource })),
  ] : [];
  const resourceTitle = (item: DeconstructionResourceRef) => item.kind === "attachment" ? item.resource.filename : item.resource.title;
  const resourceLabels = Object.fromEntries(resources.map(item => [`${item.kind}:${item.resource.id}:${item.resource.revision}`, resourceTitle(item)]));
  const resourceButton = (item: DeconstructionResourceRef, key: string | number) => <button type="button" className="dcw-chat-resource" key={key}
    onClick={() => onOpenResource?.(item)} disabled={!onOpenResource} title="在中间打开">
    <span>{resourceTitle(item)}</span><small>版本 {item.resource.revision} · 打开</small>
  </button>;
  const selection = session?.model ? { ...latest, model: latest?.model ?? session.model,
    selectedSkillAssetIds: latest?.selectedSkillAssetIds ?? [], selectedAgentAssetIds: latest?.selectedAgentAssetIds ?? [],
    capabilityRefs: [{ kind: "source", id: sourceId }], creationStrategy: "fast", officialPersonaId: "tianwang",
  } as AgentMessageInput : undefined;
  return <aside className="dcw-chat" aria-label="拆书智能体">
    <header><strong>{persona?.name ?? "天王·阿伟"} · 拆书助手</strong><p className="dcw-chat-intro">{persona?.welcome ?? "陪你拆解结构、人物与伏笔。"}</p><span>当前书籍：《{title}》</span></header>
    {activity && <ExecutionPulse {...activity} />}
    <section className="dcw-chat-messages" ref={follow.ref} onScroll={follow.onScroll}>
      <p className="dcw-chat-welcome">可以问当前进度，或告诉我“再拆10章”“拆完剩余章节”。原文和已有分析会保留。</p>
      {agent.state?.messages.map(message => <article className={`ga-message is-${message.role}`} key={message.messageId}>
        <small>{message.role === "user" ? "你" : persona?.name ?? "天王·阿伟"}</small>
        {message.parts.map((part, index) => {
          if (part.type === "text") return <AgentMarkdown key={index} text={part.text} />;
          const item = resources.find(item => item.kind === part.ref.kind && item.resource.id === part.ref.id && item.resource.revision === part.ref.revision);
          return item ? resourceButton(item, index) : <span key={index}>引用文件暂不可用 · 版本 {part.ref.revision}</span>;
        })}
      </article>)}
      {resources.length > 0 && <details className="dcw-chat-files" open><summary>文件与产物 · {resources.length}</summary>
        {resources.map(item => resourceButton(item, `${item.kind}:${item.resource.id}:${item.resource.revision}`))}
      </details>}
      {runs.map(run => <div className="dcw-chat-status" key={run.id} role="status">{run.summary}
        {run.progress && <p>{run.progress.label} · {run.progress.current} / {run.progress.total}</p>}
        {!TERMINAL_RUN_STATUSES.has(run.status) && <button type="button" disabled={run.cancelRequested} onClick={() => void agent.cancel(run.id).catch(cause => setError(String(cause)))}>{run.cancelRequested ? "正在停止" : "停止任务"}</button>}
      </div>)}
      {Object.keys(agent.state?.tools ?? {}).length > 0 && <details open><summary>智能体执行记录</summary>
        {Object.values(agent.state?.tools ?? {}).map(tool => <p className={tool.status === "failed" ? "ga-error" : "dcw-chat-status"} key={tool.callId}>
          {tool.label} · {tool.status === "succeeded" ? "完成" : tool.status === "failed" ? "失败" : tool.status === "cancelled" ? "已停止" : tool.status === "unknown" ? "结果待确认" : "执行中"}{tool.summary ? `：${tool.summary}` : ""}
        </p>)}
      </details>}
    </section>
    {(error || agent.error) && <div role="alert" className="ga-error">{error ?? agent.error}<button onClick={() => { setAttempt(value => value + 1); agent.reconnect(); }}>重新连接</button></div>}
    {session && <div className="dcw-chat-compose">
      <div className="dcw-chat-suggestions">{["当前拆到哪里了？", "再拆10章", "拆完剩余章节"].map(text => <button key={text} onClick={() => setSuggestion(text)}>{text}</button>)}</div>
      <GeneralComposer key={session.sessionId} sessionId={session.sessionId} suggestion={suggestion} initialSelection={selection} officialPersonaId="tianwang"
        capabilityRefs={[{ kind: "source", id: sourceId }]} resourceLabels={resourceLabels} question={question} placeholder="与这本书的拆书助手聊聊…"
        onSent={() => { setSuggestion(""); void agent.refresh().catch(cause => setError(String(cause))); onProgress(); }} />
    </div>}
  </aside>;
}
