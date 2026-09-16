/**
 * ConversationRoute — 剧场模式路由包装器（路由名 /conversation 是历史名，不动）
 *
 * 两种入口：
 * 1. /conversation           —— 从创作首页进来，书还不存在。
 *                               开 book-create 会话，由对话过程中的 Agent 负责建书。
 * 2. /conversation/:bookId   —— 针对已存在的书继续对话，开 book 会话。
 *
 * 注意：不要凭空造一个 bookId 传给后端——后端会 404（BOOK_NOT_FOUND）。
 */
import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { ConversationMode } from "./ConversationMode";
import { createSession, restoreWorkbenchSession, type BookSession, type SessionKind } from "../lib/api";
import type { WorkbenchMessageInput } from "../lib/workbench-chat";

export function ConversationRoute() {
  const { bookId } = useParams<{ bookId?: string }>();
  const location = useLocation();
  // 创作首页通过 navigate state 带过来的开场指令
  const navigate = useNavigate();
  const routeState = (location.state ?? null) as
    | {
      instruction?: string;
      initialInput?: WorkbenchMessageInput;
      strategy?: "fast" | "simulate";
      /** 首页编队/附件：在那儿选的技能、召唤的专家、扔进来的小说母本要接着生效。 */
      summonedSkillIds?: ReadonlyArray<string>;
      summonedAgentNames?: ReadonlyArray<string>;
      summonedCaps?: ReadonlyArray<{ kind: string; id: string }>;
      attachments?: ReadonlyArray<{ id: string; filename: string; mediaType: string; dataUrl: string }>;
    }
    | null;
  const initialInstruction = routeState?.instruction ?? null;
  const strategy = routeState?.strategy;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionKind: SessionKind = bookId ? "book" : "book-create";

  useEffect(() => {
    let cancelled = false;
    setSessionId(null);
    setError(null);
    void (async () => {
      try {
        const session: BookSession = bookId ? await restoreWorkbenchSession(bookId) : await createSession({ sessionKind, creationStrategy: strategy ?? "fast" });
        if (!cancelled) setSessionId(session.sessionId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "创建会话失败");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [bookId, sessionKind, strategy]);

  if (error) {
    return (
      <div style={{
        display: "grid",
        placeItems: "center",
        height: "100vh",
        color: "var(--muted)",
        fontSize: 14,
      }}>
        <div>
          <p>⚠️ {error}</p>
          <a href="/create" style={{ color: "var(--accent)" }}>返回首页</a>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div style={{
        display: "grid",
        placeItems: "center",
        height: "100vh",
        color: "var(--muted)",
        fontSize: 14,
      }}>
        正在创建会话...
      </div>
    );
  }

  return (
    <ConversationMode
      key={sessionId}
      sessionId={sessionId}
      bookId={bookId ?? null}
      sessionKind={sessionKind}
      strategy={strategy}
      initialInstruction={initialInstruction}
      initialInput={routeState?.initialInput}
      initialSkillIds={routeState?.summonedSkillIds}
      initialAgentNames={routeState?.summonedAgentNames}
      initialCaps={routeState?.summonedCaps}
      initialAttachments={routeState?.attachments}
      onBookCreated={(id) => {
        // 建好书后带着 bookId 换路由：六步进度要靠它查快照。
        // replace + 保留 instruction 会导致开场指令重发，所以只留 strategy。
        // 只留 strategy 与编队：instruction 保留会导致开场指令重发。
        // 附件已经随第一条消息发出去了，不再带（否则第二条会重复上传）。
        navigate(`/conversation/${id}`, {
          replace: true,
          state: {
            strategy,
            summonedSkillIds: routeState?.summonedSkillIds,
            summonedAgentNames: routeState?.summonedAgentNames,
            summonedCaps: routeState?.summonedCaps,
          },
        });
      }}
    />
  );
}
