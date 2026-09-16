/**
 * API 客户端 —— 对接后端 /api/v1 接口。
 *
 * **绝对地址直连，不依赖 vite 代理**：代理只在 `vite dev` 下存在，
 * 构建产物一部署就全是 404。地址来源见 {@link API_ORIGIN}。
 */
import { apiUrl, CREDENTIALS } from "./api-origin";
import { cachedApiRequest, invalidateApiCacheForMutation } from "./api-cache";

const BASE = apiUrl("/api/v1");

export interface GeneralArtifactPreview {
  previewId: string; url: string; expiresAt: string; artifactId: string; revision: number;
  runningPreviewId?: string;
}
export function openGeneralArtifactPreview(sessionId: string, artifactId: string, revision: number) {
  return requestJson<GeneralArtifactPreview>(`/general-agent/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/preview`, {
    method: "POST", body: JSON.stringify({ revision }),
  });
}
export function closeGeneralArtifactPreview(sessionId: string, previewId: string) {
  return requestJson<{ status: "closed" }>(`/general-agent/sessions/${encodeURIComponent(sessionId)}/previews/${encodeURIComponent(previewId)}`, { method: "DELETE" });
}
export function stopGeneralRunningPreview(sessionId: string, serviceId: string) {
  return requestJson<{ serviceId: string; status: string; summary: string }>(`/general-agent/sessions/${encodeURIComponent(sessionId)}/services/${encodeURIComponent(serviceId)}/stop`, { method: "POST", body: "{}" });
}

/** 带后端错误码的 API 异常（403 会员锁等要靠 code 分支处理）。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * 401 LOGIN_REQUIRED 的全局回调：由 use-membership 注册，把共享登录态翻成「未登录」，
 * 让 RequireLogin 闸门立刻切到登录页，而不是每个页面各自处理 401。
 */
let loginRequiredHandler: (() => void) | null = null;
export function setLoginRequiredHandler(fn: (() => void) | null): void {
  loginRequiredHandler = fn;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const scope = JSON.stringify([BASE, authHeaders()["X-Skoob-User"] ?? null]);
  return cachedApiRequest(scope, path, init, () => requestJson<T>(path, init));
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const requestAuth = authHeaders();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    // 跨源必须带凭证，否则会话 cookie 不发出，登录态永远是"未登录"。
    credentials: CREDENTIALS,
    headers: {
      "Content-Type": "application/json",
      // 登录态在浏览器，逐请求带上——后端不持久化「当前登录用户」。
      ...authHeaders(),
      ...(init?.cache === "reload" ? { "X-Skoob-Refresh": "1" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    /*
     * 后端把真正的原因放在响应体里。只抛 statusText 会把它丢掉，前端就只能
     * 显示无意义的 "403: Forbidden"。
     *
     * 两种形状都要认——仓库里两种都在用：
     *   嵌套  { error: { code, message } }
     *   平铺  { error: "COVER_FAILED", message: "cover endpoint is required…" }
     * 只认嵌套的话，平铺那批会把错误**码**当成消息显示（实测：生成封面失败
     * 只弹出一个 "COVER_FAILED"，而后端其实说清了是没配生图服务）。
     */
    const body = (await res.json().catch(() => null)) as
      | {
          error?: { code?: string; message?: string } | string;
          message?: string;
          response?: string;
        }
      | null;
    const err = body?.error;
    const message =
      (typeof err === "object" ? err?.message : undefined)
      ?? body?.message
      ?? (typeof err === "string" ? err : undefined)
      ?? body?.response
      ?? `API ${res.status}: ${res.statusText}`;
    const code = typeof err === "object" ? err?.code : typeof err === "string" ? err : undefined;
    if (res.status === 401 && code === "LOGIN_REQUIRED"
      && requestAuth.Authorization && requestAuth.Authorization === authHeaders().Authorization) loginRequiredHandler?.();
    throw new ApiError(res.status, message, code);
  }
  if (init?.method && init.method.toUpperCase() !== "GET") invalidateApiCacheForMutation(path);
  return res.json() as Promise<T>;
}

/* ── 天王模板目录 ──
   形状对齐后端 packages/studio/src/data/tianwang-catalog.ts。
   旧版这里凭空写了 { id, genre, description }，后端根本不返回这些字段——
   页面里读 tags/slug/shortDescription 全是类型错误。 */
/**
 * 拆书状态 —— 与数据库 `book_catalog.deconstruction_status` 同一套取值。
 *
 * 早先静态书单用的是 `partial`，数据库用 `in_progress`，两套枚举各说各话。
 * 统一成数据库那套；`partial` 保留只为兼容尚未迁移的静态数据。
 */
export type TianwangDeconstructionStatus =
  | "not_started" | "in_progress" | "ready" | "failed" | "partial";

export interface TianwangBook {
  readonly title: string;
  readonly slug: string;
  readonly year: string;
  readonly category: string;
  readonly tags: ReadonlyArray<string>;
  readonly shortDescription: string;
  readonly deconstructionStatus: TianwangDeconstructionStatus;
  readonly sourceId?: string;
  /** asset 表的数字主键，用于封面 API */
  readonly assetId?: string | null;
  /** 封面地址（短期签名）——跟模板同一条数据返回，没设封面为 null */
  readonly coverUrl?: string | null;
}

export interface TianwangAuthor {
  readonly name: string;
  readonly slug: string;
  readonly category: string;
  readonly label: string;
  readonly shortBio: string;
  readonly bookCount: number;
  readonly books: ReadonlyArray<TianwangBook>;
}

export interface TianwangCatalog {
  readonly authors: ReadonlyArray<TianwangAuthor>;
}

export async function fetchTianwangCatalog(): Promise<TianwangCatalog> {
  // Revalidate the private HTTP cache: unchanged catalogs return 304 without a database reload.
  return requestJson<TianwangCatalog>("/tianwang/catalog", { cache: "no-cache" });
}

/* ── 书籍列表 ── */
/** 后端 BookStatusSchema。 */
export type BookStatus =
  | "incubating" | "outlining" | "active" | "paused" | "completed" | "dropped";

export interface BookSummary {
  readonly id: string;
  readonly title: string;
  /**
   * 封面地址（短期签名）。没设封面时为 null / 缺省——前端回落到那个按 id
   * 算出来的渐变色块，不要显示空白格子。
   */
  readonly coverUrl?: string | null;
  readonly genre: string;
  readonly status: BookStatus;
  readonly chaptersWritten: number;
  readonly targetChapters?: number;
  readonly chapterWordCount?: number;
  readonly platform?: string;
  readonly language?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly tianyanGraphId?: string;
  /**
   * 这本书是用哪种模式建的（引导 / 剧场 / 互动影游）。
   *
   * 老书没有这个字段——它是后加的。缺省不要当成「引导」显示成事实，
   * 那是在编造历史；作品库把它标成「未标记」，由用户自己认领。
   * 改后端务必同步这里：packages/studio/src/api/book-create.ts。
   */
  readonly creationMode?: "guided" | "conversation" | "film";
  readonly creationLoop?: {
    readonly loopId?: string;
    readonly status?: string;
    readonly strategy?: "fast" | "simulate";
  };
}

export async function fetchBooks(): Promise<ReadonlyArray<BookSummary>> {
  const data = await fetchJson<{ books: ReadonlyArray<BookSummary> }>("/books");
  return data.books;
}

/* ── 创建书籍 ── */
export interface CreateBookParams {
  readonly title: string;
  readonly genre: string;
  readonly language?: "zh" | "en";
  readonly platform?: string;
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
  readonly blurb?: string;
}

/**
 * 建书是异步流水线：这里只排队，返回 { status: "creating", bookId }。
 * 完成情况用 GET /books/:id/create-status 轮询，或听 SSE 的 book:created。
 */
export async function createBook(
  params: CreateBookParams,
): Promise<{ status: string; bookId: string }> {
  return fetchJson<{ status: string; bookId: string }>("/books/create", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/* ── 会话管理 ── */
export interface SessionMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp?: number;
  readonly toolExecutions?: ReadonlyArray<unknown>;
}

export interface BookSession {
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly title: string | null;
  readonly sessionKind: string;
  readonly playMode?: string;
  readonly messages: ReadonlyArray<SessionMessage>;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export async function fetchSession(sessionId: string): Promise<BookSession> {
  const data = await fetchJson<{ session: BookSession }>(`/sessions/${sessionId}`);
  return data.session;
}

export async function restoreWorkbenchSession(bookId: string): Promise<BookSession> {
  const data = await fetchJson<{ sessions: ReadonlyArray<{ sessionId: string; sessionKind?: string }> }>(`/sessions?bookId=${encodeURIComponent(bookId)}`);
  const existing = data.sessions.find((session) => session.sessionKind === "book");
  return existing ? fetchSession(existing.sessionId) : createSession({ bookId, sessionKind: "book" });
}

/** 与后端 SessionKindSchema 对齐（本前端目前用到的子集） */
export type SessionKind = "chat" | "book-create" | "book";

export async function createSession(params: {
  bookId?: string | null;
  sessionKind?: SessionKind;
  playMode?: string;
  creationStrategy?: "fast" | "orchestrate" | "simulate";
}): Promise<BookSession> {
  // 后端返回 { session: {...} }，与 fetchSession 一致，需要解包
  const data = await fetchJson<{ session: BookSession }>("/sessions", {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!data?.session?.sessionId) {
    throw new Error("创建会话失败：后端未返回 sessionId");
  }
  return data.session;
}

export async function abortSession(sessionId: string, scope: "chat" | "all" = "all"): Promise<void> {
  await fetchJson(`/sessions/${sessionId}/abort`, { method: "POST", body: JSON.stringify({ scope }) });
}

/* ── Agent 调用 ── */
export interface AgentRequest {
  readonly background?: boolean;
  readonly instruction: string;
  readonly sessionId: string;
  readonly activeBookId?: string;
  readonly sessionKind?: SessionKind;
  readonly actionSource?: string;
  readonly requestedIntent?: string;
  readonly actionPayload?: unknown;
  readonly requestedSkills?: ReadonlyArray<string>;
  readonly disabledSkills?: ReadonlyArray<string>;
  readonly playMode?: string;
  readonly model?: string;
  readonly service?: string;
  readonly creationStrategy?: "fast" | "orchestrate" | "simulate";
  /** 全自动开关：`"auto"` 才不停，缺省与脏值都落到「每步停」这一侧。 */
  readonly approvalPolicy?: "review" | "auto";
  /**
   * 用哪种模式建这本书。**只在 create_book 确认那一发有意义**——
   * 它会被写进 book.json，作品库据此显示标签、据此决定点进去去哪。
   * 不传就是引导。
   */
  readonly creationMode?: "guided" | "conversation" | "film";
  readonly toolRequests?: unknown;
  readonly capabilityRefs?: unknown;
  /** 附件：图片走视觉，文本落盘供 Agent 工具按 filename 读取（拆书原件即走这条）。 */
  readonly attachments?: ReadonlyArray<AgentAttachment>;
  /** 天魔脑洞卡：从哪张热点卡发起的创作（透传到后端写来源关联）。 */
  readonly brainstormCardId?: string;
}

/**
 * 聊天附件 —— 与后端 `normalizeAgentAttachments` 的契约一一对应。
 *
 * dataUrl 必须是 base64 data URL（`data:<mime>;base64,<...>`）。后端按类型分流：
 *   图片   → 转成视觉输入随消息进模型
 *   文本   → 落盘 `.skoob/uploads/<sessionId>/`，长文（拆书原件）不注入提示词，
 *           只供 Agent 工具按 filename 读取——`tianwang_deconstruct_source` 就靠它。
 */
export interface AgentAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly dataUrl: string;
}

/** 建书确认卡的负载（propose_action 工具 args.createBook）。 */
export interface CreateBookPayload {
  readonly title: string;
  readonly titleCandidates?: ReadonlyArray<string>;
  readonly genre?: string;
  readonly platform?: string;
  readonly language?: "zh" | "en";
  readonly targetChapters?: number;
  readonly chapterWordCount?: number;
  readonly synopsis?: string;
  /** LLM 在确认卡里自选的档位；用户显式选择时会被覆盖。 */
  readonly strategy?: "fast" | "simulate";
}

/**
 * 一次工具执行。
 *
 * ⚠️ book-create 会话里 `response` 常常是空串——Agent 真正的产出是
 * `propose_action` 工具卡（建书意图卡，含三选一候选书名）。
 * 只读 response 会以为 Agent 什么都没说。
 */
export interface ToolExecution {
  readonly result?: string;
  readonly error?: string;
  readonly id: string;
  readonly tool: string;
  readonly label?: string;
  readonly agent?: string;
  readonly status?: string;
  readonly args?: {
    readonly action?: string;
    readonly title?: string;
    readonly summary?: string;
    readonly instruction?: string;
    readonly createBook?: CreateBookPayload;
    readonly [k: string]: unknown;
  };
}

export interface AgentResponse {
  readonly creationLoop?: { readonly bookId: string; readonly loopId: string };
  readonly response?: string;
  readonly session?: {
    readonly sessionId: string;
    readonly sessionKind?: string;
    readonly activeBookId?: string;
  };
  readonly details?: {
    readonly toolExecutions?: ReadonlyArray<ToolExecution>;
  };
  readonly snapshot?: unknown;
  readonly error?: { code: string; message: string };
}

/**
 * 确认建书意图卡。
 *
 * 契约见 server.ts isConfirmedProductionAction / requestedIntent==="create_book"：
 * actionSource 必须是 button（或 slash），payload 走 actionPayload.createBook。
 * title 用用户三选一的结果覆盖卡片默认值。
 */
export async function confirmCreateBook(params: {
  readonly sessionId: string;
  readonly instruction: string;
  readonly createBook: CreateBookPayload;
  readonly creationStrategy?: "fast" | "simulate";
  /**
   * 使用态模型选择（输入框下拉）。确认建书时后端会把它钉进
   * book.json creationLoop，之后六步流水线全按这个模型跑。
   */
  readonly model?: string;
  readonly service?: string;
  /**
   * 全自动开关。缺省 = 每步停下等确认。
   *
   * ⚠️ 这个字段以前**根本没发出去过**：后端建书那条路把 approvalPolicy 写死成
   * "review"，所以入口那个「全自动」模式其实从来没自动过 —— 它只是跳去了另一个
   * 页面。现在开关真的接上了，改这里记得连着后端一起看。
   */
  readonly approvalPolicy?: "review" | "auto";
  /**
   * 用哪种模式建这本书。写进 book.json —— 作品库据此显示标签、
   * 据此决定点进去去哪。以前模式只是前端路由决策，建完书就丢了，
   * 于是每本书长得一模一样，点进去一律是引导模式的工作台。
   */
  readonly creationMode?: "guided" | "conversation" | "film";
  readonly promptRefs?: ReadonlyArray<{ kind: "prompt-template" | "prompt-template-once"; id: string }>;
}): Promise<AgentResponse> {
  // 同时带上用户选择，兼容卡片与请求字段；后端以用户/已保存策略为准。
  const createBook = params.creationStrategy
    ? { ...params.createBook, strategy: params.creationStrategy }
    : params.createBook;
  return callAgent({
    ...(params.promptRefs?.length ? { promptRefs: params.promptRefs } : {}),
    background: true,
    instruction: params.instruction,
    sessionId: params.sessionId,
    sessionKind: "book-create",
    actionSource: "button",
    requestedIntent: "create_book",
    actionPayload: { createBook },
    ...(params.creationStrategy ? { creationStrategy: params.creationStrategy } : {}),
    ...(params.approvalPolicy ? { approvalPolicy: params.approvalPolicy } : {}),
    ...(params.creationMode ? { creationMode: params.creationMode } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(params.service ? { service: params.service } : {}),
  });
}

/**
 * 切换这本书的创作模式（只在引导 ↔ 剧场之间）。
 *
 * 规则在服务端（见 PUT /books/:id/creation-mode）：影游不是同一本书的另一种
 * 视图，它不跑六步编排、产出是分支图，所以切不过去也切不回来。
 */
export async function switchBookCreationMode(
  bookId: string,
  creationMode: "guided" | "conversation",
): Promise<{ bookId: string; creationMode: string }> {
  return fetchJson(`/books/${encodeURIComponent(bookId)}/creation-mode`, {
    method: "PUT",
    body: JSON.stringify({ creationMode }),
  });
}

const agentJobWaiters = new Map<string, () => void>();

export async function callAgent(req: AgentRequest, onJob?: (id: string) => void): Promise<AgentResponse> {
  if (req.background) {
    const accepted = await fetchJson<{jobId:string}>("/agent/jobs", { method:"POST", headers:{"Idempotency-Key":crypto.randomUUID()}, body:JSON.stringify(req) });
    onJob?.(accepted.jobId);
    for (;;) {
      const job = await fetchJson<{status:string; response:AgentResponse; httpStatus:number; error?:string}>(`/agent/jobs/${accepted.jobId}`);
      if (job.status === "interrupted") throw new Error(job.error);
      if (job.status === "completed") {
        if (job.httpStatus >= 400) throw new ApiError(job.httpStatus, job.response.error?.message ?? "任务失败", job.response.error?.code);
        return job.response;
      }
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); agentJobWaiters.delete(accepted.jobId); resolve(); };
        const timer = setTimeout(done, 15000 + Math.random()*1000);
        agentJobWaiters.set(accepted.jobId, done);
      });
    }
  }
  return fetchJson<AgentResponse>("/agent", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/* ── SSE 事件流 ── */
/**
 * 后端真实广播的事件名（server.ts 与 creation-loop-routes.ts 的 broadcast 调用）。
 */
export type AgentEventType =
  // 会话/回合
  | "agent:start"
  | "agent:complete"
  | "agent:aborted"
  | "agent:error"
  | "session:title"
  | "session:message"
  // 流式正文与思考
  | "draft:start"
  | "draft:delta"
  | "draft:complete"
  | "draft:error"
  | "thinking:start"
  | "thinking:delta"
  | "thinking:end"
  | "llm:progress"
  // 工具执行
  | "tool:start"
  | "tool:end"
  // 建书
  | "book:creating"
  | "book:created"
  | "book:error"
  // 六步编排
  | "creation-loop:reviewed"
  | "creation-loop:advanced"
  | "creation-loop:completed"
  | "creation-loop:outline-progress"
  | "creation-loop:error"
  // 天衍推演（仿真编排）
  | "tianyan:pipeline"
  | "tianyan:pipeline-progress"
  | "tianyan:graph"
  // 每章治理链
  | "write:start"
  | "write:complete"
  | "write:error"
  | "audit:start"
  | "audit:complete"
  | "audit:error"
  | "revise:start"
  | "revise:complete"
  | "revise:error"
  /**
   * 仿真剧场里**用户自建群**的角色回话（后端 theater/groups/:id/reply 边生成
   * 边推，一条一条冒出来）。自动群用的是 `chat:round`。
   */
  | "theater:message"
  /**
   * 角色回话的逐字流。三段配合出「他正在打字」：
   * `speaking` 轮到谁了 → `delta` 一小段一小段出 → `message` 落盘的那条替换掉
   * 临时气泡。`speaking-end` 是没说成时撤气泡用的。
   *
   * 只有 `theater:message` 是**真相**（已落盘）；前两个纯属观感，丢了也不影响
   * 最终内容——所以前端不能拿 delta 拼出来的文本当数据存。
   */
  | "theater:speaking"
  | "theater:delta"
  | "theater:speaking-end"
  /** 这本书此刻有谁在看（进场/离场时推）。 */
  | "theater:spectators"
  /**
   * 仿真跑完一轮、已写进 PG。**只是个信号，不带内容** —— 收到就按 session
   * uid 去增量拉。带内容就等于真相源又多了一份在消息通道里。
   */
  | "chat:round"
  | "stream:resync"
  | "agent:job"
  | "creation-loop:activity"
  | "creation-loop:text"
  | "intent:delta"
  | "craft:active";

/** 需要显式 addEventListener 的具名事件（SSE 具名事件不走 onmessage）。 */
export const AGENT_EVENT_TYPES: ReadonlyArray<AgentEventType> = [
  "craft:active", "intent:delta", "creation-loop:text", "creation-loop:activity", "agent:start", "agent:complete", "agent:aborted", "agent:error",
  "session:title", "session:message", "chat:round", "stream:resync", "agent:job",
  "draft:start", "draft:delta", "draft:complete", "draft:error",
  "thinking:start", "thinking:delta", "thinking:end", "llm:progress",
  "tool:start", "tool:end",
  "book:creating", "book:created", "book:error",
  "creation-loop:reviewed", "creation-loop:advanced", "creation-loop:completed", "creation-loop:outline-progress", "creation-loop:error",
  "tianyan:pipeline", "tianyan:pipeline-progress", "tianyan:graph",
  "write:start", "write:complete", "write:error",
  "audit:start", "audit:complete", "audit:error",
  "revise:start", "revise:complete", "revise:error",
  "theater:message", "theater:speaking", "theater:delta", "theater:speaking-end",
  "theater:spectators",
];

export interface AgentEvent {
  readonly type: AgentEventType;
  readonly data: unknown;
}

export type AgentEventHandler = (event: AgentEvent) => void;

/**
 * Agent 事件源 —— 订阅后端 SSE 事件流。
 *
 * 使用方式：
 *   const es = new AgentEventSource(onEvent, onError);
 *   es.connect();
 *   // ...
 *   es.disconnect();
 */
export class AgentEventSource {
  private lastEventId: string | null = null
  private reconnectAttempts = 0
  private readonly onConnectionChange?: (state: "connecting" | "connected" | "reconnecting" | "closed") => void
  private eventSource: EventSource | null = null
  private readonly onEvent: AgentEventHandler
  private readonly onError?: (error: unknown) => void
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = true
  /**
   * 要围观哪本书。
   *
   * 声明在**连接上**而不是每次事件带：服务端据此在建连接时校验一次资格，
   * 之后剧场那条流（谁在说话、说了什么）就会一起推给同一本书的其他观众。
   * 不声明的话行为不变——只收自己引发的事件。
   */
  private readonly watchBookId: string | null
  private readonly pauseWhenHidden: boolean
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
      this.eventSource?.close()
      this.eventSource = null
    } else if (this.shouldReconnect) {
      this.connect()
    }
  }

  constructor(
    onEvent: AgentEventHandler,
    onError?: (error: unknown) => void,
    options?: { readonly watchBookId?: string | null; readonly pauseWhenHidden?: boolean; readonly onConnectionChange?: (state: "connecting" | "connected" | "reconnecting" | "closed") => void },
  ) {
    this.onEvent = onEvent
    this.onError = onError
    this.watchBookId = options?.watchBookId ?? null
    this.pauseWhenHidden = options?.pauseWhenHidden ?? false
    this.onConnectionChange = options?.onConnectionChange
  }

  connect(): void {
    this.shouldReconnect = true
    if (this.pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange)
      if (document.visibilityState === "hidden") return
    }
    if (this.eventSource || this.reconnectTimer) return
    this._connect()
  }

  disconnect(): void {
    this.onConnectionChange?.("closed")
    this.shouldReconnect = false
    if (this.pauseWhenHidden && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange)
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  private _connect(): void {
    if (!this.shouldReconnect) return
    this.reconnectTimer = null
    this.onConnectionChange?.("connecting")
    /*
     * 身份走 query，不走请求头。
     *
     * 浏览器原生 EventSource **不能设置自定义头**——没有 Authorization、
     * 没有 X-Skoob-User 的余地。而后端现在按人路由事件（不再全量广播），
     * 认不出是谁就什么都收不到。
     *
     * 令牌进 URL 有代价（会进浏览器历史与服务端访问日志），这里的取舍是：
     * 它只出现在这一条长连接上，且服务端已按人隔离；相比"所有人共享一条
     * 广播流"，这个代价小得多。真要更严，下一步是给 SSE 发一次性短期票据。
     */
    const auth = authHeaders()
    const query = new URLSearchParams()
    if (auth.Authorization) query.set("access_token", auth.Authorization.replace(/^Bearer\s+/iu, ""))
    if (auth["X-Skoob-User"]) query.set("uid", auth["X-Skoob-User"])
    if (this.watchBookId) query.set("book", this.watchBookId)
    if (this.lastEventId !== null) query.set("after", this.lastEventId)
    const qs = query.toString()
    const source = new EventSource(
      `${BASE}/events${qs ? `?${qs}` : ""}`,
      { withCredentials: Boolean(CREDENTIALS) },
    )
    this.eventSource = source
    source.onopen = () => {
      if (this.eventSource !== source) return
      this.reconnectAttempts = 0
      this.onConnectionChange?.("connected")
    }

    this.eventSource.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { event?: string; data?: unknown }
        if (parsed.event) {
          this.onEvent({ type: parsed.event as AgentEventType, data: parsed.data })
        }
      } catch {
        // ignore malformed events
      }
    }

    // 具名事件：SSE 的 event: 字段不触发 onmessage，必须逐个 addEventListener
    for (const evt of AGENT_EVENT_TYPES) {
      this.eventSource.addEventListener(evt, (e) => {
        try {
          const id = (e as MessageEvent).lastEventId
          // 无 id 的实时帧也会继承浏览器的 lastEventId；仅持久化事件参与重放去重。
          const durable = evt === "chat:round" || evt === "creation-loop:advanced"
          if (durable && id && this.lastEventId !== null && Number(id) <= Number(this.lastEventId)) return
          const data = JSON.parse((e as MessageEvent).data)
          if (evt === "agent:job" && typeof data?.jobId === "string") agentJobWaiters.get(data.jobId)?.()
          this.onEvent({ type: evt, data })
          if (id && (durable || evt === "stream:resync")) this.lastEventId = id
        } catch {
          // ignore
        }
      })
    }

    source.onerror = () => {
      if (this.eventSource !== source) return
      // 原生 EventSource 自带重连；手动重建前必须关掉它，避免耗尽同源连接。
      source.close()
      this.eventSource = null
      this.onError?.(new Error("SSE connection error"))
      this.onConnectionChange?.("reconnecting")
      if (this.shouldReconnect) {
        const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts++) + Math.random() * 1000
        this.reconnectTimer = setTimeout(() => this._connect(), delay)
      }
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   六步编排（creation loop）
   ══════════════════════════════════════════════════════════════════ */

import type { WorkflowSnapshot } from "../types/creation-loop";
import { authHeaders, getVisitorId } from "./auth-storage";

/**
 * 书详情 —— 编排状态的唯一查询入口。
 *
 * ⚠️ loopId 不能由 bookId 推导（后端 creationLoopId() 里带 Date.now()）。
 * 它持久化在 book.json 的 creationLoop.loopId，而 GET /books/:id 会顺手
 * 从 events.db 组装完整快照注进来——一次请求拿到 loopId + snapshot，
 * 不需要先查 id 再查快照。
 */
export interface BookConfig {
  readonly id?: string;
  readonly title?: string;
  readonly genre?: string;
  readonly status?: string;
  readonly targetChapters?: number;
  readonly chapterWordCount?: number;
  readonly tianyanGraphId?: string;
  readonly tianyanSimDir?: string;
  readonly creationLoop?: {
    readonly loopId?: string;
    /** starting / running / awaiting_review / paused / done / error */
    readonly status?: string;
    /** 天衍流水线状态：running / done / deferred */
    readonly pipelineState?: string;
    readonly strategy?: "fast" | "simulate";
    readonly instruction?: string;
    /** 后端从 events.db 组装注入的完整六步快照。 */
    readonly snapshot?: WorkflowSnapshot;
  };
}

/**
 * 书详情响应。
 *
 * ⚠️ 书配置嵌在 `book` 字段里，不是顶层——
 *   { book, chapters, nextChapter, truth, tianyan, sessions }
 * 按顶层读 creationLoop 会永远拿到 undefined，于是三种模式都找不到
 * 编排、集体退化成空壳（"三个页面看起来一模一样"就是这么来的）。
 */
/** 书内的「真相文件」（设定/大纲/角色等已落盘的权威文本）。 */
export interface TruthFile {
  readonly name: string;
  readonly size: number;
  readonly preview?: string;
  /** true = 新版式书里的只读兼容层，编辑要去 outline/ 下的对应文件。 */
  readonly legacy?: boolean;
}

export interface ChapterSummary {
  readonly number: number;
  readonly title?: string;
  readonly wordCount?: number;
  readonly status?: string;
  /** 规范师/审校师留痕（章节索引里的真实审计结果）。 */
  readonly auditIssues?: ReadonlyArray<string>;
  readonly lengthWarnings?: ReadonlyArray<string>;
  /** 结算师落盘的章摘要与章末钩子。 */
  readonly summary?: string;
  readonly hook?: string;
}

export interface BookDetailResponse {
  readonly book: BookConfig;
  readonly chapters?: ReadonlyArray<ChapterSummary>;
  readonly nextChapter?: number;
  readonly truth?: ReadonlyArray<TruthFile>;
  readonly tianyan?: unknown;
  readonly sessions?: ReadonlyArray<{
    readonly sessionId: string;
    /** 消息条数。仿真轮次写进本书**每一个**会话，所以条数最多的那些就是
     *  历史最全的——回填按它排序，第一批就能把群聊拉出来。 */
    readonly messageCount?: number;
    readonly updatedAt?: number;
  }>;
}

export async function fetchBook(bookId: string): Promise<BookDetailResponse> {
  return fetchJson<BookDetailResponse>(`/books/${encodeURIComponent(bookId)}`);
}

/**
 * 读编排快照（书详情里没有时，再按 loopId 单独取）。
 *
 * 后端在天衍流水线还没建出 workflow 时返回 { snapshot: null }——不是错误，
 * 是"六步还没开始"，前端继续轮询即可。
 */
export async function fetchLoopSnapshot(
  bookId: string,
  loopId: string,
): Promise<WorkflowSnapshot | null> {
  const data = await fetchJson<{ snapshot: WorkflowSnapshot | null }>(
    `/books/${encodeURIComponent(bookId)}/creation-loop/${encodeURIComponent(loopId)}`,
  );
  return data.snapshot ?? null;
}

/** 一次拿到 loopId + 快照（书详情优先，缺快照时回落到单独取）。 */
export interface LoopState {
  readonly executionModel?: { service: string; model: string } | null;
  readonly loopId: string | null;
  readonly snapshot: WorkflowSnapshot | null;
  /** 该书用的档位：fast 不建编排，simulate 才有六步。 */
  readonly strategy: "fast" | "simulate" | null;
  /** 天衍流水线状态。⚠️ 不可信：仿真被跳过时后端也持久化成 "done"。 */
  readonly pipelineState: string | null;
  /**
   * 推演产物是否真的产出了。
   *
   * 判据是 book.json 上有没有 tianyanSimDir / tianyanGraphId ——
   * 它们只在天衍流水线跑完后写入。pipelineState 不能用：图谱认证失败
   * 导致流水线 deferred 时，它照样被写成 "done"，前端据此会宣称
   * "本步推演 24 轮"，而实际跑了 0 轮。
   */
  readonly hasSimulation: boolean;
}

/** 一次拿到 loopId + 快照 + 档位（书详情优先，缺快照时回落到单独取）。 */
export async function fetchLoopState(bookId: string): Promise<LoopState> {
  return fetchJson<LoopState>(`/books/${encodeURIComponent(bookId)}/creation-loop-state`);
}

/**
 * 暂停 / 恢复编排。
 *
 * ⚠️ 两个端点都要求 body 里带 loopId（`readLoopId` 会校验非空字符串），
 * 只传 {} 会 400「creation-loop loopId must be a non-empty string」。
 * loopId 从 fetchLoopState 拿。
 */
export async function pauseLoop(
  bookId: string,
  loopId: string,
): Promise<WorkflowSnapshot | null> {
  const data = await fetchJson<{ snapshot: WorkflowSnapshot | null }>(
    `/books/${encodeURIComponent(bookId)}/creation-loop/pause`,
    { method: "POST", body: JSON.stringify({ loopId }) },
  );
  return data.snapshot ?? null;
}

/**
 * 重新生成任意一步（含已确认的历史步骤）。
 *
 * 「回去重写第 1 章」走这条：后端 rejectStep 只把该步打回，不作废下游已确认
 * 的章节，重跑完停在确认门。与 {@link reviewLoopStep} 不同——那个只认当前
 * 待确认的那一步，历史步骤用它会报 "not awaiting review"。
 */
export async function regenerateLoopStep(params: {
  readonly bookId: string;
  readonly loopId: string;
  readonly stepId: string;
  readonly feedback?: string;
}): Promise<WorkflowSnapshot | null> {
  const data = await fetchJson<{ snapshot: WorkflowSnapshot | null }>(
    `/books/${encodeURIComponent(params.bookId)}/creation-loop/regenerate`,
    {
      method: "POST",
      body: JSON.stringify({
        loopId: params.loopId,
        stepId: params.stepId,
        ...(params.feedback ? { feedback: params.feedback } : {}),
      }),
    },
  );
  return data.snapshot ?? null;
}

export async function resumeLoop(
  bookId: string,
  loopId: string,
  options?: {
    autoReview?: boolean;
    /** 换模型重试：带上则先把这对 service/model 重新钉进书的 creationLoop 再恢复。 */
    service?: string;
    model?: string;
  },
): Promise<WorkflowSnapshot | null> {
  const data = await fetchJson<{ snapshot: WorkflowSnapshot | null }>(
    `/books/${encodeURIComponent(bookId)}/creation-loop/resume`,
    { method: "POST", body: JSON.stringify({ loopId, ...(options ?? {}) }) },
  );
  return data.snapshot ?? null;
}

/**
 * 步骤审阅（通过 / 打回重铸）。
 *
 * ⚠️ 没有独立的 REST 路由——审阅是经 /agent 的 loop_review 意图下发的，
 * 后端在 agent 回合里调 creationLoopRuntime.service.review()。
 * 引导模式的「通过」「重铸」按钮最终都走这里。
 */
/**
 * 工作台的「全自动运行」开关。
 *
 * 按人按书存在后端，刷新不丢；后端**每到一道闸门重新读一次**，所以中途
 * 打开立刻生效（不用等下一次推进）。
 *
 * 打开时如果正停在闸门上，后端会顺手放行——否则打开开关后还得再点一次
 * 「通过」，那这个开关就只是个标记。返回的 `resumed` 说明有没有发生这件事。
 */
export async function fetchAutoRun(bookId: string): Promise<boolean> {
  const d = await fetchJson<{ autoRun?: boolean }>(
    `/books/${encodeURIComponent(bookId)}/creation-loop/auto-run`,
  ).catch(() => ({ autoRun: false }));
  return d.autoRun === true;
}

export async function setAutoRun(params: {
  readonly bookId: string;
  readonly autoRun: boolean;
  /** 当前循环 id。带上它，打开开关时才能立刻把停着的闸门放行。 */
  readonly loopId?: string | null;
}): Promise<{ readonly autoRun: boolean; readonly resumed: boolean }> {
  return fetchJson(`/books/${encodeURIComponent(params.bookId)}/creation-loop/auto-run`, {
    method: "PUT",
    body: JSON.stringify({
      autoRun: params.autoRun,
      ...(params.loopId ? { loopId: params.loopId } : {}),
    }),
  });
}

/**
 * 可以单独指定模型的用途清单。
 *
 * 原来这份清单在前端写死。问题不只是改起来要发版：每个 id 必须与后端
 * `agentCtxFor("<id>")` 的调用逐字一致，写错不报错、只是那条路由永远不生效
 * ——而前端无从校验。现在从库里给，前端那份只作兜底（库里空着时用）。
 */
export interface RoutePurpose {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly needsStrong: boolean;
}

export async function fetchRoutePurposes(): Promise<ReadonlyArray<RoutePurpose>> {
  const d = await fetchJson<{ purposes?: ReadonlyArray<RoutePurpose> }>("/project/route-purposes")
    .catch(() => ({ purposes: [] as ReadonlyArray<RoutePurpose> }));
  return d.purposes ?? [];
}

export async function reviewLoopStep(params: {
  readonly sessionId: string;
  readonly bookId: string;
  readonly loopId: string;
  readonly stepId: string;
  readonly decision: "confirm" | "reject";
  readonly feedback?: string;
  /** 使用态模型选择：作用于这次审阅回合本身；步骤重生成仍按确认时钉定的模型。 */
  readonly model?: string;
  readonly service?: string;
}): Promise<AgentResponse> {
  return callAgent({
    instruction: params.decision === "confirm" ? "确认" : (params.feedback || "重新生成本步"),
    sessionId: params.sessionId,
    activeBookId: params.bookId,
    sessionKind: "book",
    requestedIntent: "loop_review",
    actionPayload: {
      loop: {
        loopId: params.loopId,
        stepId: params.stepId,
        decision: params.decision === "reject" ? "retry" : "confirm",
        ...(params.feedback ? { feedback: params.feedback } : {}),
      },
    },
    ...(params.model ? { model: params.model } : {}),
    ...(params.service ? { service: params.service } : {}),
  });
}

/* ── 建书状态（异步流水线轮询） ── */
export interface BookCreateStatus {
  readonly status: "creating" | "ready" | "error" | "missing";
  readonly error?: string;
}

export async function fetchBookCreateStatus(bookId: string): Promise<BookCreateStatus> {
  const res = await fetch(`${BASE}/books/${encodeURIComponent(bookId)}/create-status`, {
    credentials: CREDENTIALS, headers: authHeaders(),
  });
  if (res.status === 404) return { status: "missing" };
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<BookCreateStatus>;
}

/* ══════════════════════════════════════════════════════════════════
   天衍图谱
   ══════════════════════════════════════════════════════════════════ */

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly type?: string;
  readonly attributes?: string;
  readonly summary?: string;
  /** 剧情权重（图谱里持久化的 plot_weight，为 0 时后端用 appearance_count 兜底）。
   * 节点大小与颜色分档由它驱动。 */
  readonly weight?: number;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: string;
}

export interface GraphData {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
}

/** 读天衍图谱（Neo4j）。后端异常时回退空图谱，不抛错。 */
export async function fetchGraphData(graphId: string): Promise<GraphData> {
  return fetchJson<GraphData>(`/tianyan/graph/data/${encodeURIComponent(graphId)}`);
}

/** 节点详情（点击图谱节点）：完整档案卡 + 关联关系 + 活动时间线。 */
export interface GraphNodeDetail {
  readonly card: {
    readonly name: string;
    readonly cardType: string;
    readonly summary: string;
    /** JSON 字符串：persona/bio/behavior/tier/attributes/appearance_count 等。 */
    readonly payload: string;
  } | null;
  readonly relations: ReadonlyArray<{ direction: "out" | "in"; relation: string; target: string }>;
  readonly events: ReadonlyArray<{ round: number; action: string; content: string }>;
  /** 实体出场的章节（FEATURES 边，按章序）。 */
  readonly chapters: ReadonlyArray<{ number: number; title: string }>;
}

/** 读节点完整档案（按 graphId + 节点名直查图谱，拆书页专用——node-card 那条路依赖写书侧 bookConfig）。 */
export async function fetchGraphNodeDetail(graphId: string, name: string): Promise<GraphNodeDetail> {
  return fetchJson<GraphNodeDetail>(
    `/tianyan/graph/node/${encodeURIComponent(graphId)}/${encodeURIComponent(name)}`,
  );
}

/* ══════════════════════════════════════════════════════════════════
   去 AI 味（AI 检测 + 改写，对接 /api/v1/deai/*）
   检测与改写均为会员手动工具（403 MEMBERSHIP_REQUIRED）。
   ══════════════════════════════════════════════════════════════════ */

export interface DeAiIssue {
  readonly ruleId: string;
  readonly category: string;
  readonly name: string;
  readonly description: string;
  readonly matchedText: string;
  readonly suggestion: string;
  readonly severity: "high" | "medium" | "low";
}

export interface DeAiVocabularyIssue {
  readonly tier: 1 | 2 | 3;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly count: number;
}

/** 一项文体指标 + 人类小说参照带（后端 StyleMetric）。 */
export interface DeAiStyleMetric {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly humanLow: number;
  readonly humanHigh: number;
  readonly deviation: "high" | "low" | null;
  readonly excess: number;
  readonly meaning: string;
  readonly suggestion: string;
}

export interface DeAiDetection {
  /** 人味分，越高越像人写的。注意与朱雀的 AIGC 值方向相反。 */
  readonly score: number;
  /** = 100 - score，越高越像 AI（与朱雀同向）。 */
  readonly aiRisk?: number;
  readonly passed: boolean;
  readonly summary: {
    readonly totalIssues: number;
    readonly highSeverity: number;
    readonly mediumSeverity: number;
    readonly lowSeverity: number;
    readonly tier1Violations: number;
    readonly tier2Violations: number;
    readonly tier3Violations: number;
    readonly styleOutOfBand?: number;
  };
  readonly issues: ReadonlyArray<DeAiIssue>;
  readonly vocabularyIssues: ReadonlyArray<DeAiVocabularyIssue>;
  /** 文体计量：7 项指标对照人类小说区间。文本太短时 measurable=false。 */
  readonly stylometry?: {
    readonly metrics: ReadonlyArray<DeAiStyleMetric>;
    readonly outOfBand: number;
    readonly measurable: boolean;
  };
}

export interface DeAiRewriteResult {
  readonly original: string;
  readonly rewritten: string;
  readonly changes: ReadonlyArray<{
    readonly type: "rule" | "vocabulary" | "structure";
    readonly original: string;
    readonly replacement: string;
    readonly reason: string;
  }>;
  readonly newScore: number;
  readonly improvement: number;
}

/** 检测文本 AI 味（会员手动调用）。 */
export async function deAiDetect(content: string, language?: "zh" | "en"): Promise<DeAiDetection> {
  const d = await fetchJson<{ detection: DeAiDetection }>("/deai/detect", {
    method: "POST",
    body: JSON.stringify({ content, language }),
  });
  return d.detection;
}

/* —— 对外结论：实验融合风险分（POST /deai/verdict） —— */

export type DeAiBand = "human" | "suspect" | "ai";

export interface DeAiBandSpec {
  readonly band: DeAiBand;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly meaning: string;
}

export interface DeAiSignal {
  readonly id: "perplexity" | "judge" | "surface";
  readonly label: string;
  /** 0–1，越高越像 AI；不可用时 null。 */
  readonly value: number | null;
  readonly weight: number;
  readonly status: "ok" | "uncalibrated" | "skipped" | "failed";
  readonly note: string | null;
}

export interface DeAiAigcVerdict {
  /** 0–1，实验风险分，未经独立标定；模型侧信号全缺席时 null。 */
  readonly aigcValue: number | null;
  readonly band: DeAiBand | null;
  readonly bandLabel: string | null;
  readonly bandMeaning: string | null;
  readonly confidence: "low" | "medium" | "high";
  readonly signals: ReadonlyArray<DeAiSignal>;
  readonly warnings: ReadonlyArray<string>;
  readonly scale: ReadonlyArray<DeAiBandSpec>;
}

export interface DeAiJudgeEvidence {
  readonly quote: string;
  readonly pattern: string;
  readonly category: "句式" | "词汇" | "叙述姿态" | "结构" | "节奏" | "人味";
  readonly severity: "high" | "medium" | "low";
  readonly direction: "ai" | "human";
}

export interface DeAiJudgeVerdict {
  readonly aiProbability: number;
  readonly confidence: "low" | "medium" | "high";
  readonly summary: string;
  readonly evidence: ReadonlyArray<DeAiJudgeEvidence>;
  readonly patternDensityPerK: number | null;
  readonly sampledChars: number;
  readonly model: string | null;
}

export interface DeAiCoverage {
  readonly status: "complete" | "partial" | "unverified";
  readonly totalChars: number; readonly analyzedChars: number; readonly ratio: number;
  readonly inputTokens: number; readonly scoredTokens: number; readonly expectedScoredTokens: number;
  readonly segmentationVersion: string;
  readonly calibrationSha256?: string | null;
}
export interface DeAiSegment {
  readonly index: number; readonly start: number; readonly end: number; readonly text: string;
  readonly status: "complete" | "unverified" | "failed" | "skipped";
  readonly coverage: { readonly inputTokens: number; readonly scoredTokens: number; readonly expectedScoredTokens: number; readonly coverage: number; readonly modelId: string; readonly modelRevision: string; readonly featureVersion: string } | null;
  readonly features?: Readonly<Record<string, number | null>> | null;
  readonly aiProbability: number | null; readonly band: DeAiBand | null; readonly note: string | null;
}
export interface DeAiVerdictResponse {
  /** Optional for historical records, never infer full coverage when absent. */
  readonly coverage?: DeAiCoverage | null;
  readonly segments?: ReadonlyArray<DeAiSegment>;
  readonly ratios?: { readonly human: number; readonly suspect: number; readonly ai: number; readonly unknown: number };
  readonly quality?: "experimental";
  readonly reportVersion?: string;
  readonly contentSha256?: string;
  readonly verdict: DeAiAigcVerdict;
  readonly detection: DeAiDetection;
  readonly perplexity: {
    readonly aiProbability: number | null;
    readonly features: Record<string, number | null>;
    readonly calibrationModelId: string | null;
    readonly warnings: ReadonlyArray<string>;
  } | null;
  readonly judge: DeAiJudgeVerdict | null;
}

/**
 * 天工AI检测完整结论：规则/文体 + 困惑度 + AI 特征审校师三路融合。
 * 审校师走「天工AI检测」模型路由，有模型成本；`layers` 可只跑部分层。
 * `source`：检测成功即自动入库一条记录（迁移 051），page=检测页/chapter=章节内嵌。
 */
export async function deAiVerdict(
  content: string,
  options: {
    language?: "zh" | "en";
    layers?: ReadonlyArray<"surface" | "perplexity" | "judge">;
    source?: "page" | "chapter";
    sourceLabel?: string;
  } = {},
): Promise<DeAiVerdictResponse> {
  return fetchJson<DeAiVerdictResponse>("/deai/verdict", {
    method: "POST",
    body: JSON.stringify({
      content,
      language: options.language,
      layers: options.layers,
      ...(options.source ? { source: options.source } : {}),
      ...(options.sourceLabel ? { sourceLabel: options.sourceLabel } : {}),
    }),
  });
}

/* —— 检测记录：账号维度持久化（迁移 051），回看/详情/删除 —— */

/** 记录列表项（不含全文，详情接口另拉）。 */
export interface DeAiRecordItem {
  readonly id: string;
  readonly source: "page" | "chapter";
  readonly sourceLabel: string;
  /** 原文摘要（前 80 字，空白折叠）。 */
  readonly excerpt: string;
  readonly charCount: number;
  readonly aigcValue: number | null;
  readonly band: DeAiBand | null;
  readonly createdAt: string;
}

/** 记录详情：原文全文 + 当时的完整检测响应（报告回放与下载都以它为准）。 */
export interface DeAiRecordDetail extends DeAiRecordItem {
  readonly userId: string;
  readonly language: string | null;
  readonly content: string;
  readonly result: DeAiVerdictResponse;
}

export async function listDeAiRecords(limit = 200, offset = 0): Promise<ReadonlyArray<DeAiRecordItem>> {
  const d = await fetchJson<{ records: ReadonlyArray<DeAiRecordItem> }>(
    `/deai/records?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
  );
  return d.records ?? [];
}

export async function getDeAiRecord(id: string): Promise<DeAiRecordDetail> {
  const d = await fetchJson<{ record: DeAiRecordDetail }>(`/deai/records/${encodeURIComponent(id)}`);
  return d.record;
}

export async function deleteDeAiRecord(id: string): Promise<void> {
  await fetchJson(`/deai/records/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 一键改写去 AI 味（会员；非会员 403 MEMBERSHIP_REQUIRED）。 */
export async function deAiRewrite(content: string, language?: "zh" | "en"): Promise<DeAiRewriteResult> {
  const d = await fetchJson<{ rewrite: DeAiRewriteResult }>("/deai/rewrite", {
    method: "POST",
    body: JSON.stringify({ content, language }),
  });
  return d.rewrite;
}

/* ══════════════════════════════════════════════════════════════════
   大模型服务配置（对接 /api/v1/services/*）
   ══════════════════════════════════════════════════════════════════ */

export interface ServiceListItem {
  readonly service: string;
  readonly label: string;
  /** aggregator（中转/聚合） / overseas（海外） / china（国内）；自定义服务无分组。 */
  readonly group?: string;
  /** 已配置 API Key。 */
  readonly connected: boolean;
}

export async function fetchServices(): Promise<ReadonlyArray<ServiceListItem>> {
  const data = await fetchJson<{ services: ReadonlyArray<ServiceListItem> }>("/services");
  return data.services;
}

/** skoob.json 里的一条服务配置。 */
export interface ServiceConfigEntry {
  readonly service: string;
  /** 自定义服务的显示名（service==="custom" 时用；服务 id 是 `custom:<name>`）。 */
  readonly name?: string;
  readonly baseUrl?: string;
  readonly models?: ReadonlyArray<string>;
  /** 协议：chat=Chat/Completions，responses=OpenAI Responses。选错会连不上。 */
  readonly apiFormat?: "chat" | "responses";
  /** 是否流式。关掉时后端不发 draft:delta，整段响应走 POST 返回体。 */
  readonly stream?: boolean;
  readonly temperature?: number;
}

/** .env 里检测到的 LLM 配置（项目级 / 全局级各一份）。 */
export interface EnvConfigSummary {
  readonly detected: boolean;
  readonly provider: string | null;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly hasApiKey: boolean;
}

export interface EnvConfigStatus {
  readonly project: EnvConfigSummary;
  readonly global: EnvConfigSummary;
  readonly effectiveSource: "project" | "global" | null;
  readonly runtimeUsesEnv: boolean;
}

export interface ServicesConfig {
  readonly services: ReadonlyArray<ServiceConfigEntry>;
  /** 当前默认服务商。 */
  readonly service: string | null;
  readonly defaultModel: string | null;
  readonly configSource: string;
  readonly envConfig?: EnvConfigStatus;
}

export async function fetchServicesConfig(): Promise<ServicesConfig> {
  return fetchJson<ServicesConfig>("/services/config");
}

/**
 * 保存服务配置。
 * 只传要改的字段——后端对 services 做的是 merge 而不是覆盖。
 * configSource 不能设成 "env"（后端会 400）。
 */
/**
 * @returns `cleared` 非空表示换服务商时**顺手清掉了**对不上的旧模型。
 *
 * 不静默清：留着一个指向别家的模型下次调用就打不通，而清掉不说的话用户会
 * 发现默认模型莫名其妙没了。两种都不行，所以如实回报，由界面告诉他。
 */
export async function saveServicesConfig(patch: {
  readonly service?: string;
  readonly defaultModel?: string;
  readonly services?: ReadonlyArray<ServiceConfigEntry>;
}): Promise<{ readonly cleared?: ReadonlyArray<string> }> {
  return fetchJson("/services/config", { method: "PUT", body: JSON.stringify(patch) });
}

/** 某服务商的 key 状态。**没有明文**——后端不提供把 key 读回来的接口。 */
export interface ServiceSecretStatus {
  readonly configured: boolean;
  /** 展示用后四位；太短的 key 为空串。 */
  readonly last4: string;
}

/**
 * 读某服务商的 key 状态。
 *
 * 从前这个接口直接把明文 key 返回给前端——那等于给每个能打到它的人开了
 * 一条导出通道。现在只回「配没配」和后四位；输入框留空即表示不修改。
 */
export async function fetchServiceSecret(service: string): Promise<ServiceSecretStatus> {
  const data = await fetchJson<Partial<ServiceSecretStatus>>(
    `/services/${encodeURIComponent(service)}/secret`,
  );
  return { configured: data.configured === true, last4: data.last4 ?? "" };
}

/** 存 API Key；传空串即删除该服务的 key。 */
export async function saveServiceSecret(service: string, apiKey: string): Promise<void> {
  const res = await fetch(`${BASE}/services/${encodeURIComponent(service)}/secret`, {
    method: "PUT",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ apiKey }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error || `保存失败 ${res.status}`);
}

export interface ServiceTestResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly modelCount?: number;
  readonly models?: ReadonlyArray<ModelInfo>;
  readonly selectedModel?: string;
  readonly detected?: {
    readonly apiFormat?: string;
    readonly stream?: boolean;
    readonly baseUrl?: string;
    readonly modelsSource?: string;
  };
}

/**
 * 连通性测试。失败时后端返回 400 + { ok:false, error }，
 * 这是正常的业务结果而不是异常，所以不能用 fetchJson（它会抛）。
 */
export async function testService(
  service: string,
  params: {
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly apiFormat?: "chat" | "responses";
    readonly stream?: boolean;
  },
): Promise<ServiceTestResult> {
  const res = await fetch(`${BASE}/services/${encodeURIComponent(service)}/test`, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  return (await res.json().catch(() => ({ ok: false, error: "无法解析响应" }))) as ServiceTestResult;
}

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly maxOutput?: number;
  readonly contextWindow?: number;
}

/** 列某服务可用模型（后端缓存 10 分钟，refresh=true 强制重探）。 */
export async function fetchServiceModels(
  service: string,
  refresh = false,
): Promise<ReadonlyArray<ModelInfo>> {
  const data = await fetchJson<{ models: ReadonlyArray<ModelInfo> }>(
    `/services/${encodeURIComponent(service)}/models${refresh ? "?refresh=1" : ""}`,
  );
  return data.models;
}

export async function deleteService(service: string): Promise<void> {
  await fetchJson(`/services/${encodeURIComponent(service)}`, { method: "DELETE" });
}

/**
 * 完整保存一个服务商（对齐老前端 service-detail-state.ts 的语义）。
 *
 * 「保存」不只是存 key —— 老版是：先探测校验 → 存 key → 同时写下
 * apiFormat / stream / temperature / baseUrl，并把该服务设为默认服务商、
 * 把探测出的模型设为默认模型。探测不过就不落盘，避免存进一个连不上的配置。
 *
 * 只存 key 的做法会留下半截配置：协议/流式仍是旧值，跑起来照样连不上。
 */
export async function saveServiceFull(params: {
  readonly serviceId: string;
  readonly apiKey: string;
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly temperature?: number;
  /** 自定义服务必填。 */
  readonly baseUrl?: string;
  readonly isCustom?: boolean;
  readonly customName?: string;
  /** 设为默认服务商 + 默认模型（默认开）。 */
  readonly makeDefault?: boolean;
}): Promise<{ ok: true; detected?: ServiceTestResult["detected"]; models: ReadonlyArray<ModelInfo>; selectedModel?: string }> {
  const key = params.apiKey.trim();
  const baseUrl = params.baseUrl?.trim() ?? "";
  if (params.isCustom && !baseUrl) throw new Error("自定义服务必须填 Base URL");
  // 留空 = 不改 key（后端探测时会用已存的那把）。
  const keepExistingKey = key.length === 0;

  const probe = await testService(params.serviceId, {
    apiKey: key,
    apiFormat: params.apiFormat,
    stream: params.stream,
    ...(params.isCustom ? { baseUrl } : {}),
  });
  if (!probe.ok) throw new Error(probe.error || "连接失败，未保存");

  // 探测回来的实际协议/流式优先于表单值——后端可能自动纠正
  const apiFormat = (probe.detected?.apiFormat as "chat" | "responses") ?? params.apiFormat;
  const stream = typeof probe.detected?.stream === "boolean" ? probe.detected.stream : params.stream;

  // 只在用户真的填了新 key 时才写；留空写下去会把已存的那把清掉。
  if (!keepExistingKey) await saveServiceSecret(params.serviceId, key);
  await saveServicesConfig({
    ...(params.makeDefault !== false ? { service: params.serviceId } : {}),
    ...(params.makeDefault !== false && probe.selectedModel
      ? { defaultModel: probe.selectedModel }
      : {}),
    services: [{
      service: params.isCustom ? "custom" : params.serviceId,
      apiFormat,
      stream,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.isCustom
        ? { name: params.customName || "Custom", baseUrl: probe.detected?.baseUrl ?? baseUrl }
        : {}),
    }],
  });

  return {
    ok: true,
    detected: probe.detected,
    models: probe.models ?? [],
    ...(probe.selectedModel ? { selectedModel: probe.selectedModel } : {}),
  };
}

/* ══════════════════════════════════════════════════════════════════
   Agent 模型路由（每个 agent 走哪个模型）
   ══════════════════════════════════════════════════════════════════ */

/** skoob.json 顶层 modelOverrides：agent 名 → 模型 id（或含 baseUrl 的完整覆盖）。 */
export type ModelOverrideValue = string | {
  readonly model: string;
  /** 指向「大模型服务配置」里的另一家服务商（key 与 secrets 一致，如 `custom:openrouter`）。 */
  readonly service?: string;
  readonly baseUrl?: string;
};

/** 所有已接入服务商的模型（GET /services/models），模型路由下拉用。 */
export interface ModelGroup {
  readonly service: string;
  readonly label: string;
  readonly models: ReadonlyArray<ModelInfo>;
}
export async function fetchAllModelGroups(): Promise<ReadonlyArray<ModelGroup>> {
  const d = await fetchJson<{ groups: ReadonlyArray<ModelGroup> }>("/services/models");
  return d.groups;
}

export async function fetchModelOverrides(): Promise<Readonly<Record<string, ModelOverrideValue>>> {
  const d = await fetchJson<{ overrides: Record<string, ModelOverrideValue> }>("/project/model-overrides");
  return d.overrides ?? {};
}

export async function saveModelOverrides(
  overrides: Readonly<Record<string, ModelOverrideValue>>,
): Promise<void> {
  await fetchJson("/project/model-overrides", {
    method: "PUT",
    body: JSON.stringify({ overrides }),
  });
}

/** 全局默认模型（独立端点，与 /services/config 是同一份 skoob.json.llm）。 */
export async function fetchDefaultModel(): Promise<{ service: string | null; defaultModel: string | null }> {
  return fetchJson("/project/default-model");
}

export async function saveDefaultModel(params: {
  readonly service?: string;
  readonly defaultModel: string;
}): Promise<void> {
  await fetchJson("/project/default-model", { method: "PUT", body: JSON.stringify(params) });
}

/**
 * 项目级生效的 LLM 参数。
 *
 * 为什么需要它：stream / temperature / baseUrl 可能只写在 skoob.json 的
 * **顶层 llm**，而不在 services[] 的某一条里。设置页若只读服务条目，
 * 就会把「未指定」显示成控件默认值（比如流式默认 on），而系统实际在
 * 非流式跑——用户一保存还会把错误值真的写进去。
 */
export interface ProjectLlmInfo {
  readonly model?: string;
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly stream?: boolean;
  readonly temperature?: number;
}

export async function fetchProjectLlm(): Promise<ProjectLlmInfo> {
  return fetchJson<ProjectLlmInfo>("/project");
}

/* ══════════════════════════════════════════════════════════════════
   天魔脑洞 · 多平台热榜（hotboard）
   ══════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ 命名坑：产品口语里的「天衍引擎页面」指的是代码中的 **tianmo 天魔引擎**
 * （热点采集 + 灵感蒸馏）；`tianyan` 是仿真推演引擎，与热榜无关。
 * 见 docs/_archive/2026-08-23-tianmo-hotboard.md。
 */

export interface HotboardItem {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
  readonly summary?: string;
  /** 数值热度（各平台口径不同，仅用于排序/相对展示）。 */
  readonly heat?: number;
  /** 平台自带的热度文案，如「1295 万热度」。 */
  readonly heatLabel?: string;
  /** 领域扩展字段（网文榜：author/category/wordCount/metricLabel/tags…）。 */
  readonly meta?: Readonly<Record<string, string | number>>;
}

export interface HotboardSnapshot {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  /** 榜单领域：fiction 网文 / news 新闻热点。 */
  readonly domain?: string;
  /** live = 刚抓的；cache = 命中缓存；error = 该板失败（不影响其他板）。 */
  readonly status?: string;
  readonly updatedAt?: number;
  readonly items: ReadonlyArray<HotboardItem>;
  readonly home?: string;
  readonly error?: string;
}

export interface HotboardCategory {
  readonly id: string;
  readonly name: string;
  readonly boardIds: ReadonlyArray<string>;
}

export async function fetchHotboards(category: string, options?: { refresh?: boolean }): Promise<{
  categories: ReadonlyArray<HotboardCategory>;
  boards: ReadonlyArray<HotboardSnapshot>;
}> {
  return fetchJson(`/tianmo/hotboard/boards?category=${encodeURIComponent(category)}`,
    options?.refresh ? { cache: "reload" } : undefined);
}

/** 跨平台同题合并的聚合总榜——多个平台同时在说的事，才是真热点。 */
export interface HotTopic {
  readonly title: string;
  readonly platformCount: number;
  readonly occurrences?: ReadonlyArray<{
    readonly boardId?: string;
    readonly boardName?: string;
    readonly item?: HotboardItem;
  }>;
}

export async function fetchHotAggregate(limit = 20): Promise<ReadonlyArray<HotTopic>> {
  const d = await fetchJson<{ topics: ReadonlyArray<HotTopic> }>(
    `/tianmo/hotboard/aggregate?limit=${limit}`,
  );
  return d.topics ?? [];
}

export interface HotboardMatch {
  readonly boardId: string;
  readonly boardName: string;
  readonly category?: string;
  readonly item: HotboardItem;
  readonly matchedKeywords?: ReadonlyArray<string>;
}

export async function searchHotboard(keyword: string, limit = 60): Promise<ReadonlyArray<HotboardMatch>> {
  const d = await fetchJson<{ matches: ReadonlyArray<HotboardMatch> }>(
    `/tianmo/hotboard/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}`,
  );
  return d.matches ?? [];
}

/* ── 天魔扫榜（网文榜单市场分析） ── */

/** 扫榜平台组（长篇/短篇各一组板）。 */
export interface ScanPlatform {
  readonly id: string;
  readonly name: string;
  readonly mode: "long" | "short";
  /** 平台调性/核心指标（来自 Openwrite 平台特性速查）。 */
  readonly profile?: string;
  readonly boards: ReadonlyArray<{
    readonly id: string;
    /** 展示名（如「起点中文网·月票榜」）。 */
    readonly name?: string;
    readonly sampleCount: number;
    /** 样本 <15 条：数据稀疏（扫榜结论会自动降档，上游硬规则）。 */
    readonly sparse?: boolean;
    readonly updatedAt?: number;
  }>;
}

/** 报告板块（表格或列表，双模式通用渲染）。 */
export interface ScanSection {
  readonly title: string;
  readonly type: "table" | "list";
  readonly headers?: ReadonlyArray<string>;
  readonly rows?: ReadonlyArray<ReadonlyArray<string>>;
  readonly items?: ReadonlyArray<string>;
}

/** 选题决策（Openwrite Phase 4 四步：能爆原因(假设)→市场验证→差异化→可行性+风险+验证）。 */
export interface ScanTopic {
  readonly title: string;
  readonly genre?: string;
  readonly audience?: string;
  readonly whyHot?: string;
  readonly market?: string;
  readonly differentiation?: string;
  readonly feasibility?: string;
  readonly feasibilityReason?: string;
  readonly risk?: string;
  readonly validation?: string;
  readonly lengthPlatform?: string;
}

export interface ScanReportSummary {
  readonly id: number;
  readonly mode: string;
  readonly platform: string;
  readonly boardIds: ReadonlyArray<string>;
  readonly sampleCount: number;
  readonly status: string;
  readonly createdAt: string;
  readonly overview?: string;
}

export interface ScanReport extends ScanReportSummary {
  readonly qualityNote?: string;
  readonly error?: string;
  readonly report: {
    readonly overview?: string;
    readonly sections?: ReadonlyArray<ScanSection>;
    readonly oneLiner?: string;
  };
  readonly topics: ReadonlyArray<ScanTopic>;
}

/** 已接入的扫榜平台与各板样本情况（公开）。 */
export async function fetchScanPlatforms(): Promise<ReadonlyArray<ScanPlatform>> {
  const d = await fetchJson<{ platforms: ReadonlyArray<ScanPlatform> }>("/tianmo/scan/platforms");
  return d.platforms ?? [];
}

/** 生成扫榜报告（会员专属；非会员 403 MEMBER_REQUIRED）。 */
export async function generateScanReport(input: {
  readonly platform: string;
  readonly boardIds?: ReadonlyArray<string>;
}): Promise<ScanReport> {
  return fetchJson<ScanReport>("/tianmo/scan/reports", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 本人扫榜历史。 */
export async function listScanReports(limit = 30, filters: {
  readonly platform?: string;
  readonly mode?: string;
  readonly status?: string;
} = {}): Promise<ReadonlyArray<ScanReportSummary>> {
  const query = new URLSearchParams({ limit: String(limit) });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const d = await fetchJson<{ reports: ReadonlyArray<ScanReportSummary> }>(
    `/tianmo/scan/reports?${query}`,
  );
  return d.reports ?? [];
}

export async function fetchScanReport(id: number): Promise<ScanReport> {
  return fetchJson<ScanReport>(`/tianmo/scan/reports/${id}`);
}

/* ── 灵感方案生成 ── */

export interface EntityRisk {
  readonly name: string;
  readonly type: string;
  readonly severity: "high" | "medium" | "low";
  readonly action: string;
}

export interface InspirationPlan {
  readonly status?: "ready" | "needs_material" | "material_only" | "not_suitable" | "review_failed";
  readonly reason?: string;
  readonly bookTitle?: string;
  readonly synopsis?: string;
  readonly runId?: string;
  readonly review?: {readonly score:number;readonly issues:ReadonlyArray<string>;readonly criticalIssues:ReadonlyArray<string>};
  readonly score?: InspirationScore;
  readonly plans?: ReadonlyArray<Omit<InspirationPlan, "genre" | "plans"> & {genre:string}>;
  readonly assessments?: ReadonlyArray<{score:InspirationScore;direction:{pitch:string;category:string}}>;
  readonly genre: ReadonlyArray<string>;
  readonly coreConflict: string;
  readonly protagonist: string;
  readonly premise: string;
  readonly entityRisks: ReadonlyArray<EntityRisk>;
  readonly sourceTitle: string;
}

export interface InspirationScore {
  readonly score:number;readonly low:number;readonly high:number;
  readonly contributions:Record<"D"|"M"|"X"|"H"|"O"|"E",number>;
  readonly missing:ReadonlyArray<string>;
  readonly reasons?:ReadonlyArray<string>;
}
export interface InspirationSource {
  readonly title:string;readonly summary?:string;readonly source?:string;readonly url?:string;
  readonly sourceId?:string;readonly itemId?:string;readonly boardId?:string;readonly domain?:"news"|"fiction";
  readonly targetMode?:"long"|"short";readonly targetPlatform?:string;readonly directionId?:string;
  readonly sourceMetrics?:Omit<NonNullable<PublicInspirationAssessment["source"]>,"title">;
}

export interface PublicInspirationAssessment {
  readonly status:string;readonly reason:string;
  readonly source:{title:string;summary?:string;url?:string;domain?:string;rank?:number|null;sourceCount?:number;capturedAt?:string;
    heat?:number|null;heatLabel?:string|null;rating?:number|null;metrics:Record<string,string|number>;
    heatScore?:{value:number;missing:readonly string[]}|null;marketScore?:{value:number;missing:readonly string[]}|null}|null;
  readonly weights:Record<"D"|"M"|"X"|"H"|"O"|"E",number>;
  readonly directions:ReadonlyArray<{id:string;strategyLabel?:string;category:string;platform:string;mode:string;score:InspirationScore;reason:string}>;
}

/** Public evidence only. The paid plan is served by a separate, authorized endpoint. */
export async function fetchInspirationAssessment(input:InspirationSource):Promise<PublicInspirationAssessment> {
  return fetchJson<PublicInspirationAssessment>("/tianmo/inspiration/assessment",{method:"POST",body:JSON.stringify(input)});
}

/** 对新闻或网文采集素材评估，再生成合格灵感方案。 */
export async function generateInspirationPlan(input: InspirationSource): Promise<InspirationPlan> {
  return fetchJson<InspirationPlan>("/tianmo/inspiration/plan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}


/** 脑洞卡（最新优先，匿名可读，包含历史生成记录）。 */
export interface BrainstormCard {
  readonly id: string;
  readonly topicId: string;
  readonly batchDate: string;
  readonly originalTitle: string;
  readonly originalUrl: string | null;
  /** 书名（v2 生成要素）。 */
  readonly title: string;
  readonly genre: string;
  readonly coreConflict: string;
  readonly protagonist: string;
  readonly premise: string;
  /** 小说式简介（v2 生成要素，150-250字；老卡为空，前端回退 premise）。 */
  readonly synopsis: string | null;
  /** 生成时的完整要素（v3 起含 factions/locations/rules/triggers）。 */
  readonly fullPlan?: unknown;
  /** AI 题材插画（异步生成，可能为 null——前端走题材渐变占位）。 */
  readonly imageUrl: string | null;
  readonly pinned: boolean;
  readonly status: string;
  readonly impressionCount: number;
  readonly clickCount: number;
  readonly usedCount: number;
  readonly createdAt: string;
}

export interface BrainstormCardPage {
  readonly cards: ReadonlyArray<BrainstormCard>;
  readonly nextCursor: string | null;
}

export async function fetchBrainstormCardPage(limit = 12, options?: { refresh?: boolean; after?: string }): Promise<BrainstormCardPage> {
  const after = options?.after ? `&after=${encodeURIComponent(options.after)}` : "";
  return fetchJson<BrainstormCardPage>(
    `/tianmo/brainstorm/cards?limit=${limit}${after}`,
    options?.refresh ? { cache: "reload" } : undefined,
  );
}

export async function fetchBrainstormCards(limit = 12, options?: { refresh?: boolean }): Promise<ReadonlyArray<BrainstormCard>> {
  return (await fetchBrainstormCardPage(limit, options)).cards;
}

/** 转化漏斗事件（查看/使用/搜索/改写；匿名可上报，失败静默）。 */
export interface FunnelEvent {
  readonly eventType: "item_view" | "item_click" | "item_use" | "search" | "rewrite"
    | "scan_generate" | "scan_view" | "scan_topic_click";
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly subjectTitle?: string;
  readonly query?: string;
}

export async function reportFunnelEvents(
  events: ReadonlyArray<FunnelEvent>,
): Promise<void> {
  try {
    await fetchJson("/tianmo/funnel/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        events: events.map((e) => ({ ...e, visitorId: getVisitorId() })),
      }),
    });
  } catch {
    // 埋点失败不影响主流程。
  }
}

/** 匿名埋点：曝光(impression)/感兴趣(click)。失败静默——埋点不阻塞页面。 */
export async function reportBrainstormEvents(
  events: ReadonlyArray<{ readonly cardId: string; readonly type: "impression" | "click" }>,
): Promise<void> {
  try {
    await fetchJson("/tianmo/brainstorm/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ events }),
    });
  } catch {
    // 埋点失败不影响主流程。
  }
}

/* ══════════════════════════════════════════════════════════════════
   作品库 · 读取与导出
   ══════════════════════════════════════════════════════════════════ */

export type ExportFormat = "txt" | "md" | "epub";

/**
 * 导出下载地址。
 *
 * 后端直接返回带 Content-Disposition 的文件流，所以不用 fetch —— 让浏览器
 * 自己去下（fetch 再造 blob 只是徒增内存与失败点）。
 */
export function bookExportUrl(
  bookId: string,
  format: ExportFormat,
  approvedOnly = false,
): string {
  const q = new URLSearchParams({ format, ...(approvedOnly ? { approvedOnly: "true" } : {}) });
  return `${BASE}/books/${encodeURIComponent(bookId)}/export?${q.toString()}`;
}

/** 读单章正文。 */
export async function fetchChapter(
  bookId: string,
  num: number,
): Promise<{ title?: string; content?: string; wordCount?: number }> {
  return fetchJson(`/books/${encodeURIComponent(bookId)}/chapters/${num}`);
}

/* ── 技能（可召唤，走 requestedSkills） ── */
/**
 * 技能 —— 真能召唤的能力（`/` 菜单 → requestedSkills → runAgentSession）。
 *
 * 字段与后端 `GET /api/v1/skills` 一一对应。此前前端只取了 4 个字段，详情页
 * 因此没东西可展示——whenToUse/triggers/toolHints/body 全在后端躺着没人读。
 */
export interface SkillInfo {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** 什么时候该用它——详情页最该先给用户看的一句。 */
  readonly whenToUse?: string;
  /** 触发词：说到这些词后端会考虑挂载它。 */
  readonly triggers?: ReadonlyArray<string>;
  /** 适用会话类型（book / free…）。 */
  readonly sessionKinds?: ReadonlyArray<string>;
  /** 绑定的提示词包。 */
  readonly promptPacks?: ReadonlyArray<string>;
  /** 工具提示（canonical_step:outline 这类，说明它挂在哪一步）。 */
  readonly toolHints?: ReadonlyArray<string>;
  /** 需要的上下文。 */
  readonly contextNeeds?: ReadonlyArray<string>;
  /** SKILL.md 全文——详情页展开看规范本身。 */
  readonly body?: string;
  /** builtin=内置玩法 / project=项目内置 / external=拆书产出。 */
  readonly source?: string;
  readonly editable?: boolean;
  readonly path?: string;
  /** 这份技能是不是我创建的（asset 归属）——决定前端给不给编辑/删除。 */
  readonly isMine?: boolean;
  /** 累计安装人数（按用户去重，卸载不减）——市场与列表直接展示。 */
  readonly installs?: number;
}

export async function fetchSkills(): Promise<ReadonlyArray<SkillInfo>> {
  const d = await fetchJson<{ skills: ReadonlyArray<SkillInfo> }>("/skills");
  return d.skills ?? [];
}

/* —— 技能市场：全量技能 + 安装计数 + 安装/卸载（订阅） —— */

export interface SkillStoreItem extends SkillInfo {
  readonly updatedAt?: string;
  /** 当前用户是否已安装（订阅）。 */
  readonly installed?: boolean;
}

/** 技能市场全量列表（内置 + 用户发布的），带安装人数与安装态。 */
export async function fetchSkillStore(): Promise<ReadonlyArray<SkillStoreItem>> {
  const d = await fetchJson<{ skills: ReadonlyArray<SkillStoreItem> }>("/skills/store");
  return d.skills ?? [];
}

/** 安装一个技能 = 订阅它（同时计入累计安装人数）。 */
export async function installSkill(id: string): Promise<void> {
  await fetchJson(`/skills/${encodeURIComponent(id)}/install`, { method: "POST" });
}

/** 卸载 = 退订；安装计数不减。 */
export async function uninstallSkill(id: string): Promise<void> {
  await fetchJson(`/skills/${encodeURIComponent(id)}/uninstall`, { method: "POST" });
}

/** 技能创建/更新的载荷：body 是 SKILL.md 正文 Markdown（frontmatter 由后端生成）。 */
export interface SkillPayload {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly whenToUse?: string;
  readonly triggers?: ReadonlyArray<string>;
  readonly body: string;
}

export async function createSkill(payload: SkillPayload): Promise<void> {
  await fetchJson("/skills", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateSkill(id: string, payload: SkillPayload): Promise<void> {
  await fetchJson(`/skills/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ ...payload, id }) });
}

export async function deleteSkill(id: string): Promise<void> {
  await fetchJson(`/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 读一个真相文件的全文。 */
export async function fetchTruthFile(
  bookId: string,
  file: string,
): Promise<{ content?: string; legacy?: boolean }> {
  return fetchJson(`/books/${encodeURIComponent(bookId)}/truth/${file}`);
}

/* ══════════════════════════════════════════════════════════════════
   智能体资产（图谱）与能力引用
   ══════════════════════════════════════════════════════════════════ */

/**
 * 图谱里的智能体画像。
 *
 * ⚠️ 真实数据源是**图谱**，不是 story/tianyan/agent_configs.md ——
 * 那份 md 只是给人读的快照。智能体是跨书永久沉淀的资产：每本书创作时
 * 生成的智能体都 MERGE 进 Entity 并写画像，构成小说创作领域的知识库。
 */
export interface GraphAgent {
  readonly bookTitle?: string;
  readonly sourceScope?: { readonly analyzedChapters: number | null; readonly totalChapters: number };
  /** 名册里的唯一键（内容寻址）。画像等按角色定位的接口用它。 */
  readonly uid?: string;
  /** 生成/上传的画像地址（短期签名）；没有则前端用 SVG 兜底。 */
  readonly portraitUrl?: string | null;
  readonly name: string;
  /** 归属图谱 id（= 书 id），用于区分来源。 */
  readonly graphId: string;
  /** 层级：major/minor。**不是**分类——分类看 agentType。 */
  readonly tier: string;
  /** 智能体分类 typeId（对应 AGENT_TYPES 九类）。 */
  readonly agentType: string;
  /** 剧情权重 10-100。 */
  readonly plotWeight: number;
  /** 流派标签（气运之子、宿敌、门派掌门…）。 */
  readonly flowTags: ReadonlyArray<string>;
  readonly persona: string;
  readonly bio: string;
  readonly appearance: string;
  readonly goal: string;
  readonly conflict: string;
  readonly abilities: string;
  readonly relationships: string;
  readonly growth: string;
  readonly behavior: string;
}

export async function fetchGraphAgents(params?: {
  readonly graphId?: string;
  readonly limit?: number;
}): Promise<ReadonlyArray<GraphAgent>> {
  const q = new URLSearchParams();
  if (params?.graphId) q.set("graphId", params.graphId);
  if (params?.limit) q.set("limit", String(params.limit));
  const d = await fetchJson<{ agents: ReadonlyArray<GraphAgent> }>(
    `/tianyan/agents${q.toString() ? `?${q}` : ""}`,
  );
  return d.agents ?? [];
}

/* ── 使用已拆的书 ── */

/**
 * 使用一本已拆的书要拿到的东西。
 *
 * 三样缺一不可：skillId 挂进本轮（才有查询母本的工具）、graphId 找专家团与资产、
 * agents 直接可召唤。只往输入框塞一句「参考某某风格」是假的使用。
 */
export interface UseBookPayload {
  readonly slug: string;
  readonly title: string;
  readonly author: string | null;
  readonly graphId: string;
  readonly skillId: string | null;
  readonly sourceBlobKey: string | null;
  readonly agents: ReadonlyArray<GraphAgent>;
  readonly agentCount: number;
}

export async function useTianwangBook(slug: string): Promise<UseBookPayload> {
  return fetchJson<UseBookPayload>(`/tianwang/books/${encodeURIComponent(slug)}/use`);
}

/** 书目（数据库版，跨机可见的拆书状态）。 */
export interface CatalogBookItem {
  readonly slug: string;
  readonly title: string;
  readonly author: string | null;
  readonly tags: ReadonlyArray<string>;
  readonly shortDescription: string;
  readonly deconstructionStatus: "not_started" | "in_progress" | "ready" | "failed";
  readonly graphId: string | null;
  readonly agentCount: number;
  readonly bountyAmount: number;
}

export async function fetchCatalogBooks(params: {
  readonly status?: "not_started" | "ready";
  readonly q?: string;
  readonly limit?: number;
} = {}): Promise<{
  enabled: boolean;
  books: ReadonlyArray<CatalogBookItem>;
  counts: Readonly<Record<string, number>> | null;
}> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.q) q.set("q", params.q);
  if (params.limit) q.set("limit", String(params.limit));
  return fetchJson(`/tianwang/catalog/books${q.toString() ? `?${q}` : ""}`);
}

/* ── 档案体检 / 补全 ── */

/**
 * 智能体档案是「一套标准」：14 字段齐全才算数。
 * 统一之前落盘的记录只有 persona/bio，召唤它、拿它跑仿真都只有半成品行为。
 * 这两个接口让用户能看见残缺、一键补全，而不是对着空字段猜。
 */
export interface AgentDefects {
  readonly complete: number;
  readonly defects: ReadonlyArray<{ readonly name: string; readonly missing: ReadonlyArray<string> }>;
}

export async function fetchAgentDefects(bookId: string): Promise<AgentDefects> {
  return fetchJson<AgentDefects>(`/books/${encodeURIComponent(bookId)}/agents/defects`);
}

/** 补全残缺档案；limit 省略则修完为止。每条都要走一次 LLM，慢是正常的。 */
export async function repairAgentDefects(
  bookId: string,
  limit?: number,
): Promise<{ repaired: number; failed: ReadonlyArray<{ name: string; missing: ReadonlyArray<string> }> }> {
  return fetchJson(`/books/${encodeURIComponent(bookId)}/agents/repair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(limit === undefined ? {} : { limit }),
  });
}

/* ── 能力引用（capabilityRefs：流派 / 智能体模板） ── */
export interface GenreInfo {
  readonly id: string;
  /** asset 表的数字主键，用于封面 API 等需要主键的场景 */
  readonly assetId?: string | null;
  readonly name: string;
  readonly source?: string;
  readonly language?: string;
  /** 集群统计（HAS_GENRE 边聚合）：名下书目数。图谱不可用时缺省——不显示假 0。 */
  readonly bookCount?: number;
  /** 名下书目的设定智能体总数。 */
  readonly agentCount?: number;
  /** 流派大类（fantasy/cultivation/urban/…），来自流派 md 正文 Niubix 参数块——真实数据，不是名字猜的。 */
  readonly category?: string;
  /** 徽章（如「尊严反弹」），同上来源。 */
  readonly badge?: string;
  /** 一句话定位，同上来源。 */
  readonly summary?: string;
  /** 封面地址（短期签名）——跟流派同一条数据返回，没设封面为缺省 */
  readonly coverUrl?: string | null;
}

export async function fetchGenres(): Promise<ReadonlyArray<GenreInfo>> {
  const d = await fetchJson<{ genres: ReadonlyArray<GenreInfo> }>("/genres");
  return d.genres ?? [];
}

/** 智能体角色原型（从 asset 表加载，type='agent'） */
export interface AgentPrototype {
  readonly id: string;
  readonly kind: "agent";
  readonly name: string;
  readonly role: string;
  readonly tags: ReadonlyArray<string>;
  readonly description: string;
  /** asset 表的数字主键，用于封面 API */
  readonly assetId: string;
  readonly coverKey?: string;
  /** 封面地址（短期签名）——跟原型同一条数据返回，没设封面为 null */
  readonly coverUrl?: string | null;
  /** 业务分类（asset_category kind='agent' 的 slug，如 protagonist/antagonist） */
  readonly category?: string | null;
  /** 图数据库命名空间（graph_id），后续按它查图谱 */
  readonly graphId?: string | null;
}

export async function fetchAgentPrototypes(): Promise<ReadonlyArray<AgentPrototype>> {
  const d = await fetchJson<{ prototypes: ReadonlyArray<AgentPrototype> }>("/agent-prototypes");
  return d.prototypes ?? [];
}

/**
 * 流派专家团集群：写法（profile/body）+ 名下书目 + 跨书精选智能体。
 *
 * 三层关系「流派 → 书的专家团 → 单个智能体」的数据出口，
 * AgentsPage 的流派弹层靠它做逐级钻取。
 */
export interface GenreClusterBook {
  readonly id: string;
  readonly title: string;
  readonly agentCount: number;
}

export interface GenreCluster {
  readonly id: string;
  readonly profile: { readonly name?: string; readonly language?: string } | null;
  /** 流派写法全文（流派 md 的 body：核心循环/章节配方/禁忌反模式…）。 */
  readonly body: string;
  readonly books: ReadonlyArray<GenreClusterBook>;
  /** 跨书精选智能体（按剧情权重排序，最多 24 个）。 */
  readonly agents: ReadonlyArray<GraphAgent>;
  /** false = 图谱不可用（写法照常可读，集群部分如实标空）。 */
  readonly graphAvailable: boolean;
}

export async function fetchGenreCluster(id: string): Promise<GenreCluster> {
  return fetchJson<GenreCluster>(`/genres/${encodeURIComponent(id)}/cluster`);
}

export interface AgentTemplateInfo {
  readonly id: string;
  readonly name: string;
  readonly zhName?: string;
  readonly domain?: string;
  readonly keywords?: ReadonlyArray<string>;
  /** 模板正文（画像分节 Markdown）——编辑回填用。 */
  readonly content?: string;
  /** 这份模板是不是我创建的（asset 归属）——决定前端给不给编辑/删除。 */
  readonly isMine?: boolean;
}

export async function fetchAgentTemplates(): Promise<ReadonlyArray<AgentTemplateInfo>> {
  const d = await fetchJson<{ templates: ReadonlyArray<AgentTemplateInfo> }>("/agent-templates");
  return d.templates ?? [];
}

export interface AgentTemplatePayload {
  readonly id: string;
  readonly name: string;
  readonly zhName?: string;
  readonly domain?: string;
  readonly form?: "entity" | "category" | "rule";
  readonly keywords?: ReadonlyArray<string>;
  readonly content: string;
}

export async function createAgentTemplate(payload: AgentTemplatePayload): Promise<void> {
  await fetchJson("/agent-templates", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateAgentTemplate(id: string, payload: AgentTemplatePayload): Promise<void> {
  await fetchJson(`/agent-templates/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) });
}

export async function deleteAgentTemplate(id: string): Promise<void> {
  await fetchJson(`/agent-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * 能力引用：后端从图谱取内容，**注入本轮系统提示词**作为事实参考。
 * 见 server.ts 的 parseCapabilityRefs / capabilityContext。
 */
export interface CapabilityRef {
  readonly kind: "genre" | "template" | "book-team" | "book-agent" | "prompt-template" | "prompt-template-once";
  readonly id: string;
}

/* ══════════════════════════════════════════════════════════════════
   连接器（外部服务集成）
   ══════════════════════════════════════════════════════════════════ */

export interface ResearchSearchConfig {
  readonly enabled: boolean;
  readonly provider?: string;
  readonly baseUrl?: string;
}

export async function fetchResearchSearch(): Promise<ResearchSearchConfig> {
  const d = await fetchJson<{ researchSearch: ResearchSearchConfig }>("/project/research-search");
  return d.researchSearch ?? { enabled: false };
}

/** 通知渠道配置（飞书 / Telegram / Webhook / 企业微信）。 */
export interface NotifyConfig {
  readonly [channel: string]: unknown;
}

export async function fetchNotify(): Promise<NotifyConfig> {
  const d = await fetchJson<{ notify?: NotifyConfig }>("/project/notify");
  return d.notify ?? {};
}

/* ══════════════════════════════════════════════════════════════════════════
   拆书（天王七师）

   形态是**七位师傅**，不是步骤列表。一本书当前归哪位师傅、他那一关的门禁过没过、
   已经往图谱里放进了什么——每个数字都是后端刚从 Postgres 与 Neo4j 里数出来的，
   不采信任何"步骤自述"。
   ══════════════════════════════════════════════════════════════════════════ */

export type DeconstructionStage =
  | "pending" | "stored" | "indexed" | "graph_ready" | "chaptering"
  | "outlining" | "extracting" | "profiling" | "auditing" | "ready" | "failed";

export type DeconstructionMasterId =
  | "archivist" | "cartographer" | "ontologist" | "chronicler"
  | "weaver" | "loremaster" | "auditor";

export type DeconstructionStatus = "pending" | "running" | "ready" | "failed";

/** 师傅在这本书上的状态。 */
export type MasterProgressState = "done" | "active" | "pending" | "failed";

export interface MasterGate {
  readonly id: string;
  readonly title: string;
  readonly severity: "hard" | "soft";
  readonly ok: boolean;
  readonly expected: string;
  readonly actual: string;
}

/** 一条真实产出（「朱慈」「朱慈 → 林黛玉」「第 12 章 · 抄家」）。 */
export interface ProducedItem {
  readonly name: string;
  readonly detail?: string;
  /** 角色/势力/爱慕/故事引擎… 用于打标。 */
  readonly kind?: string;
}

export interface ProducedGroup {
  readonly group: string;
  /** 这一组总共多少条；items 只是前若干条样本。 */
  readonly total: number;
  readonly items: ReadonlyArray<ProducedItem>;
}

export interface MasterProgress {
  readonly id: DeconstructionMasterId;
  readonly name: string;
  readonly duty: string;
  /** 这一关结束后你手上多了什么。 */
  readonly delivers: ReadonlyArray<string>;
  readonly position: number;
  readonly stages: ReadonlyArray<DeconstructionStage>;
  readonly state: MasterProgressState;
  /** 这位师傅**实际往图谱里放进了什么**。 */
  readonly produced: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly gates: ReadonlyArray<MasterGate>;
  /** 真实产出内容——不是"18 个角色"，是「朱慈、林黛玉、薛宝钗…」。 */
  readonly samples: ReadonlyArray<ProducedGroup>;
}

export interface DeconstructionDetail {
  readonly slug: string;
  readonly title: string;
  readonly stage: DeconstructionStage;
  readonly status: DeconstructionStatus;
  readonly stageDone: number;
  readonly stageTotal: number;
  readonly failedStage: string | null;
  readonly failedReason: string | null;
  readonly currentMaster: DeconstructionMasterId | null;
  /** 被叫停了。进度都在，续跑从当前这一关接着来。 */
  readonly paused: boolean;
  readonly masters: ReadonlyArray<MasterProgress>;
  readonly agentCount: number;
  /** 贵价调用累计入账：拆这本书烧了多少 token / 美元。 */
  readonly usageTokens: number;
  readonly usageCostUsd: number;
  /** 全书章数与本次已拆范围（部分拆解：scope < book，停在已暂停）。 */
  readonly bookChapters: number | null;
  readonly scopeChapters: number | null;
}

export interface DeconstructionSummary {
  readonly slug: string;
  readonly title: string;
  readonly stage: DeconstructionStage;
  readonly status: DeconstructionStatus;
  readonly stageDone: number;
  readonly stageTotal: number;
  readonly currentMaster: DeconstructionMasterId | null;
  readonly currentMasterName: string | null;
  /** 用户叫停了。暂停是一等状态——列表必须显示「已暂停」，不能还写「拆书中」。 */
  readonly paused: boolean;
  /** 距上次推进的毫秒数。running 但很久没动 = 进程死过，显示「已中断」。 */
  readonly idleMs: number | null;
  /** 全书章数与本次已拆范围（部分拆解时进度按章节算）。 */
  readonly bookChapters: number | null;
  readonly scopeChapters: number | null;
  readonly failedReason: string | null;
  readonly percent: number;
}

export async function fetchDeconstructions(): Promise<ReadonlyArray<DeconstructionSummary>> {
  const d = await fetchJson<{ deconstructions: ReadonlyArray<DeconstructionSummary> }>("/deconstructions");
  return d.deconstructions ?? [];
}

/**
 * 起一次拆书。
 *
 * 与「创作」是两条完全不同的路：创作走 /workbench 的意图卡引导，
 * 拆书走七师流水线。首页选了一本待拆的书，走的必须是这条。
 */
export async function startSourceDeconstruction(input: {
  readonly sourceId: string;
  readonly license?: "owned" | "licensed" | "public-domain" | "research-only";
  readonly version?: string;
  readonly genres?: ReadonlyArray<string>;
}): Promise<{ readonly slug: string; readonly title: string; readonly chapterCount: number }> {
  const d = await fetchJson<{
    deconstruction: { slug: string; title: string; chapterCount: number };
  }>(`/tianwang/sources/${encodeURIComponent(input.sourceId)}/deconstructions`, {
    method: "POST",
    body: JSON.stringify({
      license: input.license ?? "research-only",
      version: input.version ?? "1.0.0",
      genres: input.genres ?? ["未分类"],
      // 拆书要抽全套资产，六个阶段都要
      stages: ["worldview", "outline", "character", "chapter_plan", "chapter_write"],
    }),
  });
  return d.deconstruction;
}

/** 左栏资产目录：这本书拆出了哪些类别、各多少条。 */
export interface AssetCategory {
  readonly kind: string;
  readonly label: string;
  readonly count: number;
  /** 左栏分组标题：故事骨架 / 人物与设定 / 章节。 */
  readonly group: string;
  /** 一句话说明——用户不一定知道「叙事单元」是什么。 */
  readonly hint: string;
}

/** 一条资产的完整内容。 */
export interface AssetItem {
  readonly id: string;
  readonly name: string;
  readonly kind?: string;
  readonly summary?: string;
  /** 智能体档案的 14 字段等。 */
  readonly fields?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
}

/* ── 知识库问答（图谱优先，按书限定）── */

export interface KbCitation {
  readonly index: number;
  readonly kind: string;
  readonly label: string;
  readonly detail: string;
  readonly chapterNumber?: number;
}

export interface KbAnswer {
  readonly facet: string;
  readonly answer: string;
  readonly empty: boolean;
  readonly citations: ReadonlyArray<KbCitation>;
}

/** 问这本书。与聊天里的 ask_knowledge_base 工具同一份后端实现。 */
export async function askBookKb(slug: string, question: string): Promise<KbAnswer> {
  return fetchJson<KbAnswer>(
    `/tianwang-library/kb/${encodeURIComponent(slug)}/ask?q=${encodeURIComponent(question)}`,
  );
}

export interface CharacterDossier {
  readonly dossier: {
    readonly name: string; readonly type: string; readonly tier: string;
    readonly plotWeight: number; readonly appearanceCount: number;
    readonly firstChapter: number | null;
    readonly agentType: string; readonly summary: string; readonly persona: string;
    readonly appearance: string; readonly bio: string; readonly goal: string;
    readonly conflict: string; readonly abilities: string;
    readonly relationships: string; readonly growth: string;
    readonly flowTags: ReadonlyArray<string>; readonly aliases: ReadonlyArray<string>;
  };
  readonly timeline: ReadonlyArray<{
    readonly chapter: number; readonly chapterTitle: string; readonly summary: string;
    readonly emotionIntensity: number | null; readonly climaxLevel: string;
    readonly cycleTitle: string | null;
  }>;
  readonly relations: ReadonlyArray<{
    readonly from: string; readonly type: string; readonly to: string; readonly description: string;
  }>;
  readonly cycles: ReadonlyArray<string>;
  readonly foreshadows: ReadonlyArray<{
    readonly title: string; readonly setup: string; readonly payoff: string;
    readonly status: string; readonly chapterStart: number | null; readonly chapterEnd: number | null;
  }>;
}

/** 角色完整档案页：14 字段 + 有序出场轨迹 + 关系网 + 参与循环 + 伏笔。 */
export async function fetchCharacterDossier(slug: string, name: string): Promise<CharacterDossier> {
  const d = await fetchJson<{ character: CharacterDossier }>(
    `/tianwang-library/kb/${encodeURIComponent(slug)}/character/${encodeURIComponent(name)}`,
  );
  return d.character;
}

export async function fetchAssetCategories(slug: string): Promise<ReadonlyArray<AssetCategory>> {
  const d = await fetchJson<{ categories: ReadonlyArray<AssetCategory> }>(
    `/deconstructions/${encodeURIComponent(slug)}/assets`,
  );
  return d.categories ?? [];
}

export async function fetchAssetPage(
  slug: string, kind: string, offset = 0,
): Promise<{ items: ReadonlyArray<AssetItem>; total: number }> {
  return fetchJson<{ items: ReadonlyArray<AssetItem>; total: number }>(
    `/deconstructions/${encodeURIComponent(slug)}/assets/${encodeURIComponent(kind)}?offset=${offset}`,
  );
}

/**
 * 写下一章。
 *
 * 后端是**发射后不管**的：立刻返回 `{status:"writing"}`，进度、完成、失败
 * 都靠 SSE（write:start / write:complete / write:error）推。所以这个函数
 * resolve 只代表「已经开工」，不代表章节写完了——调用方要靠事件更新界面。
 *
 * 章前的场景预演也在这条链里跑，剧场里那一场会自己出现。
 */
export async function writeNextChapter(
  bookId: string,
  wordCount?: number,
): Promise<{ started: boolean; message: string }> {
  const res = await fetchJson<{ status?: string; error?: string }>(
    `/books/${encodeURIComponent(bookId)}/write-next`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wordCount ? { wordCount } : {}),
    },
  ).catch((e: unknown): { status?: string; error?: string } => ({
    error: e instanceof Error ? e.message : String(e),
  }));
  return res.status === "writing"
    ? { started: true, message: "已开始生成下一章" }
    : { started: false, message: res.error ?? "启动失败" };
}

/* ══════════════════════════════════════════════════════════════════
   封面（书 / 模板资产同一套接口）
   ══════════════════════════════════════════════════════════════════ */

export interface CoverState {
  /** 短期签名地址；没设封面时为 null，调用方回落到渐变。 */
  readonly url: string | null;
  readonly key?: string;
}

export type CoverKind = "book" | "asset" | "agent";

const coverPath = (kind: CoverKind, id: string): string =>
  `/covers/${kind}/${encodeURIComponent(id)}`;

export async function fetchCover(kind: CoverKind, id: string): Promise<CoverState> {
  const d = await fetchJson<Partial<CoverState>>(coverPath(kind, id))
    .catch((): Partial<CoverState> => ({ url: null }));
  return { url: d.url ?? null, ...(d.key ? { key: d.key } : {}) };
}

/**
 * 上传封面。
 *
 * **不要设 Content-Type** —— multipart 的 boundary 要交给浏览器生成，
 * 手动写死服务端就解析不出来（fetch + FormData 最常见的坑）。
 */
export async function uploadCover(kind: CoverKind, id: string, file: File): Promise<CoverState> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}${coverPath(kind, id)}`, {
    method: "PUT",
    credentials: CREDENTIALS,
    headers: authHeaders(),
    body: form,
  });
  const d = (await res.json().catch(() => null)) as { url?: string; message?: string } | null;
  if (!res.ok) throw new Error(d?.message ?? `上传失败（${res.status}）`);
  invalidateApiCacheForMutation(coverPath(kind, id));
  return { url: d?.url ?? null };
}

/** 生成封面。提示词留空则由后端按书名拼一个。 */
export async function generateCover(
  kind: CoverKind,
  id: string,
  prompt?: string,
): Promise<CoverState> {
  const d = await fetchJson<{ url?: string; message?: string }>(
    `${coverPath(kind, id)}/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prompt?.trim() ? { prompt: prompt.trim() } : {}),
    },
  );
  return { url: d.url ?? null };
}

export async function deleteCover(kind: CoverKind, id: string): Promise<void> {
  await fetchJson(coverPath(kind, id), { method: "DELETE" });
}

/** 叫停。编排器在下一个检查点停下，进度保留。 */
export async function pauseDeconstruction(slug: string): Promise<{ paused: boolean; message: string }> {
  const res = await fetch(`${BASE}/deconstructions/${encodeURIComponent(slug)}/pause`, {
    method: "POST", credentials: CREDENTIALS, headers: authHeaders(),
  });
  const body = (await res.json().catch(() => null)) as { paused?: boolean; message?: string } | null;
  return { paused: body?.paused === true, message: body?.message ?? `暂停失败：${res.status}` };
}

/** 续跑，从当前进度接着拆——已完成的章不会重做。 */
export async function resumeDeconstruction(slug: string, scope?: { remaining: boolean }): Promise<string> {
  const d = await fetchJson<{ message?: string }>(
    `/deconstructions/${encodeURIComponent(slug)}/resume`, { method: "POST", ...(scope ? { body: JSON.stringify(scope), headers: { "Content-Type": "application/json" } } : {}) },
  );
  return d.message ?? "已续跑";
}

export interface ResetOutcome {
  readonly ok: boolean;
  readonly reason: string;
  readonly previousStage: DeconstructionStage;
  readonly idleMs: number | null;
}

/**
 * 重置一本卡住的拆书。
 *
 * 后端拒绝时返回 409 且 body 里带原因（「3 分钟前还在推进，看起来仍在拆解中」），
 * 所以这里不能让 fetchJson 抛——把原因原样交给页面显示。
 */
export async function resetDeconstruction(
  slug: string, force = false,
): Promise<ResetOutcome> {
  const res = await fetch(`${BASE}/deconstructions/${encodeURIComponent(slug)}/reset`, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ force }),
  });
  const body = (await res.json().catch(() => null)) as ResetOutcome | { reset?: ResetOutcome } | null;
  // 兼容两种返回格式：直接返回 ResetOutcome 或包裹在 reset 字段中
  if (body && "ok" in body) return body as ResetOutcome;
  if (body && "reset" in body && body.reset) return body.reset;
  // 后端拒绝时（409），body 里可能只有 reason
  if (body && "reason" in body) {
    const b = body as { reason: string };
    return { ok: false, reason: b.reason, previousStage: "idle" as DeconstructionStage, idleMs: null };
  }
  throw new ApiError(res.status, `重置失败：${res.status}`);
}

export async function fetchDeconstruction(slug: string): Promise<DeconstructionDetail> {
  const d = await fetchJson<{ deconstruction: DeconstructionDetail }>(
    `/deconstructions/${encodeURIComponent(slug)}`,
  );
  return d.deconstruction;
}

/* ── 拆书专家团（静态定义，与某本书无关） ── */

export interface DeconstructionGate {
  readonly id: string;
  readonly title: string;
  readonly master: DeconstructionMasterId;
  readonly stage: DeconstructionStage;
  readonly severity: string;
}

export interface DeconstructionMaster {
  readonly id: DeconstructionMasterId;
  readonly name: string;
  readonly duty: string;
  readonly stages: ReadonlyArray<DeconstructionStage>;
  readonly inputs: ReadonlyArray<string>;
  readonly outputs: ReadonlyArray<string>;
  readonly rules: ReadonlyArray<string>;
  readonly boundaries: ReadonlyArray<string>;
  readonly gates: ReadonlyArray<string>;
  readonly onFail: string;
  readonly position: number;
  readonly gateDetails: ReadonlyArray<DeconstructionGate>;
}

export async function fetchDeconstructionMasters(): Promise<ReadonlyArray<DeconstructionMaster>> {
  const d = await fetchJson<{ masters: ReadonlyArray<DeconstructionMaster> }>("/tianwang/masters");
  return d.masters ?? [];
}

/* ── 书籍操作 ── */

/** 删除书籍 */
export async function deleteBook(bookId: string): Promise<void> {
  await fetchJson(`/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
}

/* ── 真相文件 ── */

export interface TruthFileData {
  world?: string;
  characters?: string;
  rules?: string;
  outline?: string;
}

/** 获取书籍的所有真相文件 */
export async function fetchTruthFiles(bookId: string): Promise<TruthFileData> {
  const files = ["world", "characters", "rules", "outline"];
  const result: Record<string, string> = {};
  for (const file of files) {
    try {
      const data = await fetchTruthFile(bookId, file);
      if (data.content) result[file] = data.content;
    } catch {
      // 文件不存在时跳过
    }
  }
  return result as TruthFileData;
}

/** 更新真相文件 */
export async function updateTruthFile(bookId: string, file: string, content: string): Promise<void> {
  await fetchJson(`/books/${encodeURIComponent(bookId)}/truth/${file}`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

/* ── 导入功能 ── */

/** 从文件导入章节 */
export async function importChapters(file: File): Promise<{ success: boolean; message: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE}/import/chapters`, {
    method: "POST",
    credentials: CREDENTIALS,
    // 只带身份头，不设 Content-Type —— multipart 的 boundary 要交给浏览器生成。
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) {
    throw new ApiError(res.status, "导入失败");
  }
  return res.json();
}

/** 导入设定 */
export async function importCanon(params: { title: string; author?: string }): Promise<{ success: boolean; message: string }> {
  return fetchJson("/import/canon", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** 导入同人 */
export async function importFanfic(params: { title: string; author?: string }): Promise<{ success: boolean; message: string }> {
  return fetchJson("/import/fanfic", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/* ══════════════════════════════════════════════════════════════════
   仿真剧场 API

   ⚠️ 剧场的**主数据没有专属接口**，也不该有：每一场仿真、逐轮发言、参与
   角色全部来自已有通道（fetchBook → fetchSession 的 tianyan_dialogue 轮次
   + SSE session:message + fetchGraphAgents 画像），前端 lib/sim-theater.ts
   现算成群聊。这里只有后端独有的两件事：自建群、群内留痕。
   ══════════════════════════════════════════════════════════════════ */

/** 用户自建的群（自动群是仿真轮次的派生视图，不入库）。 */
export interface TheaterGroupDto {
  readonly id: string;
  readonly title: string;
  readonly memberNames: ReadonlyArray<string>;
  readonly stage: string;
  readonly chapter: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 群内留痕：导演发言与剧场回话。 */
export interface TheaterMessageDto {
  readonly id: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly kind: "user" | "system";
  readonly content: string;
  readonly userMode?: string;
  readonly mentions?: ReadonlyArray<string>;
  readonly createdAt: number;
}

export async function fetchTheaterGroups(bookId: string): Promise<{
  readonly groups: ReadonlyArray<TheaterGroupDto>;
  readonly messages: Readonly<Record<string, ReadonlyArray<TheaterMessageDto>>>;
}> {
  return fetchJson(`/books/${encodeURIComponent(bookId)}/theater/groups`);
}

export async function createTheaterGroup(bookId: string, params: {
  readonly title: string;
  readonly memberNames: ReadonlyArray<string>;
  readonly stage: string;
  readonly chapter: number | null;
}): Promise<{ readonly group: TheaterGroupDto }> {
  return fetchJson(`/books/${encodeURIComponent(bookId)}/theater/groups`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function deleteTheaterGroup(bookId: string, groupId: string): Promise<void> {
  await fetchJson(
    `/books/${encodeURIComponent(bookId)}/theater/groups/${encodeURIComponent(groupId)}`,
    { method: "DELETE" },
  );
}

/** 群内留痕。**只存不生成**——自动群里影响剧情走的是 callAgent（同引导模式那条通道）。 */
export async function appendTheaterMessage(bookId: string, groupId: string, params: {
  readonly content: string;
  readonly senderId?: string;
  readonly senderName?: string;
  readonly kind?: "user" | "system";
  readonly userMode?: string;
  readonly mentions?: ReadonlyArray<string>;
}): Promise<{ readonly message: TheaterMessageDto }> {
  return fetchJson(
    `/books/${encodeURIComponent(bookId)}/theater/groups/${encodeURIComponent(groupId)}/messages`,
    { method: "POST", body: JSON.stringify(params) },
  );
}

/**
 * 让自建群里该接话的角色开口。
 *
 * ⚠️ 只给**用户自建的群/私聊**用。自动群里的发言是天衍推演的真实产物，
 * 不该由这条凭空补。生成期间后端会逐条广播 `theater:message`，
 * 前端一条条渲染；本函数返回的是全部结果（兜底/对账用）。
 */
export async function requestTheaterReplies(bookId: string, groupId: string, params: {
  readonly content: string;
  readonly memberNames: ReadonlyArray<string>;
  readonly groupName: string;
  readonly userMode: string;
  readonly mentions?: ReadonlyArray<string>;
  readonly max?: number;
}): Promise<{ readonly replies: ReadonlyArray<{ name: string; content: string; reason: string }> }> {
  return fetchJson(
    `/books/${encodeURIComponent(bookId)}/theater/groups/${encodeURIComponent(groupId)}/reply`,
    { method: "POST", body: JSON.stringify(params) },
  );
}

/* ══════════════════════════════════════════════════════════════════
   用户创作智能体（每个账号一个化身，可参与任何书的创作）
   后端：packages/studio/src/api/user-agent.ts
   ══════════════════════════════════════════════════════════════════ */

export interface UserAgentCard {
  readonly name: string;
  /** @句柄。 */
  readonly username: string;
  readonly bio: string;
  readonly persona: string;
  /** 剧情引导风格。 */
  readonly style: string;
  /** 仿真剧情参与度 0-100。 */
  readonly plotParticipation: number;
  readonly enabled: boolean;
  readonly owner: string;
  readonly updatedAt: string;
}

/**
 * 未登录返回 null（不是错误：没登录就用默认头像，聊天照常）。
 * 后端包了一层 `{ agent }` —— 之前这里当裸对象解析，拿到的永远是 undefined。
 */
export async function fetchUserAgent(): Promise<UserAgentCard | null> {
  try {
    const d = await fetchJson<{ agent: UserAgentCard }>("/user-agent");
    return d.agent ?? null;
  } catch {
    return null;
  }
}

/** 把我的智能体挂进某本书 / 取消参与（`agent_book` 的 user-agent 绑定）。 */
export async function joinBookWithUserAgent(bookId: string): Promise<void> {
  await fetchJson(`/books/${encodeURIComponent(bookId)}/user-agent`, { method: "POST" });
}

export async function leaveBookWithUserAgent(bookId: string): Promise<void> {
  await fetchJson(`/books/${encodeURIComponent(bookId)}/user-agent`, { method: "DELETE" });
}

/* ══════════════════════════════════════════════════════════════════
   群聊分享
   ══════════════════════════════════════════════════════════════════ */

export interface TheaterShare {
  readonly token: string;
  /** 完整可分享的地址（前端页面 /share/<token>）。 */
  readonly url: string;
  readonly createdAt: number;
}

/** 生成（或复用）这个群的分享链接。 */
export async function createTheaterShare(
  bookId: string,
  groupId: string,
  payload: {
    readonly title: string;
    readonly memberNames: ReadonlyArray<string>;
    readonly messages: ReadonlyArray<{
      senderId: string; senderName: string; kind: string; content: string; round: number; ts: number;
    }>;
  },
): Promise<TheaterShare> {
  const d = await fetchJson<{ share: Omit<TheaterShare, "url"> }>(
    `/books/${encodeURIComponent(bookId)}/theater/groups/${encodeURIComponent(groupId)}/share`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return { ...d.share, url: `${window.location.origin}/share/${d.share.token}` };
}

/** 分享页读取（公开，不需要登录）。 */
export interface SharedTheaterGroup {
  readonly title: string;
  readonly bookTitle: string;
  readonly memberNames: ReadonlyArray<string>;
  readonly messages: ReadonlyArray<{
    senderId: string; senderName: string; kind: string; content: string; round: number; ts: number;
  }>;
  readonly createdAt: number;
}

export async function fetchSharedTheater(token: string): Promise<SharedTheaterGroup> {
  const d = await fetchJson<{ group: SharedTheaterGroup }>(`/share/theater/${encodeURIComponent(token)}`);
  return d.group;
}

/** 影游分享：分享的是**一条路线**，带整张图 —— 对方能自己重玩。 */
export interface SharedFilm {
  readonly kind: "film";
  readonly filmId: string;
  readonly title: string;
  /** StoryGraph（形状见 lib/story-play.ts）。 */
  readonly graph: unknown;
  readonly steps: ReadonlyArray<{
    readonly nodeId: string; readonly choiceId: string; readonly choiceText: string;
  }>;
  readonly endingId: string;
  readonly createdAt: number;
}

export type SharedContent =
  | ({ readonly kind: "theater" } & SharedTheaterGroup)
  | SharedFilm;

/**
 * 通用分享读取（公开，不需要登录）。
 * 一个 URL 空间放两种分享，靠 `kind` 分流 —— 用户不用记两种链接。
 */
export async function fetchShared(token: string): Promise<SharedContent> {
  const d = await fetchJson<{ share: SharedContent }>(`/share/${encodeURIComponent(token)}`);
  return d.share;
}

/** 把当前这条路线分享出去。每次生成新 token —— 不同的路线是不同的东西。 */
export async function createFilmShare(filmId: string, params: {
  readonly steps: ReadonlyArray<{ nodeId: string; choiceId: string; choiceText: string }>;
  readonly endingId?: string;
}): Promise<{ readonly token: string; readonly url: string }> {
  const d = await fetchJson<{ share: { token: string } }>(
    `/films/${encodeURIComponent(filmId)}/share`,
    { method: "POST", body: JSON.stringify(params) },
  );
  return { token: d.share.token, url: `${window.location.origin}/share/${d.share.token}` };
}

/* ══════════════════════════════════════════════════════════════════
   剧场聊天（PG）—— 一次查询拿全部群聊

   替代原来那套「fetchBook 拿会话列表 → 逐个 fetchSession 抓几十个 jsonl →
   在浏览器里现算」。实测首屏 5~7 秒 → 27 毫秒。
   ══════════════════════════════════════════════════════════════════ */

export interface ChatSessionDto {
  readonly id: number;
  readonly bookId: string;
  readonly uid: string;
  readonly kind: "round" | "custom" | "direct";
  readonly title: string;
  readonly stage: string;
  readonly chapter: number | null;
  readonly runId: string;
  readonly members: ReadonlyArray<{ readonly ref: string; readonly speeches: number }>;
  readonly messageCount: number;
  readonly roundCount?: number;
  readonly lastMessage: string | null;
  readonly lastSeq: number;
  readonly unread: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatMessageDto {
  readonly id: number;
  readonly seq: number;
  readonly senderKind: "agent" | "user" | "system";
  readonly senderRef: string;
  readonly senderName: string;
  readonly content: string;
  readonly action: string;
  readonly round: number | null;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export async function fetchChatSessions(bookId: string, userId = ""): Promise<ReadonlyArray<ChatSessionDto>> {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const d = await fetchJson<{ sessions: ReadonlyArray<ChatSessionDto> }>(
    `/books/${encodeURIComponent(bookId)}/theater/sessions${q}`,
  );
  return d.sessions ?? [];
}

/** `afterSeq` 用于增量拉：直播只取新的那几条。 */
export async function fetchChatMessages(
  bookId: string,
  uid: string,
  options?: { readonly afterSeq?: number; readonly limit?: number },
): Promise<ReadonlyArray<ChatMessageDto>> {
  const q = new URLSearchParams();
  if (options?.afterSeq) q.set("afterSeq", String(options.afterSeq));
  if (options?.limit) q.set("limit", String(options.limit));
  const d = await fetchJson<{ messages: ReadonlyArray<ChatMessageDto> }>(
    `/books/${encodeURIComponent(bookId)}/theater/sessions/${encodeURIComponent(uid)}/messages`
    + (q.toString() ? `?${q}` : ""),
  );
  return d.messages ?? [];
}

export async function createChatGroup(bookId: string, params: {
  readonly title?: string;
  readonly memberNames: ReadonlyArray<string>;
  readonly stage?: string;
  readonly chapter?: number | null;
}): Promise<ChatSessionDto> {
  const d = await fetchJson<{ session: ChatSessionDto }>(
    `/books/${encodeURIComponent(bookId)}/theater/chat-groups`,
    { method: "POST", body: JSON.stringify(params) },
  );
  return d.session;
}

export async function postChatMessage(bookId: string, uid: string, params: {
  readonly content: string;
  readonly senderKind?: "agent" | "user" | "system";
  readonly senderName?: string;
  readonly senderRef?: string;
  readonly meta?: Record<string, unknown>;
}): Promise<ChatMessageDto> {
  const d = await fetchJson<{ message: ChatMessageDto }>(
    `/books/${encodeURIComponent(bookId)}/theater/sessions/${encodeURIComponent(uid)}/chat`,
    { method: "POST", body: JSON.stringify(params) },
  );
  return d.message;
}

export async function markChatSessionRead(
  bookId: string, uid: string, userId: string, seq: number,
): Promise<void> {
  await fetchJson(
    `/books/${encodeURIComponent(bookId)}/theater/sessions/${encodeURIComponent(uid)}/read`,
    { method: "POST", body: JSON.stringify({ userId, seq }) },
  );
}

/* ══════════════════════════════════════════════════════════════════
   互动影游（四种模式之一）

   分支图本身的形状在 lib/story-play.ts（后端 graph-schema 的镜像）。
   ══════════════════════════════════════════════════════════════════ */

export interface FilmSummary {
  readonly id: string;
  readonly title: string;
  readonly nodes: number;
  readonly endings: number;
  /** 能走通的路径条数（图过大时后端会截断，见 pathsTruncated）。 */
  readonly paths: number;
  readonly pathsTruncated: boolean;
  readonly updatedAt: number;
}

export async function fetchFilms(): Promise<ReadonlyArray<FilmSummary>> {
  const d = await fetchJson<{ films: ReadonlyArray<FilmSummary> }>("/films");
  return d.films ?? [];
}

/** 从一句前提生成一部影游。生成只保证结构，内容质量靠后续迭代。 */
export async function createFilm(params: {
  readonly title?: string;
  readonly premise: string;
}): Promise<FilmSummary> {
  const d = await fetchJson<{ film: FilmSummary }>("/films", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return d.film;
}

/** 读分支图。返回体就是 StoryGraph（见 lib/story-play.ts）。 */
export async function fetchStoryGraph(projectId: string): Promise<unknown> {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/story-graph`);
}

/**
 * 改一个节点（Phase 6.2d）。走后端已有的 delta 接口 —— 它是 upsert/remove
 * 语义，**只提交改动的那个节点**，不整图覆盖；两个人同时编不会互相抹掉。
 */
export async function upsertFilmNode(projectId: string, node: unknown): Promise<unknown> {
  const d = await fetchJson<{ rev: number; graph: unknown }>(
    `/projects/${encodeURIComponent(projectId)}/story-graph/delta`,
    { method: "POST", body: JSON.stringify({ delta: { nodes: { upsert: [node], remove: [] } } }) },
  );
  return d.graph;
}

/**
 * 给一个节点生成配图。诊断面板的 `IMAGE_MISSING` 指的就是这个 ——
 * 报了问题却修不了，等于没报。
 */
export async function generateFilmNodeImage(projectId: string, nodeId: string): Promise<string> {
  const d = await fetchJson<{ assetRef: string }>(
    `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/image`,
    { method: "POST" },
  );
  return d.assetRef;
}

/* ── 影游诊断与导出（Phase 6：从老 studio 迁过来） ── */

export interface FilmIssue {
  /** DEAD_END / BROKEN_LINK / UNREACHABLE / VARIABLE_UNUSED / GATED_UNREACHABLE … */
  readonly code: string;
  readonly level: "error" | "warning" | "info";
  readonly message: string;
  readonly nodeIds: ReadonlyArray<string>;
}

export interface FilmAnalysis {
  readonly report: { readonly ok: boolean; readonly issues: ReadonlyArray<FilmIssue> };
  /** 每条路径的情绪曲线（图太大时 truncated）。 */
  readonly arcs: {
    readonly arcs: ReadonlyArray<{
      readonly endingId: string | null;
      readonly points: ReadonlyArray<{ readonly nodeId: string; readonly score: number }>;
    }>;
    readonly truncated: boolean;
  };
  readonly distribution: {
    readonly total: number;
    readonly truncated: boolean;
    /** 结局 id → 有多少条路通向它。`(dead-end)` 是走不到结局的那些。 */
    readonly byEnding: Readonly<Record<string, number>>;
    readonly lengthHistogram: Readonly<Record<string, number>>;
  };
}

export async function fetchFilmAnalysis(projectId: string): Promise<FilmAnalysis> {
  return fetchJson(`/projects/${encodeURIComponent(projectId)}/story-graph/analysis`);
}

/** 导出地址。后端直接返回带 Content-Disposition 的文件流，让浏览器自己下。 */
export function filmExportUrl(projectId: string, format: "json" | "ink" | "html"): string {
  return `${BASE}/projects/${encodeURIComponent(projectId)}/export/${format}`;
}

export async function adoptLegacyBook(bookId: string, model?: { service: string; model: string }): Promise<void> {
  await fetchJson(`/books/${encodeURIComponent(bookId)}/creation-loop/adopt`, { method: "POST", body: JSON.stringify(model ?? {}) });
}
export async function cancelQueuedAgentJob(jobId: string): Promise<boolean> {
  const result = await fetchJson<{ cancelled: boolean }>(`/agent/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  return result.cancelled;
}

export function fetchCreationPreview(bookId: string, stepId?: string): Promise<{activity: import("./creation-activity").CreationActivity | null; preview: import("./creation-preview").CreationPreview | null; outline: import("./creation-preview").OutlinePreview | null}> {
  return fetchJson(`/books/${encodeURIComponent(bookId)}/creation-preview${stepId ? `?stepId=${encodeURIComponent(stepId)}` : ""}`);
}
