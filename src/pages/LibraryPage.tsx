/**
 * LibraryPage —— 作品库（书架）
 *
 * 顶部导航一直有「作品库」这个链接，但路由表里没有它，点了会被 `*`
 * 兜底重定向回创作页 —— 也就是说用户建完书就再也找不到自己的书了。
 * 这一页补上：列出所有作品 + 继续创作 + 查看 + 导出下载。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Loader2, AlertCircle, BookOpen, Download, Search,
  Sparkles, RefreshCw, ChevronRight,
} from "lucide-react";
import {
  fetchBooks, bookExportUrl, switchBookCreationMode,
  type BookSummary, type BookStatus, type ExportFormat,
} from "../lib/api";
import {
  CREATION_LOOP_STEP_TYPES, CREATION_STEP_LABELS_ZH,
  CREATION_MODE_META, routeForMode, canSwitchMode, type CreationMode,
} from "../types/creation-loop";
import "../styles/covers.css";
import { useI18n } from "../i18n";

/** 状态展示走 i18n（library.status.*），这里只存词条 key。 */
const STATUS_LABEL_KEY: Readonly<Record<BookStatus, string>> = {
  incubating: "library.status.incubating",
  outlining: "library.status.outlining",
  active: "library.status.active",
  paused: "library.status.paused",
  completed: "library.status.completed",
  dropped: "library.status.dropped",
};

/** 封面渐变：按书名散列，同一本书永远同一个色。 */
const COVERS = [
  "linear-gradient(135deg,#667eea,#764ba2)",
  "linear-gradient(135deg,#f093fb,#f5576c)",
  "linear-gradient(135deg,#4facfe,#00f2fe)",
  "linear-gradient(135deg,#43e97b,#38f9d7)",
  "linear-gradient(135deg,#fa709a,#fee140)",
  "linear-gradient(135deg,#a18cd1,#fbc2eb)",
  "linear-gradient(135deg,#ff9a9e,#fecfef)",
  "linear-gradient(135deg,#30cfd0,#330867)",
];
function coverOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length]!;
}

/** 引导 ↔ 剧场互为「另一个」。影游不参与——它不是这条链上的模式。 */
function otherMode(mode: CreationMode): CreationMode {
  return mode === "conversation" ? "guided" : "conversation";
}

export function LibraryPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [books, setBooks] = useState<ReadonlyArray<BookSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  /*
   * 导出（TXT/Markdown/EPUB）与「换成引导/剧场模式」搬去了详情页。
   *
   * 它们是**写完之后偶尔用一次**的操作，摆在列表里每本书都要占三四个按钮，
   * 把真正要看的进度挤到中间；而且窄屏上每个按钮的字都会折行。
   */

  const load = useCallback(async () => {
    setError(null);
    try {
      setBooks(await fetchBooks());
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取作品库失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return books;
    return books.filter((b) =>
      b.title.toLowerCase().includes(kw) || (b.genre ?? "").toLowerCase().includes(kw));
  }, [books, q]);

  /** 六步走到哪了（只有 simulate 档有编排）。 */
  const loopProgress = (b: BookSummary): { done: number; label: string } | null => {
    const st = b.creationLoop?.status;
    if (!b.creationLoop?.loopId) return null;
    if (st === "error") return { done: 0, label: t("library.loop_error") };
    return { done: 0, label: st === "awaiting_review" ? t("library.loop_pending") : st === "done" ? t("library.loop_done") : t("library.loop_running") };
  };

  return (
    <div className="page">
      <header className="page-top">
        <h1 className="page-title">{t("library.title")}</h1>
        <span className="page-count">{t("library.count", { count: books.length })}</span>
        <div className="page-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("library.search_placeholder")} />
        </div>
        <button className="page-refresh" onClick={() => void load()}>
          <RefreshCw size={13} /> {t("common.refresh")}
        </button>
      </header>

      <main className="page-body lib-content">
        {error && <div className="lib-error"><AlertCircle size={14} /> {error}</div>}

        {loading ? (
          <div className="lib-grid">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="lib-card lib-card--sk" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="lib-empty">
            <BookOpen size={34} />
            <div className="lib-empty-t">{books.length === 0 ? t("library.no_books") : t("library.no_match")}</div>
            {books.length === 0 && (
              <>
                <div className="lib-empty-s">{t("library.start_creation")}</div>
                <Link to="/create" className="lib-empty-go"><Sparkles size={14} /> {t("library.go_create")}</Link>
              </>
            )}
          </div>
        ) : (
          <div className="lib-grid">
            {filtered.map((b) => {
              const prog = loopProgress(b);
              const target = b.targetChapters ?? 0;
              const written = b.chaptersWritten ?? 0;
              const pct = target > 0 ? Math.min(100, Math.round((written / target) * 100)) : 0;
              return (
                /*
                  ── 一行一条记录，不是一张海报 ──

                  这一页要回答的是「我这本书写到哪了、用的什么、下一步做什么」。
                  原来一张卡竖着堆：一张占半屏的封面 + 六个按钮（继续/查看/换模式
                  /TXT/Markdown/EPUB），文字全折行——真正要看的进度反倒挤在中间。

                  现在：小缩略图 + 书名 + 一行元信息 + 进度条，只留一个主操作。
                  导出、换模式这些是**做完之后偶尔用一次**的，收进详情页。
                */
                <div key={b.id} className="lib-row">
                  <Link className="lib-cover-link" to={`/library/${encodeURIComponent(b.id)}?tab=cover`} aria-label={`${b.title} · ${t("nav.covers")}`}>
                  <span
                    className={`lib-thumb${b.coverUrl ? " has-image" : ""}`}
                    style={b.coverUrl
                      ? { backgroundImage: `url(${b.coverUrl})` }
                      : { background: coverOf(b.id) }}
                    aria-hidden
                  />
                  {!b.coverUrl && <em>生成封面</em>}
                  </Link>

                  <Link to={routeForMode(b.creationMode ?? "guided", b.id)} className="lib-row-body">
                    <span className="lib-row-head">
                      <span className="lib-row-title">{b.title}</span>
                      <span className={`lib-row-status is-${b.status}`}>
                        {t(STATUS_LABEL_KEY[b.status])}
                      </span>
                    </span>

                    {/* 元信息一行说完：题材 · 模式 · 引擎。放不下就省略，不换行。 */}
                    <span className="lib-row-meta">
                      {b.genre && <span>{b.genre}</span>}
                      {b.creationMode
                        ? <span>{CREATION_MODE_META[b.creationMode].icon} {CREATION_MODE_META[b.creationMode].label}</span>
                        : <span className="is-unknown" title="这本书建于「记录创作模式」之前，无从得知">未标记</span>}
                      {b.creationLoop?.strategy === "simulate" && <span>🌐 模拟引擎</span>}
                    </span>

                    <span className="lib-row-prog">
                      <span className="lib-row-prog-bar"><i style={{ width: `${pct}%` }} /></span>
                      <span className="lib-row-prog-txt">
                        {written} / {target || "?"} 章{prog ? ` · ${prog.label}` : ""}
                      </span>
                    </span>
                  </Link>

                  <span className="lib-cover-actions">
                    <Link to={`/library/${encodeURIComponent(b.id)}?tab=cover`}>{t("nav.covers")}</Link>
                    <Link to={routeForMode(b.creationMode ?? "guided", b.id)}>继续创作 <ChevronRight size={14} /></Link>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

/** 六步进度条上用到的步骤名，导出给详情页复用。 */
export const LIBRARY_STEP_LABELS = CREATION_LOOP_STEP_TYPES.map(
  (t) => CREATION_STEP_LABELS_ZH[t],
);
