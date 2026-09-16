import { AgentActivity } from "../components/AgentActivity";
import { EMPTY_PROGRESS, reduceAgentProgress, withWorkflowProgress } from "../lib/agent-progress";
/**
 * ConversationMode — 剧场模式（像正常聊天软件那样的三栏）
 *
 * ⚠️ 文件名与路由 `/conversation` 是历史名，没有改：动它要连带迁已持久化的
 * 会话与后端键名，收益只是名字好看。展示名在 MODE_OPTIONS 里已经是「剧场模式」。
 *
 *   左  聊天列表  六师群（创作编排，书就是在这儿聊出来的）
 *                 + 仿真每推演一场自动出现的群 + 全书角色（点开就是私聊）
 *   中  聊天窗口  选中谁就和谁聊
 *   右  产出      正文 / 世界观 / 大纲 / 卷纲 / 进度（复用工作台的 StepOutput）
 *
 * ⚠️ 这是**对话模式**（/conversation）。引导模式是 /workbench（WorkbenchPage），
 * 两个页面各自独立，改这里不影响那里。
 *
 * 六师那条聊天的引擎没有变：还是原来的 /agent + SSE 流式 + 建书意图卡，
 * 只是从「一栏对话 + 左侧六步进度」换成了聊天软件的壳，六步进度挪进右栏。
 *
 * 对接后端：
 * - POST /api/v1/agent — 发送消息
 * - GET  /api/v1/events — SSE 事件流（draft:delta / agent:complete / creation-loop:*）
 * - GET  /api/v1/sessions/:id — 加载历史消息
 * - POST /api/v1/sessions/:id/abort — 中止当前生成
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Sparkles, CheckCircle2,
  RotateCcw, AlertCircle, Loader2, Crown, X, PanelLeft, PanelRight,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { EMPTY_SUMMON, type Summoned, type PendingFile } from "../types/composer";
import { useComposerData, withInstalledSkills } from "../hooks/use-composer-data";
import { Composer } from "../components/Composer";
import { workbenchMessageParams, type WorkbenchMessageInput } from "../lib/workbench-chat";
import { isPromptRef, type PromptRef } from "../lib/prompt-library";
import { AGENT_PERSONAS, type AgentRole } from "../types/agents";
import { ChatList, MASTERS_CHAT_ID } from "../components/simulation/ChatList";
import { ProductionPanel } from "../components/simulation/ProductionPanel";
import { ChatWindow } from "../components/simulation/ChatWindow";
import { CreateGroupDialog } from "../components/simulation/CreateGroupDialog";
import { ChoicePointPanel } from "../components/simulation/ChoicePointPanel";
import { AgentProfileModal, type ProfileTarget } from "../components/simulation/AgentProfileModal";
import { PortraitProvider } from "../components/simulation/PortraitContext";
import { useSimulationTheater } from "../hooks/use-simulation-theater";
import { stageLabel, hueOf } from "../lib/sim-theater";
import {
  CREATION_LOOP_STEP_TYPES, CREATION_STEP_LABELS_ZH,
  CREATION_STEP_INPUTS, stepTypeOf, chapterNumberOf,
  type CreationLoopStepType, type WorkflowSnapshot, type WorkflowStepSnapshot,
} from "../types/creation-loop";
import {
  callAgent, fetchSession, abortSession, AgentEventSource, fetchLoopState,
  confirmCreateBook, ApiError, fetchBooks,
  type AgentEvent, type BookSession, type SessionKind,
  type ToolExecution, type CreateBookPayload,
  fetchUserAgent, type UserAgentCard, writeNextChapter,
} from "../lib/api";

/* ── Props ── */
interface ConversationModeProps {
  readonly sessionId: string;
  readonly bookId?: string | null;
  /** 会话类型：新书用 book-create，已有书用 book */
  readonly sessionKind?: SessionKind;
  /** 创作引擎（fast / simulate），确认建书时透传给后端。 */
  readonly strategy?: "fast" | "simulate";
  /** 建书成功后回调（拿到 bookId 才能查六步进度）。 */
  readonly onBookCreated?: (bookId: string) => void;
  /** 从创作首页带过来的开场指令，会在会话就绪后自动发出一次 */
  readonly initialInstruction?: string | null;
  readonly initialInput?: WorkbenchMessageInput;
  /** 首页带过来的编队与附件（在那儿选的要接着生效，不能跳转就丢）。 */
  readonly initialSkillIds?: ReadonlyArray<string>;
  readonly initialAgentNames?: ReadonlyArray<string>;
  /** 首页选中的能力引用（流派/模板 chip）——capabilityRefs 通道，进系统提示词。 */
  readonly initialCaps?: ReadonlyArray<{ kind: string; id: string }>;
  readonly initialAttachments?: ReadonlyArray<{ id: string; filename: string; mediaType: string; dataUrl: string }>;
  readonly onStepAdvance?: (nextStep: string) => void;
}

/* ── 类型 ── */
interface Message {
  id: string;
  role: "user" | "agent";
  agentRole?: AgentRole;
  content: string;
  card?: ActionCard;
  timestamp: number;
  isStreaming?: boolean;
}

/** 建书意图卡（后端 propose_action 工具产出）。 */
interface ActionCard {
  readonly kind: "create_book";
  readonly title: string;
  readonly summary: string;
  readonly instruction: string;
  readonly createBook: CreateBookPayload;
  readonly promptRefs?: ReadonlyArray<PromptRef>;
}

type SendStatus = "idle" | "sending" | "streaming" | "error";

/* ── 欢迎消息 ── */
function makeWelcomeMessage(): Message {
  return {
    id: "welcome",
    role: "agent",
    agentRole: "planner",
    content:
      "你好！我是规划师 🧭，负责帮你梳理创作方向。\n\n告诉我你想写什么样的故事？比如：\n- 什么类型？（玄幻、都市、科幻...）\n- 主角是什么样的？\n- 有什么特别的想法或灵感？",
    timestamp: Date.now(),
  };
}

/* ══════════════════════════════════════════════════════════════════ */
export function ConversationMode({
  sessionId,
  bookId,
  sessionKind,
  strategy,
  initialInstruction,
  initialInput,
  initialSkillIds,
  initialAgentNames,
  initialCaps,
  initialAttachments,
  onStepAdvance,
  onBookCreated,
}: ConversationModeProps) {
  const kind: SessionKind = sessionKind ?? (bookId ? "book" : "book-create");
  const [messages, setMessages] = useState<Message[]>([makeWelcomeMessage()]);
  const [input, setInput] = useState("");
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /**
   * 当前打开的是哪一条聊天。
   *
   * `MASTERS_CHAT_ID` = 六师群（创作编排）；其余是仿真剧场的群/私聊 id。
   * 默认落在六师群：没有书的时候它是唯一能聊的，有书的时候它也是推进创作的地方。
   */
  const [activeChat, setActiveChat] = useState<string>(MASTERS_CHAT_ID);
  const [creatingGroup, setCreatingGroup] = useState(false);
  /**
   * 窄屏上开着哪一侧的抽屉（宽屏无效，两栏本来就并列）。
   *
   * 一次只开一个：小屏上同时压两块浮层，中间的聊天就被挤没了。
   */
  const [chatDrawer, setChatDrawer] = useState<"list" | "prod" | null>(null);
  /** 点头像打开的档案（角色画像 / 我自己的智能体）。 */
  const [profile, setProfile] = useState<ProfileTarget | null>(null);
  /**
   * 用户自己的创作智能体（账号自带的化身，可参与任何一本书）。
   * 没登录时为 null —— 头像仍然给一个默认的，不拦着聊天。
   */
  const [userAgent, setUserAgent] = useState<UserAgentCard | null>(null);
  /** 编排真相源：六步进度不再由前端自己数，一律读 workflow 快照。 */
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [loopId, setLoopId] = useState<string | null>(null);
  /** 已成功查过快照。用于区分「还没查」和「查了但这本书没有编排」。 */
  const [loopChecked, setLoopChecked] = useState(false);
  const [bookStrategy, setBookStrategy] = useState<"fast" | "simulate" | null>(null);
  /** 当前发言的智能体（纯展示用的人设，不影响后端调度）。 */
  const [activeRole, setActiveRole] = useState<AgentRole>("planner");
  /** 后端正在思考 / 调工具的提示。 */
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const [activity, setActivity] = useState<string | null>(null);
  /** 确认卡进行中（建书是重操作，防重复点）。 */
  const [confirming, setConfirming] = useState(false);
  /** 后端 403 MEMBER_REQUIRED 的提示（带去承接页的入口）。 */
  const [memberGate, setMemberGate] = useState<string | null>(null);
  /* ── 专家团编队 ── */
  const [summoned, setSummoned] = useState<Summoned>(EMPTY_SUMMON);
  /** 待发送附件：图片走视觉，TXT 落盘供拆书工具按文件名读取。 */
  const [files, setFiles] = useState<ReadonlyArray<PendingFile>>([]);

  const nav = useNavigate();
  /**
   * 仿真剧场的数据（群聊 / 角色 / 导演发言）。
   *
   * bookId 为空时它整体空转（没有书就没有仿真），左栏只剩六师群——
   * 这正是「先聊出一本书」的入口状态。
   */
  const theater = useSimulationTheater(bookId ?? "", sessionId);

  useEffect(() => {
    void fetchUserAgent().then(setUserAgent).catch(() => undefined);
  }, []);

  /** 导演在聊天里的身份：有账号化身就用它，没有就默认「我」。 */
  const me = {
    name: userAgent?.name ?? "我",
    hue: hueOf(userAgent?.username ?? "me"),
  };
  const composer = useComposerData({ ...(bookId ? { graphId: bookId } : {}), preserveExplicitModel: true });
  const { skills, genres, templates, llm, installed } = composer;
  const castAgents = composer.agents;
  /**
   * 首页带过来的编队与附件 → 恢复进本页。
   *
   * 在首页 `/` 选了技能、`@` 召唤了专家、扔了一本小说进来，跳到这里必须还在，
   * 否则用户以为选中了、实际一个都没生效。按 id/name 从已加载列表里还原对象。
   */
  useEffect(() => {
    if (!initialSkillIds?.length || skills.length === 0) return;
    setSummoned((prev) => {
      const have = new Set(prev.skills.map((s) => s.id));
      const add = skills.filter((s) => initialSkillIds.includes(s.id) && !have.has(s.id));
      return add.length === 0 ? prev : { ...prev, skills: [...prev.skills, ...add] };
    });
  }, [initialSkillIds, skills]);

  useEffect(() => {
    if (!initialAttachments?.length) return;
    setFiles(initialAttachments.map((a) => ({
      ...a,
      size: 0,
      // 首页已按同样口径判过；这里只做展示与转发，重算没有意义。
      deconstructable: !a.mediaType.startsWith("image/"),
    })));
  }, [initialAttachments]);

  /**
   * 已安装技能预置进编队。
   *
   * 用户在「技能」栏点 ＋ 安装的，进对话页就该已经在编队条里，不用再打一次 `/`。
   * 只补不覆盖：用户本轮手动加的技能不会被冲掉。
   */
  useEffect(() => {
    setSummoned((prev) => withInstalledSkills(prev, skills, installed));
  }, [installed, skills]);

  useEffect(() => {
    if (!initialAgentNames?.length || castAgents.length === 0) return;
    setSummoned((prev) => {
      const have = new Set(prev.agents.map((a) => a.name));
      const add = castAgents.filter((a) => initialAgentNames.includes(a.name) && !have.has(a.name));
      return add.length === 0 ? prev : { ...prev, agents: [...prev.agents, ...add] };
    });
  }, [initialAgentNames, castAgents]);

  /*
   * 首页选中的流派/模板 chip → 还原进编队条。
   *
   * 这条断了很久：CreateHomePage 把 summonedCaps 放进了 route state，
   * ConversationRoute 却没往下传——「带着退婚流起新书」进对话后流派就丢了。
   * label 从已加载的流派/模板列表里还原；列表还没到就等它（effect 会重跑）。
   */
  useEffect(() => {
    if (!initialCaps?.length) return;
    if (genres.length === 0 && templates.length === 0 && !initialCaps.some(isPromptRef)) return;
    setSummoned((prev) => {
      const have = new Set(prev.caps.map((c) => `${c.ref.kind}:${c.ref.id}`));
      const add = initialCaps
        .filter((c) => !have.has(`${c.kind}:${c.id}`))
        .map((c) => {
          if (isPromptRef(c)) return { ref: { kind: c.kind, id: c.id }, label: c.id };
          if (c.kind === "genre") {
            const g = genres.find((x) => x.id === c.id);
            return { ref: { kind: "genre" as const, id: c.id }, label: g?.name ?? c.id };
          }
          const t = templates.find((x) => x.id === c.id);
          return { ref: { kind: "template" as const, id: c.id }, label: t ? (t.zhName || t.name) : c.id };
        });
      return add.length === 0 ? prev : { ...prev, caps: [...prev.caps, ...add] };
    });
  }, [initialCaps, genres, templates]);
  const [trigger, setTrigger] = useState<"/" | "@" | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<AgentEventSource | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const autoSentRef = useRef(false);
  /** 本轮是否真的收到过 draft:delta。
   *  项目默认 llm.stream=false —— 后端此时不发流式增量，整段响应放在
   *  POST /agent 的返回体里。只等 SSE 会永远卡在打字指示器。 */
  const gotStreamRef = useRef(false);

  // ── 拉取编排快照（步骤进度的唯一真相源） ──
  const refreshLoop = useCallback(async () => {
    if (!bookId) return;
    try {
      const st = await fetchLoopState(bookId);
      setSnapshot(st.snapshot);
      setLoopId(st.loopId);
      setBookStrategy(st.strategy);
      setLoopChecked(true);
    } catch {
      // 天衍还在跑时 workflow 尚未创建，属正常
    }
  }, [bookId]);

  // ── 滚动到底部 ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sendStatus]);

  // ── 加载历史会话 ──
  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      try {
        const session: BookSession = await fetchSession(sessionId);
        if (session.messages && session.messages.length > 0) {
          const history: Message[] = session.messages.map((m, i) => ({
            id: `hist-${i}-${m.timestamp ?? i}`,
            role: m.role === "assistant" ? "agent" : "user",
            content: m.content,
            timestamp: m.timestamp ?? Date.now(),
          }));
          setMessages(history);
        }
      } catch {
        // 新会话可能没有历史，忽略 404
      }
    })();
  }, [sessionId]);

  // ── 专家团数据：技能全局，智能体按书（天衍产物，世界观确认后才有） ──
  useEffect(() => {
  }, []);

  // ── 编排快照轮询（剧场模式也要知道六步走到哪了） ──
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refreshLoop();
      if (!cancelled) timer = setTimeout(() => void tick(), 6_000);
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bookId, refreshLoop]);

  const eventHandlerRef = useRef<(event: AgentEvent) => void>(() => undefined);
  // ── 连接 SSE 事件流 ──
  useEffect(() => {
    const es = new AgentEventSource((event) => eventHandlerRef.current(event), () => {
      // 连接错误时静默重连（AgentEventSource 内部已处理）
    });
    es.connect();
    eventSourceRef.current = es;
    return () => es.disconnect();
  }, []);

  // ── SSE 事件处理 ──
  const handleSSEEvent = useCallback((event: AgentEvent) => {
    const data = (event.data ?? {}) as { sessionId?: string; bookId?: string };
    if (data.sessionId ? data.sessionId !== sessionId : !bookId || data.bookId !== bookId) return;
    setProgress(previous => reduceAgentProgress(previous, event, sessionId));
    switch (event.type) {
      case "agent:start":
        setSendStatus("streaming");
        setErrorMsg(null);
        setActivity(null);
        break;

      case "draft:delta": {
        const delta = (event.data as { text?: string; sessionId?: string }) ?? {};
        if (delta.sessionId && delta.sessionId !== sessionId) return;
        if (!delta.text) return;
        appendStreamingText(delta.text);
        break;
      }

      case "agent:complete": {
        const data = event.data as { sessionId?: string; instruction?: string };
        if (data.sessionId && data.sessionId !== sessionId) return;
        finalizeStreamingMessage();
        setSendStatus("idle");
        setActivity(null);
        void refreshLoop();
        break;
      }

      case "agent:aborted": {
        const data = event.data as { sessionId?: string };
        if (data.sessionId && data.sessionId !== sessionId) return;
        finalizeStreamingMessage(" [已中止]");
        setSendStatus("idle");
        break;
      }

      // 步骤过闸：不自己推进本地状态，直接重拉快照（后端才知道到哪一步了）
      case "creation-loop:reviewed": {
        const data = event.data as { stepId?: string };
        void refreshLoop();
        const type = data.stepId ? stepTypeOf(data.stepId) : null;
        if (type && type !== "anchor") onStepAdvance?.(type);
        break;
      }
      case "creation-loop:error": {
        const data = event.data as { message?: string };
        setErrorMsg(data.message ?? "编排出错");
        break;
      }
      case "thinking:start": setActivity("思考中…"); break;
      case "thinking:end": setActivity(null); break;
      case "tool:start": {
        const data = event.data as { label?: string; tool?: string };
        setActivity(data.label ?? data.tool ?? "调用工具中…");
        break;
      }
      case "tool:end": setActivity(null); break;

      default:
        break;
    }
  }, [sessionId, bookId, refreshLoop, onStepAdvance]);
  eventHandlerRef.current = handleSSEEvent;

  // ── 追加流式文本 ──
  const appendStreamingText = useCallback((text: string) => {
    gotStreamRef.current = true;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.isStreaming) {
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + text },
        ];
      }
      const newId = streamingMessageIdRef.current ?? `stream-${Date.now()}`;
      streamingMessageIdRef.current = newId;
      return [
        ...prev,
        {
          id: newId,
          role: "agent",
          agentRole: activeRole,
          content: text,
          timestamp: Date.now(),
          isStreaming: true,
        },
      ];
    });
  }, [activeRole]);

  // ── 结束流式消息 ──
  const finalizeStreamingMessage = useCallback((suffix = "") => {
    setMessages((prev) =>
      prev.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false, content: m.content + suffix } : m,
      ),
    );
    streamingMessageIdRef.current = null;
  }, []);


  // ── 发送消息 ──
  const sendMessage = useCallback(async (raw: string, firstInput?: WorkbenchMessageInput) => {
    const messageInput = firstInput ?? { text: raw, files, summoned, model: composer.selected };
    const promptRefs = messageInput.summoned.caps.map(cap => cap.ref).filter(isPromptRef).map(ref => ({ kind: ref.kind, id: ref.id }));
    const text = messageInput.text.trim();
    if (!text && !messageInput.files.length) return;
    setErrorMsg(null);

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text || messageInput.files.map(file => file.filename).join("、"),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setSendStatus("sending");
    setProgress({ items: [], active: true });

    // 取消上一次请求
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    gotStreamRef.current = false;
    const sentFiles = messageInput.files;
    if (sentFiles.length > 0) setFiles([]);   // 已随本条发出，别让下一条重复带
    try {
      const res = await callAgent({
        background: true,
        creationStrategy: bookStrategy ?? strategy ?? "fast",
        sessionId,
        activeBookId: bookId ?? undefined,
        sessionKind: kind,
        ...workbenchMessageParams(messageInput),
      });
      if (controller.signal.aborted) return;
      if (res.error) {
        if (sentFiles.length) setFiles(previous => previous.length ? previous : sentFiles);
        setErrorMsg(res.error.message || "生成失败");
        setSendStatus("error");
        return;
      }
      // book-create 会话里 response 常常是空串，真正的产出是 propose_action 确认卡
      const card = extractActionCard(res.details?.toolExecutions);
      const reply = res.response?.trim() ?? "";
      // 非流式（llm.stream=false）：SSE 没有增量，用返回体补上这条回复。
      // 流式已经渲染过就不重复追加。
      if ((!gotStreamRef.current && reply) || card) {
        setMessages((prev) => [
          ...prev,
          {
            id: `agent-${Date.now()}`,
            role: "agent",
            agentRole: activeRole,
            content: reply || (card ? "我按你的方向拟了一张建书意图卡，确认后就开始铸造。" : ""),
            ...(card ? { card: { ...card, promptRefs } } : {}),
            timestamp: Date.now(),
          },
        ]);
      }
      setSendStatus("idle");
      setProgress(previous => reduceAgentProgress(previous, { type: "agent:complete", data: { sessionId } }, sessionId));
      setActivity(null);
      void refreshLoop();
    } catch (err) {
      if (controller.signal.aborted) return;
      setErrorMsg(err instanceof Error ? err.message : "发送失败，请重试");
      setSendStatus("error");
      setProgress(previous => reduceAgentProgress(previous, { type: "agent:error", data: { sessionId } }, sessionId));
    }
  }, [sessionId, bookId, kind, activeRole, refreshLoop, summoned, files, composer.selected, bookStrategy, strategy]);

  const handleSend = () => {
    if (sendStatus === "sending" || sendStatus === "streaming") return;
    if (!input.trim() && !files.length) return;
    const text = input;
    setInput("");
    void sendMessage(text);
  };

  // ── 自动发送开场指令（仅一次）──
  useEffect(() => {
    if (!initialInstruction?.trim() && !initialInput?.text.trim() && !initialInput?.files.length) return;
    if (autoSentRef.current) return;
    autoSentRef.current = true;
    void sendMessage(initialInput?.text ?? initialInstruction ?? "", initialInput);
  }, [initialInstruction, initialInput, sendMessage]);

  // ── 中止生成 ──
  const handleAbort = async () => {
    try {
      await abortSession(sessionId);
      abortControllerRef.current?.abort();
      finalizeStreamingMessage(" [已中止]");
      setSendStatus("idle");
    } catch {
      // ignore
    }
  };

  // ── 重试 ──
  const handleRetry = () => {
    setErrorMsg(null);
    setSendStatus("idle");
  };

  // ── 确认建书意图卡 ──
  const handleConfirmCard = async (card: ActionCard, title: string) => {
    if (confirming) return;
    setConfirming(true);
    setErrorMsg(null);
    setSendStatus("sending");
    setProgress({ items: [], active: true });
    try {
      const res = await confirmCreateBook({
        sessionId,
        instruction: card.instruction,
        // 三选一：用户选中的书名覆盖卡片默认值
        createBook: { ...card.createBook, title },
        // 没带 strategy 时兜 fast：不能让 LLM 把非会员默默升到 simulate 再撞 403
        creationStrategy: bookStrategy ?? strategy ?? "fast",
        // 这一页是剧场（路由名 /conversation 是历史名）——书按剧场记。
        creationMode: "conversation",
        promptRefs: card.promptRefs,
        ...(composer.selected ? { model: composer.selected.id, service: composer.selected.service } : {}),
      });
      if (res.error) {
        setProgress(previous => reduceAgentProgress(previous, { type: "agent:error", data: { sessionId } }, sessionId));
        setErrorMsg(res.error.message || "建书失败");
        setSendStatus("error");
        return;
      }
      // 建书异步：activeBookId 可能还没填上，用书名兜底找回（见 IntentDraftStage 注释）
      let newBookId = res.creationLoop?.bookId ?? res.session?.activeBookId ?? null;
      if (!newBookId) {
        for (let i = 0; i < 12 && !newBookId; i += 1) {
          const books = await fetchBooks().catch(() => []);
          newBookId = books.find((b) => b.title === title || b.id === title)?.id ?? null;
          if (!newBookId) await new Promise((r) => setTimeout(r, 1500));
        }
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `agent-${Date.now()}`,
          role: "agent",
          agentRole: "arranger",
          content: res.response?.trim()
            || `《${title}》已开始铸造，正在进入六步编排。`,
          timestamp: Date.now(),
        },
      ]);
      setSendStatus("idle");
      setProgress(previous => reduceAgentProgress(previous, { type: "agent:complete", data: { sessionId } }, sessionId));
      // 建好书后切到该书的会话路由，六步进度才有 bookId 可查
      if (newBookId) onBookCreated?.(newBookId);
    } catch (err) {
      // 会员锁：给一条能点的路，而不是只丢一句 403
      if (err instanceof ApiError && (err.code === "MEMBER_REQUIRED" || err.status === 403)) {
        setMemberGate(err.message || "该操作需要会员");
        setErrorMsg(null);
      } else {
        setErrorMsg(err instanceof Error ? err.message : "建书失败");
      }
      setSendStatus("error");
      setProgress(previous => reduceAgentProgress(previous, { type: "agent:error", data: { sessionId } }, sessionId));
    } finally {
      setConfirming(false);
    }
  };

  // ── 渲染 ──
  const activeAgent = AGENT_PERSONAS[activeRole];
  const isBusy = sendStatus === "sending" || sendStatus === "streaming";

  /** 六步 → 快照状态（章节步骤有很多个，按类型归并）。 */
  const byType = (() => {
    const map = new Map<CreationLoopStepType, WorkflowStepSnapshot>();
    for (const st of snapshot?.steps ?? []) {
      const type = stepTypeOf(st.id);
      if (!type || type === "anchor") continue;
      const prev = map.get(type);
      if (!prev || prev.status === "confirmed") map.set(type, st);
    }
    return map;
  })();

  const currentType = snapshot?.currentStepId ? stepTypeOf(snapshot.currentStepId) : null;
  const focusType: CreationLoopStepType =
    currentType && currentType !== "anchor" ? currentType : "intent";
  const chapterNo = snapshot?.currentStepId ? chapterNumberOf(snapshot.currentStepId) : null;
  const completedSteps = CREATION_LOOP_STEP_TYPES.filter(
    (t) => byType.get(t)?.status === "confirmed",
  ).length;
  /** 旧作品可能没有绑定分步编排；新作品的两种策略都有 loop。 */
  const noOrchestration = Boolean(bookId) && loopChecked && !loopId;

  /** 六师群在列表里显示的最后一句（没有就提示当前步）。 */
  const lastMasterLine = (() => {
    const last = [...messages].reverse().find((m) => m.content.trim());
    if (last) return `${last.role === "user" ? "我" : AGENT_PERSONAS[last.agentRole ?? activeRole].name}：${last.content}`;
    return bookId ? `当前步：${CREATION_STEP_LABELS_ZH[focusType]}` : "";
  })();

  /** 点左栏：六师群走本组件自己的对话流，其余交给剧场。 */
  const selectChat = useCallback((id: string) => {
    setActiveChat(id);
    if (id === MASTERS_CHAT_ID) return;
    theater.selectSession(id);
    // 自己拉的群 / 私聊里「围观」没有意义——是你把人叫来的，直接就能说话。
    // 自动群保持围观：那一场是推演出来的，默认不该让人以为可以随手改。
    const s = theater.sessions.find((x) => x.id === id);
    if (s && s.kind !== "round") theater.setUserMode((m) => (m === "observe" ? "participate" : m));
  }, [theater]);

  /*
   * 推进到下一章。
   *
   * 后端是发射后不管的（写作进度走 SSE），所以这里只负责「开工」并给一句
   * 回执——按钮转圈到请求返回为止，而不是等整章写完：那要好几分钟，转那么久
   * 会让人以为卡死了。真正的进度由 write:* 事件驱动界面。
   */
  const [advancing, setAdvancing] = useState(false);
  const advanceChapter = useCallback(() => {
    if (!bookId || advancing) return;
    setAdvancing(true);
    void writeNextChapter(bookId)
      .then((r) => { setAdvanceNote(r.message); })
      .catch((e: unknown) => { setAdvanceNote(e instanceof Error ? e.message : "启动失败"); })
      .finally(() => {
        setAdvancing(false);
        window.setTimeout(() => setAdvanceNote(null), 4000);
      });
  }, [bookId, advancing]);
  const [advanceNote, setAdvanceNote] = useState<string | null>(null);

  const openDirect = useCallback((agentName: string) => {
    const session = theater.openDirectSession(agentName);
    if (session) setActiveChat(session.id);
  }, [theater]);

  const createGroup = useCallback((names: ReadonlyArray<string>, title?: string) => {
    const session = theater.createGroupSession(names, title);
    if (session) setActiveChat(session.id);
  }, [theater]);

  // 建群缺省名预览：跟着当前模拟的章节/步骤走。
  const groupNamePreview = theater.simState.currentChapter !== null
    ? `第 ${theater.simState.currentChapter} 章 · 加演`
    : `${stageLabel(theater.simState.currentStep ?? "outline")} · 加演`;

  const onMasters = activeChat === MASTERS_CHAT_ID;

  /** 点头像 → 档案。角色画像从名册里查（查不到就显示「画像待生成」）。 */
  const openProfile = useCallback((t: { kind: "agent"; name: string } | { kind: "user" }) => {
    if (t.kind === "user") { setProfile({ kind: "user", card: userAgent }); return; }
    const hit = theater.roster.agents.find((a) => a.name === t.name)
      ?? theater.roster.agents.find((a) => a.name.split(/[:：]/)[0]?.trim() === t.name);
    setProfile({ kind: "agent", name: t.name, profile: hit ?? null });
  }, [userAgent, theater.roster.agents]);

  return (
    /*
     * 画像索引罩住整个剧场：头像组件自己按名字查，聊天列表、消息气泡、
     * 群成员不用各自多背一个字段——漏掉一处就是同一个人两张脸。
     */
    <PortraitProvider agents={theater.roster.agents}>
    {/*
      窄屏上左右两栏变抽屉（见 global.css 里 .chat-shell 那段）。

      原来左栏固定 280px 不收缩、右栏也在，390px 的屏上中间只剩 166px——
      发送按钮被挤到 x=433，屏幕外，消息根本发不出去。一次只开一个：
      同时压两块浮层，中间的聊天就没了。
    */}
    <div
      className="chat-shell"
      data-drawer={chatDrawer ?? "none"}
      onClick={(e) => {
        // 遮罩是 .chat-shell 的伪元素，命中时 target 就是它自己。
        if (chatDrawer && e.target === e.currentTarget) setChatDrawer(null);
      }}
    >
      {/* ── 左：聊天列表 ── */}
      <ChatList
        mastersSubtitle={lastMasterLine}
        mastersBusy={isBusy}
        simState={theater.simState}
        sessions={theater.sessions}
        activeId={activeChat}
        liveSessionId={theater.liveSessionId}
        agents={theater.roster.agents}
        extraNames={theater.roster.extras}
        onSelect={selectChat}
        onOpenDirect={openDirect}
        onCreateGroup={() => setCreatingGroup(true)}
        spectators={theater.spectators}
      />

      {/* ── 中：聊天窗口 ── */}
      {!onMasters ? (
        <div className="chat-center">
          <ChatWindow
            session={theater.activeSession}
            messages={theater.activeMessages}
            userMode={theater.userMode}
            live={theater.activeSession?.id === theater.liveSessionId}
            sending={theater.sending}
            loading={theater.loading}
            bookId={bookId ?? null}
            me={me}
            onSend={theater.send}
            onModeChange={theater.setUserMode}
            onOpenProfile={openProfile}
            onChat={openDirect}
            {...(bookId ? { onAdvance: advanceChapter } : {})}
            advancing={advancing}
            typing={theater.activeTyping}
            onToggleDrawer={(which) => setChatDrawer((d) => (d === which ? null : which))}
          />
          {advanceNote && <div className="sim-advance-note">{advanceNote}</div>}
          <ChoicePointPanel gate={theater.gate} busy={theater.sending} onDecide={theater.decideGate} />
        </div>
      ) : (
        /* 六师群：原来那套对话流一行没改，只是换了个壳 */
        <main className="conv-main">
        {/* 当前智能体 + 当前步 */}
        <div className="conv-agent-header">
          {/*
            六师群走的是另一套壳（.conv-main），窄屏抽屉的入口在这里也要有一份
            ——只在 ChatWindow 那条分支加按钮的话，一进剧场默认停在六师群，
            左右两栏都收起了却没有任何打开的办法。
          */}
          <button
            type="button"
            className="sim-drawer-btn sim-drawer-left"
            onClick={() => setChatDrawer((d) => (d === "list" ? null : "list"))}
            aria-label="聊天列表"
            title="聊天列表"
          >
            <PanelLeft size={16} />
          </button>
          <div className="conv-agent-avatar">{activeAgent.emoji}</div>
          <div className="conv-agent-id">
            <div className="conv-agent-name">{activeAgent.name}</div>
            <div className="conv-agent-title">{activeAgent.title}</div>
          </div>
          <button
            type="button"
            className="sim-drawer-btn sim-drawer-right"
            onClick={() => setChatDrawer((d) => (d === "prod" ? null : "prod"))}
            aria-label="产出面板"
            title="产出面板"
          >
            <PanelRight size={16} />
          </button>
          <div className="conv-current-step">
            <span className="conv-current-label">当前步</span>
            <span className="conv-current-name">
              {CREATION_STEP_LABELS_ZH[focusType]}
              {chapterNo ? ` · 第 ${chapterNo} 章` : ""}
            </span>
          </div>
        </div>

        {/* 依赖提示：这一步读什么、跑几轮、边界在哪 */}
        <div className="conv-hint">
          <Sparkles size={12} />
          <span>{CREATION_STEP_INPUTS[focusType]}</span>
        </div>

        {/* 消息列表 */}
        <div className="conv-messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`conv-msg ${msg.role}`}>
              {msg.role === "agent" && (
                <div className="conv-msg-avatar">
                  {msg.agentRole ? AGENT_PERSONAS[msg.agentRole].emoji : <Bot size={16} />}
                </div>
              )}
              <div className="conv-msg-content">
                {msg.role === "agent" && msg.agentRole && (
                  <div className="conv-msg-sender">
                    ✦ {AGENT_PERSONAS[msg.agentRole].name}
                  </div>
                )}
                <div className="conv-msg-text">{msg.content}</div>
                {msg.card && (
                  <CardPreview card={msg.card} onConfirm={handleConfirmCard} disabled={isBusy || confirming} />
                )}
                {msg.isStreaming && <span className="conv-cursor">▍</span>}
              </div>
            </div>
          ))}

          <AgentActivity progress={withWorkflowProgress(progress, snapshot)} busy={isBusy || confirming} />

          {sendStatus === "sending" && !messages.some((m) => m.isStreaming) && (
            <div className="conv-msg agent">
              <div className="conv-msg-avatar">{activeAgent.emoji}</div>
              <div className="conv-msg-content">
                <div className="conv-typing">
                  <span /><span /><span />
                </div>
                {activity && <div className="conv-activity">{activity}</div>}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 会员门：可点，直达承接页选套餐 */}
        {memberGate && (
          <div className="conv-gate">
            <Crown size={14} />
            <span>{memberGate}</span>
            <Link to="/pricing?from=member_required" className="conv-gate-btn">查看套餐</Link>
            <button className="conv-gate-close" onClick={() => setMemberGate(null)}>
              <X size={13} />
            </button>
          </div>
        )}

        {/* 错误提示 */}
        {errorMsg && (
          <div className="conv-error">
            <AlertCircle size={14} />
            <span>{errorMsg}</span>
            <button onClick={handleRetry} className="conv-error-retry">
              <RotateCcw size={12} /> 重试
            </button>
          </div>
        )}

        {/* 输入区域 —— 编队 / 附件 / 斜杠菜单 / 模型 / 发送，全在一个 Composer 里 */}
        <Composer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onAbort={handleAbort}
          busy={isBusy}
          disabled={sendStatus === "error"}
          placeholder={`和${activeAgent.name}聊聊你的故事想法…（/ 唤技能，@ 召唤专家）`}
          summoned={summoned}
          onSummonedChange={setSummoned}
          skills={skills}
          agents={castAgents}
          genres={genres}
          templates={templates}
          files={files}
          onFilesChange={setFiles}
          models={composer.models}
          selected={composer.selected}
          onModelChange={composer.selectModel}
          model={llm?.model}
          modelNotice={composer.modelNotice}
          onManageModels={() => nav("/settings")}
        />

      </main>
      )}

      {/* ── 右：产出 ── */}
      <ProductionPanel
        bookId={bookId ?? null}
        snapshot={snapshot}
        chapters={theater.chapters}
        noOrchestration={noOrchestration}
      />

      {profile && (
        <AgentProfileModal
          target={profile}
          onClose={() => setProfile(null)}
          onChat={openDirect}
          onPortrait={theater.setAgentPortrait}
        />
      )}

      {creatingGroup && (
        <CreateGroupDialog
          agents={theater.roster.agents}
          extraNames={theater.roster.extras}
          namePreview={groupNamePreview}
          onClose={() => setCreatingGroup(false)}
          onCreate={createGroup}
        />
      )}
    </div>
    </PortraitProvider>
  );
}


/* ── 建书意图卡 ── */
function CardPreview({
  card, onConfirm, disabled,
}: {
  readonly card: ActionCard;
  readonly onConfirm: (card: ActionCard, title: string) => void;
  readonly disabled: boolean;
}) {
  const candidates = card.createBook.titleCandidates?.length
    ? card.createBook.titleCandidates
    : [card.createBook.title];
  const [title, setTitle] = useState(card.createBook.title || candidates[0]!);
  const [expanded, setExpanded] = useState(false);
  const cb = card.createBook;

  return (
    <div className="conv-card">
      <div className="conv-card-header">
        <Sparkles size={13} />
        <span>{card.title || "建书意图卡"}</span>
      </div>
      <div className="conv-card-body">
        {card.summary && <p className="conv-card-summary">{card.summary}</p>}

        <div className="conv-card-field">
          <span className="conv-card-label">
            书名{candidates.length > 1 ? `（${candidates.length} 选 1）` : ""}
          </span>
          <div className="conv-card-titles">
            {candidates.map((t) => (
              <button
                key={t}
                className={`conv-card-title ${title === t ? "is-on" : ""}`}
                onClick={() => setTitle(t)}
                disabled={disabled}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="conv-card-meta">
          {cb.genre && <span>题材 {cb.genre}</span>}
          {cb.platform && <span>平台 {PLATFORM_LABELS[cb.platform] ?? cb.platform}</span>}
          {cb.targetChapters ? <span>{cb.targetChapters} 章</span> : null}
          {cb.chapterWordCount ? <span>{cb.chapterWordCount} 字/章</span> : null}
        </div>

        {cb.synopsis && (
          <div className="conv-card-field">
            <span className="conv-card-label">简介</span>
            <p className={`conv-card-synopsis ${expanded ? "" : "is-clamped"}`}>{cb.synopsis}</p>
          </div>
        )}

        {card.instruction && (
          <button className="conv-card-more" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收起完整意图卡" : "展开完整意图卡"}
          </button>
        )}
        {expanded && <pre className="conv-card-raw">{card.instruction}</pre>}

        <button
          className="conv-card-btn"
          onClick={() => onConfirm(card, title)}
          disabled={disabled}
        >
          {disabled ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
          确认建书 · 开始铸造
        </button>
      </div>
    </div>
  );
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  tomato: "番茄", qidian: "起点", feilu: "飞卢", other: "其他",
};

/**
 * 从工具执行里提建书确认卡。
 * 后端把它放在 propose_action 的 args 里，action==="create_book"。
 */
function extractActionCard(
  execs: ReadonlyArray<ToolExecution> | undefined,
): ActionCard | undefined {
  const exec = execs?.find(
    (e) => e.tool === "propose_action" && e.args?.action === "create_book" && e.args?.createBook,
  );
  const cb = exec?.args?.createBook;
  if (!exec || !cb?.title) return undefined;
  return {
    kind: "create_book",
    title: exec.args?.title ?? "建书意图卡",
    summary: exec.args?.summary ?? "",
    instruction: exec.args?.instruction ?? "",
    createBook: cb,
  };
}

/* ── 辅助函数 ── */
