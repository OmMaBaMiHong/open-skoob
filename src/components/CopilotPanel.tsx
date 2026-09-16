import { ExecutionPulse } from "./ExecutionPulse";
import { ChapterActivity } from "./ChapterActivity";
import { workflowIsBusy, type CreationActivity } from "../lib/creation-activity";
import { AgentActivity } from "./AgentActivity";
import { EMPTY_PROGRESS, type AgentProgress } from "../lib/agent-progress";
/**
 * CopilotPanel — 引导向导右栏「六师随行」。
 *
 * 发送走智能体讨论；独立的重写按钮提交本步反馈，生成后回到审阅门。
 * 只有请求成功才清空输入，聊天滚动限制在消息区域内。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Composer } from "./Composer";
import { EMPTY_SUMMON, type Summoned, type PendingFile } from "../types/composer";
import { useComposerData, withInstalledSkills } from "../hooks/use-composer-data";
import { toolResultText, type CopilotMessage, type WorkbenchMessageInput } from "../lib/workbench-chat";

export type { CopilotMessage } from "../lib/workbench-chat";

export function CopilotPanel({
  author, messages, busy, disabled, hint, liveMessage, quickActions, onSend, onRewrite, onStop, reviewAction, taskActions, graphId, execution, progress = EMPTY_PROGRESS,
}: {
  readonly liveMessage?: string;
  readonly progress?: AgentProgress;
  readonly execution?: {activity?: CreationActivity;chapter:number|null;status:string;error?:string};
  readonly author: string;
  readonly messages: ReadonlyArray<CopilotMessage>;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly hint: string;
  readonly quickActions: ReadonlyArray<string>;
  readonly onSend: (input: WorkbenchMessageInput) => Promise<boolean>;
  readonly onStop?: () => void;
  readonly taskActions?: ReactNode;
  readonly reviewAction?: { label: string; disabled: boolean; onConfirm: () => void };
  readonly onRewrite?: (text: string) => Promise<boolean>;
  /** 本书图谱 id：有了它就只列本书的智能体，没有则跨书全列。 */
  readonly graphId?: string;
}) {
  const [input, setInput] = useState("");
  const [summoned, setSummoned] = useState<Summoned>(EMPTY_SUMMON);
  const [files, setFiles] = useState<ReadonlyArray<PendingFile>>([]);
  const [sending, setSending] = useState(false);
  const composer = useComposerData(graphId ? { graphId } : {});
  const { skills, agents, genres, templates, llm, installed } = composer;
  const messagesRef = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);

  useEffect(() => {
    setSummoned((prev) => withInstalledSkills(prev, skills, installed));
  }, [installed, skills]);

  useEffect(() => {
    const el = messagesRef.current;
    if (el && followTail.current) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [messages, busy, execution?.activity, progress]);

  const send = async (text: string, rewrite = false) => {
    const t = text.trim();
    if ((!t && (rewrite || !files.length)) || busy || disabled || sending) return;
    setSending(true);
    followTail.current = true;
    const savedFiles = files;
    setInput("");
    if (!rewrite) setFiles([]);
    try {
      const accepted = rewrite && onRewrite
        ? await onRewrite(t)
        : await onSend({ text: t, summoned, files, model: composer.selected });
      if (!accepted) { setInput(previous => previous || t); if (!rewrite) setFiles(previous => previous.length ? previous : savedFiles); }
    } finally { setSending(false); }
  };

  return (
    <aside className="cop">
      <header className="cop-hd">
        <span className="cop-t"><Sparkles size={12} /> 六师随行</span>
        <span className="cop-m">{author}随行 · 讨论创作与调整方案</span>
      </header>

      <ExecutionPulse running={busy || sending} message={liveMessage || progress.items.filter(item => item.status === "running").at(-1)?.label || (busy ? "请求已提交，正在等待任务进展" : "")} />
      <div className="cop-bd" ref={messagesRef} onScroll={() => { const el = messagesRef.current; if (el) followTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
        <div className="cop-hint">{hint}</div>
        {messages.map((m) => (
          <div key={m.id} className={`cop-msg is-${m.role}`}>
            {m.role === "agent" && m.author && <div className="cop-msg-w">✦ {m.author}</div>}
            {m.content && <div className="cop-msg-c">{m.content}</div>}
            {m.toolExecutions?.map(tool => (
              <details className={`cop-tool is-${tool.status ?? "completed"}`} key={tool.id}>
                <summary>{tool.status === "running" ? "◌ " : tool.status === "error" ? "! " : "✓ "}{tool.label || tool.tool}{tool.status === "running" ? " · 执行中" : tool.status === "error" ? " · 失败" : " · 已完成"}</summary>
                {(tool.args?.title || tool.args?.summary) && <div className="cop-msg-c">{tool.args.title}{tool.args.summary ? `\n${tool.args.summary}` : ""}</div>}
                <div className="cop-msg-c">{tool.error || toolResultText(tool.result) || (tool.status === "running" ? "结果将随执行进度更新。" : "工具执行记录已保存。")}</div>
              </details>
            ))}
            {m.error && <div className="cop-error" role="alert">{m.error}</div>}
          </div>
        ))}
        {execution && <ChapterActivity key={`${graphId}:${execution.chapter}`} {...execution} variant="chat" running={workflowIsBusy(execution.status)} />}
        <AgentActivity progress={progress} busy={(!execution && busy) || sending} />

      </div>

      <div className="cop-in">
        {taskActions && <div className="cop-task-actions">{taskActions}</div>}
        {reviewAction && <div className="cop-review" role="status">
          <strong>待你审阅 · {reviewAction.label}</strong>
          <span>在中间审阅本步内容。聊天用于讨论，点击通过才继续创作。</span>
          <button className="cop-qk" disabled={reviewAction.disabled || busy || sending} onClick={reviewAction.onConfirm}>通过{reviewAction.label}，继续</button>
        </div>}
        <div className="cop-quick">
          {quickActions.map((q) => (
            <button key={q} className="cop-qk" onClick={() => void send(q)} disabled={busy || disabled || sending}>
              {q}
            </button>
          ))}
        </div>
        {/* 与首页 / 对话页同一个输入框：召唤专家、挂技能、传参考资料在这里同样可用。 */}
        <Composer
          value={input}
          onChange={setInput}
          onSend={() => void send(input)}
          onAbort={onStop}
          busy={busy || sending}
          disabled={busy || disabled || sending}
          placeholder={busy ? "任务执行中，完成或暂停后可发送…" : disabled ? "请稍候…" : `和${author}聊聊你的想法…`}
          summoned={summoned}
          onSummonedChange={setSummoned}
          skills={skills}
          agents={agents}
          genres={genres}
          templates={templates}
          files={files}
          onFilesChange={setFiles}
          models={composer.models}
          selected={composer.selected}
          onModelChange={composer.selectModel}
          model={llm?.model}
          modelNotice={composer.modelNotice}
        />
        {onRewrite && <button className="cop-qk cop-rewrite" disabled={busy || disabled || sending || !input.trim()} onClick={() => void send(input, true)} title="将输入文字作为本步重写要求，沿用本书的创作模型与配置">按这段文字重写本步</button>}
      </div>
    </aside>
  );
}
