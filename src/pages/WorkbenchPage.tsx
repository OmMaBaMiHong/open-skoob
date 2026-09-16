import { ChapterActivity } from "../components/ChapterActivity";
import { activitySummary, mergeCreationActivity, workflowIsBusy, type CreationActivity } from "../lib/creation-activity";
import { useFollowOutput } from "../hooks/use-follow-output";
import { fetchCreationPreview } from "../lib/api";
import { reduceCreationPreview, restoreCreationPreview, previewText, outlineProgressLabel, type CreationPreview, type OutlinePreview } from "../lib/creation-preview";
import { EMPTY_PROGRESS, reduceAgentProgress, withWorkflowProgress } from "../lib/agent-progress";
import { useMembership } from "../hooks/use-membership";
import { nextWorkbenchPoll, syncChatMessages } from "../lib/workbench-sync";
/**
 * WorkbenchPage —— 引导模式（向导）
 *
 * 引导模式 = 后端 approvalPolicy:"review"：每一步生成完停在 awaiting_review，
 * 等用户「通过」或「重铸」。这一页就是那个闸门的 UI。
 *
 * 真相源是 workflow 快照（GET /books/:id 内联返回），不是前端自己的状态机：
 *   snapshot.status === "running"          → 生成中，推进条禁用
 *   snapshot.status === "awaiting_review"  → 亮出「通过 / 重铸」
 *   snapshot.status === "succeeded"        → 全书完成
 *   step.status === "confirmed"            → 该步已过闸
 *
 * 「通过 / 重铸」没有独立 REST 路由，走 /agent 的 loop_review 意图
 * （见 api.ts reviewLoopStep）——所以本页需要一个会话。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation, Link, useNavigate } from "react-router-dom";
import {
  Check, Loader2, RotateCcw, AlertCircle,
  MessageSquare, X, ChevronDown, Zap, Info,
} from "lucide-react";
import {
  adoptLegacyBook, abortSession, cancelQueuedAgentJob,
  AgentEventSource, restoreWorkbenchSession, pauseLoop, fetchBook, fetchLoopState, reviewLoopStep,
  fetchAutoRun, setAutoRun as saveAutoRun,
  regenerateLoopStep, resumeLoop, fetchChatSessions, fetchChatMessages,
  type AgentEvent, type ChapterSummary, type ChatMessageDto,
} from "../lib/api";
import {
  CREATION_LOOP_STEP_TYPES, CREATION_STEP_LABELS_ZH, CREATION_STEP_SUBTITLES,
  CREATION_STEP_INPUTS, TIANYAN_ROUNDS,
  STEP_AUTHOR, stepTypeOf, chapterNumberOf, isAwaitingReview, isLoopRunning, creationStepLabel,
  type CreationLoopStepType, type WorkflowSnapshot, type WorkflowStepSnapshot,
} from "../types/creation-loop";
import { StepOutput } from "../components/StepOutput";
import { WorkflowError } from "../components/WorkflowError";
import { summarizeWorkflowError } from "../lib/workflow-error";
import {
  SIM_ACTION_LABELS, SIM_STAGE_OF_STEP, runsFromChat,
  type SimRun,
} from "../lib/sim-feed";
import { CastPanel, type CastState, type CastChapter } from "../components/CastPanel";
import { DeconstructionLayout } from "../components/agent/DeconstructionLayout";
import { CopilotPanel, type CopilotMessage } from "../components/CopilotPanel";
import { useComposerData } from "../hooks/use-composer-data";
import { IntentDraftStage, type DraftPhase, type IntentDraftHandle } from "../components/IntentDraftStage";
import { restoreCopilotMessages, reduceCopilotEvent, finishCopilotMessage, discussWorkbench, requireAgentSuccess, type WorkbenchMessageInput } from "../lib/workbench-chat";
import { WorkbenchGraphPage } from "./WorkbenchGraphPage";

type StepState = "idle" | "running" | "review" | "done" | "failed";

/** 展示态 → 左栏档案态（含失败态）。 */
function castStateFor(st: StepState): CastState {
  if (st === "review") return "review";
  if (st === "running") return "active";
  if (st === "idle") return "waiting";
  return st; // done | failed
}

/** 单个 workflow 步骤 → 展示态。`isCurrent` 区分「真的在跑」和「排在后面还没轮到」。 */
function stepStateOf(step: WorkflowStepSnapshot, isCurrent: boolean): StepState {
  if (step.status === "failed") return "failed";
  if (step.status === "confirmed") return "done";
  if (step.status === "awaiting_review") return "review";
  if (step.status === "running" || step.status === "pending") return isCurrent ? "running" : "idle";
  if (step.status === "completed") return "review";
  return "idle";
}

export function WorkbenchPage() {
  const { bookId } = useParams<{ bookId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = (location.state ?? null) as
    | { instruction?: string; strategy?: "fast" | "simulate"; initialInput?: WorkbenchMessageInput }
    | null;
  const instruction = routeState?.instruction ?? "";
  const [routeStrategy, setRouteStrategy] = useState<"fast" | "simulate">(routeState?.strategy ?? "fast");
  /** 还没有 bookId = 处在「意图卡建书」阶段（六步的第 ① 步）。 */
  const preBook = !bookId;
  const [draftPhase, setDraftPhase] = useState<DraftPhase>("idle");
  const draftRef = useRef<IntentDraftHandle>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loopId, setLoopId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const workflowBusy = workflowIsBusy(snapshot?.status);
  const [activities, setActivities] = useState<Record<string, CreationActivity>>({});
  const [strategy, setStrategy] = useState<"fast" | "simulate" | null>(null);
  /** 推演产物是否真的存在（判据见 api.ts fetchLoopState 的注释）。 */
  const [hasSim, setHasSim] = useState(true);
  const [connected, setConnected] = useState(false);
  const [executionModel, setExecutionModel] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const statusRef = useRef<WorkflowSnapshot | null>(null);
  const refreshFlight = useRef<Promise<WorkflowSnapshot | null> | null>(null);
  const messageCache = useRef<Record<string, ReadonlyArray<ChatMessageDto>>>({});
  const currentBook = useRef(bookId);
  currentBook.current = bookId;
  useEffect(() => {
    refreshFlight.current = null;
    statusRef.current = null;
    messageCache.current = {};
    setSnapshot(null);
    setLastUpdated(null);
    setLoopId(null);
    setSessionId(null);
    chatReply.current = null;
    chatJob.current = null;
    setChatBusy(false);
    setCopilot([]);
    setProgress(EMPTY_PROGRESS);
    setCreationPreview(null);
    setOutlinePreview(null);
    setActivities({});
    setGovernance(null);
    setError(null);
    setSyncError(null);
    setHistoryError(null);
  }, [bookId]);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const membership = useMembership();
  const canSimulate = membership.entitlements.includes("world.simulate");
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [creationPreview, setCreationPreview] = useState<CreationPreview | null>(null);
  const [outlinePreview, setOutlinePreview] = useState<OutlinePreview | null>(null);
  const chatReply = useRef<CopilotMessage | null>(null);
  const chatJob = useRef<string | null>(null);
  const stoppingChat = useRef(false);
  const [rejecting, setRejecting] = useState(false);
  const composer = useComposerData({ ...(bookId ? { graphId: bookId } : {}), preserveExplicitModel: true });
  /**
   * 用户点开的步骤 **id**（不是类型）；null = 跟随当前步。
   *
   * 必须精确到 id：章节是 chapter_write-1 / -2 / … 一步一章，只记类型的话
   * 「回去看第 1 章」永远落到最新那一章上——用户找不到旧章的入口就是这么来的。
   */
  const [viewing, setViewingStep] = useState<string | null>(null);
  const [viewingGraph, setViewingGraph] = useState(false);
  const setViewing = (stepId: string | null) => {
    setViewingGraph(false);
    setViewingStep(stepId);
  };
  /**
   * 全自动运行：不停下等确认，一路跑完。
   *
   * 按人按书存在后端（user_preference 的 workbench 域），刷新不丢；
   * 后端每到一道闸门重新读一次，所以中途打开立刻生效。
   */
  const [autoRun, setAutoRun] = useState(false);
  const [autoRunBusy, setAutoRunBusy] = useState(false);

  // 进页面读一次当前设置——它是存在后端的，刷新/换设备都该看到同一个状态。
  useEffect(() => {
    if (!bookId) return;
    let live = true;
    void fetchAutoRun(bookId).then((on) => { if (live) setAutoRun(on); });
    return () => { live = false; };
  }, [bookId]);

  const toggleAutoRun = useCallback(async (on: boolean) => {
    if (!bookId) return;
    setAutoRunBusy(true);
    // 先落到界面上：这是个开关，等一个网络往返才动会让人以为没点上。
    setAutoRun(on);
    try {
      const res = await saveAutoRun({ bookId, autoRun: on, loopId });
      setAutoRun(res.autoRun);
    } catch {
      setAutoRun(!on);   // 存不上就退回去，别让界面显示一个并不生效的状态
    } finally {
      setAutoRunBusy(false);
    }
  }, [bookId, loopId]);
  /** 本步治理链进度（SSE write/audit/revise 推出来的） */
  const [governance, setGovernance] = useState<string | null>(null);
  /** 六师随行的真实讨论回复，以及独立重写操作的提交状态。 */
  const [copilot, setCopilot] = useState<ReadonlyArray<CopilotMessage>>([]);
  const copilotSeq = useRef(0);
  /**
   * 仿真直播流。**数据源是 PG**（`chat_session` / `chat_message`）：
   * 后端 pushSimulationRound 每轮写一次库，这里按「正在看的那一步」的 stage
   * 把场次读回来。
   *
   * 早先是从会话消息里解析 `tianyan_dialogue` 工具卡拼出来的 —— 同一轮被写进
   * 本书**每一个**会话，实测放大了 34.5 倍，还得靠「轮号有没有回退」去猜分场。
   * 现在一个 chat_session 就是一场，不用猜。
   */
  const [simRuns, setSimRuns] = useState<ReadonlyArray<SimRun>>([]);
  /** SSE 每来一批消息就 +1，触发增量重拉（下面有合并，不会一条一拉）。 */
  const [simTick, setSimTick] = useState(0);
  const simTickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 合并 SSE 抖动：一轮仿真会推好几条消息，逐条重拉纯属浪费。
   * 1.2s 的延迟在「一轮要跑好几秒」的直播里看不出来。
   */
  const bumpSim = useCallback(() => {
    if (simTickTimer.current) return;
    simTickTimer.current = setTimeout(() => {
      simTickTimer.current = null;
      setSimTick((t) => t + 1);
    }, 1200);
  }, []);
  useEffect(() => () => { if (simTickTimer.current) clearTimeout(simTickTimer.current); }, []);

  /* ── 会话（审阅动作要用） ── */
  useEffect(() => {
    if (!bookId || sessionId) return; // 首次读取失败时，连接恢复后再恢复会话。
    let cancelled = false;
    void restoreWorkbenchSession(bookId)
      .then((s) => { if (!cancelled) {
        setSessionId(s.sessionId);
        setCopilot(restoreCopilotMessages(s.messages));
      } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "创建会话失败"); });
    return () => { cancelled = true; };
  }, [bookId, connected, sessionId]);

  /* First load and disconnected reconciliation share one in-flight request. */
  const refresh = useCallback(async () => {
    if (!bookId) return null;
    if (refreshFlight.current) return refreshFlight.current;
    const request = fetchLoopState(bookId).then((st) => {
      if (currentBook.current !== bookId) return null;
      setSyncError(null);
      const previous = statusRef.current;
      if (previous && st.snapshot && previous.workflowId === st.snapshot.workflowId && previous.version > st.snapshot.version) return previous;
      setSnapshot((previous) => previous && st.snapshot && previous.workflowId === st.snapshot.workflowId && previous.version > st.snapshot.version ? previous : st.snapshot);
      statusRef.current = st.snapshot;
      setLoopId(st.loopId);
      setStrategy(st.strategy);
      setHasSim(st.hasSimulation);
      setExecutionModel(st.executionModel ? `${st.executionModel.service} / ${st.executionModel.model}` : null);
      setLastUpdated(Date.now());
      if (st.snapshot) {
        const stepId = st.snapshot.currentStepId?.startsWith("chapter_write-") ? st.snapshot.currentStepId : undefined;
        void fetchCreationPreview(bookId, stepId).then(data => {
          if (currentBook.current !== bookId) return;
          setCreationPreview(previous => restoreCreationPreview(previous, data.preview));
          if (data.activity) setActivities(previous => { const next = mergeCreationActivity(previous[data.activity!.stepId],data.activity!,bookId); return next ? {...previous,[next.stepId]:next} : previous; });
          setOutlinePreview(data.outline);
        }).catch(() => undefined);
      }
      return st.snapshot;
    }).catch((error: unknown) => {
      if (currentBook.current === bookId) setSyncError(`进度读取失败，将在重连后重试：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }).finally(() => { if (refreshFlight.current === request) refreshFlight.current = null; });
    refreshFlight.current = request;
    return request;
  }, [bookId]);

  useEffect(() => {
    if (!bookId || connected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try { await refresh(); }
      catch { /* refresh owns the recoverable read error. */ }
      const wait = nextWorkbenchPoll(statusRef.current?.status, connected, document.hidden);
      if (!cancelled && wait !== null) timer = setTimeout(() => void tick(), wait);
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [bookId, refresh, connected]);

  /* ── SSE：治理链提示 + 步骤过闸后立刻刷新（不等下一次轮询） ── */
  useEffect(() => {
    // 建书阶段已有 IntentDraftStage 的连接，无需再占一个同源连接。
    if (!bookId) return;
    const handle = (event: AgentEvent) => {
      const d = (event.data ?? {}) as Record<string, unknown>;
      if (typeof d.bookId === "string" && d.bookId !== bookId) return;
      setProgress(previous => reduceAgentProgress(previous, event, sessionId));
      if (chatReply.current) {
        const next = reduceCopilotEvent(chatReply.current, event, sessionId);
        if (next !== chatReply.current) {
          chatReply.current = next;
          setCopilot(previous => previous.map(m => m.id === next.id ? next : m));
        }
      }
      switch (event.type) {
        case "creation-loop:activity":
          setActivities(previous => {
            const incoming = d as unknown as CreationActivity;
            const next = mergeCreationActivity(previous[incoming.stepId],incoming,bookId);
            return next ? {...previous,[next.stepId]:next} : previous;
          });
          break;
        case "creation-loop:text":
          setCreationPreview(previous => reduceCreationPreview(previous, d, bookId));
          if (d.phase === "complete" && d.stepId === "outline" && bookId) {
            void fetchCreationPreview(bookId).then(data => { if (currentBook.current === bookId) setOutlinePreview(data.outline); }).catch(() => undefined);
          }
          break;
        case "craft:active":
          setGovernance(({planner:"规划师 · 细化章纲",composer:"编排师 · 整理上下文",writer:"执笔师 · 撰写中","length-normalizer":"执笔师 · 调整篇幅",auditor:"审校师 · 审校中",reviser:"修订师 · 修订中",settler:"结算师 · 更新状态"} as Record<string,string>)[String(d.stage)] ?? null);
          break;
        case "write:start": setGovernance("执笔师 · 撰写中"); break;
        case "audit:start": setGovernance("审校师 · 一致性审计"); break;
        case "revise:start": setGovernance("修订师 · 定向修订"); break;
        case "write:complete":
        case "audit:complete":
        case "revise:complete": setGovernance(null); break;
        case "creation-loop:reviewed":
        case "creation-loop:advanced":
        case "creation-loop:completed":
          setError(null);
          setGovernance(null);
          if (d.snapshot) {
            const next = d.snapshot as WorkflowSnapshot;
            setSnapshot((previous) => previous && previous.workflowId === next.workflowId && previous.version > next.version ? previous : next);
            if (!statusRef.current || statusRef.current.workflowId !== next.workflowId || statusRef.current.version <= next.version) statusRef.current = next;
            setLastUpdated(Date.now());
          } else void refresh().catch(() => undefined);
          break;
        case "stream:resync":
          void refresh().catch(() => undefined);
          bumpSim();
          break;
        case "creation-loop:error":
          setError(typeof d.error === "string" ? d.error : typeof d.message === "string" ? d.message : "编排出错");
          break;
        // 只当作「有新东西了」的信号：内容以 PG 为准，这里不解析消息体。
        case "chat:round":
          if (typeof d.bookId === "string" && d.bookId !== bookId) break;
          bumpSim();
          break;
        default: break;
      }
    };
    const es = new AgentEventSource(handle, undefined, { watchBookId: bookId, pauseWhenHidden: true, onConnectionChange: (state) => {
      setConnected(state === "connected");
      if (state === "connected") { void refresh().catch(() => undefined); bumpSim(); }
    } });
    es.connect();
    const restore = () => {
      if (document.visibilityState !== "visible") return;
      void refresh().catch(() => undefined);
      bumpSim();
    };
    document.addEventListener("visibilitychange", restore);
    return () => {
      document.removeEventListener("visibilitychange", restore);
      es.disconnect();
    };
  }, [bookId, refresh, sessionId]);

  /* ── 派生：每个步骤类型的状态 ── */
  const byType = useMemo(() => {
    const map = new Map<CreationLoopStepType, WorkflowStepSnapshot>();
    for (const s of snapshot?.steps ?? []) {
      const type = stepTypeOf(s.id);
      if (!type || type === "anchor") continue;
      const prev = map.get(type);
      // 章节步骤有很多个：保留"最新一个未确认的"，都确认了就保留最后一个
      if (!prev || prev.status === "confirmed") map.set(type, s);
    }
    return map;
  }, [snapshot]);

  const currentType = snapshot?.currentStepId ? stepTypeOf(snapshot.currentStepId) : null;
  /** 正在看的那一步（精确到 id）。viewing 指定优先，否则跟随当前步。 */
  const viewingStep = useMemo(
    () => (viewing ? snapshot?.steps.find((s) => s.id === viewing) ?? null : null),
    [viewing, snapshot],
  );
  const viewingType = viewing ? stepTypeOf(viewing) : null;
  const activeType: CreationLoopStepType =
    (viewingType && viewingType !== "anchor" ? viewingType : null)
    ?? (currentType && currentType !== "anchor" ? currentType : null)
    ?? "intent";

  const stateOf = (type: CreationLoopStepType): StepState => {
    // 建书阶段：意图卡就是当前步，后面五步都还不存在
    if (preBook) return type !== "intent" ? "idle"
      : draftPhase === "ready" ? "review"
      : draftPhase === "error" ? "failed"
      : draftPhase === "idle" ? "idle" : "running";
    const s = byType.get(type);
    if (!s) return "idle";
    return stepStateOf(s, currentType === type);
  };

  /** 指定了 id 就看那一步，否则看这个类型的代表步。 */
  const activeStep = viewingStep ?? byType.get(activeType) ?? null;
  const activeState = activeStep && viewingStep
    ? stepStateOf(viewingStep, currentType === activeType)
    : stateOf(activeType);
  /** 「正在看的这一步」就是编排当前停着的那一步——只有它能走通过/重铸闸门。 */
  const isCurrent = !!activeStep && activeStep.id === snapshot?.currentStepId;

  /* 角色档案索引：大纲步的 roles[] 是全书唯一一份完整档案（人设/目标/冲突/
     能力/关系/成长）。后面几步只带名字，靠这个索引把同一个人接回同一份档案。 */
  const roleIndex = useMemo(() => {
    const index: Record<string, Record<string, unknown>> = {};
    for (const step of snapshot?.steps ?? []) {
      if (stepTypeOf(step.id) !== "outline") continue;
      const roles = (step.output?.roles ?? []) as ReadonlyArray<Record<string, unknown>>;
      if (!Array.isArray(roles)) continue;
      for (const role of roles) {
        const name = typeof role?.name === "string" ? role.name.trim() : "";
        if (name) index[name] = role;
      }
    }
    return index;
  }, [snapshot]);

  /* 按「正在看的这一步」读它的仿真场次。切步、进页、刷新、回看历史步都走这里，
     直播也走这里（simTick 变化重拉）—— 一条路径，不再有「回填 + 直播两份数据要
     互相合并」的问题。 */
  useEffect(() => {
    const stage = SIM_STAGE_OF_STEP[activeType] ?? null;
    if (!bookId || !stage) { setSimRuns([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        const all = await fetchChatSessions(bookId);
        const mine = all.filter((x) => x.kind === "round" && x.stage === stage);
        const msgs = await Promise.all(
          mine.map(async (x) => {
            const cached = messageCache.current[x.uid] ?? [];
            const updated = await syncChatMessages(bookId, x, cached);
            messageCache.current[x.uid] = updated;
            return updated;
          }),
        );
        if (cancelled) return;
        const byUid: Record<string, ReadonlyArray<ChatMessageDto>> = {};
        mine.forEach((x, i) => { byUid[x.uid] = msgs[i] ?? []; });
        setSimRuns(runsFromChat(mine, byUid, stage));
        setHistoryError(null);
      } catch (error) {
        if (!cancelled) setHistoryError(`仿真历史读取失败，已展示内容保留：${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [activeType, bookId, simTick]);
  const canAct =
    isCurrent && isAwaitingReview(snapshot?.status) && !!sessionId && !!loopId && !busy && !chatBusy;

  // 章号读「正在看的那一步」，不是编排当前步——回看第 1 章时标题不能写第 2 章。
  const chapterNo = activeStep ? chapterNumberOf(activeStep.id) : null;
  const activeActivity = activeStep ? activities[activeStep.id] : undefined;
  const currentActivity = snapshot?.currentStepId ? activities[snapshot.currentStepId] : undefined;
  const chapterExecution = snapshot?.currentStepId?.startsWith("chapter_write-") ? {
    activity: currentActivity, chapter: chapterNumberOf(snapshot.currentStepId), status: snapshot.status,
    error: snapshot.steps.find(step => step.id === snapshot.currentStepId)?.error ?? undefined,
  } : undefined;
  const stageScroll = useFollowOutput(`${bookId}:${activeStep?.id}`, creationPreview?.text, !viewingGraph && isCurrent && workflowBusy);
  useEffect(() => {
    if (!bookId || !activeStep?.id.startsWith("chapter_write-")) return;
    let cancelled = false;
    void fetchCreationPreview(bookId,activeStep.id).then(data => {
      if (cancelled || !data.activity) return;
      setActivities(previous => { const next = mergeCreationActivity(previous[data.activity!.stepId],data.activity!,bookId); return next ? {...previous,[next.stepId]:next} : previous; });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [bookId, activeStep?.id]);
  const titleOutput = snapshot?.steps.find(step => step.type === "title_synopsis")?.output;
  const intentOutput = snapshot?.steps.find(step => step.type === "intent")?.output;
  const savedTitle = titleOutput?.title ?? (intentOutput?.intent as { title?: string } | undefined)?.title;
  const bookTitle = bookId ? `《${typeof savedTitle === "string" ? savedTitle : bookId}》` : "尚未命名";

  /* 章节索引（标题/字数）：目录用，跟着快照的章节步一起刷新。 */
  const [chapterIndex, setChapterIndex] = useState<ReadonlyArray<ChapterSummary>>([]);
  const chapterStepCount = useMemo(
    () => (snapshot?.steps ?? []).filter((s) => stepTypeOf(s.id) === "chapter_write").length,
    [snapshot],
  );
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    void fetchBook(bookId)
      .then((d) => { if (!cancelled) setChapterIndex(d.chapters ?? []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [bookId, chapterStepCount, snapshot?.status]);

  /**
   * 章节目录：编排里每章一个步骤，六步视图只显示最新一个——写到第 2 章就
   * 点不回第 1 章了。这里把全部章节步摊平，配上章节索引里的标题与字数。
   */
  const castChapters = useMemo<ReadonlyArray<CastChapter>>(() => {
    const byNumber = new Map(chapterIndex.map((c) => [c.number, c]));
    return (snapshot?.steps ?? [])
      .filter((s) => stepTypeOf(s.id) === "chapter_write")
      .map((s) => {
        const number = chapterNumberOf(s.id) ?? 0;
        const meta = byNumber.get(number);
        return {
          stepId: s.id,
          number,
          title: meta?.title ?? "",
          wordCount: meta?.wordCount ?? null,
          state: castStateFor(stepStateOf(s, s.id === snapshot?.currentStepId)),
        };
      })
      .filter((c) => c.number > 0)
      .sort((a, b) => a.number - b.number);
  }, [snapshot, chapterIndex]);

  /**
   * 面板实际展示的仿真：正文步再按**章**收一次。
   * stage 只能收窄到「正文预演」，第 1 章和第 2 章的预演都在这个桶里；
   * 看第 1 章却混进第 2 章的预演是错的。
   */
  const visibleRuns = useMemo(() => {
    if (activeType !== "chapter_write" || chapterNo === null) return simRuns;
    return simRuns.filter((r) => r.chapter === chapterNo);
  }, [simRuns, activeType, chapterNo]);
  const visibleRoundCount = useMemo(
    () => visibleRuns.reduce((n, r) => n + r.rounds.length, 0),
    [visibleRuns],
  );

  /**
   * 重新生成任意一步（含已确认的历史章节）。走 /creation-loop/regenerate：
   * 只把该步打回重跑，不作废下游已确认的章节。
   */
  const regenerate = async (stepId: string, fb?: string) => {
    if (!bookId || !loopId || busy || chatBusy || workflowBusy) return false;
    setBusy(true);
    setError(null);
    try {
      await regenerateLoopStep({ bookId, loopId, stepId, ...(fb ? { feedback: fb } : {}) });
      setRejecting(false);
      setViewing(stepId);   // 停在这一章，看它重跑
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新生成失败");
      return false;
    } finally {
      setBusy(false);
    }
  };

  /* 章节过程卡的数据：章节索引里的审计/规范/结算留痕（章节步才取）。 */
  const [chapterMeta, setChapterMeta] = useState<ChapterSummary | null>(null);
  useEffect(() => {
    if (!bookId || activeType !== "chapter_write" || !chapterNo) {
      setChapterMeta(null);
      return;
    }
    let cancelled = false;
    void fetchBook(bookId)
      .then((d) => {
        if (cancelled) return;
        setChapterMeta((d.chapters ?? []).find((c) => c.number === chapterNo) ?? null);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [bookId, activeType, chapterNo]);

  /* ── 审阅动作 ── */
  const act = async (decision: "confirm" | "reject", fb?: string) => {
    if (!sessionId || !loopId || !bookId || !snapshot?.currentStepId) return false;
    setBusy(true);
    setError(null);
    try {
      requireAgentSuccess(await reviewLoopStep({
        sessionId, bookId, loopId,
        stepId: snapshot.currentStepId,
        decision,
        ...(fb ? { feedback: fb } : {}),
        // 使用态模型选择：审阅回合按用户当前下拉的模型跑
        //（步骤重生成本身仍按确认建书时钉定的模型，见后端 creationLoop）。
        ...(composer.selected
          ? { model: composer.selected.id, ...(composer.selected.service ? { service: composer.selected.service } : {}) }
          : {}),
      }));
      setRejecting(false);
      setViewing(decision === "reject" ? snapshot.currentStepId : null);
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** 只有独立重写按钮把讨论内容提交为修改要求。 */
  const rewriteWithFeedback = async (text: string) => {
    copilotSeq.current += 1;
    const author = STEP_AUTHOR[activeType];
    setCopilot((prev) => [
      ...prev,
      { id: `u${copilotSeq.current}`, role: "user", content: text },
    ]);
    // 当前步走确认门的 reject；回看的历史步（第 1 章等）走 regenerate。
    const ok = canAct ? await act("reject", text) : activeStep ? await regenerate(activeStep.id, text) : false;
    if (ok) setCopilot((prev) => [...prev, { id: `a${++copilotSeq.current}`, role: "system", author, content: `重写要求已提交，正在重新生成「${CREATION_STEP_LABELS_ZH[activeType]}」。完成后请在中间审阅。` }]);
    return ok;
  };

  const askAgent = async (input: WorkbenchMessageInput) => {
    if (chatReply.current || busy || workflowBusy || (preBook ? !draftRef.current : !sessionId)) return false;
    // A bare confirmation has an exact, visible target; ordinary discussion still goes to the agent.
    if (canAct && /^(确认|通过|继续)[。！!]?$/u.test(input.text.trim()) && !input.files.length && !input.summoned.agents.length) {
      const ok = await act("confirm");
      if (ok) setCopilot(prev => [...prev, { id: `confirm-${++copilotSeq.current}`, role: "system", content: `已通过${chapterNo ? `第 ${chapterNo} 章` : CREATION_STEP_LABELS_ZH[activeType]}，正在推进下一步。` }]);
      return ok;
    }
    const reply: CopilotMessage = { id: `a${++copilotSeq.current}`, role: "agent", author: STEP_AUTHOR[activeType], content: "" };
    chatReply.current = reply;
    chatJob.current = null;
    stoppingChat.current = false;
    setChatBusy(true);
    setError(null);
    setCopilot(prev => [...prev, { id: `u${++copilotSeq.current}`, role: "user", content: input.text }, reply]);
    let failed = false;
    try {
      const response = preBook
        ? { response: await draftRef.current!.send(input) }
        : await discussWorkbench(input, sessionId!, bookId!, id => {
          if (chatReply.current?.id !== reply.id) return;
          chatJob.current = id;
          if (stoppingChat.current) void cancelQueuedAgentJob(id).then(cancelled => {
            if (!cancelled) return abortSession(sessionId!, "chat");
          }).catch(e => setError(e instanceof Error ? e.message : "停止请求失败"));
        });
      if (chatReply.current?.id !== reply.id || currentBook.current !== bookId) return true;
      const completed = finishCopilotMessage(chatReply.current, response);
      setCopilot(prev => prev.map(m => m.id === reply.id ? completed : m));
      if (bookId) void refresh().catch(() => undefined);
      return true;
    } catch (e) {
      failed = true;
      if (chatReply.current?.id !== reply.id || currentBook.current !== bookId) return false;
      const message = e instanceof Error ? e.message : "发送失败";
      setCopilot(prev => prev.map(m => m.id === reply.id ? { ...m, error: stoppingChat.current ? "已请求停止；已产生的内容与工具记录保留，请检查实际结果。" : message,
        toolExecutions: m.toolExecutions?.map(t => t.status === "running" ? { ...t, status: "error", error: "本轮中断，请检查实际结果后再试。" } : t) } : m));
      return stoppingChat.current;
    } finally {
      if (chatReply.current?.id === reply.id) {
        chatReply.current = null;
        chatJob.current = null;
        setChatBusy(false);
        setProgress(previous => reduceAgentProgress(previous, { type: failed ? "agent:error" : "agent:complete", data: { sessionId } }, sessionId));
      }
    }
  };

  const stopChat = async () => {
    if (!sessionId || !chatReply.current || stoppingChat.current) return;
    stoppingChat.current = true;
    try {
      const cancelled = chatJob.current ? await cancelQueuedAgentJob(chatJob.current) : false;
      if (!cancelled) await abortSession(sessionId, "chat");
    } catch (e) { stoppingChat.current = false; setError(e instanceof Error ? e.message : "停止请求失败"); }
  };

  const adoptBook = async () => {
    if (!bookId || busy || chatBusy) return;
    setBusy(true); setError(null);
    try {
      await adoptLegacyBook(bookId, composer.selected ? { service: composer.selected.service, model: composer.selected.id } : undefined);
      await refresh();
      setCopilot(prev => [...prev, { id: `adopt-${++copilotSeq.current}`, role: "system", content: "已接回原有档案与章节。请查看当前待审阅内容，通过后从下一章继续创作。" }]);
    } catch (e) { setError(e instanceof Error ? e.message : "接续失败"); }
    finally { setBusy(false); }
  };

  /**
   * 回看的历史步骤能不能就地重写。
   *
   * 通过/重铸闸门只对「编排当前停着的那一步」开放，所以写到第 2 章之后，
   * 第 1 章既点不了通过也点不了重铸——用户要改早先某一章时无路可走。
   * 已确认/已失败的历史步骤走 regenerate：只打回这一步，不动下游。
   *
   * 失败的当前步也放开：后端 rejectStep 本就允许 failed 步带 feedback 重跑
   * （harness 只拒 running/pending），以前禁着纯属前端自限——失败时只能
   * 原样重试、连"说要改什么"都做不到，输入框成了摆设。
   */
  const canRegenerate =
    !preBook && !!loopId && !busy && !chatBusy && !workflowBusy && !!activeStep
    && (!activeStep.output?.restoredFromFiles || !!activeStep.output?.priorChapterPlan)
    && (activeState === "failed" || (!isCurrent && activeState === "done"));
  /** 重写按钮的文案：章节步说「第 N 章」，其他步说步骤名。 */
  const regenLabel = chapterNo !== null
    ? `重新生成第 ${chapterNo} 章`
    : `重新生成「${CREATION_STEP_LABELS_ZH[activeType]}」`;

  /**
   * 失败恢复：workflow 落到 failed 后，通过/重铸都要求 awaiting_review，
   * 全都点不动 —— 不给一条出路的话这一步就是死胡同。
   * resume 会从失败处重新推进（后端沿用原策略与指令）。
   */
  const retryFailed = async () => {
    if (!bookId || !loopId || busy || chatBusy || workflowBusy) return;
    setBusy(true);
    setError(null);
    try {
      await resumeLoop(bookId, loopId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重试失败");
    } finally {
      setBusy(false);
    }
  };

  const loopFailed = snapshot?.status === "failed" || activeState === "failed";

  /**
   * 换模型重试：把右栏选中的模型（使用态选择，同时写全局）钉进这本书的
   * creationLoop 再恢复——书是用坏配置建的（比如服务 baseUrl 失效）时，
   * 原样重试只会再失败一次，这是唯一的出口。
   */
  const retryWithModel = async () => {
    if (!bookId || !loopId || !composer.selected || busy || chatBusy || workflowBusy) return;
    setBusy(true);
    setError(null);
    try {
      await resumeLoop(bookId, loopId, {
        service: composer.selected.service,
        model: composer.selected.id,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重试失败");
    } finally {
      setBusy(false);
    }
  };

  const doneCount = CREATION_LOOP_STEP_TYPES.filter((t) => stateOf(t) === "done").length;

  /** 已铸档案的状态映射（含失败态）。 */
  const castStateOf = (t: CreationLoopStepType): CastState => castStateFor(stateOf(t));
  const attemptOf = (t: CreationLoopStepType): number => byType.get(t)?.attempt ?? 1;
  /** 还没轮到跑天衍（意图卡/世界观阶段），不是"没产出"。 */
  const pendingSim = activeType === "intent" || activeType === "worldview";

  return (
    <div className="wb">
      {/* ── 顶部步骤轨 ── */}
      <header className="wb-top">
        <div className="wb-brand">铸造一个世界</div>
        <nav className="wb-rail">
          {CREATION_LOOP_STEP_TYPES.map((type, i) => {
            const st = stateOf(type);
            const on = activeType === type;
            return (
              <button
                key={type}
                className={`wb-rail-step is-${st} ${on ? "is-active" : ""}`}
                onClick={() => setViewing(byType.get(type)?.id ?? null)}
                title={CREATION_STEP_SUBTITLES[type]}
              >
                <span className="wb-rail-dot">
                  {st === "done" ? <Check size={11} />
                    : st === "running" ? <Loader2 size={11} className="spin" />
                    : i + 1}
                </span>
                <span className="wb-rail-name">{CREATION_STEP_LABELS_ZH[type]}</span>
              </button>
            );
          })}
        </nav>
        <div className="wb-top-right">
          {preBook && <select aria-label="创作引擎" value={routeStrategy} disabled={draftPhase === "creating"} onChange={(e) => setRouteStrategy(e.target.value as "fast" | "simulate")}>
            <option value="fast">快速直出</option>
            <option value="simulate" disabled={!canSimulate}>世界模拟 · 会员</option>
          </select>}
          {/*
            全自动：顶部一个小方框，不占底部那条的位置。
            它是「怎么跑」，跟进度放一起最顺手——底部那条现在是跟六师说话的地方。
          */}
          <label
            className={`wb-auto ${autoRun ? "is-on" : ""}`}
            title={autoRun ? "全自动：不停下等确认，一路跑完" : "开启后不停下等确认，一路跑完"}
          >
            <input
              type="checkbox"
              checked={autoRun}
              disabled={preBook || autoRunBusy}
              onChange={(e) => void toggleAutoRun(e.target.checked)}
            />
            <Zap size={13} />
          </label>
          <span className="wb-progress">{doneCount} / 6</span>
          {bookId && (
            <Link to={`/conversation/${bookId}`} className="wb-switch" title="切换到剧场模式">
              <MessageSquare size={14} /> 对话
            </Link>
          )}

        </div>
      </header>

      {/*
        ── 这一步读什么、边界在哪 ──

        原来是一条通栏的说明文字，每一步都占掉屏幕上一整行。它是**查得到就行**
        的东西，不是每次都要读一遍的——收成一个感叹号，需要时点开/悬停。
      */}
      <details className="wb-hint">
        <summary aria-label="这一步做什么">
          <Info size={13} />
        </summary>
        <p>
          {preBook
            ? "第 ① 步就是建书本身：确认意图卡后才会生出后面五步，所以先把方向定下来。"
            : CREATION_STEP_INPUTS[activeType]}
        </p>
      </details>

      {/* 引擎实况：档位与仿真是否真的跑了——比标称的轮次更重要 */}
      {strategy === "fast" && (
        <div className="wb-degraded">
          快速直出：六师正常完成各步创作，不调用天衍仿真。
        </div>
      )}
      {/* 天衍是「延后」执行的：意图卡阶段不跑，世界观确认后才跑本体/建图/画像。
          所以前两步没有产物是正常的，从大纲开始没有才是真问题（后端会硬失败）。 */}
      {strategy === "simulate" && !hasSim && (
        pendingSim ? (
          <div className="wb-pending-sim">
            天衍推演将在<b>世界观确认后</b>运行（本体 → 建图 → 智能体画像 → 舆情推演），
            之后的大纲/卷纲/正文都会消费它的产出。
          </div>
        ) : (
          <div className="wb-degraded">
            这本书没有推演产物（缺 simDir / graphId），而仿真编排<b>要求仿真必达</b>，
            后端会在大纲步直接失败而不是降级。通常是建书时知识图谱不可用所致。
          </div>
        )
      )}

      {([
        [error, () => setError(null)],
        [syncError, () => setSyncError(null)],
        [historyError, () => setHistoryError(null)],
      ] as const).map(([message, dismiss], index) => message && (
        <div className="wb-error" key={index}>
          <AlertCircle size={14} /> {message}
          <button onClick={dismiss} aria-label="关闭提示"><X size={13} /></button>
        </div>
      ))}

      {!preBook && lastUpdated && !snapshot && !loopId && (
        <div className="wb-degraded">
          已有档案与章节尚未接入工作台。接续后保留原稿，从当前进度继续。
          <button className="cop-qk" disabled={busy || chatBusy} onClick={() => void adoptBook()}>{busy ? "正在接续…" : "接续已有档案"}</button>
        </div>
      )}
      {!preBook && (
        <div className="wb-task-status" role="status">
          <span>{!snapshot ? lastUpdated ? loopId ? "编排已登记，等待步骤开始" : "已读取：旧作品无分步记录" : "正在读取创作进度" : connected ? "进度已连接" : "正在重连，后台任务状态待同步"}</span>
          {executionModel && <span>当前任务模型：{executionModel}</span>}
          {lastUpdated && <span>最近同步 {new Date(lastUpdated).toLocaleTimeString()}</span>}
          {snapshot && isLoopRunning(snapshot.status) && <button disabled={busy} onClick={() => {
            if (!bookId || !loopId) return;
            setBusy(true);
            void pauseLoop(bookId, loopId).then(() => refresh()).catch((e) => setError(String(e))).finally(() => setBusy(false));
          }}>暂停任务</button>}
          <button onClick={() => { void refresh().catch(() => undefined); bumpSim(); }}>重新读取</button>
        </div>
      )}
      <DeconstructionLayout variant="workbench" contentKey={`${bookId}:${activeStep?.id}:${viewingGraph}`}>
        <CastPanel
          simulationEnabled={strategy === "simulate" || (strategy === null && hasSim)}
          bookTitle={bookTitle}
          stepsDone={doneCount}
          stateOf={castStateOf}
          attemptOf={attemptOf}
          activeType={activeType}
          activeStepId={activeStep?.id ?? null}
          onPick={(t) => setViewing(byType.get(t)?.id ?? null)}
          chapters={castChapters}
          onPickChapter={(stepId) => setViewing(stepId)}
          {...(bookId ? { graphHref: `/workbench/${encodeURIComponent(bookId)}/graph` } : {})}
          onOpenGraph={() => setViewingGraph(true)}
          viewingGraph={viewingGraph}
        />

        {viewingGraph && (
          <main className="wb-stage wb-graph-stage">
            <WorkbenchGraphPage onBack={() => setViewingGraph(false)} />
          </main>
        )}
        <main className="wb-stage" ref={stageScroll.ref} onScroll={stageScroll.onScroll} style={viewingGraph ? { display: "none" } : undefined}>
          {!!activeStep?.output?.restoredFromFiles && <div className="wb-task-status">来自已有档案 · 原稿保留，未重新生成</div>}
          <div className="wb-stage-head">
            <div>
              <h1 className="wb-stage-title">
                {CREATION_STEP_LABELS_ZH[activeType]}
                {activeType === "chapter_write" && chapterNo && (
                  <span className="wb-stage-chapter">第 {chapterNo} 章</span>
                )}
              </h1>
              <div className="wb-stage-sub">
                {CREATION_STEP_SUBTITLES[activeType]} · {STEP_AUTHOR[activeType]}执笔
              </div>
            </div>
            <StepBadge state={activeState} label={activeState === "running" && activeActivity?.items.some(i => i.stage === "writer" && i.status === "done") ? "正文已生成 · 后续处理中" : undefined} />
          </div>

          {!preBook && activeType === "chapter_write" && <ChapterActivity key={`${bookId}:${activeStep?.id}`} activity={activeActivity} running={isCurrent && workflowBusy} chapter={chapterNo} error={activeStep?.error ?? undefined} status={isCurrent ? snapshot?.status : activeStep?.status} />}
          {stageScroll.paused && <button className="wb-follow-output" onClick={stageScroll.resume}>↓ 回到最新输出</button>}

          {!preBook && activeType === "chapter_write" && visibleRuns.length > 0 && <SimFeedPanel runs={visibleRuns} rounds={visibleRoundCount} running={isCurrent && workflowBusy} />}
          {preBook ? (
            <IntentDraftStage
              ref={draftRef}
              instruction={instruction}
              initialInput={routeState?.initialInput}
              strategy={routeStrategy}
              // 工作台就是「每步停下确认」的界面；自动运行走 /auto 那一页。
              approvalPolicy="review"
              // 这一页就是引导模式，书按引导记——作品库据此显示标签并决定点进去去哪。
              creationMode="guided"
              onPhase={setDraftPhase}
              onCreated={(id) => {
                // 拿到真 bookId 才进工作台；replace 避免回退又落回建书页
                navigate(`/workbench/${encodeURIComponent(id)}`, {
                  replace: true,
                  state: { strategy: routeStrategy },
                });
              }}
            />
          ) : activeState === "running" ? (
            <>
              {!(creationPreview?.bookId === bookId && creationPreview.stepId === activeStep?.id && previewText(creationPreview.text, creationPreview.structured)) && <RunningPanel type={activeType} governance={governance} />}
              {creationPreview?.bookId === bookId && creationPreview.stepId === activeStep?.id && <section className="so-block"><header className="so-block-head">{creationPreview.awaitingText ? "新一轮正在准备，先保留已有内容" : activeActivity && activeType === "chapter_write" ? activitySummary(activeActivity,workflowBusy) : creationPreview.label || "正在生成内容"}</header><div className="so-block-body" aria-live="off">{previewText(creationPreview.text, creationPreview.structured) || "正在准备本阶段产出…"}</div></section>}
              {activeType === "outline" && outlinePreview?.text && <details className="so-block"><summary>{outlineProgressLabel(outlinePreview)}</summary><div className="so-block-body">{outlinePreview.text}</div></details>}
            </>
          ) : activeState === "failed" ? (
            <div className="wb-failed">
              <AlertCircle size={16} />
              <div className="wb-failed-body">
                <div className="wb-failed-title">{CREATION_STEP_LABELS_ZH[activeType]}失败{activeStep?.attempt ? ` · 第 ${activeStep.attempt} 次尝试` : ""}</div>
                <WorkflowError error={activeStep?.error || "未知错误"} />
                {creationPreview?.bookId === bookId && creationPreview.stepId === activeStep?.id && <details><summary>查看本次已产出内容（创作步骤尚未完成）</summary>{activeType === "chapter_write" ? <StepOutput key={creationPreview.requestId} type="chapter_write" output={{content:previewText(creationPreview.text, creationPreview.structured)}} /> : <div className="so-block-body">{previewText(creationPreview.text, creationPreview.structured)}</div>}</details>}
                {activeType === "outline" && outlinePreview?.text && <details><summary>{outlineProgressLabel(outlinePreview)}，重试从未完成处继续</summary><div className="so-block-body">{outlinePreview.text}</div></details>}
                <div className="wb-failed-actions">
                  {/*
                    换模型重试：书的 creationLoop 钉着确认建书时的模型/服务，
                    配置坏了原样重试必然再失败。这里直接用使用态选择——
                    下拉换个模型（会同步写全局），点按钮钉进书里再恢复。
                  */}
                  <select
                    className="wb-retry-model"
                    value={composer.selected ? `${composer.selected.service}:${composer.selected.id}` : ""}
                    onChange={(e) => {
                      const hit = composer.models.find((m) => `${m.service}:${m.id}` === e.target.value);
                      if (hit) composer.selectModel(hit);
                    }}
                    disabled={busy || chatBusy || workflowBusy}
                  >
                    {composer.models.length === 0 && <option value="">暂无可用模型</option>}
                    {[...new Map(composer.models.map((m) => [m.service, m])).values()].map((g) => (
                      <optgroup key={g.service} label={g.serviceLabel}>
                        {composer.models
                          .filter((m) => m.service === g.service)
                          .map((m) => (
                            <option key={`${m.service}:${m.id}`} value={`${m.service}:${m.id}`}>
                              {m.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    className="wb-foot-btn is-warn wb-failed-retry"
                    onClick={() => void retryFailed()}
                    disabled={busy || chatBusy || workflowBusy}
                  >
                    {busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
                    重新生成
                  </button>
                  <button
                    className="wb-foot-btn is-warn"
                    onClick={() => void retryWithModel()}
                    disabled={busy || chatBusy || workflowBusy || !composer.selected}
                  >
                    {busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
                    换模型重试
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <StepOutput type={activeType} output={activeStep?.output ?? null} roleIndex={roleIndex} />
          )}

          {/* 仿真对话流：谁在参与、每轮说了什么。跑着是直播，停下是回看；
              回填+SSE 都按「正在看的步」的阶段过滤，有数据的步才显示。 */}
          {!preBook && activeType !== "chapter_write" && visibleRuns.length > 0 && (
            <SimFeedPanel runs={visibleRuns} rounds={visibleRoundCount} running={activeState === "running" && isCurrent} />
          )}

          {/* 章节过程卡：预演/执笔/规范/审校/修订/结算各环节的真实产出与留痕，
              替代原来的六师静态占位卡（那些 SSE 事件在编排路径里从来没广播过）。 */}
          {!preBook && activeType === "chapter_write" && activeState !== "running" && activeStep?.output && (
            <ChapterProcessCard
              strategy={strategy}
              step={activeStep}
              meta={chapterMeta}
              simRounds={visibleRoundCount}
            />
          )}

          {activeStep?.reviewFeedback && (
            <div className="wb-feedback-echo">
              <RotateCcw size={12} /> 上次重铸要求：{activeStep.reviewFeedback}
            </div>
          )}
        </main>

        <CopilotPanel
          liveMessage={workflowBusy
            ? creationPreview && creationPreview.stepId === snapshot?.currentStepId
                ? `${currentActivity ? activitySummary(currentActivity, true) : creationPreview.label || "正在生成内容"} · 已输出 ${previewText(creationPreview.text, creationPreview.structured).length} 字`
                : currentActivity ? activitySummary(currentActivity, true)
                : `正在执行${snapshot?.currentStepId ? creationStepLabel(snapshot.currentStepId) : "创作任务"}`
            : snapshot?.status === "failed" ? "本步执行中断，已产出内容保留"
            : snapshot?.status === "paused" ? "任务已暂停，已有内容保留" : undefined}
          progress={chapterExecution ? progress : withWorkflowProgress(progress, snapshot)}
          execution={chapterExecution}
          {...(bookId ? { graphId: bookId } : {})}
          author={STEP_AUTHOR[activeType]}
          messages={copilot}
          busy={chatBusy || busy || workflowBusy || (preBook && (draftPhase === "drafting" || draftPhase === "creating"))}
          disabled={!preBook && !sessionId}
          hint={
            preBook
              ? "聊聊想写的故事，也可以调整意图卡；方向确定后，在中间确认建书。"
              : workflowBusy
                ? "创作任务正在执行，下面会持续更新进展；完成或暂停后可发送新指令。"
              : chatBusy
                ? "正在与你讨论，当前审阅进度已保存；可以随时停止本轮回复。"
              : snapshot?.status === "failed"
                ? `当前任务：${snapshot.currentStepId ? creationStepLabel(snapshot.currentStepId) : "创作"}。${summarizeWorkflowError(snapshot.steps.find(step => step.id === snapshot.currentStepId)?.error || "执行失败")}下方对话保留历史记录，以当前任务状态为准。`
              : canAct
              ? "可以先讨论本步的内容。确定修改要求后，点击「按这段文字重写本步」，生成完再审阅。"
              : canRegenerate
                ? isCurrent
                  ? "本步失败了——说要改什么，会带着要求重试；想原样重跑就点「重新生成」。"
                  : `这一步已确认，但仍可回改：你说的要求会作为「${regenLabel}」的依据，只重跑这一步，后面的章节不作废。`
                : isCurrent
                  ? "可以在这里讨论创作，待本步生成完成后再提交重写。"
                  : "可以讨论后续构思；重写要等这一步有了产出。"
          }
          taskActions={<>
            {(viewing || viewingGraph) && <button className="cop-qk" onClick={() => setViewing(null)}>回到当前步</button>}
            {snapshot?.status === "paused" && <div className="cop-review"><span>任务已暂停，已保存的内容会保留。</span><button className="cop-qk" disabled={busy || chatBusy} onClick={() => void retryFailed()}>继续任务</button></div>}
            {loopFailed && <button className="cop-qk" disabled={busy || chatBusy} onClick={() => void retryFailed()}>重试当前任务</button>}
            {canRegenerate && !loopFailed && <button className="cop-qk" disabled={busy || chatBusy} onClick={() => { if (activeStep) void regenerate(activeStep.id); }}>原样重跑本步</button>}
            {snapshot?.status === "succeeded" && <div className="cop-hint">本次创作已完成。</div>}
            {snapshot?.status === "cancelled" && <div className="cop-hint">任务已取消。</div>}
          </>}
          quickActions={QUICK_ACTIONS[activeType] ?? DEFAULT_QUICK_ACTIONS}
          onSend={askAgent}
          {...(chatBusy && !preBook ? { onStop: () => void stopChat() } : {})}
          {...(isCurrent && !viewingGraph && snapshot?.status === "awaiting_review" && snapshot.currentStepId ? { reviewAction: {
            label: chapterNumberOf(snapshot.currentStepId) ? `第 ${chapterNumberOf(snapshot.currentStepId)} 章` : CREATION_STEP_LABELS_ZH[stepTypeOf(snapshot.currentStepId) as CreationLoopStepType],
            disabled: !canAct,
            onConfirm: () => { setViewing(null); void act("confirm"); },
          } } : {})}
          {...((canAct && (!activeStep?.output?.restoredFromFiles || !!activeStep?.output?.priorChapterPlan)) || canRegenerate ? { onRewrite: rewriteWithFeedback } : {})}
        />
      </DeconstructionLayout>
    </div>
  );
}

/** 每步的快捷改写要求——都会走 reject+feedback。 */
const DEFAULT_QUICK_ACTIONS = ["整步重铸", "更具体一些", "检查与上一步的冲突"];
const QUICK_ACTIONS: Readonly<Partial<Record<CreationLoopStepType, ReadonlyArray<string>>>> = {
  intent: ["换个更抓人的方向", "冲突再尖锐一点", "换个书名"],
  worldview: ["法则再狠一点", "补上势力之间的制衡", "红线写具体，别空泛"],
  title_synopsis: ["简介再有钩子", "换一批候选书名"],
  outline: ["压缩前期节奏", "把伏笔埋得更早", "卷与卷之间的张力递进"],
  chapter_plan: ["本卷章数压缩", "每章加一个钩子", "补上镜头外事件"],
  chapter_write: ["对白多一点", "节奏再快", "结尾钩子再重"],
};

/* ── 状态徽章 ── */
function StepBadge({ state, label: overrideLabel }: { readonly state: StepState; readonly label?: string }) {
  const map: Record<StepState, [string, string]> = {
    idle: ["未开始", "idle"],
    running: ["生成中", "running"],
    review: ["待确认", "review"],
    done: ["已确认", "done"],
    failed: ["失败", "failed"],
  };
  const [label, cls] = map[state];
  return <span className={`wb-badge is-${cls}`}>{overrideLabel ?? label}</span>;
}

/* ── 生成中：说明这一步正在做什么，而不是干转菊花 ── */
function RunningPanel({
  type, governance,
}: { readonly type: CreationLoopStepType; readonly governance: string | null }) {
  return (
    <div className="wb-running">
      <Loader2 size={22} className="spin" />
      <div className="wb-running-title">{CREATION_STEP_LABELS_ZH[type]} 生成中</div>
      <div className="wb-running-sub">
        {governance ?? "正在生成本步内容，完成后会停下来供你审阅。"}
      </div>
    </div>
  );
}

/* ── 仿真直播流：参与者 + 逐轮对话（数据来自 tianyan_dialogue 会话消息） ── */
/** 智能体名可能带描述后缀（"名称：描述"）——显示短名，全名放 title。 */
function shortAgentName(name: string): string {
  const cut = name.split(/[:：]/)[0]?.trim();
  return cut && cut.length > 0 ? cut : name;
}

/** 时间戳 → HH:MM（0 = 老数据没记时间，不显示）。 */
function clockOf(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function SimFeedPanel({
  runs, rounds: totalRounds, running,
}: {
  readonly runs: ReadonlyArray<SimRun>;
  readonly rounds: number;
  readonly running: boolean;
}) {
  return (
    <section className="wb-simfeed">
      <header className="wb-simfeed-head">
        <span className="wb-simfeed-title">
          智能体仿真实况 · {runs.length > 1 ? `${runs.length} 场 · ` : ""}{totalRounds} 轮
          {running && <Loader2 size={12} className="spin" />}
        </span>
      </header>
      {/* 最新一场默认展开，历史场次折叠——留痕但不刷屏。 */}
      {runs.map((run, i) => (
        <SimRunBlock
          key={run.key}
          run={run}
          ordinal={i + 1}
          total={runs.length}
          defaultOpen={i === runs.length - 1}
          live={running && i === runs.length - 1}
        />
      ))}
    </section>
  );
}

function SimRunBlock({
  run, ordinal, total, defaultOpen, live,
}: {
  readonly run: SimRun;
  readonly ordinal: number;
  readonly total: number;
  readonly defaultOpen: boolean;
  readonly live: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // 参与者：按发言数排序，一眼看到这场仿真谁在被推演。
  const participants = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of run.rounds) for (const a of r.actions) counts.set(a.agent, (counts.get(a.agent) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [run]);
  const speeches = useMemo(
    () => run.rounds.reduce((sum, r) => sum + r.actions.length, 0),
    [run],
  );
  // 新一轮进来时滚到底（用户往上翻时不抢滚动条）。
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !open) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [run, open]);
  const clock = clockOf(run.startedAt);
  return (
    <div className={`wb-simrun ${open ? "is-open" : ""}`}>
      <button className="wb-simrun-head" onClick={() => setOpen((v) => !v)}>
        <ChevronDown size={13} className={open ? "is-open" : ""} />
        <span className="wb-simrun-name">
          {run.chapter !== null ? `第 ${run.chapter} 章预演` : total > 1 ? `第 ${ordinal} 次推演` : "本步推演"}
        </span>
        <span className="wb-simrun-meta">
          {run.rounds.length} 轮 · {participants.length} 个智能体 · {speeches} 条发言
          {clock && ` · ${clock}`}
        </span>
        {live && <span className="wb-simrun-live">进行中</span>}
      </button>
      {open && (
        <>
          <div className="wb-simfeed-participants">
            {participants.map(([name, count]) => (
              <span key={name} className="wb-simfeed-chip" title={`${name}：${count} 次发言`}>
                {shortAgentName(name)}<i>{count}</i>
              </span>
            ))}
          </div>
          <div className="wb-simfeed-body" ref={bodyRef}>
            {run.rounds.map((r) => (
              <div key={r.id} className="wb-simfeed-round">
                <div className="wb-simfeed-round-no">第 {r.round + 1} 轮</div>
                {r.actions.map((a, i) => (
                  <div key={`${r.id}-${i}`} className="wb-simfeed-line">
                    <span className="wb-simfeed-agent" title={a.agent}>{shortAgentName(a.agent)}</span>
                    <span className="wb-simfeed-type">{SIM_ACTION_LABELS[a.type] ?? "发言"}</span>
                    <span className="wb-simfeed-content">{a.content}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── 章节过程卡：每一「师」干什么、产出什么——全部取真实数据 ──
   数据源：步骤产出（字数/智能体同步/用量）、章节索引（审计问题/字数警告/摘要/钩子）、
   仿真直播（预演轮数）、步骤尝试次数与重铸意见。 */
function ChapterProcessCard({
  step, meta, simRounds, strategy,
}: {
  readonly step: WorkflowStepSnapshot;
  readonly meta: ChapterSummary | null;
  readonly simRounds: number;
  readonly strategy: "fast" | "simulate" | null;
}) {
  const output = (step.output ?? {}) as Record<string, unknown>;
  const wordCount = typeof output.wordCount === "number" ? output.wordCount : null;
  const tokens = step.usage?.tokens;
  const agentSync = (output.agentSync ?? null) as { ok?: unknown; error?: unknown } | null;
  const auditIssues = meta?.auditIssues ?? [];
  const lengthWarnings = meta?.lengthWarnings ?? [];
  const rows: Array<{ emoji: string; name: string; duty: string; result: string; warn?: boolean }> = [
    {
      emoji: "📐", name: "场景预演", duty: "本章场景 + 智能体跑几轮仿真，产出素材",
      result: strategy === "fast" ? "快速直出不启用仿真" : simRounds > 0 ? `${simRounds} 轮智能体对话（见上方实况）` : "未运行",
      warn: strategy === "simulate" && simRounds === 0,
    },
    {
      emoji: "✍️", name: "执笔成文", duty: "按已确认章纲渲染正文",
      result: wordCount !== null
        ? `${wordCount.toLocaleString()} 字${tokens ? `，消耗 ${tokens.toLocaleString()} tokens` : ""}`
        : "无产出",
      warn: wordCount === null,
    },
    {
      emoji: "📏", name: "规范校验", duty: "字数/长度是否达到目标区间",
      result: !meta
        ? "章节索引无记录"
        : lengthWarnings.length > 0
          ? `${lengthWarnings.length} 处警告：${lengthWarnings[0]}`
          : "未记录篇幅警告（不代表已通过校验）",
      warn: lengthWarnings.length > 0,
    },
    {
      emoji: "🔍", name: "审校审计", duty: "规则与连续性审计",
      result: !meta
        ? "章节索引无记录"
        : auditIssues.length > 0
          ? `${auditIssues.length} 处问题：${auditIssues[0]}`
          : "未记录审校问题；详细结果见本章执行记录",
      warn: auditIssues.length > 0,
    },
    {
      emoji: "🎨", name: "修订重铸", duty: "按审校/驳回意见定向重写",
      result: step.attempt > 1
        ? `第 ${step.attempt} 次生成${step.reviewFeedback ? `，依据：${step.reviewFeedback}` : ""}`
        : "首次生成；是否定向修订见执行记录",
    },
    {
      emoji: "📊", name: "结算落盘", duty: "正文落盘 + 章节索引 + 记忆同步",
      result: [
        meta ? `章节已登记（${meta.status ?? "未知状态"}）` : "未登记",
        agentSync ? (agentSync.ok === false ? `智能体同步失败：${String(agentSync.error ?? "")}` : "") : "未记录智能体同步结果",
      ].filter(Boolean).join("；"),
      warn: agentSync?.ok === false,
    },
  ];
  return (
    <section className="wb-card wb-proc">
      <header className="wb-card-head">本章产出记录</header>
      <ul className="wb-proc-list">
        {rows.map((r) => (
          <li key={r.name} className={r.warn ? "is-warn" : ""}>
            <span className="wb-proc-emoji">{r.emoji}</span>
            <div className="wb-proc-body">
              <div className="wb-proc-name">{r.name}<i>{r.duty}</i></div>
              <div className="wb-proc-result">{r.result}</div>
            </div>
          </li>
        ))}
      </ul>
      {meta?.summary && (
        <div className="wb-proc-summary">
          <b>章摘要</b>{meta.summary}
          {meta.hook && <><b>章末钩子</b>{meta.hook}</>}
        </div>
      )}
    </section>
  );
}
