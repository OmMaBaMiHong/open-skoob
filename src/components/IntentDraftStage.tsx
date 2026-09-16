import { previewText } from "../lib/creation-preview";
import { AgentActivity } from "./AgentActivity";
import { EMPTY_PROGRESS, reduceAgentProgress } from "../lib/agent-progress";
/**
 * IntentDraftStage — 建书前的「意图卡」阶段。
 *
 * 为什么需要它：六步编排的第 ① 步 intent，在后端是**建书确认**本身
 * （propose_action / create_book），不是 workflow 里的一个普通步骤——
 * 书没建出来就没有 loop，也就没有任何可导的步骤。
 *
 * 所以引导模式和全自动模式在拿到真实 bookId 之前，都得先走这一段：
 *   开 book-create 会话 → 发灵感 → Agent 出意图卡（含三选一书名）
 *   → 用户确认 → 建书 → 拿到真 bookId → 交给 loop 驱动后五步
 *
 * ⚠️ 别再用 `book-${Date.now()}` 伪造 id 直接进工作台：后端会 404，
 * 页面上所有按钮都会是死的（这正是之前那个"链路断了"的现象）。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Loader2, AlertCircle, Sparkles, CheckCircle2, Crown } from "lucide-react";
import { Link } from "react-router-dom";
import {
  createSession, callAgent, confirmCreateBook, ApiError,
  fetchBooks, AgentEventSource,
  type ToolExecution, type CreateBookPayload, type AgentEvent,
} from "../lib/api";
import { modelChoiceParams } from "../lib/model-choice";
import { workbenchMessageParams, type WorkbenchMessageInput } from "../lib/workbench-chat";
import { EMPTY_SUMMON } from "../types/composer";
import { isPromptRef, type PromptRef } from "../lib/prompt-library";

export type DraftPhase = "idle" | "drafting" | "ready" | "creating" | "error";

interface ActionCard {
  readonly title: string;
  readonly summary: string;
  readonly instruction: string;
  readonly createBook: CreateBookPayload;
  readonly promptRefs?: ReadonlyArray<PromptRef>;
}

/** 从工具执行里提建书意图卡（后端放在 propose_action 的 args 里）。 */
function extractCard(execs: ReadonlyArray<ToolExecution> | undefined): ActionCard | undefined {
  const exec = execs?.find(
    (e) => e.tool === "propose_action" && e.args?.action === "create_book" && e.args?.createBook,
  );
  const cb = exec?.args?.createBook;
  if (!exec || !cb?.title) return undefined;
  return {
    title: exec.args?.title ?? "建书意图卡",
    summary: exec.args?.summary ?? "",
    instruction: exec.args?.instruction ?? "",
    createBook: cb,
  };
}

/**
 * 按书名找刚建出来的书。
 * 后端的 bookId 由书名推导（会做 slug 处理），前端不能自己算，
 * 所以老老实实轮询书列表按 title 匹配。
 */
async function pollBookIdByTitle(title: string, tries = 12): Promise<string | null> {
  for (let i = 0; i < tries; i += 1) {
    const books = await fetchBooks().catch(() => []);
    const hit = books.find((b) => b.title === title || b.id === title);
    if (hit) return hit.id;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  tomato: "番茄", qidian: "起点", feilu: "飞卢", other: "其他",
};

export interface IntentDraftHandle { send: (input: WorkbenchMessageInput) => Promise<string> }

interface IntentDraftProps {
  readonly instruction: string;
  readonly initialInput?: WorkbenchMessageInput;
  readonly strategy: "fast" | "simulate";
  /** 跟入口一致并存入书配置，作品库据此选择页面。 */
  readonly creationMode?: "guided" | "conversation" | "film";
  readonly approvalPolicy?: "review" | "auto";
  readonly autoConfirm?: boolean;
  readonly onPhase?: (phase: DraftPhase) => void;
  readonly onCreated: (bookId: string) => void;
}

export const IntentDraftStage = forwardRef<IntentDraftHandle, IntentDraftProps>(function IntentDraftStage({
  instruction, initialInput, strategy, approvalPolicy, creationMode, autoConfirm, onPhase, onCreated,
}, ref) {
  const [liveText, setLiveText] = useState("");
  const [structuredPreview, setStructuredPreview] = useState(false);
  const structuredPreviewRef = useRef(false);
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const [phase, setPhase] = useState<DraftPhase>("idle");
  const [card, setCard] = useState<ActionCard | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [memberGate, setMemberGate] = useState(false);
  const startedRef = useRef(false);
  const sessionRef = useRef<string | null>(null);

  const setPhaseBoth = useCallback((p: DraftPhase) => {
    setPhase(p);
    onPhase?.(p);
  }, [onPhase]);

  const draft = useCallback(async (input: WorkbenchMessageInput) => {
      const promptRefs = input.summoned.caps.map(cap => cap.ref).filter(isPromptRef).map(ref => ({ kind: ref.kind, id: ref.id }));
      setProgress({ items: [], active: true });
      setLiveText("");
      setStructuredPreview(false);
      structuredPreviewRef.current = false;
      setPhaseBoth("drafting");
      setError(null);
      try {
        if (!sessionRef.current) {
          const session = await createSession({ sessionKind: "book-create", creationStrategy: strategy });
          sessionRef.current = session.sessionId;
        }
        const res = await callAgent({
          background: true,
          creationStrategy: strategy,
          ...workbenchMessageParams(input),
          sessionId: sessionRef.current,
          sessionKind: "book-create",
          ...(input.model ? {} : modelChoiceParams()),
        });
        if (res.error) throw new Error(res.error.message || "生成意图卡失败");
        setLiveText(res.response?.trim() || "");
        setStructuredPreview(false);
        structuredPreviewRef.current = false;
        setProgress(previous => reduceAgentProgress(previous, { type: "agent:complete", data: { sessionId: sessionRef.current } }, sessionRef.current));
        const c = extractCard(res.details?.toolExecutions);
        if (c) {
          setCard({ ...c, promptRefs });
          setTitle(c.createBook.title);
          setPhaseBoth("ready");
        } else {
          if (!res.response?.trim()) throw new Error("智能体没有返回内容，请重试。");
          setPhaseBoth(card ? "ready" : "idle");
        }
        return res.response?.trim() || c?.summary || "意图卡已更新，请在中间查看并确认。";
      } catch (e) {
        setProgress(previous => reduceAgentProgress(previous, { type: "agent:error", data: { sessionId: sessionRef.current } }, sessionRef.current));
        setError(e instanceof Error ? e.message : "生成意图卡失败");
        setPhaseBoth("error");
        throw e;
      }
  }, [card, setPhaseBoth, strategy]);

  useImperativeHandle(ref, () => ({ send: draft }), [draft]);

  /* 从创作首页进入时自动生成；直接打开时等待右侧输入。 */
  useEffect(() => {
    const input = initialInput ?? { text: instruction, summoned: EMPTY_SUMMON, files: [], model: null };
    if (startedRef.current || (!input.text.trim() && !input.files.length)) return;
    startedRef.current = true;
    void draft(input).catch(() => undefined);
  }, [instruction, initialInput, draft]);
  /** SSE 里捎带回来的 bookId（book:creating / book:created）。 */
  const sseBookIdRef = useRef<string | null>(null);

  useEffect(() => {
    const es = new AgentEventSource((e: AgentEvent) => {
      setProgress(previous => reduceAgentProgress(previous, e, sessionRef.current));
      const streamed = e.data as {sessionId?: string;text?: string;structured?: boolean};
      if (streamed.sessionId === sessionRef.current && (e.type === "draft:delta" || e.type === "intent:delta") && streamed.text) {
        const changed = structuredPreviewRef.current !== !!streamed.structured;
        structuredPreviewRef.current = !!streamed.structured;
        setStructuredPreview(!!streamed.structured);
        setLiveText(previous => (changed ? "" : previous) + streamed.text);
      }
      if (e.type !== "book:creating" && e.type !== "book:created") return;
      const data = e.data as { bookId?: unknown; sessionId?: unknown } | null;
      if (!sessionRef.current || data?.sessionId !== sessionRef.current) return;
      const id = data.bookId;
      if (typeof id === "string" && id) sseBookIdRef.current = id;
    });
    es.connect();
    return () => es.disconnect();
  }, []);

  /* ── 确认建书 ── */
  const confirm = useCallback(async (chosen: string) => {
    if (!card || !sessionRef.current) return;
    setPhaseBoth("creating");
    setError(null);
    setMemberGate(false);
    sseBookIdRef.current = null;
    try {
      const res = await confirmCreateBook({
        sessionId: sessionRef.current,
        instruction: card.instruction,
        createBook: { ...card.createBook, title: chosen },
        creationStrategy: strategy,
        promptRefs: card.promptRefs,
        ...(approvalPolicy ? { approvalPolicy } : {}),
        ...(creationMode ? { creationMode } : {}),
        // 确认时刻的使用态选择会被后端钉进 creationLoop——整条六步流水线按它跑。
        ...modelChoiceParams(),
      });
      if (res.error) throw new Error(res.error.message || "建书失败");
      // 建书是异步的：响应返回时 activeBookId 常常还没填上。
      // 三级兜底：响应字段 → SSE book:creating/created 捎带的 id → 按书名轮询书列表。
      const bookId =
        res.creationLoop?.bookId
        ?? res.session?.activeBookId
        ?? sseBookIdRef.current
        ?? (await pollBookIdByTitle(chosen));
      if (!bookId) {
        throw new Error("书已在后台创建，但没能确认它的 id —— 去作品库看看是否已经出现。");
      }
      onCreated(bookId);
    } catch (e) {
      if (e instanceof ApiError && (e.code === "MEMBER_REQUIRED" || e.status === 403)) {
        setMemberGate(true);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "建书失败");
      }
      setPhaseBoth("error");
    }
  }, [card, strategy, approvalPolicy, creationMode, onCreated, setPhaseBoth]);

  /* 全自动：卡片一到就自动确认 */
  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoConfirm || phase !== "ready" || !card || autoDone.current) return;
    autoDone.current = true;
    void confirm(card.createBook.title);
  }, [autoConfirm, phase, card, confirm]);

  /* ── 渲染 ── */
  if (phase === "idle" && liveText) return (
    <section className="so-block">
      <header className="so-block-head"><Sparkles size={16} /> 规划师</header>
      <div className="so-block-body">{liveText}</div>
    </section>
  );
  if (phase === "idle") {
    return <div className="idraft-wait"><Sparkles size={22} /><div className="idraft-wait-t">先聊聊你想写的故事</div><div className="idraft-wait-s">在六师随行中输入题材、主角或一句灵感，规划师会和你一起整理意图卡。</div></div>;
  }
  if (phase === "drafting") {
    if (previewText(liveText, structuredPreview)) return (
      <section className="so-block">
        <header className="so-block-head"><Loader2 size={16} className="spin" /> 规划师 · 正在处理你的请求</header>
        <AgentActivity progress={progress} busy />
        <div className="so-block-body">{previewText(liveText, structuredPreview)}</div>
      </section>
    );
    return (
      <div className="idraft-wait">
        <Loader2 size={22} className="spin" />
        <div className="idraft-wait-t">正在处理你的请求</div>
        <div className="idraft-wait-s">规划师正在读取你的要求与参考资料…</div>
        <AgentActivity progress={progress} busy />
      </div>
    );
  }

  if (phase === "error" && !card) {
    return (
      <div className="idraft-err">
        <AlertCircle size={18} />
        <div>
          <div className="idraft-err-t">本次请求未完成</div>
          <div className="idraft-err-m">{error}</div>
          {liveText && <div className="so-block-body">{previewText(liveText, structuredPreview)}</div>}
          <Link to="/create" className="idraft-err-back">← 回去换个方向</Link>
        </div>
      </div>
    );
  }

  if (!card) return null;

  const cb = card.createBook;
  const candidates = cb.titleCandidates?.length ? cb.titleCandidates : [cb.title];
  const busy = phase === "creating";

  return (
    <div className="idraft">
      <AgentActivity progress={progress} busy={busy} />
      <div className="idraft-cap"><Sparkles size={13} /> {card.title}</div>
      {card.summary && <p className="idraft-sum">{card.summary}</p>}

      <section className="so-block">
        <header className="so-block-head">
          <span className="so-block-label">
            书名{candidates.length > 1 ? `（${candidates.length} 选 1）` : ""}
          </span>
        </header>
        <div className="idraft-titles">
          {candidates.map((t) => (
            <button
              key={t}
              className={`idraft-title ${title === t ? "is-on" : ""}`}
              onClick={() => setTitle(t)}
              disabled={busy}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <div className="so-meta">
        {cb.genre && <span>题材 {cb.genre}</span>}
        {cb.platform && <span>平台 {PLATFORM_LABELS[cb.platform] ?? cb.platform}</span>}
        {cb.targetChapters ? <span>{cb.targetChapters} 章</span> : null}
        {cb.chapterWordCount ? <span>{cb.chapterWordCount} 字/章</span> : null}
        <span className="idraft-engine">
          {strategy === "simulate" ? "🌐 世界模拟引擎" : "⚡ 快速直出"}
        </span>
      </div>

      {cb.synopsis && (
        <section className="so-block">
          <header className="so-block-head"><span className="so-block-label">简介</span></header>
          <div className="so-block-body">{cb.synopsis}</div>
        </section>
      )}

      {card.instruction && (
        <details className="idraft-full">
          <summary>展开完整意图卡</summary>
          <pre>{card.instruction}</pre>
        </details>
      )}

      {error && (
        <div className={`idraft-alert ${memberGate ? "is-member" : ""}`}>
          {memberGate ? <Crown size={14} /> : <AlertCircle size={14} />}
          <span>{error}</span>
          {memberGate && <Link to="/pricing?from=simulate" className="idraft-alert-btn">查看套餐</Link>}
        </div>
      )}

      <button className="idraft-go" onClick={() => void confirm(title)} disabled={busy}>
        {busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
        {busy ? "正在铸造世界…" : "确认建书 · 开始铸造"}
      </button>
    </div>
  );
});
