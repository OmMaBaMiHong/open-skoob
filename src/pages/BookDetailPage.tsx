/**
 * BookDetailPage —— 单本作品详情（查看）
 *
 * 两块内容：
 *   设定 —— 六步产出落盘的「真相文件」（story_frame / volume_map / 角色…）
 *   正文 —— 已写章节，点开读全文
 *
 * ⚠️ 带 legacy 标记的文件（story_bible.md / book_rules.md）在新版式书里是
 * 只读兼容层，运行时读的是 outline/ 下的对应文件；这里如实标出来，
 * 免得用户对着一个不生效的文件较劲。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CoverEditor } from "../components/CoverEditor";
import { Image as ImageIcon } from "lucide-react";
import {
  ArrowLeft, Loader2, AlertCircle, Download, FileText, BookOpen, ChevronRight,
} from "lucide-react";
import {
  fetchBook, fetchTruthFile, fetchChapter, bookExportUrl, fetchJson,
  type BookDetailResponse, type TruthFile, type ExportFormat,
} from "../lib/api";

const FORMATS: ReadonlyArray<{ id: ExportFormat; label: string }> = [
  { id: "txt", label: "TXT" }, { id: "md", label: "Markdown" }, { id: "epub", label: "EPUB" },
];

export function BookDetailPage() {
  const { bookId = "" } = useParams<{ bookId: string }>();
  const [data, setData] = useState<BookDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /*
   * tab 与展开的章节都放进 URL。
   *
   * 剧场那边的「查看正文」要能直接落到某一章——只有组件内 state 的话，
   * 跳过来还得让人自己点两下找回刚才在演的那一章。
   */
  const [params, setParams] = useSearchParams();
  type Tab = "truth" | "chapters" | "cover";
  const rawTab = params.get("tab");
  const tab: Tab = rawTab === "chapters" || rawTab === "cover" ? rawTab : "truth";
  const setTab = (next: Tab): void => {
    const p = new URLSearchParams(params);
    if (next === "truth") { p.delete("tab"); p.delete("chapter"); }
    else { p.set("tab", next); if (next !== "chapters") p.delete("chapter"); }
    setParams(p, { replace: true });
  };

  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileBody, setFileBody] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);

  const [openChapter, setOpenChapter] = useState<number | null>(null);
  const [chapterBody, setChapterBody] = useState<{ title?: string; content?: string } | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  async function saveChapter() {
    if (openChapter === null) return;
    setSaving(true); setSaveError("");
    try { await fetchJson(`/books/${encodeURIComponent(bookId)}/chapters/${openChapter}`, { method: "PUT", body: JSON.stringify({ content: draftText, title: chapterBody?.title }) }); setChapterBody(previous => ({ ...previous, content: draftText })); setEditing(false); setData(await fetchBook(bookId)); }
    catch (e) { setSaveError((e as Error).message); } finally { setSaving(false); }
  }

  useEffect(() => {
    setLoading(true);
    void fetchBook(bookId)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "读取失败"))
      .finally(() => setLoading(false));
  }, [bookId]);

  const openTruth = useCallback(async (f: TruthFile) => {
    if (openFile === f.name) { setOpenFile(null); return; }
    setOpenFile(f.name);
    setFileLoading(true);
    setFileBody("");
    try {
      const r = await fetchTruthFile(bookId, f.name);
      setFileBody(r.content ?? f.preview ?? "（空文件）");
    } catch {
      setFileBody(f.preview ?? "读取失败");
    } finally { setFileLoading(false); }
  }, [bookId, openFile]);

  const openCh = useCallback(async (n: number) => {
    if (openChapter === n) { setOpenChapter(null); return; }
    setOpenChapter(n); setEditing(false); setSaveError("");
    setChapterLoading(true);
    setChapterBody(null);
    try { setChapterBody(await fetchChapter(bookId, n)); }
    catch { setChapterBody({ content: "读取失败" }); }
    finally { setChapterLoading(false); }
  }, [bookId, openChapter]);

  /*
   * 带 ?chapter=N 进来时自动展开那一章（从剧场「查看正文」跳过来的情况）。
   * 只在数据到位后跑一次：太早展开会先请求一个还不存在的章节。
   */
  const deepLinkChapter = params.get("chapter");
  useEffect(() => {
    if (!data || !deepLinkChapter) return;
    const n = Number(deepLinkChapter);
    if (Number.isFinite(n) && n > 0) void openCh(n);
    // 展开一次就把参数摘掉，免得用户手动收起后刷新又被强行展开。
    const p = new URLSearchParams(params);
    p.delete("chapter");
    setParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, deepLinkChapter]);

  if (loading) {
    return <div className="bd-load"><Loader2 size={22} className="spin" /> 读取作品…</div>;
  }
  if (error || !data) {
    return (
      <div className="bd-load">
        <AlertCircle size={20} /> {error ?? "作品不存在"}
        <Link to="/library" className="bd-back-link">← 回作品库</Link>
      </div>
    );
  }

  const book = data.book;
  const truth = data.truth ?? [];
  const chapters = data.chapters ?? [];

  return (
    <div className="bd">
      <header className="bd-top">
        <Link to="/library" className="bd-back"><ArrowLeft size={15} /> 作品库</Link>
        <div className="bd-id">
          <h1>{book.title ?? bookId}</h1>
          <div className="bd-meta">
            {book.genre && <span>{book.genre}</span>}
            {book.targetChapters ? <span>{book.targetChapters} 章</span> : null}
            {book.creationLoop?.strategy === "simulate" && <span className="bd-engine">🌐 模拟引擎</span>}
          </div>
        </div>
        <div className="bd-acts">
          <Link className="bd-btn is-primary" to={`/workbench/${encodeURIComponent(bookId)}`}>
            继续创作
          </Link>
          {FORMATS.map((f) => (
            <a
              key={f.id}
              className={`bd-btn ${chapters.length === 0 ? "is-off" : ""}`}
              href={chapters.length === 0 ? undefined : bookExportUrl(bookId, f.id)}
              title={chapters.length === 0 ? "还没有正文可导出" : `导出 ${f.label}`}
            >
              <Download size={12} /> {f.label}
            </a>
          ))}
        </div>
      </header>

      <nav className="bd-tabs">
        <button className={tab === "truth" ? "is-on" : ""} onClick={() => setTab("truth")}>
          <FileText size={13} /> 设定 <em>{truth.length}</em>
        </button>
        <button className={tab === "chapters" ? "is-on" : ""} onClick={() => setTab("chapters")}>
          <BookOpen size={13} /> 正文 <em>{chapters.length}</em>
        </button>
        <button className={tab === "cover" ? "is-on" : ""} onClick={() => setTab("cover")}>
          <ImageIcon size={13} /> 封面
        </button>
      </nav>

      <main className="bd-body">
        {tab === "cover" ? (
          <CoverEditor kind="book" id={bookId} title={book.title ?? bookId} />
        ) : tab === "truth" ? (
          truth.length === 0 ? (
            <div className="bd-empty">还没有产出设定 —— 去工作台把六步走完。</div>
          ) : (
            <div className="bd-files">
              {truth.map((f) => (
                <div key={f.name} className={`bd-file ${openFile === f.name ? "is-open" : ""}`}>
                  <button className="bd-file-h" onClick={() => void openTruth(f)}>
                    <ChevronRight size={13} className="bd-file-caret" />
                    <span className="bd-file-n">{f.name}</span>
                    <span className="bd-file-s">{(f.size / 1024).toFixed(1)} KB</span>
                  </button>
                  {openFile === f.name && (
                    <div className="bd-file-b">
                      {fileLoading ? <Loader2 size={14} className="spin" /> : <pre>{fileBody}</pre>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : chapters.length === 0 ? (
          <div className="bd-empty">
            还没有正文。六步走到「章节正文」后，这里会逐章出现。
          </div>
        ) : (
          <div className="bd-chaps">
            {chapters.map((c) => (
              <div key={c.number} className={`bd-chap ${openChapter === c.number ? "is-open" : ""}`}>
                <button className="bd-chap-h" onClick={() => void openCh(c.number)}>
                  <span className="bd-chap-n">第 {c.number} 章</span>
                  <span className="bd-chap-t">{c.title ?? "（未命名）"}</span>
                  {c.wordCount ? <span className="bd-chap-w">{c.wordCount} 字</span> : null}
                </button>
                {openChapter === c.number && (
                  <div className="bd-chap-b">
                    {chapterLoading ? <Loader2 size={14} className="spin" /> : editing ? <><textarea aria-label="章节正文编辑" style={{ width: "100%", minHeight: 360, font: "inherit", lineHeight: 1.8 }} value={draftText} onChange={e => setDraftText(e.target.value)} /><button className="bd-btn" disabled={saving} onClick={() => void saveChapter()}>保存正文</button><button className="bd-btn" disabled={saving} onClick={() => setEditing(false)}>取消</button></> : <><article>{chapterBody?.content ?? "（空）"}</article><button className="bd-btn" onClick={() => { setDraftText(chapterBody?.content || ""); setEditing(true); }}>编辑正文</button></>}{saveError && <p role="alert">{saveError}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
