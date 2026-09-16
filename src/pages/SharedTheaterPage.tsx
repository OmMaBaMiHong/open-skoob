/**
 * SharedTheaterPage —— 别人打开分享链接看到的页面。
 *
 * **公开、只读、不需要登录。** 一个 URL 空间放两种分享，靠 `kind` 分流：
 *   theater —— 一段多智能体推演对话（只能看）
 *   film    —— 一条影游路线（**能自己重玩**）
 *
 * 后端只按 token 读那一份快照（见 share-store.ts），拿不到书的其他内容。
 */
import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Loader2, MessagesSquare, Clapperboard, Play, Flag } from "lucide-react";
import { AgentAvatar } from "../components/simulation/AgentAvatar";
import { hueOf, shortName } from "../lib/sim-theater";
import { replay, nodeById, startNodeOf, type StoryGraph } from "../lib/story-play";
import { fetchShared, type SharedContent, type SharedFilm } from "../lib/api";

function clock(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SharedTheaterPage() {
  const { token } = useParams<{ token: string }>();
  const [shared, setShared] = useState<SharedContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void fetchShared(token)
      .then((s) => { if (!cancelled) setShared(s); })
      .catch(() => { if (!cancelled) setError("链接已失效或不存在"); });
    return () => { cancelled = true; };
  }, [token]);

  if (error) {
    return (
      <div className="share-page">
        <div className="share-blank">
          <p>{error}</p>
          <Link to="/" className="share-home">回首页</Link>
        </div>
      </div>
    );
  }

  if (!shared) {
    return (
      <div className="share-page">
        <div className="share-blank"><Loader2 size={16} className="spin" /> 读取中…</div>
      </div>
    );
  }

  if (shared.kind === "film") return <SharedFilmView film={shared} />;
  const group = shared;

  return (
    <div className="share-page">
      <div className="share-card">
        <header className="share-head">
          <div className="share-title">
            <MessagesSquare size={14} />
            <h1>{group.title}</h1>
          </div>
          <p className="share-sub">
            《{group.bookTitle}》 · {group.memberNames.length} 个角色 · {group.messages.length} 条对话
          </p>
          <div className="share-faces">
            {group.memberNames.slice(0, 10).map((n) => (
              <AgentAvatar key={n} name={shortName(n)} hue={hueOf(n)} size="sm" />
            ))}
          </div>
        </header>

        <div className="share-body">
          {group.messages.length === 0 ? (
            <p className="prof-empty">这场戏还没有对话。</p>
          ) : (
            group.messages.map((m, i) => {
              const prev = group.messages[i - 1];
              const newRound = m.kind === "agent" && (!prev || prev.round !== m.round);
              const head = !prev || prev.senderId !== m.senderId || prev.kind !== m.kind || newRound;
              if (m.kind === "user") {
                return (
                  <div key={i} className="sim-msg is-user">
                    <div className="sim-msg-main">
                      <div className="sim-msg-bubble">{m.content}</div>
                      <div className="sim-msg-foot">{m.senderName} · {clock(m.ts)}</div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={i}>
                  {newRound && m.round >= 0 && (
                    <div className="sim-round-sep"><span>第 {m.round} 轮</span></div>
                  )}
                  <div className={`sim-msg is-agent${head ? "" : " is-cont"}`}>
                    <div className="sim-msg-avatar">
                      {head && (
                        <AgentAvatar name={shortName(m.senderName)} hue={hueOf(m.senderId || m.senderName)} size="md" />
                      )}
                    </div>
                    <div className="sim-msg-main">
                      {head && (
                        <div className="sim-msg-head">
                          <span className="sim-msg-name">{m.senderName}</span>
                          <span className="sim-msg-time">{clock(m.ts)}</span>
                        </div>
                      )}
                      <div className="sim-msg-bubble">{m.content}</div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <footer className="share-foot">
          这段对话由多智能体仿真推演产出 · <Link to="/">焚决 Skoob</Link>
        </footer>
      </div>
    </div>
  );
}

/* ── 影游分享：分享的是一条路线，对方能自己重玩 ── */

function SharedFilmView({ film }: { readonly film: SharedFilm }) {
  const nav = useNavigate();
  const graph = film.graph as StoryGraph;
  const ending = graph.endings?.find((e) => e.id === film.endingId) ?? null;

  /**
   * 把分享者走过的路重放出来 —— 对方看到的是「他当时经过了哪些场景、
   * 在每个岔路选了什么」，而不是一串光秃秃的选项文字。
   */
  const path: Array<{ nodeTitle: string; sceneDesc: string; choiceText: string }> = [];
  let cur = startNodeOf(graph);
  for (const step of film.steps) {
    if (!cur) break;
    const choice = cur.choices.find((c) => c.id === step.choiceId);
    path.push({ nodeTitle: cur.title || cur.id, sceneDesc: cur.sceneDesc, choiceText: step.choiceText });
    if (!choice) break;
    cur = nodeById(graph, choice.targetNodeId);
  }
  const { vars } = replay(graph, film.steps);

  return (
    <div className="share-page">
      <div className="share-card">
        <header className="share-head">
          <div className="share-title">
            <Clapperboard size={14} />
            <h1>{film.title}</h1>
          </div>
          <p className="share-sub">
            一条走过的路线 · {film.steps.length} 个选择
            {ending && ` · 结局「${ending.title}」`}
          </p>
        </header>

        <div className="share-body">
          {path.length === 0 ? (
            <p className="prod-empty">分享者还没做过选择 —— 你可以从头玩。</p>
          ) : (
            path.map((p, i) => (
              <div key={i} className="share-step">
                {p.sceneDesc && <div className="film-scene"><span>{p.sceneDesc}</span></div>}
                <div className="film-chosen">
                  <b>{i + 1}.</b> {p.choiceText}
                </div>
              </div>
            ))
          )}

          {ending && (
            <div className={`film-ending-card is-${ending.type}`}>
              <div className="film-ending-flag"><Flag size={12} /> 他走到的结局</div>
              <div className="film-ending-name">{ending.title}</div>
              {ending.description && <p>{ending.description}</p>}
            </div>
          )}

          {Object.keys(vars).length > 0 && (
            <div className="share-vars">
              {(graph.variables ?? []).map((v) => (
                <span key={v.name}>{v.desc || v.name}：{String(vars[v.name] ?? v.default)}</span>
              ))}
            </div>
          )}

          {/*
            这是影游分享比剧场分享更能传播的地方：对方不是只能看，是能**自己玩**。
            需要登录才能进播放器（图在本地目录里），所以这里说清楚。
          */}
          <button type="button" className="film-btn share-play" onClick={() => nav(`/film/${encodeURIComponent(film.filmId)}`)}>
            <Play size={13} /> 我也玩一遍（换条路走）
          </button>
        </div>

        <footer className="share-foot">
          互动影游 · <Link to="/">焚决 Skoob</Link>
        </footer>
      </div>
    </div>
  );
}
