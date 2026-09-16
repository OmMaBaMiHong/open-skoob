/**
 * FilmHomePage —— 互动影游的入口（四种模式之一）。
 *
 * 做两件事：列出已有的影游、从一句前提生成一部新的。
 *
 * 为什么不照搬老 studio 的五阶段向导（世界→规模→结构→逐节点→校验）：
 * 新前端的心智已经是聊天，再插一套向导是两套操作逻辑。第一版先把
 * 「一句话 → 能玩的分支图」这条最短路走通，逐节点打磨放到播放器里做。
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Clapperboard, Loader2, Play, AlertCircle, Sparkles } from "lucide-react";
import { fetchFilms, createFilm, type FilmSummary } from "../lib/api";

export function FilmHomePage() {
  const nav = useNavigate();
  const [films, setFilms] = useState<ReadonlyArray<FilmSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [premise, setPremise] = useState("");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchFilms()
      .then((list) => { if (!cancelled) setFilms(list); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const create = useCallback(async () => {
    const p = premise.trim();
    if (!p || creating) return;
    setCreating(true);
    setError(null);
    try {
      const film = await createFilm({ premise: p, ...(title.trim() ? { title: title.trim() } : {}) });
      nav(`/film/${encodeURIComponent(film.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setCreating(false);
    }
  }, [premise, title, creating, nav]);

  return (
    <div className="film-home">
      <header className="film-home-head">
        <h1><Clapperboard size={20} /> 互动影游</h1>
        <p>
          分支剧：你的选择决定走向，通关后可以从任一岔路重玩，也可以把走过的路线分享出去。
          <br />
          <span className="film-dim">
            播放是**确定性**的 —— 图生成好之后，玩多少遍都不再调模型。
          </span>
        </p>
      </header>

      <section className="film-create">
        <input
          className="film-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题（可选，留空自动取）"
        />
        <textarea
          className="film-textarea"
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          placeholder="这部影游讲什么？例如：雨夜的旧城废墟里，一台会做梦的机器人被三方势力同时盯上…"
          rows={3}
        />
        <div className="film-create-foot">
          <span className="film-dim">
            生成只保证结构（一个开场、至少两处分岔、至少两个不同结局，每条路都能走到结局）。
          </span>
          <button type="button" className="film-btn" disabled={!premise.trim() || creating} onClick={create}>
            {creating ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {creating ? "生成中…" : "生成影游"}
          </button>
        </div>
        {error && <p className="film-error"><AlertCircle size={12} /> {error}</p>}
      </section>

      <section className="film-list">
        <div className="film-list-head">已有影游 {films.length > 0 && <i>{films.length}</i>}</div>
        {loading ? (
          <p className="film-dim"><Loader2 size={13} className="spin" /> 读取中…</p>
        ) : films.length === 0 ? (
          <p className="film-dim">还没有影游。上面写一句前提就能生成一部。</p>
        ) : (
          films.map((f) => (
            <button
              key={f.id}
              type="button"
              className="film-card"
              onClick={() => nav(`/film/${encodeURIComponent(f.id)}`)}
            >
              <span className="film-card-title">{f.title}</span>
              <span className="film-card-meta">
                {f.nodes} 个节点 · {f.endings} 个结局 · {f.paths}
                {f.pathsTruncated ? "+" : ""} 条路径
              </span>
              <Play size={14} className="film-card-play" />
            </button>
          ))
        )}
      </section>
    </div>
  );
}
