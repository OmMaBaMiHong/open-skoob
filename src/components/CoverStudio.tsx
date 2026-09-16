import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ImagePlus, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { ApiError, deleteCover, fetchBooks, uploadCover, type BookSummary } from "../lib/api";
import { API_ORIGIN } from "../lib/api-origin";
import { AUTH_CHANGED_EVENT, readAuth } from "../lib/auth-storage";
import {
  applyCoverJob, COVER_STATUS, createCoverJob, downloadCoverJob, fetchCoverCatalog, fetchCoverMaterial,
  isCoverRunning, listCoverJobs, recomposeCoverJob,
  type CoverCatalog, type CoverInput, type CoverJob, type CoverTypography,
} from "../lib/cover-api";
import "../styles/covers.css";

const DEFAULT_TYPE: CoverTypography = { template: "modern", font: "sans", color: "#ffffff", position: "top" };
const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
type Pending = { key: string; input: CoverInput };

export function CoverStudio(props: { initialBookId?: string; embedded?: boolean }) {
  const [identity, setIdentity] = useState(() => readAuth()?.userId ?? "anonymous");
  useEffect(() => {
    const update = () => setIdentity(readAuth()?.userId ?? "anonymous");
    window.addEventListener(AUTH_CHANGED_EVENT, update);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, update);
  }, []);
  return <CoverStudioSession key={`${identity}:${props.initialBookId ?? ""}`} {...props} identity={identity} />;
}

function CoverStudioSession({ initialBookId, embedded, identity }: { initialBookId?: string; embedded?: boolean; identity: string }) {
  const [bookId, setBookId] = useState(initialBookId ?? "");
  const [books, setBooks] = useState<ReadonlyArray<BookSummary>>([]);
  const [catalog, setCatalog] = useState<CoverCatalog | null>(null);
  const [recommendation, setRecommendation] = useState<CoverCatalog["recommendation"]>();
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [prompt, setPrompt] = useState("");
  const [styleId, setStyleId] = useState("");
  const [customType, setCustomType] = useState(false);
  const [typography, setTypography] = useState<CoverTypography>(DEFAULT_TYPE);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [jobs, setJobs] = useState<CoverJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [applyBookId, setApplyBookId] = useState(initialBookId ?? "");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [thumbnail, setThumbnail] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const live = useRef(true);
  const storageKey = `skoob.cover.pending:${JSON.stringify([API_ORIGIN, identity, bookId])}`;
  const [pending, setPending] = useState<Pending | null>(null);
  const selected = jobs.find((job) => job.id === selectedId);
  const running = jobs.some(isCoverRunning);
  const blocked = Boolean(busy) || loading;

  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void fetchCoverCatalog().then((value) => { if (active) setCatalog(value); }).catch((e) => { if (active) setError(message(e)); });
    void fetchBooks().then((value) => { if (active) setBooks(value); }).catch((e) => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setJobs([]); setSelectedId(""); setCurrentUrl(null); setError(""); setNotice("");
    setApplyBookId(bookId); setPending(null);
    setTitle(""); setGenre(""); setSynopsis(""); setPrompt("");
    let restored = false;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const value = JSON.parse(saved) as Pending;
        if (typeof value.key === "string" && typeof value.input?.title === "string") {
          setPending(value); setTitle(value.input.title); setGenre(value.input.genre); setSynopsis(value.input.synopsis);
          setPrompt(value.input.prompt ?? ""); setStyleId(value.input.styleId ?? "");
          if (value.input.typography) { setTypography(value.input.typography); setCustomType(true); }
          restored = true;
        }
      }
    } catch { /* 浏览器不提供会话存储时仍可生成。 */ }
    const material = bookId ? fetchCoverMaterial(bookId).then((value) => {
      if (!active) return;
      if (!restored) { setTitle(value.title); setGenre(value.genre); setSynopsis(value.synopsis ?? ""); }
      setCurrentUrl(value.coverUrl);
    }) : Promise.resolve();
    void Promise.all([material, listCoverJobs(bookId || undefined).then((value) => {
      if (active) { setJobs(value); setSelectedId(value[0]?.id ?? ""); }
    })]).catch((e) => { if (active) setError(message(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bookId, storageKey]);
  useEffect(() => {
    setRecommendation(undefined);
    if (!genre.trim() || styleId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchCoverCatalog(genre.trim(), controller.signal).then((value) => {
        if (!controller.signal.aborted) setRecommendation(value.recommendation);
      }).catch(() => { /* 推荐读取失败不改变用户输入或风格，生成时由后端解析。 */ });
    }, 350);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [genre, styleId]);
  useEffect(() => {
    if (!running) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const value = await listCoverJobs(bookId || undefined); if (active) setJobs(value); }
      catch (e) { if (active) setError(`进度读取失败：${message(e)}。不会重新发起生图。`); }
      if (active) timer = setTimeout(() => void poll(), 3000);
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => { active = false; clearTimeout(timer); };
  }, [running, bookId]);

  const savePending = (value: Pending | null) => {
    setPending(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); }
    catch { /* 当前页面仍保留相同的幂等键。 */ }
  };
  const addJob = (job: CoverJob) => {
    setJobs((previous) => [job, ...previous.filter((entry) => entry.id !== job.id)]); setSelectedId(job.id);
  };
  const run = async (name: string, action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(name); setError(""); setNotice("");
    try { await action(); } catch (e) { if (live.current) setError(message(e)); }
    finally { lock.current = false; if (live.current) setBusy(""); }
  };
  const generate = () => void run("generate", async () => {
    const request = pending ?? { key: crypto.randomUUID(), input: {
      ...(bookId ? { bookId } : {}), title: title.trim(), genre: genre.trim(), synopsis: synopsis.trim(),
      ...(prompt.trim() ? { prompt: prompt.trim() } : {}), ...(styleId ? { styleId } : {}),
      ...(customType ? { typography } : {}),
    } };
    savePending(request);
    try {
      const job = await createCoverJob(request.input, request.key);
      if (!live.current) return;
      addJob(job); savePending(null);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) savePending(null);
      throw e;
    }
  });
  const refresh = () => void run("refresh", async () => {
    const [nextCatalog, nextJobs, material] = await Promise.all([
      fetchCoverCatalog(genre.trim() || undefined), listCoverJobs(bookId || undefined),
      bookId ? fetchCoverMaterial(bookId) : Promise.resolve(null),
    ]);
    if (live.current) {
      setCatalog(nextCatalog); setRecommendation(nextCatalog.recommendation); setJobs(nextJobs);
      if (material) setCurrentUrl(material.coverUrl);
      setSelectedId((id) => nextJobs.some((job) => job.id === id) ? id : nextJobs[0]?.id ?? "");
    }
  });
  const selectedStyle = catalog?.styles.find((style) => style.id === styleId);
  const recommendedStyle = catalog?.styles.find((style) => style.id === recommendation?.styleId);
  const displayType = customType ? typography : selectedStyle?.typography ?? recommendedStyle?.typography ?? DEFAULT_TYPE;
  const editType = <K extends keyof CoverTypography>(key: K, value: CoverTypography[K]) => {
    setTypography({ ...displayType, [key]: value }); setCustomType(true);
  };

  return <section className={`cover-studio${embedded ? " is-embedded" : ""}`} aria-label="天工封面编辑器">
    <div className="cover-story">
      <div className="cover-section-head"><h2>故事与风格</h2>{embedded && <Link to={`/covers?bookId=${encodeURIComponent(bookId)}`}>完整编辑页</Link>}</div>
      {!embedded && <label>素材来源<select value={bookId} disabled={blocked || Boolean(pending)} onChange={(e) => setBookId(e.target.value)}>
        <option value="">直接输入</option>{books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
      </select></label>}
      <fieldset disabled={blocked || Boolean(pending)} className="cover-fields">
        <label>书名 <span aria-hidden="true">*</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="输入真实书名" /></label>
        <label>题材 <span aria-hidden="true">*</span><input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="例如：历史架空、庙堂权谋" /></label>
        <label>故事简介<textarea value={synopsis} onChange={(e) => setSynopsis(e.target.value)} rows={4} placeholder="人物、时代、冲突与代表性场景" /></label>
        {!synopsis.trim() && <p className="cover-help">补充简介能让封面更贴合故事，也可以只按书名和题材生成。</p>}
        <label>封面风格<select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
          <option value="">按题材推荐</option>{catalog?.styles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
        </select></label>
        <p className="cover-help">{selectedStyle ? `已选择：${selectedStyle.name}` : recommendation
          ? `推荐：${catalog?.styles.find((style) => style.id === recommendation.styleId)?.name ?? recommendation.styleId} · ${recommendation.reason}`
          : "按实际题材匹配后台风格规则，结果会显示采用的风格。"}</p>
        {catalog && catalog.styles.length > 0 && <div className="cover-style-list" aria-label="可选封面风格">{catalog.styles.map((style) => <button
          key={style.id} type="button" className={`cover-style${styleId === style.id ? " is-selected" : ""}`} aria-pressed={styleId === style.id} onClick={() => setStyleId(style.id)}>
          {style.sampleUrl && <img src={style.sampleUrl} alt={`${style.name}样例`} loading="lazy" />}<strong>{style.name}</strong>
          <span>{style.genres.join(" · ") || "通用风格"}</span>
        </button>)}</div>}
        <label>画面补充要求<textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：雨夜宫门，一把遗落的油纸伞" /></label>
        <details className="cover-typography"><summary>书名排版 · {customType ? "自定义" : "随风格"}</summary>
          <label>模板<select value={displayType.template} onChange={(e) => editType("template", e.target.value as CoverTypography["template"])}>
            <option value="classic">古风</option><option value="modern">现代</option><option value="suspense">悬疑</option><option value="scifi">科幻</option>
          </select></label>
          <label>字体<select value={displayType.font} onChange={(e) => editType("font", e.target.value as CoverTypography["font"])}><option value="serif">宋体</option><option value="sans">黑体</option></select></label>
          <label>文字颜色<input type="color" value={displayType.color} onChange={(e) => editType("color", e.target.value)} /></label>
          <label>位置<select value={displayType.position} onChange={(e) => editType("position", e.target.value as CoverTypography["position"])}><option value="top">顶部</option><option value="bottom">底部</option></select></label>
          <button type="button" className="cv-btn" onClick={() => setCustomType(false)}>恢复随风格</button>
        </details>
      </fieldset>
      <div className="cover-service">
        {catalog?.models.image && <p>生图：{catalog.models.image.service} / {catalog.models.image.model}</p>}
        {catalog?.models.text && <p>策划：{catalog.models.text.service} / {catalog.models.text.model}</p>}
        {catalog && !catalog.configured && <p>平台尚未发布封面策略，请联系管理员。输入会保留，上传封面仍可使用。</p>}
        {catalog && !catalog.models.image && <p>尚未配置个人 AI 生图模型。<Link to="/settings/models">配置 AI 生图</Link></p>}
        {!catalog && <p>正在读取封面配置…</p>}
        <button type="button" className="cover-text-button" onClick={refresh} disabled={blocked}><RefreshCw size={13} /> 刷新配置与进度</button>
      </div>
      {pending && <p className="cover-warning" role="status">上次请求结果尚未确认。核实原请求会使用同一个请求编号，避免重复生成。</p>}
      <button className="cv-btn is-primary cover-generate" disabled={blocked || (!pending && (!catalog?.configured || !catalog.models.image || !title.trim() || !genre.trim() || running))} onClick={generate}>
        {busy === "generate" ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
        {pending ? "核实原请求" : running ? "正在生成候选…" : "生成一张封面"}
      </button>
      {error && <p className="cv-err" role="alert">{error}</p>}
      {notice && <p className="cover-notice" role="status">{notice}</p>}
    </div>
    <div className="cover-results">
      <div className="cover-section-head"><h2>封面预览</h2><button className="cover-text-button" onClick={() => setThumbnail(!thumbnail)}>{thumbnail ? "完整尺寸" : "列表缩略图"}</button></div>
      <div className={`cover-preview${thumbnail ? " is-thumbnail" : ""}`}>
        {selected?.url ? <img src={selected.url} alt={`${selected.input.title}候选封面`} /> : <div className="cover-placeholder"><ImagePlus size={32} /><strong>{selected ? COVER_STATUS[selected.status] : "你的下一张封面"}</strong><span>{selected ? selected.input.title : "填好故事，生成后在这里预览"}</span>{selected && isCoverRunning(selected) && <Loader2 className="spin" size={20} />}</div>}
      </div>
      {selected && <div className="cover-result-info" aria-live="polite"><strong>{COVER_STATUS[selected.status]}</strong>{selected.styleName && <span> · {selected.styleName}</span>}
        {selected.configVersion !== undefined && <span> · 策略 v{selected.configVersion}</span>}
        {selected.imageModel && <p>生图模型：{selected.imageModel}</p>}{selected.error && <p role="alert" className="cv-err">{selected.error}</p>}
        {selected.status === "uncertain" && <p>服务结果待核实。请刷新进度，不会自动重发生成请求。</p>}
      </div>}
      {selected && ((selected.status === "completed" && selected.url) || selected.rawUrl) && <div className="cover-result-actions">
        {selected.status === "completed" && selected.url && <button className="cv-btn" disabled={blocked} onClick={() => void run("download", () => downloadCoverJob(selected))}><Download size={14} /> 下载封面</button>}
        <button className="cv-btn" disabled={blocked || !title.trim() || !selected.rawUrl || isCoverRunning(selected)} title={!selected.rawUrl ? "此封面没有可复用的无字底图" : undefined} onClick={() => void run("recompose", async () => {
          const type = customType ? typography : selected.typography ?? selected.input.typography ?? catalog?.styles.find((style) => style.id === selected.styleId)?.typography ?? DEFAULT_TYPE;
          const job = await recomposeCoverJob(selected.id, title.trim(), type); if (live.current) addJob(job);
        })}>仅重排书名</button>
        <p className="cover-help">改书名或排版后，可复用底图。候选不会自动替换作品封面。</p>
        {selected.status === "completed" && selected.url && <>{!bookId && <label>应用到作品<select value={applyBookId} disabled={blocked} onChange={(e) => setApplyBookId(e.target.value)}><option value="">选择我的作品</option>{books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>}
        <button className="cv-btn is-primary" disabled={blocked || !applyBookId} onClick={() => void run("apply", async () => {
          const result = await applyCoverJob(selected.id, applyBookId);
          if (live.current) { if (bookId === applyBookId) setCurrentUrl(result.url); setNotice("已设为作品封面"); }
          const nextJobs = await listCoverJobs(bookId || undefined); if (live.current) setJobs(nextJobs);
        })}>设为作品封面</button></>}
      </div>}
      <div className="cover-history"><h3>最近的候选</h3>{jobs.length === 0 && <p className="cover-help">{loading ? "读取候选中…" : "还没有生成记录"}</p>}
        <div className="cover-history-list">{jobs.map((job) => <button key={job.id} className={job.id === selectedId ? "is-selected" : ""} aria-pressed={job.id === selectedId} disabled={Boolean(busy)} onClick={() => {
          setSelectedId(job.id);
          if (!pending) {
            setTitle(job.input.title); setGenre(job.input.genre); setSynopsis(job.input.synopsis ?? ""); setPrompt(job.input.prompt ?? "");
            setStyleId(job.input.styleId ?? ""); setCustomType(Boolean(job.input.typography));
            if (job.input.typography) setTypography(job.input.typography);
          }
        }}>
          {job.url ? <img src={job.url} alt={`${job.input.title}候选`} loading="lazy" /> : <div className="cover-history-empty">{isCoverRunning(job) ? <Loader2 className="spin" size={18} /> : <ImagePlus size={18} />}</div>}
          <span>{job.input.title}</span><small>{COVER_STATUS[job.status]}</small>
        </button>)}</div>
      </div>
      {bookId && <div className="cover-current"><h3>作品当前封面</h3>{currentUrl ? <img src={currentUrl} alt={`${title}当前封面`} /> : <p className="cover-help">还没有封面</p>}
        <input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
          const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
          if (file.size > 5 * 1024 * 1024) { setError("封面不能超过 5MB"); return; }
          void run("upload", async () => { const result = await uploadCover("book", bookId, file); if (live.current) { setCurrentUrl(result.url); setNotice("已上传并更新作品封面"); } });
        }} />
        <div className="cover-current-actions"><button className="cv-btn" disabled={blocked} onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> 上传封面</button>
          {currentUrl && <button className="cv-btn is-danger" disabled={blocked} onClick={() => void run("delete", async () => { await deleteCover("book", bookId); if (live.current) setCurrentUrl(null); })}><Trash2 size={14} /> 删除封面</button>}</div>
        <p className="cover-help">上传会直接更新当前封面。建议 3:4 竖版，JPG / PNG / WebP，不超过 5MB。</p>
      </div>}
    </div>
  </section>;
}
