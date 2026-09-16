import { syncChatMessages } from "../lib/workbench-sync";
import type { ChatMessageDto } from "../lib/api";
/**
 * useSimulationTheater —— 仿真剧场的全部状态。
 *
 * **这里没有一条假数据。** 群聊、成员、消息、正文全部来自后端已经在跑的东西：
 *
 *   天衍仿真引擎每轮推演
 *     → 后端 pushSimulationRound 写成 tianyan_dialogue 会话消息
 *     → SSE `session:message` 实时推 + `fetchSession` 历史回填
 *     → 后端按 chat_session 分场，前端直接读（见 lib/sim-feed 的 runsFromChat）
 *     → buildTheaterSessions 翻译成「一个个群聊」
 *
 * 正文来自六步编排快照与已落盘的章节；导演发言走 `/agent`（和引导模式同一条
 * 通道，只是带上群聊上下文），闸门决策走 `reviewLoopStep`——**没有另起一套
 * 后端**，剧场只是同一批数据的另一种看法。
 */
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  AgentEventSource, callAgent, fetchBook, fetchChapter,
  fetchGraphAgents, fetchLoopState, reviewLoopStep,
  createTheaterGroup, appendTheaterMessage, requestTheaterReplies,
  type AgentEvent, type GraphAgent, type ChapterSummary,
} from "../lib/api";
import {
  fetchChatSessions, fetchChatMessages, markChatSessionRead,
  type ChatSessionDto,
} from "../lib/api";
import {
  sessionsFromChat, messageOfDto, makeUserSession, directorMessage, parseMentions,
  type TheaterSession, type TheaterMessage,
} from "../lib/sim-theater";
import {
  chapterNumberOf, stepTypeOf, isLoopRunning, isAwaitingReview,
  CREATION_STEP_LABELS_ZH,
  type WorkflowSnapshot, type CreationLoopStepType,
} from "../types/creation-loop";
import type { UserMode } from "../types/simulation";

/* ── 对外状态 ── */

export interface TheaterOutput {
  readonly chapterNumber: number | null;
  readonly title: string;
  readonly content: string;
  readonly isStreaming: boolean;
}

export interface TheaterSimState {
  /** 编排在跑（= 仿真在推演）。 */
  readonly isRunning: boolean;
  /** 停在闸门等人确认。 */
  readonly awaitingReview: boolean;
  /** 已经跑过的仿真轮次总数（真实轮数，不是预估）。 */
  readonly totalRounds: number;
  /** 已经开过几场（= 几个自动群）。 */
  readonly totalRuns: number;
  readonly currentStep: CreationLoopStepType | null;
  readonly currentStepLabel: string;
  readonly currentChapter: number | null;
  /** 这本书到底有没有推演产物（没有就别装作有）。 */
  readonly hasSimulation: boolean;
}

/** 闸门 = 真实的剧情决策点：过还是打回重铸，直接改后续剧情。 */
export interface TheaterGate {
  readonly loopId: string;
  readonly stepId: string;
  readonly stepLabel: string;
  readonly chapter: number | null;
}

const EMPTY_OUTPUT: TheaterOutput = {
  chapterNumber: null, title: "", content: "", isStreaming: false,
};

/**
 * @param sessionId 宿主已经开好的书会话（导演发言、闸门决策都走它）。
 *   **不要在这里另开会话**：宿主页面已经开了一个，这里再开一个的话
 *   每次进页面就多两个空会话（本书的会话列表会越滚越长）。
 */
export function useSimulationTheater(bookId: string, sessionId: string | null) {
  /** 未读按人算。多用户上线前用固定 key —— 比按会话算更接近最终形态。 */
  const userKey = "me";
  const [connected, setConnected] = useState(false);
  const chatCache = useRef<Record<string, ReadonlyArray<ChatMessageDto>>>({});
  /* ── 原始真相（全部来自后端 chat_* 表） ── */
  const [chatSessions, setChatSessions] = useState<ReadonlyArray<ChatSessionDto>>([]);
  /** 已拉过消息的群：uid → 消息。列表只带摘要，消息按需拉。 */
  const [messagesByUid, setMessagesByUid] = useState<Record<string, ReadonlyArray<TheaterMessage>>>({});
  const [agents, setAgents] = useState<ReadonlyArray<GraphAgent>>([]);
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [loopId, setLoopId] = useState<string | null>(null);
  const [hasSimulation, setHasSimulation] = useState(false);
  const [chapters, setChapters] = useState<ReadonlyArray<ChapterSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── 用户侧 ── */
  /** 用户拉的群 / 私聊（本地会话，不写死进仿真流）。 */
  const [userSessions, setUserSessions] = useState<ReadonlyArray<TheaterSession>>([]);
  /** 导演发言与智能体回话（按会话 id 分片）。 */
  const [userMessages, setUserMessages] = useState<Record<string, ReadonlyArray<TheaterMessage>>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [userMode, setUserMode] = useState<UserMode>("observe");
  const [sending, setSending] = useState(false);
  /**
   * 正在开口的角色和他已经说出来的半句（按会话）。
   *
   * **不是真相**：只服务于观感，落盘那条一到就丢掉。真要留存的内容永远来自
   * `theater:message` / 后端接口，不能拿这里拼出来的文本当数据。
   */
  const [typing, setTyping] = useState<Record<string, { readonly name: string; readonly text: string }>>({});
  /**
   * 此刻在看这本书的人（含自己）。
   *
   * 来自活着的 SSE 连接，不是一张表：断线就不在名单里了，不需要心跳和 TTL，
   * 也不会出现「名单说他在、其实浏览器早关了」。
   */
  const [spectators, setSpectators] = useState<ReadonlyArray<{ readonly userId: string; readonly name: string }>>([]);

  const [output, setOutput] = useState<TheaterOutput>(EMPTY_OUTPUT);

  /* ── 名册 + 快照轮询 ── */
  useEffect(() => {
    if (!bookId) { setLoading(false); return; }
    let cancelled = false;
    void fetchGraphAgents({ graphId: bookId, limit: 300 })
      .then((list) => { if (!cancelled) setAgents(list); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [bookId]);

  const refreshLoop = useCallback(async () => {
    if (!bookId) return;
    const st = await fetchLoopState(bookId);
    setSnapshot(st.snapshot);
    setLoopId(st.loopId);
    setHasSimulation(st.hasSimulation);
  }, [bookId]);

  useEffect(() => {
    if (!bookId || connected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (!document.hidden) await refreshLoop();
      } catch {
        // 轮询失败不打断剧场：下一拍再试。
      }
      if (!cancelled) timer = setTimeout(() => void tick(), 15_000 + Math.random()*5000);
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bookId, refreshLoop, connected]);

  /* ── 群聊列表：一次查询（Phase 2.5） ── */
  const reloadSessions = useCallback(async () => {
    if (!bookId) return;
    const list = await fetchChatSessions(bookId, userKey);
    setChatSessions(list);
  }, [bookId, userKey]);

  useEffect(() => {
    if (!bookId) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      try {
        // 章节列表给右栏正文用；群聊一次查询就够（原来要抓几十个会话文件）。
        const [detail] = await Promise.all([
          fetchBook(bookId).catch(() => null),
          reloadSessions(),
        ]);
        if (cancelled) return;
        if (detail) setChapters(detail.chapters ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载群聊失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId, reloadSessions]);

  /* ── 直播：SSE 推来的新轮次 ── */
  useEffect(() => {
    if (!bookId) return;
    const handle = (event: AgentEvent) => {
      const d = (event.data ?? {}) as Record<string, unknown>;
      switch (event.type) {
        case "chat:round": {
          /*
           * 仿真推了新一轮。消息本身已经在 chat_message 里了，这里只刷列表
           * （新的群 / 新的最后一句 / 未读数）。
           */
          if (typeof d.bookId === "string" && d.bookId !== bookId) break;
          void reloadSessions().catch(() => undefined);
          break;
        }
        /* ── 逐字流：三段合起来是「他正在打字」 ── */
        case "theater:spectators": {
          if (typeof d.bookId === "string" && d.bookId !== bookId) break;
          const list = Array.isArray(d.spectators) ? d.spectators : [];
          setSpectators(list
            .filter((x): x is { userId: string; name: string } =>
              !!x && typeof x === "object"
              && typeof (x as { userId?: unknown }).userId === "string"
              && typeof (x as { name?: unknown }).name === "string")
            .map((x) => ({ userId: x.userId, name: x.name })));
          break;
        }
        case "theater:speaking": {
          if (typeof d.bookId === "string" && d.bookId !== bookId) break;
          const gid = typeof d.groupId === "string" ? d.groupId : "";
          const name = typeof d.name === "string" ? d.name : "";
          if (!gid || !name) break;
          setTyping((prev) => ({ ...prev, [gid]: { name, text: "" } }));
          break;
        }
        case "theater:delta": {
          if (typeof d.bookId === "string" && d.bookId !== bookId) break;
          const gid = typeof d.groupId === "string" ? d.groupId : "";
          const name = typeof d.name === "string" ? d.name : "";
          const text = typeof d.text === "string" ? d.text : "";
          if (!gid || !name || !text) break;
          setTyping((prev) => {
            const cur = prev[gid];
            // 换人了就重开一段，别把两个人的话拼在一起。
            return { ...prev, [gid]: cur?.name === name ? { name, text: cur.text + text } : { name, text } };
          });
          break;
        }
        case "theater:speaking-end": {
          if (typeof d.bookId === "string" && d.bookId !== bookId) break;
          const gid = typeof d.groupId === "string" ? d.groupId : "";
          if (!gid) break;
          setTyping((prev) => {
            if (!prev[gid]) return prev;
            const next = { ...prev };
            delete next[gid];
            return next;
          });
          break;
        }
        case "theater:message": {
          // 自建群里角色一条条开口（后端边生成边推）。
          if (typeof d.bookId === "string" && d.bookId !== bookId) break;
          const gid = typeof d.groupId === "string" ? d.groupId : "";
          const m = d.message as Record<string, unknown> | undefined;
          if (!gid || !m || typeof m.content !== "string") break;
          const msg: TheaterMessage = {
            id: typeof m.id === "string" ? m.id : `live-${Date.now()}`,
            sessionId: gid,
            senderId: typeof m.senderId === "string" ? m.senderId : "system",
            senderName: typeof m.senderName === "string" ? m.senderName : "",
            kind: m.kind === "user" ? "user" : m.kind === "system" ? "system" : "agent",
            action: "",
            content: m.content,
            round: -1,
            ts: typeof m.createdAt === "number" ? m.createdAt : Date.now(),
          };
          setUserMessages((prev) => {
            const list = prev[gid] ?? [];
            // SSE 与 HTTP 返回可能都到：按 id 去重。
            if (list.some((x) => x.id === msg.id)) return prev;
            return { ...prev, [gid]: [...list, msg] };
          });
          /*
           * 落盘的那条到了，临时气泡就该撤。
           *
           * 只撤同一个人的：串行生成时下一位可能已经开口，那条 speaking 比
           * 这条 message 先到，无条件清会把新的一段也抹掉。
           */
          setTyping((prev) => {
            const cur = prev[gid];
            if (!cur || cur.name !== msg.senderName) return prev;
            const next = { ...prev };
            delete next[gid];
            return next;
          });
          break;
        }
        case "creation-loop:reviewed":
        case "book:created":
        case "stream:resync":
          void refreshLoop().catch(() => undefined);
          break;
        case "draft:delta": {
          // 正文在写：右侧面板跟着流。
          const text = typeof d.text === "string" ? d.text : "";
          if (text) setOutput((p) => ({ ...p, content: p.content + text, isStreaming: true }));
          break;
        }
        case "draft:complete":
        case "agent:complete":
          setOutput((p) => (p.isStreaming ? { ...p, isStreaming: false } : p));
          break;
      }
    };
    // 带上 book：服务端据此校验围观资格，之后同一本书的剧场流会一起推过来。
    const src = new AgentEventSource(handle, undefined, { watchBookId: bookId, pauseWhenHidden: true, onConnectionChange: (state) => { setConnected(state === "connected"); if (state === "connected") { void refreshLoop(); void reloadSessions(); } } });
    src.connect();
    return () => src.disconnect();
  }, [bookId, refreshLoop]);

  /* ── 派生：后端 DTO → 界面群聊 ── */
  const running = isLoopRunning(snapshot?.status);
  /** 正在推演的那一场 = 最近更新的自动群（列表按 updated_at 倒序）。 */
  const liveSessionId = running
    ? chatSessions.find((x) => x.kind === "round")?.uid ?? null
    : null;

  const roundSessions = useMemo(
    () => sessionsFromChat(chatSessions, agents, { liveUid: liveSessionId }),
    [chatSessions, agents, liveSessionId],
  );

  /**
   * 自建群排在自动群前面（用户自己拉的群优先看到）。
   *
   * 自建群的「最后一句」不在 session 里，它在 userMessages ——列表要显示最后
   * 说了什么，就得在这儿并进去，否则聊完了左栏还写着「还没有人说话」。
   */
  const sessions = useMemo<ReadonlyArray<TheaterSession>>(() => {
    const withLast = userSessions.map((s) => {
      const list = userMessages[s.id];
      const last = list?.[list.length - 1];
      if (!last) return s;
      const who = last.kind === "user" ? "我" : last.senderName;
      return { ...s, lastMessage: `${who}：${last.content}`, updatedAt: last.ts };
    });
    return [...withLast, ...roundSessions];
  }, [userSessions, userMessages, roundSessions]);

  /** 默认落在最新那个群上（用户没点过别的的话）。 */
  useEffect(() => {
    if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) return;
    const first = sessions[0];
    if (first) setActiveSessionId(first.id);
  }, [sessions, activeSessionId]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const activeChatLastSeq = chatSessions.find((session) => session.uid === activeSessionId)?.lastSeq;
  /*
   * 当前群的消息按需拉。
   *
   * 列表接口只带摘要（最后一句 / 条数 / 未读），不带全部消息 —— 一本书几千条
   * 消息全塞进列表响应里，首屏又会变慢，那就白迁了。切到哪个群才拉哪个群，
   * 并且顺手把已读推进到最新一条。
   */
  useEffect(() => {
    if (!bookId || !activeSessionId) return;
    // 本地新建、还没落库的群（id 形如 `user:<ts>` 且不在后端列表里）没有消息可拉
    if (activeChatLastSeq === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const msgs = await syncChatMessages(bookId, { uid:activeSessionId, lastSeq:activeChatLastSeq }, chatCache.current[activeSessionId] ?? []);
        chatCache.current[activeSessionId] = msgs;
        if (cancelled) return;
        setMessagesByUid((prev) => ({
          ...prev,
          [activeSessionId]: msgs.map((m) => messageOfDto(m, activeSessionId)),
        }));
        const lastSeq = msgs[msgs.length - 1]?.seq ?? 0;
        if (lastSeq > 0) {
          await markChatSessionRead(bookId, activeSessionId, userKey, lastSeq).catch(() => undefined);
          // 未读数在列表里，标记完要刷一次才不会一直挂着红点
          void reloadSessions().catch(() => undefined);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "历史消息暂时读取失败，请重试");
      }
    })();
    return () => { cancelled = true; };
  }, [bookId, activeSessionId, activeChatLastSeq, reloadSessions, userKey]);

  /** 当前群的消息 = 后端拉的 + 本地刚发出去还没回流的，按时间合流。 */
  const activeMessages = useMemo<ReadonlyArray<TheaterMessage>>(() => {
    if (!activeSession) return [];
    const fromDb = messagesByUid[activeSession.id] ?? [];
    const extra = userMessages[activeSession.id] ?? [];
    if (extra.length === 0) return fromDb;
    // 已经回流的（内容+发送者相同）不重复显示
    const known = new Set(fromDb.map((m) => `${m.senderId}\u0000${m.content}`));
    const pending = extra.filter((m) => !known.has(`${m.senderId}\u0000${m.content}`));
    return [...fromDb, ...pending].sort((a, b) => a.ts - b.ts);
  }, [activeSession, messagesByUid, userMessages]);

  /* ── 仿真状态 ── */
  const currentStepId = snapshot?.currentStepId ?? null;
  const currentStep = currentStepId ? stepTypeOf(currentStepId) : null;
  const currentChapter = currentStepId ? chapterNumberOf(currentStepId) : null;

  const simState: TheaterSimState = {
    isRunning: running,
    awaitingReview: isAwaitingReview(snapshot?.status),
    // 「几场几轮」：场 = 自动群数，轮 = 全部消息数（后端已算好，不用前端再数）
    totalRounds: chatSessions.filter((x) => x.kind === "round").reduce((n, x) => n + (x.roundCount ?? 0), 0),
    totalRuns: chatSessions.filter((x) => x.kind === "round").length,
    currentStep: currentStep && currentStep !== "anchor" ? currentStep : null,
    currentStepLabel: currentStep && currentStep !== "anchor"
      ? CREATION_STEP_LABELS_ZH[currentStep]
      : currentStepId ?? "",
    currentChapter,
    hasSimulation,
  };

  /* ── 闸门 = 真实决策点 ── */
  const gate = useMemo<TheaterGate | null>(() => {
    if (!snapshot || !loopId || !isAwaitingReview(snapshot.status)) return null;
    const step = snapshot.steps.find((s) => s.status === "awaiting_review")
      ?? snapshot.steps.find((s) => s.id === snapshot.currentStepId);
    if (!step) return null;
    const type = stepTypeOf(step.id);
    return {
      loopId,
      stepId: step.id,
      stepLabel: type && type !== "anchor" ? CREATION_STEP_LABELS_ZH[type] : step.id,
      chapter: chapterNumberOf(step.id),
    };
  }, [snapshot, loopId]);

  /* ── 右侧正文：当前群对应的那一章 ── */
  const outputChapter = activeSession?.chapter ?? currentChapter ?? chapters[chapters.length - 1]?.number ?? null;

  useEffect(() => {
    if (!bookId || outputChapter === null) { setOutput(EMPTY_OUTPUT); return; }
    let cancelled = false;
    void fetchChapter(bookId, outputChapter)
      .then((ch) => {
        if (cancelled) return;
        setOutput({
          chapterNumber: outputChapter,
          title: ch.title ?? `第 ${outputChapter} 章`,
          content: ch.content ?? "",
          isStreaming: false,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setOutput({
            chapterNumber: outputChapter,
            title: `第 ${outputChapter} 章`,
            content: "",
            isStreaming: false,
          });
        }
      });
    return () => { cancelled = true; };
  }, [bookId, outputChapter]);

  /* ── 会话操作 ── */
  const selectSession = useCallback((id: string) => setActiveSessionId(id), []);

  const createGroupSession = useCallback((memberNames: ReadonlyArray<string>, title?: string) => {
    const now = Date.now();
    const stage = currentStep && currentStep !== "anchor" ? currentStep : "outline";
    // 先本地建好（点了就能进群，不等一个来回），再落盘；落盘拿到真 id 后换掉。
    const local = makeUserSession({
      id: `user:${now}`,
      memberNames,
      agents,
      ...(title ? { title } : {}),
      stage,
      chapter: currentChapter,
      now,
    });
    setUserSessions((prev) => [local, ...prev]);
    setActiveSessionId(local.id);
    // 自己拉的群里「围观」没有意义——是你把人叫来的，默认就能说话。
    setUserMode((m) => (m === "observe" ? "participate" : m));
    if (bookId) {
      void createTheaterGroup(bookId, {
        title: local.name, memberNames, stage, chapter: currentChapter,
      })
        .then(({ group }) => {
          setUserSessions((prev) => prev.map((s) => (s.id === local.id ? { ...s, id: group.id } : s)));
          setUserMessages((prev) => {
            const moved = prev[local.id];
            if (!moved) return prev;
            const next = { ...prev, [group.id]: moved };
            delete next[local.id];
            return next;
          });
          setActiveSessionId((cur) => (cur === local.id ? group.id : cur));
        })
        .catch(() => setError("群没能保存，刷新后会丢"));
    }
    return local;
  }, [agents, currentStep, currentChapter, bookId]);

  /** 点左侧角色 → 和他单独说话。已经有私聊就跳过去，不重复建。 */
  const openDirectSession = useCallback((agentName: string) => {
    const existing = userSessions.find((s) => s.kind === "direct" && s.members[0]?.id === agentName);
    if (existing) {
      setActiveSessionId(existing.id);
      setUserMode((m) => (m === "observe" ? "participate" : m));
      return existing;
    }
    return createGroupSession([agentName]);
  }, [userSessions, createGroupSession]);

  /* ── 导演发言 ── */
  const send = useCallback(async (content: string) => {
    const text = content.trim();
    if (!text || !activeSession || userMode === "observe") return;
    const now = Date.now();
    const mine = directorMessage(activeSession.id, text, now);
    setUserMessages((prev) => ({
      ...prev,
      [activeSession.id]: [...(prev[activeSession.id] ?? []), mine],
    }));

    const mentioned = parseMentions(text, activeSession.members);

    // 留痕先落盘：哪怕生成失败，导演说过的话也还在群里。
    if (bookId) {
      void appendTheaterMessage(bookId, activeSession.id, {
        content: text,
        kind: "user",
        userMode,
        ...(mentioned.length > 0 ? { mentions: mentioned } : {}),
      }).catch(() => undefined);
    }

    setSending(true);
    try {
      /* ── 自建群 / 私聊：让角色各自开口 ──
       * 这里必须走 theater/reply：仿真引擎不知道这个群存在，不会为它推轮次，
       * 只能按画像逐个生成。回话由 SSE theater:message 一条条进群。 */
      if (activeSession.kind !== "round") {
        if (!bookId) return;
        await requestTheaterReplies(bookId, activeSession.id, {
          content: text,
          memberNames: activeSession.members.map((m) => m.id),
          groupName: activeSession.name,
          userMode,
          ...(mentioned.length > 0 ? { mentions: mentioned } : {}),
        });
        return;
      }

      /* ── 自动群：导演发言是对**创作链**说话 ──
       * 这一场的发言是天衍推演出来的，不该由前端补几句台词进去；导演说的话
       * 走 /agent（和引导模式同一条通道），影响的是后续生成。 */
      if (!sessionId) {
        setError("会话还没就绪，稍后再发");
        return;
      }
      const roster = activeSession.members.map((m) => m.name).join("、");
      const identity = userMode === "guide" ? "导演（指令）" : "导演（建议）";
      const directive = [
        `【仿真剧场 · ${activeSession.name}】`,
        `在场角色：${roster || "（暂无）"}`,
        mentioned.length > 0 ? `点名回应：${mentioned.join("、")}` : "",
        `${identity}：${text}`,
      ].filter(Boolean).join("\n");

      const res = await callAgent({
        instruction: directive,
        sessionId,
        activeBookId: bookId,
        sessionKind: "book",
      });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      const reply = (res.response ?? "").trim();
      if (!reply) return;
      if (bookId) {
        void appendTheaterMessage(bookId, activeSession.id, {
          content: reply, kind: "system", senderId: "system", senderName: "剧场",
        }).catch(() => undefined);
      }
      setUserMessages((prev) => ({
        ...prev,
        [activeSession.id]: [...(prev[activeSession.id] ?? []), {
          id: `reply-${Date.now()}`,
          sessionId: activeSession.id,
          senderId: "system",
          senderName: "剧场",
          kind: "system" as const,
          action: "",
          content: reply,
          round: -1,
          ts: Date.now(),
        }],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  }, [activeSession, userMode, sessionId, bookId]);

  /* ── 闸门决策 ── */
  const decideGate = useCallback(async (decision: "confirm" | "reject", feedback?: string) => {
    if (!gate || !sessionId || !bookId) return;
    setSending(true);
    try {
      await reviewLoopStep({
        sessionId,
        bookId,
        loopId: gate.loopId,
        stepId: gate.stepId,
        decision,
        ...(feedback ? { feedback } : {}),
      });
      await refreshLoop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "决策提交失败");
    } finally {
      setSending(false);
    }
  }, [gate, sessionId, bookId, refreshLoop]);

  /* ── 全书角色名册（左侧「角色」页签） ── */
  const roster = useMemo(() => {
    // 有画像的按剧情权重排；在群里发过言但还没画像的补在后面。
    const spoken = new Set<string>();
    for (const s of chatSessions) for (const m of s.members) spoken.add(m.ref);
    const known = new Set(agents.map((a) => a.name));
    const extras = [...spoken].filter((n) => !known.has(n));
    return { agents: [...agents].sort((a, b) => b.plotWeight - a.plotWeight), extras };
  }, [agents, chatSessions]);

  const clearError = useCallback(() => setError(null), []);

  /**
   * 刚生成完的画像就地写回名册。
   *
   * 不重新拉一遍 /graph/agents：那要几百条角色，为了一张图重来一次太贵，
   * 而且用户会看到列表闪一下。就地改一行，剧场里所有头像位（走画像索引）
   * 同一帧就换脸了。
   */
  const setAgentPortrait = useCallback((uid: string, url: string | null) => {
    setAgents((prev) => prev.map((a) => (a.uid === uid ? { ...a, portraitUrl: url } : a)));
  }, []);

  return {
    loading,
    error,
    clearError,
    simState,
    gate,
    sessions,
    liveSessionId,
    chapters,
    activeSession,
    activeSessionId,
    activeMessages,
    /** 当前会话里「谁正在说、说到哪了」。没人说话时是 null。 */
    activeTyping: activeSessionId ? typing[activeSessionId] ?? null : null,
    spectators,
    output,
    roster,
    userMode,
    sending,
    // 操作
    setAgentPortrait,
    setUserMode,
    selectSession,
    createGroupSession,
    openDirectSession,
    send,
    decideGate,
  };
}
