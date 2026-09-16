/**
 * AutoMode —— 观看推演
 *
 * 这**不是第四种模式**，是引导/剧场打开「全自动」开关后落到的界面：
 * 后端 `approvalPolicy:"auto"`，六步不停在每步等确认，一路跑到底。
 * 既然没有按钮可点，这一页的价值就全在「让引擎的工作可见」：
 *
 *   ① 天衍推演 7 阶段    ← SSE tianyan:pipeline-progress
 *   ② 舆情仿真 72 轮      ← SSE tianyan:pipeline / 阶段推进
 *   ③ 图谱实时生长        ← SSE tianyan:graph
 *   ④ 事件流              ← 各类 SSE 事件归一成一条人话时间线
 *   ⑤ 六步编排进度        ← 轮询 creation-loop 快照
 *   ⑥ 章节成文            ← SSE draft:delta 流式
 *
 * 这些数据后端本来就在广播，旧版这一页却是 setInterval 假进度条。
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import {
  Pause, Play, Loader2, Check, AlertCircle,
  Network, Activity, BookOpen,
} from "lucide-react";
import {
  AgentEventSource, fetchLoopState, fetchGraphData, pauseLoop, resumeLoop,
  type AgentEvent, type GraphData,
} from "../lib/api";
import {
  TIANYAN_STAGES, tianyanStageIndex, TIANYAN_ROUNDS,
  CREATION_LOOP_STEP_TYPES, CREATION_STEP_LABELS_ZH, CREATION_STEP_SUBTITLES,
  stepTypeOf, chapterNumberOf, isLoopRunning,
  type WorkflowSnapshot, type CreationLoopStepType, type WorkflowStepStatus,
} from "../types/creation-loop";
import { LiveGraph, GraphLegend } from "../components/LiveGraph";
import { IntentDraftStage } from "../components/IntentDraftStage";

/* ── 事件流条目 ── */
type FeedTone = "sim" | "graph" | "step" | "chapter" | "govern" | "error";

interface FeedItem {
  readonly id: string;
  readonly tone: FeedTone;
  readonly text: string;
  readonly at: number;
}

const TONE_LABEL: Readonly<Record<FeedTone, string>> = {
  sim: "推演",
  graph: "图谱",
  step: "编排",
  chapter: "成文",
  govern: "治理",
  error: "错误",
};

export function AutoMode() {
  const { bookId } = useParams<{ bookId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = (location.state ?? null) as
    | {
      instruction?: string; strategy?: "fast" | "simulate";
      approvalPolicy?: "review" | "auto";
      /** 引导和剧场打开全自动都会到这一页——建出来的书该记成哪一种由它决定。 */
      mode?: "guided" | "conversation" | "film";
    }
    | null;
  const instruction = routeState?.instruction ?? "";
  const routeStrategy = routeState?.strategy ?? "fast";
  /*
   * 这一页是「观看推演」的界面，**不等于**自动运行 —— 是不是自动由入口那个开关
   * 决定并带进来。别在这里默认成 "auto"：直接开链接进来的人会拿到一个没人守着
   * 的自动跑。
   */
  const routeApprovalPolicy = routeState?.approvalPolicy ?? "review";
  // 直接开链接进来的（没有 state）按引导记——它是历史默认。
  const routeMode = routeState?.mode === "conversation" ? "conversation" as const : "guided" as const;

  /* 天衍流水线 */
  const [stage, setStage] = useState<string | null>(null);
  const [graphId, setGraphId] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [simDone, setSimDone] = useState(false);

  /* 六步编排 */
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [loopId, setLoopId] = useState<string | null>(null);
  const [hasSim, setHasSim] = useState(true);
  const [loopError, setLoopError] = useState<string | null>(null);

  /* 章节流式 */
  const [draft, setDraft] = useState("");
  const [draftTitle, setDraftTitle] = useState<string | null>(null);

  /* 事件流 */
  const [feed, setFeed] = useState<ReadonlyArray<FeedItem>>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  const push = useCallback((tone: FeedTone, text: string) => {
    seqRef.current += 1;
    const item: FeedItem = { id: `f${seqRef.current}`, tone, text, at: Date.now() };
    // 只留最近 200 条：全自动可能跑几百章，无上限会把内存吃光
    setFeed((prev) => [...prev.slice(-199), item]);
  }, []);

  /* ── SSE ── */
  useEffect(() => {
    const handle = (event: AgentEvent) => {
      const d = (event.data ?? {}) as Record<string, unknown>;
      // 多本书共用一条事件流：不是本书的事件直接丢弃
      if (bookId && typeof d.bookId === "string" && d.bookId !== bookId) return;

      switch (event.type) {
        case "tianyan:pipeline-progress": {
          const s = String(d.stage ?? "");
          setStage(s);
          if (typeof d.graphId === "string") setGraphId(d.graphId);
          const info = TIANYAN_STAGES[tianyanStageIndex(s)];
          if (info) push("sim", `${info.ordinal} ${info.label} — ${info.description}`);
          break;
        }
        case "tianyan:pipeline": {
          setSimDone(true);
          if (typeof d.graphId === "string") setGraphId(d.graphId);
          const n = typeof d.entityCount === "number" ? d.entityCount : 0;
          push("sim", `天衍仿真完成 · ${TIANYAN_ROUNDS.baseSimulationRounds} 轮舆情推演 · ${n} 个智能体`);
          break;
        }
        case "tianyan:graph": {
          const nodes = Array.isArray(d.nodes) ? d.nodes : [];
          const edges = Array.isArray(d.edges) ? d.edges : [];
          setGraph({ nodes, edges } as GraphData);
          push("graph", `图谱更新 · ${nodes.length} 个实体 / ${edges.length} 条关系`);
          break;
        }
        case "creation-loop:reviewed": {
          const stepId = String(d.stepId ?? "");
          const type = stepTypeOf(stepId);
          const name = type && type !== "anchor" ? CREATION_STEP_LABELS_ZH[type] : stepId;
          push("step", `${name} 已确认`);
          break;
        }
        case "creation-loop:outline-progress": {
          const text = typeof d.message === "string" ? d.message : "大纲生成中…";
          push("step", text);
          break;
        }
        case "creation-loop:error": {
          const msg = typeof d.message === "string" ? d.message : "编排出错";
          setLoopError(msg);
          push("error", msg);
          break;
        }
        case "draft:start":
          setDraft("");
          if (typeof d.title === "string") setDraftTitle(d.title);
          push("chapter", `开始成文${typeof d.title === "string" ? ` · ${d.title}` : ""}`);
          break;
        case "draft:delta": {
          const t = typeof d.text === "string" ? d.text : "";
          if (t) setDraft((prev) => (prev + t).slice(-4000));
          break;
        }
        case "draft:complete":
          push("chapter", "本章成文完成");
          break;
        case "write:start": push("govern", "执笔师 · 开始撰写"); break;
        case "write:complete": {
          /*
           * 降级完成也是完成：正文已落盘，只是收尾的某一步没成。
           * 不说的话下一章会基于半旧的状态往下写，而没人知道为什么。
           */
          const degradations = Array.isArray(d.degradations) ? d.degradations as string[] : [];
          push("govern", degradations.length > 0
            ? `执笔师 · 草稿完成（收尾未完成：${degradations.join("；")}）`
            : "执笔师 · 草稿完成");
          break;
        }
        case "audit:start": push("govern", "审校师 · 一致性审计中"); break;
        case "audit:complete": push("govern", "审校师 · 审计通过"); break;
        case "revise:start": push("govern", "修订师 · 定向修订中"); break;
        case "revise:complete": push("govern", "修订师 · 修订完成"); break;
        case "book:created": push("step", "建书完成，进入六步编排"); break;
        case "book:error":
          setLoopError(typeof d.error === "string" ? d.error : "建书失败");
          push("error", typeof d.error === "string" ? d.error : "建书失败");
          break;
        default:
          break;
      }
    };

    const es = new AgentEventSource(handle);
    es.connect();
    return () => es.disconnect();
  }, [bookId, push]);

  /* ── 图谱兜底：SSE 可能在页面打开前就发过 graph 事件，靠 graphId 补拉一次 ── */
  useEffect(() => {
    if (!graphId) return;
    let cancelled = false;
    void fetchGraphData(graphId)
      .then((data) => {
        // 只在补拉结果更全时覆盖，避免把 SSE 的增量图谱冲掉
        if (!cancelled && data.nodes.length > graph.nodes.length) setGraph(data);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // graph.nodes.length 故意不进依赖：只在 graphId 变化时补拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphId]);

  /* ── 编排快照轮询 ── */
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const st = await fetchLoopState(bookId);
        const snap = st.snapshot;
        if (!cancelled) {
          setSnapshot(snap);
          if (st.loopId) setLoopId(st.loopId);
          setHasSim(st.hasSimulation);
        }
        // 还在跑就继续轮；停了（终态/闸门）就放慢到 10s 兜底
        const delay = snap && !isLoopRunning(snap.status) ? 10_000 : 3_000;
        if (!cancelled) timer = setTimeout(() => void tick(), delay);
      } catch {
        // 天衍还在跑时 workflow 尚未创建，快照 404/异常都属正常，继续轮
        if (!cancelled) timer = setTimeout(() => void tick(), 5_000);
      }
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bookId]);

  /* 事件流自动滚底 */
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [feed]);

  /* ── 派生状态 ── */
  const stageIdx = stage ? tianyanStageIndex(stage) : -1;
  const stageDone = simDone ? TIANYAN_STAGES.length : Math.max(0, stageIdx);

  /** 六步进度：从快照里按类型归并（章节步骤有很多个，只算"到没到这一步"）。 */
  const stepStatus = useMemo(() => {
    const map = new Map<CreationLoopStepType, WorkflowStepStatus>();
    for (const s of snapshot?.steps ?? []) {
      const type = stepTypeOf(s.id);
      if (!type || type === "anchor") continue;
      const prev = map.get(type);
      // 同类型多步（chapter_write-1..N）取"最靠前未完成"的状态作为该类代表
      if (!prev || prev === "confirmed" || prev === "completed") map.set(type, s.status);
    }
    return map;
  }, [snapshot]);

  const currentType = snapshot?.currentStepId ? stepTypeOf(snapshot.currentStepId) : null;
  const currentChapter = snapshot?.currentStepId
    ? chapterNumberOf(snapshot.currentStepId)
    : null;

  const running = isLoopRunning(snapshot?.status);
  const paused = snapshot?.status === "paused";

  const onPause = async () => {
    if (!bookId) return;
    if (!loopId) return;
    try { setSnapshot(await pauseLoop(bookId, loopId)); push("step", "已暂停"); }
    catch (e) { push("error", e instanceof Error ? e.message : "暂停失败"); }
  };
  const onResume = async () => {
    if (!bookId || !loopId) return;
    try {
      // autoReview:true —— 全自动模式恢复后继续不停，遇 awaiting_review 自动确认
      setSnapshot(await resumeLoop(bookId, loopId, { autoReview: true }));
      push("step", "已继续");
    } catch (e) { push("error", e instanceof Error ? e.message : "继续失败"); }
  };

  // 还没有 bookId：先建书。全自动的定位是「只看不点」，所以拿到卡就自动确认。
  if (!bookId) {
    return (
      <div className="am">
        <header className="am-top">
          <div className="am-title">
            <span className="am-badge">⚡ 全自动</span>
            <span className="am-instruction">{instruction || "准备建书"}</span>
          </div>
        </header>
        <div className="am-draftwrap">
          <IntentDraftStage
            instruction={instruction}
            strategy={routeStrategy}
            approvalPolicy={routeApprovalPolicy}
            creationMode={routeMode}
            autoConfirm
            onCreated={(id) => {
              navigate(`/auto/${encodeURIComponent(id)}`, {
                replace: true,
                state: { strategy: routeStrategy, approvalPolicy: routeApprovalPolicy, mode: routeMode },
              });
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="am">
      {/* ── 顶栏 ── */}
      <header className="am-top">
        <div className="am-title">
          <span className="am-badge">⚡ 全自动</span>
          <span className="am-instruction" title={instruction}>{instruction || "自动创作中"}</span>
        </div>
        <div className="am-top-actions">
          {snapshot && (
            <span className={`am-status is-${snapshot.status}`}>
              {statusLabel(snapshot.status)}
            </span>
          )}
          {running && (
            <button className="am-btn" onClick={() => void onPause()}>
              <Pause size={14} /> 暂停
            </button>
          )}
          {paused && (
            <button className="am-btn is-primary" onClick={() => void onResume()}>
              <Play size={14} /> 继续
            </button>
          )}
        </div>
      </header>

      {loopError && (
        <div className="am-error"><AlertCircle size={14} /> {loopError}</div>
      )}

      {/* ── 进度区：天衍 7 阶段 + 六步编排 ── */}
      <section className="am-rails">
        <div className="am-rail">
          <div className="am-rail-head">
            <Activity size={13} /> 天衍推演
            <span className="am-rail-count">{Math.min(stageDone, TIANYAN_STAGES.length)} / {TIANYAN_STAGES.length}</span>
          </div>
          {!hasSim && !simDone && (
            <div className="am-deferred">这本书没有推演产物，天衍未产出——六步在无仿真素材下运行</div>
          )}
          <div className="am-stages">
            {TIANYAN_STAGES.map((s, i) => {
              const state = simDone || i < stageIdx ? "done" : i === stageIdx ? "active" : "idle";
              return (
                <div key={s.id} className={`am-stage is-${state}`} title={s.description}>
                  <span className="am-stage-dot">
                    {state === "done" ? <Check size={10} />
                      : state === "active" ? <Loader2 size={10} className="spin" />
                      : null}
                  </span>
                  <span className="am-stage-label">{s.ordinal} {s.label}</span>
                </div>
              );
            })}
          </div>
          <div className="am-sim">
            <div className="am-sim-head">
              <span>舆情仿真</span>
              <span className="am-sim-count">
                {simDone
                  ? `${TIANYAN_ROUNDS.baseSimulationRounds} / ${TIANYAN_ROUNDS.baseSimulationRounds} 轮`
                  : stageIdx >= 4 ? `推演中 · 共 ${TIANYAN_ROUNDS.baseSimulationRounds} 轮` : "待启动"}
              </span>
            </div>
            <div className="am-bar">
              <div
                className={`am-bar-fill ${!simDone && stageIdx >= 4 ? "is-indeterminate" : ""}`}
                style={{ width: simDone ? "100%" : stageIdx >= 4 ? "100%" : "0%" }}
              />
            </div>
          </div>
        </div>

        <div className="am-rail">
          <div className="am-rail-head">
            <BookOpen size={13} /> 六步编排
            {currentChapter && <span className="am-rail-count">第 {currentChapter} 章</span>}
          </div>
          <div className="am-steps">
            {CREATION_LOOP_STEP_TYPES.map((type) => {
              const st = stepStatus.get(type);
              const isCurrent = currentType === type;
              const done = st === "confirmed" || st === "completed";
              const state = done ? "done" : isCurrent ? "active" : st === "failed" ? "failed" : "idle";
              return (
                <div key={type} className={`am-step is-${state}`}>
                  <span className="am-step-dot">
                    {state === "done" ? <Check size={10} />
                      : state === "active" ? <Loader2 size={10} className="spin" />
                      : null}
                  </span>
                  <div className="am-step-text">
                    <span className="am-step-name">{CREATION_STEP_LABELS_ZH[type]}</span>
                    <span className="am-step-sub">{CREATION_STEP_SUBTITLES[type]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 主体：图谱 | 事件流 ── */}
      <section className="am-body">
        <div className="am-panel">
          <div className="am-panel-head">
            <Network size={13} /> 图谱实时生长
            <span className="am-panel-meta">
              {graph.nodes.length} 实体 · {graph.edges.length} 关系
            </span>
          </div>
          <LiveGraph data={graph} height={300} />
          <GraphLegend />
        </div>

        <div className="am-panel">
          <div className="am-panel-head">
            <Activity size={13} /> 事件流
          </div>
          <div className="am-feed" ref={feedRef}>
            {feed.length === 0 ? (
              <div className="am-feed-empty">等待引擎事件…</div>
            ) : (
              feed.map((f) => (
                <div key={f.id} className={`am-feed-item is-${f.tone}`}>
                  <span className="am-feed-tag">{TONE_LABEL[f.tone]}</span>
                  <span className="am-feed-text">{f.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* ── 底部：章节成文流 ── */}
      <section className="am-draft">
        <div className="am-draft-head">
          <span className="am-draft-title">
            {currentChapter ? `第 ${currentChapter} 章` : "章节正文"}
            {draftTitle && <span className="am-draft-name"> · {draftTitle}</span>}
          </span>
          <span className="am-draft-state">
            {draft ? <><Loader2 size={12} className="spin" /> 正在成文…</> : "待开始"}
          </span>
        </div>
        <div className="am-draft-body">
          {draft ? <>{draft}<span className="am-caret">▍</span></> : (
            <span className="am-draft-placeholder">
              前五步完成后，正文会在这里逐字流出。
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

function statusLabel(status: WorkflowSnapshot["status"]): string {
  switch (status) {
    case "queued": return "排队中";
    case "running": return "运行中";
    case "awaiting_review": return "等待确认";
    case "paused": return "已暂停";
    case "succeeded": return "已完成";
    case "failed": return "失败";
    case "cancelled": return "已取消";
    default: return status;
  }
}
