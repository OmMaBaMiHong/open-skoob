/** 天魔扫榜：平台切换、最近报告、历史与选题，首页和独立阅读页共用。 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radar, RefreshCw, Loader2, AlertCircle, Crown, TrendingUp, PenLine, History, X, SlidersHorizontal, BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { fetchScanPlatforms, generateScanReport, listScanReports, fetchScanReport, fetchHotboards, reportFunnelEvents,
  type ScanPlatform, type ScanReport, type ScanReportSummary, type ScanSection, type ScanTopic, type HotboardSnapshot } from "../lib/api";
import { readAuth } from "../lib/auth-storage";
import { startOAuthLogin } from "../lib/account";
import { useTianmoScope, readTianmoView, saveTianmoView } from "../lib/tianmo-view";

/** 可行性 → 徽标样式（高/中/低）。 */
function feasClass(feasibility?: string): string {
  if (feasibility?.includes("高")) return "scan-feas scan-feas--high";
  if (feasibility?.includes("低")) return "scan-feas scan-feas--low";
  return "scan-feas scan-feas--mid";
}

function SectionBlock({ section }: { readonly section: ScanSection }) {
  return (
    <section className="scan-section">
      <h3 className="scan-section-t">{section.title}</h3>
      {section.type === "table" && section.headers && section.rows ? (
        <div className="scan-table-wrap">
          <table className="scan-table">
            <thead>
              <tr>{section.headers.map((header, i) => <th key={i}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {section.rows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="scan-list">
          {(section.items ?? []).map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}
    </section>
  );
}

function TopicCard({ topic, onUse }: {
  readonly topic: ScanTopic;
  readonly onUse: (topic: ScanTopic) => void;
}) {
  const rows: ReadonlyArray<[string, string | undefined]> = [
    ["题材组合", topic.genre],
    ["目标读者", topic.audience],
    ["能爆的原因（假设，待拆文验证）", topic.whyHot],
    ["市场验证", topic.market],
    ["差异化定位", topic.differentiation],
    ["失败风险", topic.risk],
    ["验证动作", topic.validation],
    ["篇幅/平台", topic.lengthPlatform],
  ];
  return (
    <div className="scan-topic">
      <header className="scan-topic-h">
        <TrendingUp size={15} />
        <strong>{topic.title}</strong>
        <span className={feasClass(topic.feasibility)}>可行性 {topic.feasibility ?? "中"}</span>
      </header>
      {topic.feasibilityReason && <p className="scan-topic-feas">{topic.feasibilityReason}</p>}
      <details className="scan-topic-details">
      <summary>查看依据与风险</summary>
      <dl className="scan-topic-rows">
        {rows.filter(([, value]) => value).map(([label, value]) => (
          <div className="scan-topic-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      </details>
      <button className="scan-topic-use" onClick={() => onUse(topic)}>
        <PenLine size={13} /> 用这个开写
      </button>
    </div>
  );
}

function OriginalBoards({ platform }: { readonly platform: ScanPlatform }) {
  const track = useRef<HTMLDivElement>(null);
  const [snapshots, setSnapshots] = useState<ReadonlyArray<HotboardSnapshot>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true); setError("");
    void fetchHotboards("fiction", { refresh: refresh > 0 }).then((result) => {
      if (live) setSnapshots(result.boards.filter((board) => platform.boards.some((entry) => entry.id === board.id)));
    }).catch(() => { if (live) setError("榜单加载失败，请重试。"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [platform.id, refresh]);
  return <section className="scan-originals" aria-label="原始榜单">
    <header className="scan-originals-head"><h3><BookOpen size={15} /> {platform.name} · 原始榜单</h3>
      <div className="scan-original-actions">
        <button className="scan-secondary" aria-label="向左滑动榜单" onClick={() => track.current?.scrollBy({ left: -352, behavior: "smooth" })}><ChevronLeft size={15} /></button>
        <button className="scan-secondary" aria-label="向右滑动榜单" onClick={() => track.current?.scrollBy({ left: 352, behavior: "smooth" })}><ChevronRight size={15} /></button>
        <button className="scan-secondary" disabled={loading} title="刷新榜单，不会重新生成分析报告" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={13} /> 刷新</button>
      </div></header>
    {loading ? <p role="status">正在加载榜单…</p> : error ? <p role="alert">{error}</p> : snapshots.length === 0 ? <p>该平台暂未采集到榜单样本。</p> :
      <div className="scan-original-track" ref={track} tabIndex={0} role="region" aria-label="榜单横向轨道">{snapshots.map((board) => <section className="scan-original-board" key={board.id}>
        <h4>{board.name}</h4>
        <p className="scan-original-updated">{board.updatedAt ? new Date(board.updatedAt).toLocaleString("zh-CN") : "采集时间未知"}</p>
        {board.error && <p className="scan-muted">采集异常，展示已有榜单</p>}
        <ol tabIndex={0} aria-label={board.name}>{board.items.map((item, index) => {
          const metaLine = [item.meta?.category, item.meta?.author].filter(Boolean).join(" · ");
          const metric = item.heatLabel || item.meta?.metricLabel || "";
          const wordCount = item.meta?.wordCount;
          const dataLine = [wordCount && !String(metric).includes(String(wordCount)) ? wordCount : "", metric].filter(Boolean).join(" · ");
          return <li key={item.id}>
            <span className={`scan-rank ${index < 3 ? "is-top" : ""}`}>{index + 1}</span>
            <div className="scan-original-item">
              {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : <span>{item.title}</span>}
              {metaLine && <p className="scan-original-meta">{metaLine}</p>}
              {dataLine && <p className="scan-original-data">{dataLine}</p>}
            </div>
          </li>;
        })}</ol>
      </section>)}</div>}
  </section>;
}

interface ScanPanelProps { readonly onPick?: (seed: string) => void }

export function ScanPanel(props: ScanPanelProps) {
  const scope = useTianmoScope();
  return <ScanReader key={scope} scope={scope} {...props} />;
}

function ScanReader({ scope, onPick }: ScanPanelProps & { readonly scope: string }) {
  const navigate = useNavigate();
  const [platforms, setPlatforms] = useState<ReadonlyArray<ScanPlatform>>([]);
  const [selected, setSelected] = useState(() => readTianmoView(scope).platform ?? "fanqie");
  const [platformError, setPlatformError] = useState("");
  const [platformLoading, setPlatformLoading] = useState(true);
  const [platformReload, setPlatformReload] = useState(0);
  const [boards, setBoards] = useState<ReadonlyArray<string>>([]);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [reports, setReports] = useState<ReadonlyArray<ScanReportSummary>>([]);
  const [latestId, setLatestId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [actionError, setActionError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [memberRequired, setMemberRequired] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const request = useRef(0);
  const historyDialog = useRef<HTMLDialogElement>(null);
  const reportTop = useRef<HTMLElement>(null);
  const current = platforms.find((platform) => platform.id === selected);
  const mode = current?.mode ?? "long";
  const modePlatforms = platforms.filter((platform) => platform.mode === mode);

  useEffect(() => {
    let live = true;
    setPlatformLoading(true); setPlatformError("");
    void fetchScanPlatforms().then((list) => {
      if (!live) return;
      setPlatforms(list);
      setSelected((id) => list.some((platform) => platform.id === id) ? id : list[0]?.id ?? "");
    }).catch(() => { if (live) setPlatformError("平台加载失败，请重试。"); })
      .finally(() => { if (live) setPlatformLoading(false); });
    return () => { live = false; };
  }, [platformReload]);

  useEffect(() => {
    if (!current) return;
    const version = ++request.current;
    setBoards(current.boards.map((board) => board.id));
    setReport(null); setReports([]); setLatestId(null); setLoading(true);
    setReportError(""); setActionError(""); setMemberRequired(false); setHistoryOpen(false);
    saveTianmoView(scope, { platform: current.id });
    if (!readAuth()) { setLoading(false); return () => { request.current++; }; }
    const filters = { platform: current.id, mode: current.mode };
    void Promise.all([
      listScanReports(1, { ...filters, status: "succeeded" }),
      listScanReports(100, filters),
    ]).then(async ([latest, history]) => {
      if (version !== request.current) return;
      setReports(history); setLatestId(latest[0]?.id ?? null);
      if (latest[0]) {
        const detail = await fetchScanReport(latest[0].id);
        if (version !== request.current) return;
        if (detail.platform !== current.id || detail.mode !== current.mode || detail.status !== "succeeded") throw new Error("报告与平台不一致");
        setReport(detail); trackView(detail);
      }
    }).catch(() => { if (version === request.current) setReportError("报告加载失败，请重试。"); })
      .finally(() => { if (version === request.current) setLoading(false); });
    return () => { request.current++; };
  }, [current?.id, reload, scope]);

  useEffect(() => {
    if (!historyOpen) return;
    const dialog = historyDialog.current;
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute("open", "");
    return () => { if (dialog?.close) dialog.close(); };
  }, [historyOpen]);

  function trackView(detail: ScanReport) {
    void reportFunnelEvents([{ eventType: "scan_view", subjectType: "scan_report", subjectId: String(detail.id), subjectTitle: `${detail.platform}·${detail.mode}` }]);
  }

  function selectPlatform(id: string) {
    if (id === selected || generating) return;
    request.current++;
    setReport(null); setReports([]); setLoading(true); setHistoryOpen(false);
    setSelected(id);
  }

  async function openReport(id: number) {
    if (!current || generating) return;
    const version = ++request.current;
    setLoading(true); setReportError(""); setHistoryOpen(false);
    try {
      const detail = await fetchScanReport(id);
      if (version !== request.current) return;
      if (detail.platform !== current.id || detail.mode !== mode || detail.status !== "succeeded") throw new Error("报告不可读");
      setReport(detail); trackView(detail);
      reportTop.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    } catch { if (version === request.current) setReportError("报告加载失败，请重试。"); }
    finally { if (version === request.current) setLoading(false); }
  }

  async function startScan() {
    if (!current || generating || boards.length === 0) return;
    if (!readAuth()) { startOAuthLogin(window.location.href); return; }
    const version = ++request.current;
    setGenerating(true); setActionError(""); setMemberRequired(false);
    try {
      const result = await generateScanReport({ platform: current.id, boardIds: boards });
      if (version !== request.current) return;
      setReport(result); setLatestId(result.id); setReportError("");
      setReports((previous) => [result, ...previous]);
      void reportFunnelEvents([{ eventType: "scan_generate", subjectType: "scan_report", subjectId: String(result.id), subjectTitle: `${current.name}·${result.sampleCount}条` }]);
    } catch (error) {
      if (version !== request.current) return;
      const message = error instanceof Error ? error.message : "扫榜分析失败，请重试。";
      setActionError(message); setMemberRequired(message.includes("会员") || message.includes("MEMBER_REQUIRED"));
    } finally { if (version === request.current) setGenerating(false); }
  }

  function useTopic(topic: ScanTopic) {
    void reportFunnelEvents([{ eventType: "scan_topic_click", subjectType: "scan_topic", subjectId: String(report?.id ?? ""), subjectTitle: topic.title }]);
    const seed = [
      `【扫榜选题】${topic.title}`, topic.genre ? `题材：${topic.genre}` : "", topic.audience ? `读者：${topic.audience}` : "",
      topic.differentiation ? `差异化：${topic.differentiation}` : "", topic.risk ? `注意：${topic.risk}` : "",
      report ? `来源：${current?.name} · ${mode === "long" ? "长篇" : "短篇"}扫榜报告 #${report.id}（${formatTime(report.createdAt)}）` : "",
    ].filter(Boolean).join("\n");
    if (onPick) onPick(seed);
    else navigate("/create?tianmo=scan", { state: { scanSeed: seed } });
  }

  const hasSamples = current?.boards.some((board) => boards.includes(board.id) && board.sampleCount > 0);
  return <div className="scan-reader">
    <div className="scan-toolbar">
      <div className="scan-platform-tabs" role="tablist" aria-label="扫榜平台">
        {modePlatforms.map((platform) => <button key={platform.id} type="button" role="tab" id={`scan-tab-${platform.id}`}
          aria-selected={selected === platform.id} aria-controls="scan-content" tabIndex={selected === platform.id ? 0 : -1}
          disabled={generating} onClick={() => selectPlatform(platform.id)} onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const index = modePlatforms.findIndex((entry) => entry.id === selected);
            const next = event.key === "Home" ? 0 : event.key === "End" ? modePlatforms.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + modePlatforms.length) % modePlatforms.length;
            selectPlatform(modePlatforms[next]!.id);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
          }}>{platform.name}<span className="scan-tab-mark" /></button>)}
      </div>
      <div className="scan-mode" aria-label="扫榜篇幅">
        {(["long", "short"] as const).map((value) => <button key={value} aria-pressed={mode === value} disabled={generating || !platforms.some((platform) => platform.mode === value)}
          onClick={() => { if (mode !== value) selectPlatform(platforms.find((platform) => platform.mode === value)!.id); }}>{value === "long" ? "长篇" : "短篇"}</button>)}
      </div>
    </div>
    {platformLoading && <p className="scan-status" role="status"><Loader2 size={16} className="spin" /> 正在加载平台…</p>}
    {platformError && <div className="page-error" role="alert">{platformError}<button onClick={() => setPlatformReload((value) => value + 1)}>重试</button></div>}
    {!platformLoading && !platformError && platforms.length === 0 && <p className="scan-status">暂未接入扫榜平台</p>}
    {current && <div id="scan-content" role="tabpanel" aria-labelledby={`scan-tab-${selected}`}>
      <OriginalBoards key={selected} platform={current} />
      <header className="scan-reading-head" ref={reportTop}>
        <div><p className="scan-eyebrow">市场观察 · {mode === "long" ? "长篇" : "短篇"}</p><h2>{current.name}扫榜报告</h2>
          <p className="scan-muted">{report ? <>{report.id === latestId ? "最新报告" : "历史版本"} · {formatTime(report.createdAt)} · {report.sampleCount} 条样本</> : "从平台榜单，找到值得写的方向"}</p></div>
        <div className="scan-reading-actions">
          {report && report.id !== latestId && latestId && <button className="scan-secondary" disabled={loading || generating} onClick={() => void openReport(latestId)}>回到最新</button>}
          <button className="scan-secondary" disabled={loading || generating} onClick={() => setHistoryOpen(true)}><History size={14} /> 历史报告</button>
          <button className="scan-run" disabled={loading || generating || !hasSamples} onClick={() => void startScan()}>
            {generating ? <Loader2 size={14} className="spin" /> : <Radar size={14} />}{generating ? "正在分析…" : report ? "重新分析" : "生成报告"}</button>
        </div>
      </header>
      <details className="scan-scope" key={`scope-${selected}`}>
        <summary><SlidersHorizontal size={13} /> 分析范围 <span>{boards.length} 个榜单</span></summary>
        <p className="scan-muted">{current.profile}。调整仅用于下一次分析，已有报告的范围不变。</p>
        <div className="scan-scope-boards">{current.boards.map((board) => <label key={board.id}>
          <input type="checkbox" checked={boards.includes(board.id)} disabled={generating} onChange={(event) => setBoards((previous) => event.target.checked ? [...previous, board.id] : previous.filter((id) => id !== board.id))} />
          <span>{board.name ?? board.id}</span><small>{board.sampleCount} 条{board.sparse ? " · 样本较少" : ""}</small>
        </label>)}</div>
        {boards.length === 0 && <p role="status">请至少选择一个榜单。</p>}
      </details>
      {generating && <p className="scan-status" role="status">正在分析榜单样本，完成后会自动展示新报告。你可以继续阅读当前报告。</p>}
      {actionError && <div className="page-error" role="alert"><AlertCircle size={14} /> {actionError}{memberRequired && <button onClick={() => navigate("/pricing")}><Crown size={14} /> 查看会员方案</button>}</div>}
      {reportError && <div className="page-error" role="alert">{reportError}<button onClick={() => setReload((value) => value + 1)}>重试</button></div>}
      {loading && <p className="scan-status" role="status"><Loader2 size={16} className="spin" /> 正在读取报告…</p>}
      {report && <article className="scan-report" aria-busy={loading}>
        <p className="scan-report-range">本报告范围：{report.boardIds.map((id) => current.boards.find((board) => board.id === id)?.name ?? id).join("、")}</p>
        {report.qualityNote && <p className="scan-quality">样本提示：{report.qualityNote}</p>}
        {report.report.overview && <section className="scan-discovery"><span className="scan-eyebrow">核心发现</span><p>{report.report.overview}</p></section>}
        {report.topics?.length > 0 && <section className="scan-section"><h3 className="scan-section-t">值得写的方向 <span>从一个方向开始，再写出你的不同</span></h3>
          <div className="scan-topics">{report.topics.map((topic, index) => <TopicCard key={`${report.id}-${index}`} topic={topic} onUse={useTopic} />)}</div></section>}
        {!!report.report.sections?.length && <nav className="scan-contents" aria-label="报告目录">{report.report.sections.map((section, index) => <a key={index} href={`#scan-${report.id}-${index}`} onClick={(event) => {
          event.preventDefault(); document.getElementById(`scan-${report.id}-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}>{section.title}</a>)}</nav>}
        {report.report.sections?.map((section, index) => <div id={`scan-${report.id}-${index}`} className="scan-anchor" key={index}><SectionBlock section={section} /></div>)}
        {report.report.oneLiner && <p className="scan-oneliner">{report.report.oneLiner}</p>}
      </article>}
      {!loading && !report && !reportError && <div className="scan-empty"><BookOpen size={25} /><h3>还没有{current.name}的分析报告</h3>
        <p>{readAuth() ? "先看看已采集的榜单，会员可生成自己的选题分析。" : "榜单可以直接浏览，登录后查看自己的报告，会员可生成分析。"}</p>
        {!readAuth() && <button className="scan-secondary" onClick={() => startOAuthLogin(window.location.href)}>登录查看我的报告</button>}</div>}
      {historyOpen && <dialog ref={historyDialog} className="scan-history-dialog" role="dialog" aria-labelledby="scan-history-title" onCancel={() => setHistoryOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false); }}>
        <div className="scan-history-inner"><header><div><p className="scan-eyebrow">{current.name} · {mode === "long" ? "长篇" : "短篇"}</p><h3 id="scan-history-title">历史报告</h3></div><button className="scan-secondary" autoFocus aria-label="关闭历史报告" onClick={() => setHistoryOpen(false)}><X size={18} /></button></header>
          <p className="scan-muted">我的分析 · 最近 {reports.length} 份记录</p>
          {reports.length === 0 ? <p>还没有历史报告。</p> : <div className="scan-history-list">{reports.map((entry) => <button key={entry.id} data-report-id={entry.id}
            className={`scan-history-item ${report?.id === entry.id ? "is-on" : ""}`} disabled={entry.status !== "succeeded"} onClick={() => void openReport(entry.id)}>
            <strong>{formatTime(entry.createdAt)}<span>{entry.status === "succeeded" ? entry.id === latestId ? "最新" : "已完成" : "生成失败"}</span></strong>
            <p>{entry.overview || (entry.status === "succeeded" ? "查看这次分析" : "本次未生成可用报告，可返回后重新分析。")}</p><small>{entry.sampleCount} 条样本 · {entry.boardIds.length} 个榜单</small>
          </button>)}</div>}
        </div>
      </dialog>}
    </div>}
  </div>;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
