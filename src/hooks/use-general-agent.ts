import { useCallback, useEffect, useRef, useState } from "react";
import { AUTH_CHANGED_EVENT, readAuth } from "../lib/auth-storage";
import { ApiError } from "../lib/api";
import { cancelGeneralRun, fetchGeneralAttachments, fetchGeneralSnapshot, readGeneralEvents } from "../lib/general-agent-api";
import { confirmGeneralCancellation, emptyGeneralAgentState, hydrateGeneralSnapshot, receiveGeneralEvent, type GeneralAgentState } from "../lib/general-agent-state";

type Connection = "idle" | "loading" | "connected" | "reconnecting" | "error";
interface View { state: GeneralAgentState; connection: Connection; error: string | null }
const message = (error: unknown) => error instanceof Error ? error.message : "连接失败，请重新连接";
const terminalConnectionError = (error: unknown) => error instanceof ApiError && ([401, 403, 404].includes(error.status) || error.code === "IDENTITY_CHANGED");
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms); signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

/** A URL identifies a persisted session; mounting never resends a message. */
export function useGeneralAgent(sessionId: string | null) {
  const [view, setView] = useState<View | null>(null);
  const [attempt, setAttempt] = useState(0);
  const actions = useRef<{ refresh: () => Promise<void>; cancel: (runId: string) => Promise<void> } | null>(null);

  useEffect(() => {
    if (!sessionId) { setView(null); actions.current = null; return; }
    const identity = readAuth(); const lifetime = new AbortController();
    let state = emptyGeneralAgentState(sessionId), connection: Connection = "loading", error: string | null = null;
    let refreshPending: Promise<void> | null = null;
    let attachmentsPending = false, attachmentRequest = 0;
    const publish = () => { if (!lifetime.signal.aborted) setView({ state, connection, error }); };
    const identityChanged = () => {
      const current = readAuth();
      if (current?.userId === identity?.userId && current?.token === identity?.token) return;
      lifetime.abort(); actions.current = null;
      setView({ state: emptyGeneralAgentState(sessionId), connection: "error", error: "登录身份已变化，请重新打开会话" });
    };
    window.addEventListener(AUTH_CHANGED_EVENT, identityChanged); window.addEventListener("storage", identityChanged);
    publish();
    const refresh = () => {
      if (lifetime.signal.aborted) return Promise.resolve();
      if (!refreshPending) refreshPending = (async () => {
        const request = ++attachmentRequest;
        const snapshot = await fetchGeneralSnapshot(sessionId, lifetime.signal);
        if (lifetime.signal.aborted) return;
        const attachments = state.attachments;
        state = hydrateGeneralSnapshot(state, snapshot);
        if (request !== attachmentRequest) state = { ...state, attachments };
        publish();
      })().finally(() => { refreshPending = null; });
      return refreshPending;
    };
    actions.current = { refresh, cancel: async runId => {
      const status = await cancelGeneralRun(runId, lifetime.signal);
      if (lifetime.signal.aborted) return;
      state = confirmGeneralCancellation(state, runId, status); publish();
      // The receipt updates the button immediately; durable events reconcile it.
    } };
    void (async () => {
      let failures = 0;
      while (!lifetime.signal.aborted) {
        const stream = new AbortController(); const abortStream = () => stream.abort(lifetime.signal.reason);
        lifetime.signal.addEventListener("abort", abortStream, { once: true });
        let gap = false;
        try {
          await refresh();
          if (lifetime.signal.aborted) break;
          connection = "connected"; error = null; publish();
          await readGeneralEvents(sessionId, state.cursor, event => {
            if (lifetime.signal.aborted || stream.signal.aborted) return;
            state = receiveGeneralEvent(state, event); failures = 0; publish();
            if (Object.keys(state.buffered).length) { gap = true; stream.abort(); }
          }, stream.signal);
          if (!lifetime.signal.aborted) error = gap ? "正在补齐任务进度" : "连接已断开，正在恢复";
        } catch (cause) {
          if (lifetime.signal.aborted) break;
          error = gap ? "正在补齐任务进度" : message(cause);
          if (terminalConnectionError(cause)) { connection = "error"; publish(); break; }
        } finally { lifetime.signal.removeEventListener("abort", abortStream); stream.abort(); }
        if (lifetime.signal.aborted) break;
        connection = "reconnecting"; publish();
        await delay(gap ? 0 : Math.min(1000 * 2 ** failures++, 10000), lifetime.signal);
      }
    })();
    // Attachment parsing does not emit text-message events. Refresh its actual
    // server state while parsing, including uploads made in another tab.
    const poll = setInterval(() => {
      if (connection !== "connected" || attachmentsPending) return;
      attachmentsPending = true;
      const request = ++attachmentRequest;
      void fetchGeneralAttachments(sessionId, lifetime.signal).then(attachments => {
        if (lifetime.signal.aborted || request !== attachmentRequest) return;
        state = { ...state, attachments }; if (connection === "connected") error = null; publish();
      }).catch(cause => {
        if (lifetime.signal.aborted) return;
        error = message(cause); publish();
        if (terminalConnectionError(cause)) { connection = "error"; publish(); lifetime.abort(); }
      }).finally(() => { attachmentsPending = false; });
    }, 4000);
    return () => {
      lifetime.abort(); clearInterval(poll); actions.current = null;
      window.removeEventListener(AUTH_CHANGED_EVENT, identityChanged); window.removeEventListener("storage", identityChanged);
    };
  }, [sessionId, attempt]);

  const refresh = useCallback(() => actions.current?.refresh() ?? Promise.resolve(), []);
  const cancel = useCallback((runId: string) => actions.current?.cancel(runId) ?? Promise.reject(new Error("会话尚未连接")), []);
  const reconnect = useCallback(() => setAttempt(value => value + 1), []);
  // A route change must not display the preceding session for one render.
  const current = view?.state.sessionId === sessionId ? view : null;
  return { state: current?.state ?? null, connection: current?.connection ?? (sessionId ? "loading" : "idle") as Connection,
    error: current?.error ?? null, refresh, cancel, reconnect };
}
