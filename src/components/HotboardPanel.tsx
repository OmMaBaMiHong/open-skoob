import { hotboardItemDetails } from "./HotboardItemDetails";
import type { InspirationSource } from "../lib/api";
import { readAuth } from "../lib/auth-storage";
import { startOAuthLogin } from "../lib/account";
/**
 * HotboardPanel — 天魔脑洞：多平台热榜聚合。
 *
 * 作用是「给灵感找燃料」：把各平台此刻在吵什么摆出来，点一条就把它
 * 变成创作方向填进输入框。所以每一条都要是**可以直接开写**的，
 * 而不是一个只能看的新闻列表。
 *
 * 数据来自 /api/v1/tianmo/hotboard/*（阶段 1：48 个板 / 5 个分类）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Flame, Search, RefreshCw, Loader2, ExternalLink, Layers, X, Eye, Sparkles, Radar,
} from "lucide-react";
import {
  fetchHotboards, fetchHotAggregate, searchHotboard,
  reportBrainstormEvents, reportFunnelEvents,
  type HotboardSnapshot, type HotboardCategory, type HotTopic, type HotboardMatch,
  type BrainstormCard,
} from "../lib/api";
import { apiUrl } from "../lib/api-origin";
import { useBrainstormCards } from "../hooks/use-brainstorm-cards";
import { InspirationPreview } from "./InspirationPreview";

/** 分类图标，纯展示。fiction=网文（扫榜数据源，主打频道恒第一）。 */
const CAT_ICON: Readonly<Record<string, string>> = {
  fiction: "📚", china: "🔥", entertainment: "🎬", tech: "⚙️", finance: "📈", world: "🌍",
};

/** 题材 → 轨道占位渐变（没图时的兜底，按题材稳定取色）。 */
const GENRE_GRADIENTS: ReadonlyArray<string> = [
  "linear-gradient(135deg,#5b4b8a,#9b5de5)",
  "linear-gradient(135deg,#1f6f8b,#3ec1d3)",
  "linear-gradient(135deg,#b3541e,#f4a259)",
  "linear-gradient(135deg,#2d6a4f,#74c69d)",
  "linear-gradient(135deg,#9d0208,#e85d04)",
];
function genreGradient(genre: string): string {
  let hash = 0;
  for (const ch of genre) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return GENRE_GRADIENTS[hash % GENRE_GRADIENTS.length]!;
}

/** v3 故事世界要素（factions/locations/rules/triggers，存 fullPlan）→ 弹窗分组。 */
function caseGroups(card: BrainstormCard): ReadonlyArray<[string, ReadonlyArray<string>]> {
  const plan = (card.fullPlan ?? {}) as Record<string, unknown>;
  const read = (key: string): ReadonlyArray<string> => {
    const value = plan[key];
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
  };
  return ([
    ["势力", read("factions")],
    ["场景", read("locations")],
    ["世界规则", read("rules")],
    ["升级触发器", read("triggers")],
  ] as ReadonlyArray<[string, ReadonlyArray<string>]>).filter(([, values]) => values.length > 0);
}

/** 生成策略标签（fullPlan.strategyLabel，策略路由写入）。 */
function strategyLabelOf(card: BrainstormCard): string {
  const value = (card.fullPlan ?? {}) as Record<string, unknown>;
  return typeof value.strategyLabel === "string" ? value.strategyLabel : "";
}

export function HotboardPanel({
  onPick,
  onScan,
  hotboardEnabled = true,
  brainstormEnabled = true,
}: {
  /** 选中一条内容 → 变成创作方向（父级把它填进输入框）；cardId = 脑洞卡埋点/溯源透传。 */
  readonly onPick: (seed: string, cardId?: string) => void;
  readonly onScan?: () => void;
  readonly hotboardEnabled?: boolean;
  readonly brainstormEnabled?: boolean;
}) {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<ReadonlyArray<HotboardCategory>>([]);
  // 网文是主打频道，默认落在第一位分类（用户裁决 2026-09-10）。
  const [category, setCategory] = useState("fiction");
  const [boards, setBoards] = useState<ReadonlyArray<HotboardSnapshot>>([]);
  const [topics, setTopics] = useState<ReadonlyArray<HotTopic>>([]);
  const [loading, setLoading] = useState(true);
  const [aggLoading, setAggLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState("");
  const [matches, setMatches] = useState<ReadonlyArray<HotboardMatch> | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── 灵感方案预览 ── */
  const [previewHotTopic, setPreviewHotTopic] = useState<InspirationSource | null>(null);

  /* ── 榜单 ── */
  const load = useCallback(async (cat: string, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchHotboards(cat, { refresh });
      if (d.categories?.length) setCategories(d.categories);
      setBoards(d.boards ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "热榜加载失败");
      setBoards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (hotboardEnabled) void load(category); }, [category, load, hotboardEnabled]);

  /* ── 聚合总榜（只拉一次） ── */
  useEffect(() => {
    if (!hotboardEnabled) return;
    void fetchHotAggregate(10)
      .then(setTopics)
      .catch(() => setTopics([]))
      .finally(() => setAggLoading(false));
  }, [hotboardEnabled]);

  /* ── AI 脑洞图文轨道（板块顶部；加载即记曝光，匿名计） ── */
  const brainstormRail = useRef<HTMLDivElement>(null);
  const brainstorm = useBrainstormCards(() => !brainstormRail.current || brainstormRail.current.scrollLeft < 1, brainstormEnabled);
  const brainstormCards = brainstorm.cards;
  /** 点卡先看完整案例，再决定开写。 */
  const [openCase, setOpenCase] = useState<BrainstormCard | null>(null);

  /** 「用这个开写」：记「感兴趣」，组装种子透传卡 id（书↔热点溯源）。 */
  const useBrainstormCard = (card: BrainstormCard) => {
    if (!readAuth()) { startOAuthLogin(window.location.href); return; }
    void reportBrainstormEvents([{ cardId: card.id, type: "click" }]);
    const plan = (card.fullPlan ?? {}) as Record<string, unknown>;
    const list = (v: unknown): ReadonlyArray<string> =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    const groups: ReadonlyArray<[string, ReadonlyArray<string>]> = [
      ["势力", list(plan.factions)],
      ["场景", list(plan.locations)],
      ["世界规则", list(plan.rules)],
      ["升级触发器", list(plan.triggers)],
    ];
    const synopsisLine = card.synopsis?.trim() ? `\n简介：${card.synopsis.trim()}` : "";
    const groupLines = groups
      .filter(([, values]) => values.length > 0)
      .map(([label, values]) => `\n${label}：${values.join("；")}`)
      .join("");
    onPick(
      `基于热点「${card.originalTitle}」的虚构故事。\n书名：${card.title}\n题材：${card.genre}\n核心冲突：${card.coreConflict}\n主角：${card.protagonist}\n故事前提：${card.premise}${synopsisLine}${groupLines}`,
      card.id,
    );
    setOpenCase(null);
  };

  /* ── 搜索（防抖） ── */
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!hotboardEnabled) return;
    const kw = keyword.trim();
    if (!kw) { setMatches(null); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      void reportFunnelEvents([{ eventType: "search", query: kw, subjectType: "hotboard" }]);
      void searchHotboard(kw)
        .then(setMatches)
        .catch(() => setMatches([]))
        .finally(() => setSearching(false));
    }, 420);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [keyword, hotboardEnabled]);

  /** 漏斗埋点：热点条目被使用 / 被查看（原文链接）。失败静默。 */
  const trackItem = (eventType: "item_click" | "item_view", title: string): void => {
    void reportFunnelEvents([{ eventType, subjectType: "hot_item", subjectTitle: title }]);
  };

  const liveCount = useMemo(
    () => boards.reduce((n, b) => n + (b.items?.length ?? 0), 0),
    [boards],
  );

  return (
    <div className="hb">
      {/* ── AI 脑洞 · 图文轨道（顶部；AI 预生成的「热点→故事切入点」，点卡即写） ── */}
      {(brainstormCards.length > 0 || brainstorm.loading || brainstorm.error) && (
        <section>
          <div className="hb-rail-head" style={{ marginBottom: 8 }}>
            <div className="hb-rail-title"><Sparkles size={13} /> AI 脑洞 · 今日灵感</div>
            <div className="hb-rail-note">{brainstormCards.length > 0 && <>最近更新 {new Date(`${brainstormCards.map(card => card.batchDate).sort().at(-1)}T00:00:00+08:00`).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" })} · </>}登录免费使用</div>
          </div>
          <div className="hb-rail" ref={brainstormRail} aria-label="全部故事灵感" onScroll={event => {
            const rail = event.currentTarget;
            if (!brainstorm.error && rail.scrollWidth - rail.clientWidth - rail.scrollLeft < 600) void brainstorm.loadMore();
          }}>
            {brainstormCards.map((card) => (
              <button key={card.id} type="button" className="hb-rail-card" onClick={() => setOpenCase(card)}>
                {card.imageUrl ? (
                  <img className="hb-rail-img" src={apiUrl(card.imageUrl)} alt="" loading="lazy" />
                ) : (
                  <div className="hb-rail-imgph" style={{ background: genreGradient(card.genre) }}>
                    {card.genre.slice(0, 2)}
                  </div>
                )}
                <div className="hb-rail-body">
                  <div className="hb-rail-t">{card.title}</div>
                  <div className="hb-rail-g">{card.synopsis?.trim() || card.premise}</div>
                  <div className="hb-rail-c">{card.genre} · {card.coreConflict}</div>
                  <div className="hb-rail-meta">
                    <span>🔥 感兴趣 {card.clickCount}</span>
                    <span>✍️ 已创作 {card.usedCount}</span>
                  </div>
                </div>
              </button>
            ))}
            <div className="hb-rail-more" aria-live="polite">
              {brainstorm.loading ? <span>正在加载…</span> : brainstorm.error ? <button onClick={() => void brainstorm.retry()}>{brainstorm.error}</button>
                : brainstorm.hasMore ? <button onClick={() => void brainstorm.loadMore()}>继续滑动，查看更多</button> : <span>已展示全部 {brainstormCards.length} 条灵感</span>}
            </div>
          </div>
        </section>
      )}

      {/* ── Case 详情弹窗（吸收老前端灵感详情：书名/简介/前提/主角/来源，看完再开写） ── */}
      {openCase && (
        <div className="hb-case" role="dialog" aria-modal="true" onClick={() => setOpenCase(null)}>
          <div className="hb-case__panel" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="hb-case__close" onClick={() => setOpenCase(null)} aria-label="关闭">
              <X size={16} />
            </button>

            {/* ── 头部：封面（左）+ 书名/标签/数据（右）——对标书城榜单条目 ── */}
            <div className="hb-case__hero">
              {openCase.imageUrl ? (
                <img className="hb-case__cover" src={apiUrl(openCase.imageUrl)} alt="" />
              ) : (
                <div className="hb-case__cover is-ph" style={{ background: genreGradient(openCase.genre) }}>
                  {openCase.genre.slice(0, 2)}
                </div>
              )}
              <div className="hb-case__hero-r">
                <h3 className="hb-case__title">{openCase.title}</h3>
                <div className="hb-case__head">
                  <span className="hb-case__genre">{openCase.genre}</span>
                  {strategyLabelOf(openCase) && (
                    <span className="hb-case__strategy">{strategyLabelOf(openCase)}</span>
                  )}
                </div>
                <div className="hb-case__meta">🔥 感兴趣 {openCase.clickCount} · ✍️ 已创作 {openCase.usedCount}</div>
              </div>
            </div>

            {/* ── 简介（小说简介口吻，完整展示）── */}
            <p className="hb-case__synopsis">{openCase.synopsis?.trim() || openCase.premise}</p>

            {/* ── 改写思路（生成时的结构化设定）── */}
            <dl className="hb-case__facts">
              <div><dt>导火索</dt><dd>{openCase.premise}</dd></div>
              <div><dt>主角</dt><dd>{openCase.protagonist}</dd></div>
              <div><dt>核心冲突</dt><dd>{openCase.coreConflict}</dd></div>
            </dl>
            {caseGroups(openCase).map(([label, values]) => (
              <div key={label} className="hb-case__group">
                <span className="hb-case__group-label">{label}</span>
                <div className="hb-case__group-items">
                  {values.map((value) => <em key={value}>{value}</em>)}
                </div>
              </div>
            ))}

            <div className="hb-case__foot">
              <button type="button" className="hb-case__go" onClick={() => useBrainstormCard(openCase)}>
                <Flame size={14} /> 用这个开写
              </button>
              {openCase.originalUrl && (
                <a href={openCase.originalUrl} target="_blank" rel="noreferrer" className="hb-case__src">
                  原始热点《{openCase.originalTitle}》↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {hotboardEnabled && <>
      {/* ── 头部：搜索 + 分类 ── */}
      <div className="hb-top">
        <div className="hb-search">
          <Search size={14} />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜关键词，跨 48 个榜找同题热点…"
          />
          {keyword && (
            <button className="hb-clear" onClick={() => setKeyword("")}><X size={13} /></button>
          )}
          {searching && <Loader2 size={13} className="spin" />}
        </div>
        <button className="hb-refresh" onClick={() => void load(category, true)} disabled={loading}>
          <RefreshCw size={13} className={loading ? "spin" : ""} /> 刷新
        </button>
        {/* 扫榜导流：从「看榜」到「市场分析」——网文榜的深度用法在 /scan */}
        <button className="hb-refresh hb-scan-link" onClick={() => onScan ? onScan() : navigate("/scan")} title="网文榜单市场分析">
          <Radar size={13} /> 扫榜分析
        </button>
      </div>

      {matches ? (
        /* ── 搜索结果 ── */
        <div className="hb-matches">
          <div className="hb-sec-cap">
            <Search size={12} />
            {searching ? `正在跨 48 个榜找「${keyword}」…` : `「${keyword}」命中 ${matches.length} 条`}
          </div>
          {/* 跨平台检索要现抓各家榜单，实测 ~10s；只给一个小转圈用户会以为卡死 */}
          {searching ? (
            <div className="hb-skeleton">
              {Array.from({ length: 5 }, (_, i) => <div key={i} className="hb-sk-row" />)}
              <div className="hb-sk-note">
                <Loader2 size={12} className="spin" /> 各平台榜单实时抓取中，约需 10 秒
              </div>
            </div>
          ) : matches.length === 0 ? (
            <div className="hb-empty">没有平台在讨论这个词</div>
          ) : (
            <div className="hb-match-list">
              {matches.map((m, i) => (
                <div key={`${m.boardId}-${m.item.id}-${i}`} className="hb-match-row">
                  <button
                    className="hb-match"
                    onClick={() => setPreviewHotTopic({ title: m.item.title, summary: m.item.summary, source: m.boardName, url: m.item.url, itemId:m.item.id,boardId:m.boardId })}
                  >
                    <span className="hb-match-src">{m.boardName}</span>
                    <span className="hb-match-t">{m.item.title}</span>
                    {m.matchedKeywords?.length ? (
                      <span className="hb-match-kw">{m.matchedKeywords.join(" · ")}</span>
                    ) : null}
                  </button>
                  <button
                    className="hb-preview-btn"
                    onClick={() => setPreviewHotTopic({
                      title: m.item.title,
                      summary: m.item.summary,
                      source: m.boardName,
                      url: m.item.url,
                      itemId:m.item.id,boardId:m.boardId,
                    })}
                    title="AI 改写：先评分，再生成" aria-label="AI 改写"
                  >
                    <Eye size={14} />
                  </button>
                  {m.item.url && (
                    <a
                      className="hb-preview-btn"
                      href={m.item.url}
                      target="_blank"
                      rel="noreferrer"
                      title="查看原文"
                      onClick={() => trackItem("item_view", m.item.title)}
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ── 聚合总榜：多平台同时在说的事 ── */}
          <section className="hb-agg">
            <div className="hb-sec-cap">
              <Layers size={12} /> 全网同题
              <span className="hb-sec-note">公开浏览 · 会员可生成改编方案</span>
            </div>
            {aggLoading ? (
              <div className="hb-skeleton is-compact">
                {Array.from({ length: 3 }, (_, i) => <div key={i} className="hb-sk-row" />)}
                <div className="hb-sk-note">
                  <Loader2 size={12} className="spin" /> 正在合并全平台同题…
                </div>
              </div>
            ) : topics.length === 0 ? (
              <div className="hb-empty">暂无跨平台同题</div>
            ) : (
              <div className="hb-agg-list">
                {topics.slice(0, 6).map((t, i) => {
                  const firstUrl = t.occurrences?.[0]?.item?.url;
                  return (
                    <div key={t.title} className="hb-agg-row">
                      <button
                        className={`hb-agg-item ${i === 0 ? "is-top" : ""}`}
                        onClick={() => { trackItem("item_click", t.title); setPreviewHotTopic({ title: t.title, summary: t.occurrences?.[0]?.item?.summary, url:firstUrl,boardId:t.occurrences?.[0]?.boardId,itemId:t.occurrences?.[0]?.item?.id }); }}
                        title="用这条开写"
                      >
                        <span className="hb-agg-n">{i + 1}</span>
                        <span className="hb-agg-t">{t.title}</span>
                        <span className="hb-agg-c">
                          <Flame size={10} /> {t.platformCount} 平台
                        </span>
                      </button>
                      <div className="hb-agg-actions">
                        <button
                          className="hb-preview-btn"
                          onClick={() => setPreviewHotTopic({
                            title: t.title,
                            summary: t.occurrences?.[0]?.item?.summary,
                            source: t.occurrences?.[0]?.boardName,
                            url: firstUrl,
                            boardId:t.occurrences?.[0]?.boardId,itemId:t.occurrences?.[0]?.item?.id,
                          })}
                          title="AI 改写：先评分，再生成" aria-label="AI 改写"
                        >
                          <Eye size={14} />
                        </button>
                        {firstUrl && (
                          <a
                            className="hb-preview-btn"
                            href={firstUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="查看原文"
                            onClick={() => trackItem("item_view", t.title)}
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── 分类 ── */}
          <div className="hb-cats">
            {categories.map((c) => (
              <button
                key={c.id}
                className={`hb-cat ${category === c.id ? "is-on" : ""}`}
                onClick={() => setCategory(c.id)}
              >
                {CAT_ICON[c.id] ?? "•"} {c.name}
                <em>{c.boardIds.length}</em>
              </button>
            ))}
            {liveCount > 0 && <span className="hb-live">{liveCount} 条在榜</span>}
          </div>

          {error && <div className="hb-error">{error}</div>}

          {/* ── 平台榜单卡片 ── */}
          {loading && boards.length === 0 ? (
            <div className="hb-grid">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="hb-card hb-card--sk">
                  <div className="hb-sk-row is-title" />
                  {Array.from({ length: 5 }, (_, j) => <div key={j} className="hb-sk-row" />)}
                </div>
              ))}
            </div>
          ) : (
            <div className="hb-grid">
              {boards.map((b) => (
                <BoardCard
                  key={b.id}
                  board={b}
                  onPick={(t, s) => setPreviewHotTopic({ title: t, summary: s })}
                  onPreview={setPreviewHotTopic}
                />
              ))}
            </div>
          )}


        </>
      )}
      </>}
          {/* 灵感方案预览 */}
          {previewHotTopic && (
            <InspirationPreview
              hotTopic={previewHotTopic}
              onClose={() => setPreviewHotTopic(null)}
              onUsePlan={(plan) => {
                const seed = `根据已确认脑洞创作原创小说。书名：${plan.bookTitle || "待定"}\n简介：${plan.synopsis || plan.premise}\n参考来源：${previewHotTopic.title}\n\n题材：${plan.genre.join(" / ")}\n核心冲突：${plan.coreConflict}\n主角设定：${plan.protagonist}\n故事前提：${plan.premise}`;
                onPick(seed);
                setPreviewHotTopic(null);
              }}
            />
          )}
    </div>
  );
}

export function BoardCard({
  board, onPick, onPreview,
}: {
  readonly board: HotboardSnapshot;
  readonly onPick: (title: string, summary?: string) => void;
  readonly onPreview: (source: InspirationSource) => void;
}) {
  const items = board.items ?? [];
  return (
    <div className={`hb-card ${board.error ? "is-err" : ""}`}>
      <header className="hb-card-h">
        <span className="hb-card-t">{board.name}</span>
        {board.status === "cache" && <span className="hb-card-st">缓存</span>}
        {board.home && (
          <a className="hb-card-go" href={board.home} target="_blank" rel="noreferrer" title="去平台">
            <ExternalLink size={11} />
          </a>
        )}
      </header>
      {board.error ? (
        <div className="hb-card-err">抓取失败</div>
      ) : items.length === 0 ? (
        <div className="hb-card-err">暂无数据</div>
      ) : (
        <ol className="hb-list">
          {items.slice(0, 8).map((it, i) => {
            const isFiction = board.domain === "fiction";
            const metric = compactHotboardMetric(it);
            const details = hotboardItemDetails(it).filter(detail=>/^(作者|分类)：/u.test(detail));
            return (
            <li key={it.id || i}>
              <div className="hb-item-row">
                <button className="hb-item" onClick={() => { void reportFunnelEvents([{ eventType: "item_click", subjectType: "hot_item", subjectTitle: it.title }]); onPick(it.title, it.summary); }} title="用这条开写">
                  <span className={`hb-rank ${i < 3 ? "is-hot" : ""}`}>{i + 1}</span>
                  <span className="hb-item-content">
                    <span className="hb-item-t" title={it.title}>{it.title}</span>
                    {details.length>0 && <span className="hb-item-details hb-item-brief">{details.map(detail=><span key={detail} title={detail}>{detail}</span>)}</span>}
                  </span>
                  <span className="hb-heat" title={it.heatLabel}>{metric}</span>
                </button>
                <div className="hb-item-actions">
                  {(
                    <button
                      className="hb-preview-btn"
                      onClick={() => onPreview({title:it.title,summary:it.summary,source:board.name,url:it.url,itemId:it.id,boardId:board.id,domain:isFiction?"fiction":"news",
                        sourceMetrics:{rank:i+1,heat:it.heat,heatLabel:it.heatLabel,domain:isFiction?"fiction":"news",
                          metrics:Object.fromEntries(Object.entries(it.meta ?? {}).filter((entry):entry is [string,string|number]=>["author","category","tags","status","wordCount","metricLabel","update","rating","ratingCount"].includes(entry[0]) && ["string","number"].includes(typeof entry[1])))}})}
                      title="AI 改写：先评分，再生成" aria-label="AI 改写"
                    >
                      <Eye size={14} />
                    </button>
                  )}

                </div>
              </div>
            </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** One number in narrow rows; all source metrics remain available in the preview. */
function compactHotboardMetric(item:{heat?:number;heatLabel?:string}):string {
  let value=item.heat;
  if(value===undefined) {
    const first=item.heatLabel?.match(/^\s*([0-9][0-9,]*(?:\.[0-9]+)?)(亿|万|千|[kKmM])?/u);
    if(!first) return "";
    value=Number(first[1]!.replace(/,/gu,""))*({亿:1e8,万:1e4,千:1e3,k:1e3,K:1e3,m:1e6,M:1e6}[first[2] ?? ""] ?? 1);
  }
  if(!Number.isFinite(value)) return "";
  const compact=(n:number)=>n>=100?String(Math.round(n)):n.toFixed(1).replace(/\.0$/u,"");
  return value>=1e8?`${compact(value/1e8)}亿`:value>=1e4?`${compact(value/1e4)}万`:String(Math.round(value));
}
