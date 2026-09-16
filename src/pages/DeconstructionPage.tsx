/**
 * DeconstructionPage —— 拆书流程（七师流水线）
 *
 * 这一页要回答的只有一个问题：**这本书拆到哪了，拆出什么了。**
 *
 * 所以主体不是步骤列表，是**七位师傅**：存 → 测 → 立 → 读 → 并 → 拆 → 验。
 * 每位师傅展开后是两块：
 *
 *   产出   他实际往图谱里放进了什么（22 个智能体、30 条关系边、174/174 章章纲…）
 *   门禁   他那一关的确定性断言过没过，期望多少、实际多少
 *
 * 每个数字都是后端刚从 Postgres 与 Neo4j 里数出来的，不采信任何"步骤自述"。
 * 这个区别不是洁癖：之前有过 353 步全绿、图谱里 0 个实体的实测——
 * 每步都只校验自己的返回值合不合 schema，没有一处在问「东西真的进去了吗」。
 * 现在这一页显示的就是「问出来的答案」。
 *
 *   /deconstruction        全部拆书任务
 *   /deconstruction/:slug  七师轨道 + 逐关产出与门禁
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DeconstructionChapterComparison } from "../components/DeconstructionChapterComparison";
import { DeconstructionPublicSwitch, type PublicationState } from "../components/DeconstructionPublicSwitch";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Loader2, CheckCircle2, Circle, AlertTriangle,
  ShieldCheck, ShieldAlert, RotateCcw, Pause, Play,
  BookOpen, Network, Sparkles, Layers, ScrollText, ChevronDown, ChevronRight,
  MessageCircleQuestion, Send, UserRound, X,
} from "lucide-react";
import {
  fetchDeconstructions, fetchDeconstruction, resetDeconstruction, startSourceDeconstruction, fetchJson,
  pauseDeconstruction, resumeDeconstruction, fetchAssetCategories, fetchAssetPage,
  type DeconstructionSummary, type DeconstructionDetail,
  type MasterProgress, type MasterProgressState,
  type AssetCategory, type AssetItem,
  askBookKb, fetchCharacterDossier,
  type KbAnswer, type CharacterDossier,
  fetchGraphData, fetchGraphNodeDetail, type GraphData, type GraphNodeDetail,
} from "../lib/api";
import { DeconstructionChat } from "../components/agent/DeconstructionChat";
import { DeconstructionLayout } from "../components/agent/DeconstructionLayout";
import { DeconstructionResource, type DeconstructionResourceRef } from "../components/agent/DeconstructionResource";
import { useI18n } from "../i18n";
import { DetailModal } from "../components/GenreTeamDetail";
import { GraphLegend } from "../components/LiveGraph";
import { ReactGraphCanvas } from "../components/novel-graph/ReactGraphCanvas";

/** 状态展示走 i18n（deconstruction.status.*），这里只存词条 key。 */
const STATUS_TEXT_KEY: Record<string, string> = {
  pending: "deconstruction.status.pending", running: "deconstruction.status.running",
  ready: "deconstruction.status.ready", failed: "deconstruction.status.failed",
};

/** 七师的流水线口诀，轨道上用——比 id 好认。 */
const MASTER_STEP: Readonly<Record<string, string>> = {
  archivist: "存", cartographer: "测", ontologist: "立",
  chronicler: "读", weaver: "并", loremaster: "拆", auditor: "验",
};

export function DeconstructionPage() {
  const { slug } = useParams<{ slug: string }>();
  return slug ? <Detail key={slug} slug={slug} /> : <List />;
}

/* ════════════════════════════ 列表 ════════════════════════════ */

function List() {
  const [rows, setRows] = useState<ReadonlyArray<DeconstructionSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bookFilter = params.get("book");

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchDeconstructions()
        .then((d) => { if (alive) { setRows(d); setError(null); } })
        .catch((e: unknown) => { if (alive) setError((e as Error).message); })
        .finally(() => { if (alive) setLoading(false); });
    };
    load();
    // 拆书是小时级的，列表 10 秒一轮足够；详情页才需要更勤。
    const timer = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  /* 从天王模板点某本书进来时，直接送进那本书的详情。 */
  useEffect(() => {
    if (!bookFilter || rows.length === 0) return;
    if (rows.some((r) => r.slug === bookFilter)) {
      navigate(`/deconstruction/${encodeURIComponent(bookFilter)}`, { replace: true });
    }
  }, [bookFilter, rows, navigate]);

  /* 暂停的不算「正在拆」——暂停是一等状态，既不滚动进度也不该催用户。 */
  const running = rows.filter((r) => r.status === "running" && !r.paused).length;
  /** 进程死过但没被暂停的任务：30 分钟没动按「已中断」显示（与后端 reset 判据同源）。 */
  const STALE_MS = 30 * 60 * 1000;
  const displayStatus = (r: DeconstructionSummary): { key: string; cls: string } => {
    if (r.paused) return { key: "deconstruction.status.paused", cls: "is-paused" };
    if (r.status === "running" && r.idleMs !== null && r.idleMs > STALE_MS) {
      return { key: "deconstruction.status.interrupted", cls: "is-interrupted" };
    }
    return { key: STATUS_TEXT_KEY[r.status] ?? "", cls: `is-${r.status}` };
  };
  /** 副标题：部分拆解的书要说清「拆了全书的多少」，不是当前师傅的阶段进度。 */
  const partialOf = (r: DeconstructionSummary): string | null =>
    r.paused && r.scopeChapters !== null && r.bookChapters !== null && r.scopeChapters < r.bookChapters
      ? `已拆 ${r.scopeChapters}/${r.bookChapters} 章`
      : null;

  return (
    <div className="dc">
      <header className="dc-top">
        <div className="dc-brand">{t("deconstruction.title")}</div>
      </header>

      <div className="dc-wrap">
        <div className="dc-lead">
          <h1>{t("deconstruction.tasks_title")}</h1>
          <p>
            每本书要过七位师傅：<b>入库师</b>存原文 → <b>测绘师</b>量骨架 → <b>本体师</b>立图谱 →{" "}
            <b>纪事师</b>读章纲 → <b>脉络师</b>并脉络 → <b>设定师</b>拆智能体 → <b>验收师</b>逐条验收。
            每位做完立刻回读数据库校验，不合格当场停。
          </p>
          {running > 0 && (
            <div className="dc-alert is-info">
              <Loader2 size={16} className="spin" />
              {running} 本正在拆解中，进度每 10 秒刷新。
            </div>
          )}
        </div>

        {loading && <div className="dc-loading"><Loader2 size={18} className="spin" />{t("common.loading")}</div>}
        {error && <div className="dc-error"><AlertTriangle size={16} />{error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div className="dc-empty">还没有拆书任务。上传一本书就会自动开始。</div>
        )}

        <div className="dc-list">
          {rows.map((r) => {
            const ds = displayStatus(r);
            return (
              <div key={r.slug} className="dc-row-entry"><Link to={`/deconstruction/${encodeURIComponent(r.slug)}`} className="dc-row">
                <div className="dc-row-main">
                  <div className="dc-row-title">{r.title}</div>
                  <div className="dc-row-sub">
                    {r.status === "failed" && r.failedReason
                      ? <span className="dc-row-fail">{r.failedReason}</span>
                      : partialOf(r)
                        ? <><b>{partialOf(r)}</b>，已暂停——点进来可继续拆</>
                        : r.currentMasterName
                          ? <>{r.paused
                              ? <>已暂停在<b>{r.currentMasterName}</b></>
                              : <>正在由<b>{r.currentMasterName}</b>处理</>
                            }{r.stageTotal > 0 ? ` · ${r.stageDone}/${r.stageTotal}` : ""}</>
                          : "—"}
                  </div>
                </div>
                <div className="dc-row-bar"><i style={{ width: `${r.percent}%` }} /></div>
                <span className={`dc-tag ${ds.cls}`}>{ds.key ? t(ds.key) : r.status}</span>
              </Link><DeconstructionPublicSwitch slug={r.slug} /></div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════ 详情：三栏工作台 ════════════════════════════ */

const STATE_TEXT: Record<MasterProgressState, string> = {
  done: "已完成", active: "进行中", pending: "待执行", failed: "卡在这里",
};

/** 样本组 → 左栏资产类别：点了样本就跳到那一类的完整列表。 */
const SAMPLE_TARGET: Readonly<Record<string, string>> = {
  "章纲": "chapters",
  "叙事单元": "cycles",
  "逆向大纲": "outlines",
  "关系网": "relations",
};

/** 「智能体」样本的 kind（中文类型名）→ 左栏资产类别。 */
const ENTITY_KIND_TARGET: Readonly<Record<string, string>> = {
  "角色": "entity:Character", "势力": "entity:Organization", "地图": "entity:Location",
  "器物": "entity:Artifact", "规则": "entity:Rule", "资源": "entity:Resource",
  "事件": "entity:Event",
};

/** 中间舞台上现在摆的是什么。 */
type Stage =
  | { readonly type: "master"; readonly id: string }
  | { readonly type: "asset"; readonly kind: string; readonly label: string }
  /** 知识库问答——与聊天里的 ask_knowledge_base 工具同一份后端。 */
  | { readonly type: "ask"; readonly prefill?: string; readonly nonce?: number }
  /** 图谱总览——这本书拆出来的实体与关系，整张网。 */
  | { readonly type: "graph" }
  /** 角色完整档案页（从角色卡点进来）。 */
  | { readonly type: "dossier"; readonly name: string };

function categoryIcon(kind: string): JSX.Element {
  if (kind === "golden-three") return <Sparkles size={13} />;
  if (kind === "opening") return <Sparkles size={13} />;
  if (kind === "chapters") return <ScrollText size={13} />;
  if (kind === "relations") return <Network size={13} />;
  if (kind === "outlines") return <Sparkles size={13} />;
  if (kind === "cycles") return <Layers size={13} />;
  return <BookOpen size={13} />;
}

function Detail({ slug }: { readonly slug: string }) {
  const [publication, setPublication] = useState<PublicationState | null>(null);
  const isOwner = publication?.canManage === true;
  const [view, setView] = useState<(DeconstructionDetail & { activityMessage?: string }) | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [cats, setCats] = useState<ReadonlyArray<AssetCategory>>([]);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [resource, setResource] = useState<DeconstructionResourceRef | null>(null);
  useEffect(() => setResource(null), [stage]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** 顶部常驻问答框的输入（回车 → ask stage 自动提问）。 */
  const [askInput, setAskInput] = useState("");
  const { t } = useI18n();

  const load = useCallback(() => {
    fetchJson<PublicationState>(`/deconstructions/${encodeURIComponent(slug)}/publication`, { cache: "no-store" })
      .then(setPublication).catch(() => setPublication(null));
    fetchDeconstruction(slug)
      .then((v) => { setView(v); setRefreshVersion(n => n + 1); setError(null); })
      .catch((e: unknown) => setError((e as Error).message));
    fetchAssetCategories(slug).then(setCats).catch(() => undefined);
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!view || view.paused || !["pending", "running"].includes(view.status)) return;
    // Legacy jobs may have no agent event stream. Only refresh progress/catalog;
    // GraphStage keeps the same slug and its canvas is not remounted.
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load, view?.status, view?.paused]);

  /* 默认摆当前这位师傅——用户进来最想看「现在在干什么」。 */
  useEffect(() => {
    if (view && stage === null && view.currentMaster) {
      setStage(view.paused && view.scopeChapters ? { type: "asset", kind: "chapters", label: "章节目录" } : { type: "master", id: view.currentMaster });
    }
  }, [view, stage]);

  const act = useCallback(async (what: "pause" | "resume" | "restart") => {
    setBusy(true);
    setNote(null);
    try {
      if (what === "pause") setNote((await pauseDeconstruction(slug)).message);
      else if (what === "resume") setNote(await resumeDeconstruction(slug, view?.paused && view.scopeChapters ? { remaining: true } : undefined));
      else {
        const out = await resetDeconstruction(slug, true);
        if (!out.ok) { setNote(out.reason); return; }
        await startSourceDeconstruction({ sourceId: slug });
        setNote("已从头重拆，七位师傅会连着跑完。");
      }
      load();
    } catch (e: unknown) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [slug, load, view?.paused, view?.scopeChapters]);

  if (error && !view) {
    return (
      <div className="dcw">
        <header className="dcw-top">
          <Link to="/deconstruction" className="dc-back"><ArrowLeft size={16} />{t("deconstruction.all_tasks")}</Link>
        </header>
        <div className="dc-error" style={{ margin: 24 }}><AlertTriangle size={16} />{error}</div>
      </div>
    );
  }
  if (!view) {
    return <div className="dcw"><div className="dc-loading"><Loader2 size={18} className="spin" />{t("common.loading")}</div></div>;
  }

  const done = view.masters.filter((m) => m.state === "done").length;
  const current = view.masters.find((m) => m.id === view.currentMaster);

  /* 按后端给的 group 归拢，保持后端声明的顺序——顺序本身有意义：
     故事骨架在前（读者先关心这本书讲什么），章节在后。 */
  const groups: ReadonlyArray<readonly [string, ReadonlyArray<AssetCategory>]> = (() => {
    const map = new Map<string, AssetCategory[]>();
    for (const c of cats) {
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    }
    return [...map.entries()];
  })();

  return (
    /* 图谱页整页一种底色（is-graph 时左栏融入 --bg，不再白/米黄撞色） */
    <div className={`dcw${stage?.type === "graph" ? " is-graph" : ""}`}>
      {/* ── 顶栏：七师轨道 ── */}
      <header className="dcw-top">
        <Link to="/deconstruction" className="dc-back"><ArrowLeft size={16} /></Link>
        <span className="dcw-title">拆一本书</span>
        <div className="dcw-rail">
          {view.masters.map((m, i) => (
            <button
              key={m.id}
              className={`dcw-rail-item is-${m.state}${stage?.type === "master" && stage.id === m.id ? " is-on" : ""}`}
              onClick={() => setStage({ type: "master", id: m.id })}
              title={`${m.name}：${m.duty}`}
            >
              <span className="dcw-rail-no">
                {m.state === "done" ? <CheckCircle2 size={11} />
                  : m.state === "failed" ? <AlertTriangle size={11} />
                    : m.state === "active" ? <Loader2 size={11} className="spin" />
                      : i + 1}
              </span>
              {m.name}
            </button>
          ))}
        </div>
        <span className="dcw-count">{done} / {view.masters.length}</span>
      </header>

      {/* ── 状态 + 常驻问答框（大而居中，随时可问）+ 主操作（继续拆/暂停跟在状态旁） ── */}
      <div className="dcw-hint">
        <span className="dcw-hint-text">
          {view.paused
            ? view.scopeChapters !== null && view.bookChapters !== null && view.scopeChapters < view.bookChapters
              ? <><Pause size={13} />本次范围拆完：已分析 {view.scopeChapters}/{view.bookChapters} 章，图谱里已有 {view.agentCount} 个智能体。验收与发布留到全本拆完——在右侧选择追加章数或继续拆完剩余章节。</>
              : <><Pause size={13} />已暂停在「{current?.name ?? "当前这关"}」。进度都在，点「继续拆」从这里接着来。</>
            : view.status === "failed"
              ? <><AlertTriangle size={13} />{view.failedReason}</>
              : view.status === "ready"
                ? <><CheckCircle2 size={13} />拆完了：图谱里有 {view.agentCount} 个可召唤的智能体。</>
                : <><Loader2 size={13} className="spin" />{current?.duty ?? "正在拆解"}</>}
        </span>
        <form
          className="dcw-askbox"
          onSubmit={(e) => {
            e.preventDefault();
            const q = askInput.trim();
            if (!q) return;
            setStage({ type: "ask", prefill: q, nonce: Date.now() });
            setAskInput("");
          }}
        >
          <MessageCircleQuestion size={14} />
          <input
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            placeholder="问这本书…"
            aria-label="问这本书"
          />
        </form>
        {isOwner && (view.status === "running" || view.status === "failed") && (
          <button
            className="dc-btn is-primary dcw-hint-btn"
            disabled={busy}
            onClick={() => void act(view.paused || view.status === "failed" ? "resume" : "pause")}
          >
            {busy ? <Loader2 size={14} className="spin" /> : view.paused || view.status === "failed" ? <Play size={14} /> : <Pause size={14} />}
            {view.status === "failed" ? "重试拆书" : view.paused ? view.scopeChapters ? "拆完剩余" : "继续拆" : "暂停"}
          </button>
        )}
      </div>

      <DeconstructionLayout contentKey={resource ?? stage}>
        {/* ── 左栏：小说要素 ──
             这里不列七位师傅：师傅是我们的流水线机器，已经在顶部轨道上。
             用户打开这一页想看的是**小说本身有什么**。 */}
        <aside className="dcw-side">
          <div className="dcw-book">
            <div className="dcw-book-title">《{view.title}》</div>
            <div className="dcw-book-sub">
              {view.status === "ready" ? "已拆完" : view.paused ? "已暂停" : "拆解中"}
              {view.stageTotal > 0 && ` · ${view.stageDone}/${view.stageTotal}`}
            </div>
            {/* token 账本（调研 §3.6 DeterminFlow）：烧了多少钱必须看得见，不能只活在日志里 */}
            {isOwner && view.usageTokens > 0 && (
              <div className="dcw-book-usage" title="贵价调用累计入账（档案生成等）">
                {view.usageTokens.toLocaleString()} tokens
                {view.usageCostUsd > 0 && ` · $${view.usageCostUsd.toFixed(4)}`}
              </div>
            )}
            <div className="dcw-bar">
              <i style={{ width: `${Math.round((done / view.masters.length) * 100)}%` }} />
            </div>
          </div>

          {/* 图谱总览——拆出来的实体与关系网整张铺开，放在资产列表之上。 */}
          <button
            className={`dcw-item dcw-graph-entry${stage?.type === "graph" ? " is-on" : ""}`}
            onClick={() => setStage({ type: "graph" })}
          >
            <span className="dcw-item-name"><Network size={13} /> 图谱总览</span>
            <span className="dcw-item-count">可视化</span>
          </button>

          {groups.map(([group, list]) => (
            <div key={group}>
              <div className="dcw-group">{group}</div>
              {list.map((cat) => (
                <button
                  key={cat.kind}
                  className={`dcw-item${stage?.type === "asset" && stage.kind === cat.kind ? " is-on" : ""}${cat.count === 0 ? " is-empty" : ""}`}
                  onClick={() => setStage({ type: "asset", kind: cat.kind, label: cat.label })}
                  title={cat.hint}
                >
                  <span className="dcw-item-name">{cat.label}</span>
                  <span className="dcw-item-count">
                    {cat.count > 0 ? cat.count : "待产出"}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* ── 中栏：舞台 ── */}
        <main hidden={!!resource} className={`dcw-stage${stage?.type === "graph" ? " is-graph" : ""}`}>
          {stage?.type === "ask"
            ? <AskStage slug={slug} prefill={stage.prefill} nonce={stage.nonce} />
            : stage?.type === "graph"
              ? <GraphStage slug={slug} />
              : stage?.type === "dossier"
              ? <DossierStage slug={slug} name={stage.name} onBack={() => setStage({ type: "asset", kind: "entity:Character", label: "角色智能体" })} />
              : stage?.type === "asset"
                ? <AssetStage
                    slug={slug} kind={stage.kind} label={stage.label} refreshVersion={refreshVersion} canReadOriginal={isOwner}
                    onOpenDossier={stage.kind.startsWith("entity:")
                      ? (name) => setStage({ type: "dossier", name })
                      : undefined}
                  />
                : <MasterStage
                    master={view.masters.find((m) => m.id === (stage?.type === "master" ? stage.id : "")) ?? null}
                    onOpenAsset={(kind) => {
                      const cat = cats.find((c) => c.kind === kind);
                      if (cat) setStage({ type: "asset", kind: cat.kind, label: cat.label });
                    }}
                    onOpenDossier={(name) => setStage({ type: "dossier", name })}
                  />}
        </main>
        {resource && <main className="dcw-stage"><DeconstructionResource key={`${resource.sessionId}:${resource.kind}:${resource.resource.id}:${resource.resource.revision}`}
          selection={resource} onClose={() => setResource(null)} /></main>}
        {isOwner ? <DeconstructionChat activity={{ running: view.status === "running" && !view.paused,
          message: view.paused ? "拆书已暂停，已有成果保留" : view.status === "failed" ? "本段拆解中断，已有章纲和骨架可继续查看"
            : view.status === "ready" ? "拆书已完成，全部成果已保存"
            : `${(["chronicler", "weaver"].includes(current?.id || "") ? view.activityMessage : undefined) || current?.duty || "正在准备拆书"}${view.stageTotal ? ` · ${view.stageDone}/${view.stageTotal}` : ""}`
        }} sourceId={slug} title={view.title} onProgress={load} onOpenResource={setResource} />
          : <aside className="dcw-chat"><header><strong>公开拆书成果</strong><p>可浏览本书的章节拆解、故事骨架与设定图谱。</p></header></aside>}
      </DeconstructionLayout>

      {/* ── 底部：操作回执 + 次要操作（主操作「继续拆/暂停」在上方状态条里） ── */}
      {isOwner && (note || view.status !== "running") && (
        <footer className="dcw-foot">
          {note && <span className="dcw-note">{note}</span>}
          <div className="dcw-foot-btns">
            {view.status !== "running" && (
              <button className="dc-btn" disabled={busy} onClick={() => void act("restart")}>
                <RotateCcw size={14} />从头重拆
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

/** 舞台上摆一位师傅：他在干什么、给你什么、门禁过没过、真实拆出了什么。 */
function MasterStage({ master, onOpenAsset, onOpenDossier }: {
  readonly master: MasterProgress | null;
  /** 样本点跳左栏资产类别（那一类的完整列表）。 */
  readonly onOpenAsset: (kind: string) => void;
  /** 角色样本直接开完整档案。 */
  readonly onOpenDossier: (name: string) => void;
}) {
  if (!master) return <div className="dcw-empty">从左边选一位师傅，或选一类拆出来的东西</div>;
  const reached = master.state !== "pending";
  const passed = master.gates.filter((g) => g.ok).length;

  return (
    <>
      <div className="dcw-stage-head">
        <h2>{master.name}</h2>
        <span className={`dc-step-status is-${master.state}`}>{STATE_TEXT[master.state]}</span>
      </div>
      <p className="dcw-duty">{master.duty}</p>

      {master.delivers.length > 0 && (
        <section className="dcw-block">
          <div className="dcw-block-title">这一关给你什么</div>
          <ul className="dc-delivers">
            {master.delivers.map((d) => <li key={d}><Sparkles size={11} />{d}</li>)}
          </ul>
        </section>
      )}

      {master.produced.length > 0 && (
        <section className="dcw-block">
          <div className="dcw-block-title">实际放进图谱的</div>
          <div className="dc-output">
            {master.produced.map((r) => (
              <div key={r.label} className="dc-output-row">
                <span className="dc-output-key">{r.label}</span>
                <span className="dc-output-val">{r.value}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 真实产出内容：不是「抽出 18 个角色」，是「朱慈、林黛玉…」。
          每条都能点开——角色进完整档案，其余跳左栏对应类别的完整列表。 */}
      {master.samples.length > 0 && (
        <section className="dcw-block">
          <div className="dcw-block-title">真实拆出来的（点开看详情）</div>
          {master.samples.map((g) => (
            <div key={g.group} className="dcw-sample-group">
              <div className="dcw-sample-group-h">
                {g.group}
                <span className="dc-block-count">{g.total > g.items.length ? `共 ${g.total} 条，示例 ${g.items.length} 条` : `共 ${g.total} 条`}</span>
              </div>
              <div className="dc-samples">
                {g.items.map((it, i) => {
                  const target = g.group === "智能体"
                    ? (it.kind ? ENTITY_KIND_TARGET[it.kind] : undefined)
                    : SAMPLE_TARGET[g.group];
                  const body = (
                    <>
                      <div className="dc-sample-head">
                        <span className="dc-sample-name">{it.name}</span>
                        {it.kind && <span className="dc-sample-kind">{it.kind}</span>}
                      </div>
                      {it.detail && <div className="dc-sample-detail">{it.detail}</div>}
                    </>
                  );
                  if (!target) {
                    return <div key={`${it.name}-${i}`} className="dc-sample">{body}</div>;
                  }
                  return (
                    <button
                      key={`${it.name}-${i}`}
                      className="dc-sample is-link"
                      onClick={() => {
                        if (g.group === "智能体" && it.kind === "角色") onOpenDossier(it.name);
                        else onOpenAsset(target);
                      }}
                    >
                      {body}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="dcw-block">
        <div className="dcw-block-title">
          门禁{reached ? ` · ${passed}/${master.gates.length} 通过` : ""}
        </div>
        <div className="dc-gates">
          {master.gates.map((g) => (
            <div key={g.id} className={`dc-gate-row${!reached ? " is-idle" : g.ok ? " is-ok" : g.severity === "hard" ? " is-bad" : " is-warn"}`}>
              {!reached ? <Circle size={12} /> : g.ok ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
              <span className="dc-gate-title">{g.title}</span>
              {reached && <span className="dc-gate-nums">期望 {g.expected} · 实际 {g.actual}</span>}
              {g.severity === "soft" && <span className="dc-gate-soft">软</span>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/** 舞台上摆一类资产：真正的角色、关系、章纲，可以逐条翻。 */
function AssetStage({ slug, kind, label, onOpenDossier, refreshVersion, canReadOriginal }: {
  readonly canReadOriginal: boolean;
  readonly refreshVersion: number;
  readonly slug: string; readonly kind: string; readonly label: string;
  /** 实体类资产：点「完整档案」进角色档案页。 */
  readonly onOpenDossier?: (name: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<ReadonlyArray<AssetItem>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [modalItem, setModalItem] = useState<AssetItem | null>(null);
  const { t } = useI18n();
  const isEntity = kind.startsWith("entity:");
  const isCharacter = kind === "entity:Character";

  useEffect(() => {
    setLoading(true);
    setOffset(0);
    setOpenId(null);
    setModalItem(null);
    setItems([]);
    setTotal(0);
  }, [slug, kind]);

  useEffect(() => {
    let cancelled = false;
    fetchAssetPage(slug, kind, offset)
      .then((d) => { if (!cancelled) { setItems(d.items); setTotal(d.total); } })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, kind, offset, refreshVersion]);

  return (
    <>
      <div className="dcw-stage-head">
        <h2>{label}</h2>
        <span className="dcw-total">{total} 条</span>
      </div>

      {loading && <div className="dc-loading"><Loader2 size={16} className="spin" />{t("common.loading")}</div>}
      {!loading && items.length === 0 && (
        <div className="dcw-empty">这一类还没拆出来。</div>
      )}

      {isEntity ? (
        /*
         * 实体类：密集小卡片，一行多条。
         * 角色点卡直接进完整档案——左栏点类别、点卡，两次到位（原来是
         * 点类别→展开→点「完整档案」三次）。其他实体点卡弹详情层。
         */
        <div className="dcw-ecards">
          {items.map((item) => (
            <button
              key={item.id}
              className="dcw-ecard"
              onClick={() => {
                if (isCharacter && onOpenDossier) onOpenDossier(item.name);
                else setModalItem(item);
              }}
            >
              <span className="dcw-ecard-top">
                <span className="dcw-ecard-a">{item.name.charAt(0)}</span>
                <span className="dcw-ecard-n">{item.name}</span>
              </span>
              {item.summary && <span className="dcw-ecard-s">{item.summary}</span>}
              <span className="dcw-ecard-go">{isCharacter ? "完整档案 →" : "详情 →"}</span>
            </button>
          ))}
        </div>
      ) : (
      <div className="dcw-cards">
        {items.map((item) => {
          const open = openId === item.id;
          /* 有字段可展开；角色类哪怕档案字段还空着，也能点开进「完整档案」——
             不能因为档案没生成就连门都不给进。 */
          const hasDetail = Boolean(item.fields?.length) || Boolean(onOpenDossier);
          return (
            <div key={item.id} className={`dcw-card${open ? " is-open" : ""}`}>
              <button
                className="dcw-card-head"
                onClick={() => setOpenId(open ? null : item.id)}
                disabled={!hasDetail && !item.summary}
              >
                {hasDetail && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
                <span className="dcw-card-name">{item.name}</span>
                {item.kind && <span className="dcw-card-kind">{item.kind}</span>}
                {hasDetail && <span className="dcw-card-more">{open ? "收起" : "展开"}</span>}
              </button>
              {/* 收起时只露一行摘要；展开后摘要在 fields 里有完整的一条，不重复 */}
              {!open && item.summary && <p className="dcw-card-summary">{item.summary}</p>}
              {kind === "chapters" && canReadOriginal && <DeconstructionChapterComparison key={`${slug}:${item.id}`} slug={slug} item={item} expanded={open} onExpand={() => setOpenId(item.id)} />}
              {open && hasDetail && (kind !== "chapters" || !canReadOriginal) && (
                <div className="dcw-fields">
                  {item.fields?.map((f) => (
                    <div key={f.label} className="dcw-field">
                      <span className="dcw-field-label">{f.label}</span>
                      <span className="dcw-field-value">{f.value}</span>
                    </div>
                  ))}
                  {onOpenDossier && (
                    <button className="dcw-dossier-link" onClick={() => onOpenDossier(item.name)}>
                      <UserRound size={13} /> 完整档案：出场轨迹 · 关系网 · 循环 · 伏笔
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {(total > 50 || offset > 0) && <nav aria-label="资产分页" className="dcw-foot-btns">
        <button disabled={offset === 0} onClick={() => { setOpenId(null); setOffset(n => Math.max(0, n - 50)); }}>上一页</button>
        <span>第 {Math.floor(offset / 50) + 1} 页 · 共 {total} 条</span>
        <button disabled={offset + 50 >= total} onClick={() => { setOpenId(null); setOffset(n => n + 50); }}>下一页</button>
      </nav>}

      {/* 非角色实体的详情层：字段直接铺开，不再套一层展开按钮 */}
      {modalItem && (
        <DetailModal onClose={() => setModalItem(null)}>
          <div className="dcw-stage-head">
            <h2>{modalItem.name}</h2>
            {modalItem.kind && <span className="dcw-total">{modalItem.kind}</span>}
          </div>
          {modalItem.summary && <p className="dcw-card-summary">{modalItem.summary}</p>}
          <div className="dcw-fields">
            {modalItem.fields?.map((f) => (
              <div key={f.label} className="dcw-field">
                <span className="dcw-field-label">{f.label}</span>
                <span className="dcw-field-value">{f.value}</span>
              </div>
            ))}
          </div>
        </DetailModal>
      )}

      {total > items.length && (
        <p className="dcw-truncated">只显示前 {items.length} 条，共 {total} 条。</p>
      )}
    </>
  );
}

/* ══════════════ 图谱总览 ══════════════ */

/** 关系类型 → 中文（图谱详情卡用，与后端 REL_ZH 同源手工对齐）。 */
export const REL_TYPE_ZH: Readonly<Record<string, string>> = {
  ALLIED_WITH: "结盟", HOSTILE_TO: "敌对", MENTORS: "师承", KIN_OF: "亲属",
  SUBORDINATE_TO: "从属", LOVES: "爱慕", EXPLOITS: "利用", TRADES_WITH: "交易",
  CAUSES: "因果", LOCATED_IN: "位于", OWNS: "持有", GOVERNED_BY: "受制于",
  HAS_ENTITY: "包含",
};

/** 档案字段 → 中文标签（详情卡用）。 */
const PAYLOAD_FIELD_ZH: Readonly<Record<string, string>> = {
  plot_weight: "剧情权重", appearance_count: "出场次数", first_chapter: "首次登场",
  tier: "层级", type: "类型", persona: "人设", bio: "简介", profile: "档案",
  behavior: "行为模式", attributes: "属性", memory: "记忆",
  growth_timeline: "成长轨迹", major_events: "大事件", summary: "摘要",
  goal: "目标", conflict: "冲突", abilities: "能力", relationships: "关系",
  growth: "成长", appearance: "外貌",
};

/** 字段展示优先级（对齐老前端 renderNodeCardPayload：人设/简介在前，摘要最后）。 */
const PAYLOAD_ORDER: ReadonlyArray<string> = [
  "plot_weight", "appearance_count", "first_chapter", "tier", "type",
  "persona", "bio", "profile", "behavior", "attributes",
  "memory", "growth_timeline", "major_events", "summary",
];

/** 档案 payload JSON → [标签, 文本] 行；persona 等对象按子字段逐行展开。 */
export function payloadEntries(payloadJson: string): ReadonlyArray<readonly [string, string]> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return [["档案", payloadJson]];
  }
  const keys = Object.keys(parsed).sort((a, b) => {
    const ia = PAYLOAD_ORDER.indexOf(a);
    const ib = PAYLOAD_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const rows: Array<readonly [string, string]> = [];
  for (const key of keys) {
    const value = parsed[key];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "string") {
      rows.push([PAYLOAD_FIELD_ZH[key] ?? key, value]);
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // persona 六块这类对象：逐子字段一行，不把整段 JSON 糊给用户
      for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
        const text = typeof subValue === "string" ? subValue : JSON.stringify(subValue);
        if (text) rows.push([PAYLOAD_FIELD_ZH[sub] ?? sub, text]);
      }
    } else {
      rows.push([PAYLOAD_FIELD_ZH[key] ?? key, JSON.stringify(value)]);
    }
  }
  return rows;
}

/**
 * 这本书的图谱整张铺开，全屏占满舞台——实体是点、关系是边。
 *
 * 画布是老前端 ReactGraphCanvas 原样搬来的 d3 force 实现：节点从中心散开的
 * 力学动画、红边带关系标签、hover 金描边、选中紫粗描边、滚轮缩放、节点拖拽。
 * 节点颜色与大小 = 图谱里持久化的权重字段（plot_weight，为 0 时后端用
 * appearance_count 兜底），按灰→白→绿→蓝→紫→红→金分档。
 * 点击节点弹浮层档案卡（对齐老前端 ChatGraphPanel）：完整档案（人设/简介/轨迹）、
 * 关联关系、活动时间线直接展示在卡里。
 * 数据走 /tianyan/graph/data/:graphId + /tianyan/graph/node/:graphId/:name，
 * 拆书图谱的 graphId 就是 slug。进入页面时拉取一次，不做定时轮询。
 */
function GraphStage({ slug }: {
  readonly slug: string;
}) {
  const [data, setData] = useState<GraphData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GraphNodeDetail | null>(null);
  const { t } = useI18n();

  /* 进入图谱页时拉一次就完——不搞定时轮询（容易出问题）。
     想看最新进度，用户切走再切回/刷新页面即可。 */
  useEffect(() => {
    let live = true;
    setData(null);
    setSelectedId(null);
    fetchGraphData(slug)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setData({ nodes: [], edges: [] }); });
    return () => { live = false; };
  }, [slug]);

  const selected = selectedId ? data?.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedLabel = selected?.label ?? null;
  const selectedType = selected?.type ?? "";

  /* 选中节点 → 拉完整档案直接展示：
     角色卡走 dossier（14 字段 + 出场轨迹 + 关系网 + 循环 + 伏笔），
     势力/地图等其他节点走图谱节点详情（自身属性 + 出场章节 + 关联关系）。 */
  const [dossier, setDossier] = useState<CharacterDossier | null>(null);
  useEffect(() => {
    setDetail(null);
    setDossier(null);
    if (!selectedLabel) return;
    let live = true;
    if (selectedType === "Character") {
      fetchCharacterDossier(slug, selectedLabel)
        .then((d) => { if (live) setDossier(d); })
        .catch(() => undefined);
    } else {
      fetchGraphNodeDetail(slug, selectedLabel)
        .then((d) => { if (live) setDetail(d); })
        .catch(() => { if (live) setDetail(null); });
    }
    return () => { live = false; };
  }, [slug, selectedLabel, selectedType]);

  const loading = selected !== null && dossier === null && detail === null;

  return (
    <div className="dcw-graph-page">
      <div className="dcw-stage-head">
        <h2>图谱总览</h2>
        {data && (
          <span className="dcw-total">
            {data.nodes.length} 个节点 · {data.edges.length} 条边 · 颜色/大小=权重（灰孤立→金核心） · 滚轮缩放 · 点节点看档案
          </span>
        )}
      </div>
      {!data && <div className="dc-loading"><Loader2 size={16} className="spin" />{t("common.loading")}</div>}
      {data && data.nodes.length === 0 && (
        <div className="dcw-empty">图谱还是空的——本体师跑完才有节点。</div>
      )}
      {data && data.nodes.length > 0 && (
        <div className="dcw-graph is-full">
          <ReactGraphCanvas
            graph={data}
            selectedNodeId={selectedId}
            onNodeClick={(id) => {
              // 点击节点 = 弹/收档案卡（再点一次收起），对齐老前端 ChatGraphPanel。
              setSelectedId(id === selectedId ? null : id);
            }}
          />
          {/* 节点档案浮层卡：角色卡/势力/地图的完整信息直接展示在卡里 */}
          {selected && (
            <div className="dcw-gpop">
              <div className="dcw-gpop-h">
                <b>{selected.label}</b>
                <span className="dcw-card-kind">
                  {dossier ? dossier.dossier.type : detail?.card?.cardType || selected.type || selected.kind}
                </span>
                <button
                  type="button"
                  className="dcw-gpop-x"
                  onClick={() => setSelectedId(null)}
                  aria-label="关闭"
                >
                  <X size={13} />
                </button>
              </div>
              {loading && <div className="dcw-gpop-loading"><Loader2 size={13} className="spin" /></div>}

              {/* ── 角色卡：完整档案直显 ── */}
              {dossier && (
                <>
                  <div className="dcw-gpop-meta">
                    {dossier.dossier.tier === "major" ? "主要角色" : "配角"} · 权重 {dossier.dossier.plotWeight}
                    {dossier.dossier.firstChapter !== null && ` · 第 ${dossier.dossier.firstChapter} 章登场`}
                    {dossier.dossier.appearanceCount > 0 && ` · 出场 ${dossier.dossier.appearanceCount} 章`}
                  </div>
                  {dossier.dossier.aliases.length > 0 && (
                    <div className="dcw-gpop-meta">别名：{dossier.dossier.aliases.join("、")}</div>
                  )}
                  {dossier.dossier.summary && <p className="dcw-card-summary">{dossier.dossier.summary}</p>}
                  <dl className="dcw-gpop-fields">
                    {([
                      ["性格", dossier.dossier.persona], ["外貌", dossier.dossier.appearance],
                      ["背景", dossier.dossier.bio], ["目标", dossier.dossier.goal],
                      ["冲突", dossier.dossier.conflict], ["能力", dossier.dossier.abilities],
                      ["关系", dossier.dossier.relationships], ["成长弧线", dossier.dossier.growth],
                    ] as ReadonlyArray<readonly [string, string]>)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k} className="dcw-gpop-field">
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                  </dl>
                  {dossier.cycles.length > 0 && (
                    <div className="dcw-gpop-sec">
                      <div className="dcw-gpop-sec-t">参与循环</div>
                      <p className="dcw-gpop-text">{dossier.cycles.join(" → ")}</p>
                    </div>
                  )}
                  {dossier.relations.length > 0 && (
                    <div className="dcw-gpop-sec">
                      <div className="dcw-gpop-sec-t">关系网</div>
                      <div className="dcw-gnode-rels">
                        {dossier.relations.map((r, i) => (
                          <span key={i} className="dcw-cite" title={r.description}>
                            {r.from === dossier.dossier.name ? "→" : "←"} {REL_TYPE_ZH[r.type] ?? r.type} {r.from === dossier.dossier.name ? r.to : r.from}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {dossier.timeline.length > 0 && (
                    <div className="dcw-gpop-sec">
                      <div className="dcw-gpop-sec-t">出场轨迹</div>
                      <div className="dcw-gpop-events">
                        {dossier.timeline.slice(0, 12).map((ch, i) => (
                          <div key={i} className="dcw-gpop-event">
                            <span>第 {ch.chapter} 章 · {ch.chapterTitle}</span>
                            <p>{ch.summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {dossier.foreshadows.length > 0 && (
                    <div className="dcw-gpop-sec">
                      <div className="dcw-gpop-sec-t">伏笔</div>
                      <div className="dcw-gpop-events">
                        {dossier.foreshadows.map((f, i) => (
                          <div key={i} className="dcw-gpop-event">
                            <span>{f.title} · {f.status === "paid" ? "已回收" : f.status === "partial" ? "部分回收" : "未回收"}</span>
                            <p>{f.setup}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── 势力/地图/其他节点：图谱属性 + 出场章节 + 关联关系 ── */}
              {!dossier && detail?.card && (
                <>
                  {detail.card.summary && <p className="dcw-card-summary">{detail.card.summary}</p>}
                  {payloadEntries(detail.card.payload).length > 0 && (
                    <dl className="dcw-gpop-fields">
                      {payloadEntries(detail.card.payload).map(([k, v], i) => (
                        <div key={`${k}-${i}`} className="dcw-gpop-field">
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {detail.chapters.length > 0 && (
                    <div className="dcw-gpop-sec">
                      <div className="dcw-gpop-sec-t">出场章节</div>
                      <div className="dcw-gnode-rels">
                        {detail.chapters.map((ch) => (
                          <span key={ch.number} className="dcw-cite">第 {ch.number} 章 {ch.title}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.relations.length > 0 && (
                    <div className="dcw-gpop-sec">
                      <div className="dcw-gpop-sec-t">关联关系</div>
                      <div className="dcw-gnode-rels">
                        {detail.relations.map((r, i) => (
                          <span key={i} className="dcw-cite">
                            {r.direction === "out" ? "→" : "←"} {REL_TYPE_ZH[r.relation] ?? r.relation} {r.target}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.events.length > 0 && (
                    <div className="dcw-gpop-sec">
                      <div className="dcw-gpop-sec-t">活动时间线</div>
                      <div className="dcw-gpop-events">
                        {detail.events.map((ev, i) => (
                          <div key={i} className="dcw-gpop-event">
                            <span>R{ev.round} · {ev.action}</span>
                            <p>{ev.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      {data && data.nodes.length > 0 && <GraphLegend />}
    </div>
  );
}

/* ══════════════ 知识库问答 ══════════════ */

/**
 * 「问这本书」——拆书的终点。
 *
 * 与聊天里的 ask_knowledge_base 工具走同一份后端（kb-service）：
 * 图谱优先取精确事实（发展轨迹、卷循环、伏笔），语义检索只补原文佐证，
 * 答不出来就直说，不编。
 */
function AskStage({ slug, prefill, nonce }: { readonly slug: string; readonly prefill?: string; readonly nonce?: number }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<ReadonlyArray<{ q: string; a: KbAnswer | null; err?: string }>>([]);

  const ask = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setQuestion("");
    setHistory((h) => [...h, { q: trimmed, a: null }]);
    try {
      const answer = await askBookKb(slug, trimmed);
      setHistory((h) => h.map((row, i) => (i === h.length - 1 ? { q: trimmed, a: answer } : row)));
    } catch (e: unknown) {
      setHistory((h) => h.map((row, i) => (i === h.length - 1 ? { q: trimmed, a: null, err: (e as Error).message } : row)));
    } finally {
      setAsking(false);
    }
  }, [slug, asking]);

  /* 顶部常驻问答框/图谱节点带问题跳过来——落地就问，不让用户再敲一遍。
     去重 key 带 nonce：同一个问题可以再问一次。 */
  const askedPrefillRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${nonce ?? 0}:${prefill ?? ""}`;
    if (prefill && askedPrefillRef.current !== key && !asking) {
      askedPrefillRef.current = key;
      void ask(prefill);
    }
  }, [prefill, nonce, ask, asking]);

  const SUGGESTED = ["主角是谁，他经历了什么", "这本书分几卷，结构是怎样的", "埋了哪些伏笔，收了没有"];

  return (
    <>
      <div className="dcw-stage-head">
        <h2>问这本书</h2>
        <span className="dcw-total">图谱优先 · 带章节引用 · 答不出来会直说</span>
      </div>

      {history.length === 0 && (
        <div className="dcw-ask-suggest">
          {SUGGESTED.map((q) => (
            <button key={q} onClick={() => void ask(q)} disabled={asking}>{q}</button>
          ))}
        </div>
      )}

      <div className="dcw-ask-history">
        {history.map((row, i) => (
          <div key={i} className="dcw-ask-row">
            <div className="dcw-ask-q">{row.q}</div>
            {row.a === null && !row.err && (
              <div className="dc-loading"><Loader2 size={14} className="spin" />查询图谱与索引中…</div>
            )}
            {row.err && <div className="dcw-ask-err"><AlertTriangle size={13} /> {row.err}</div>}
            {row.a && (
              <div className={`dcw-ask-a${row.a.empty ? " is-empty" : ""}`}>
                <div className="dcw-ask-text">{row.a.answer}</div>
                {row.a.citations.length > 0 && (
                  <div className="dcw-ask-cites">
                    {row.a.citations.map((c) => (
                      <span key={c.index} className="dcw-cite" title={c.detail.slice(0, 200)}>
                        [{c.index}] {c.kind}·{c.label.slice(0, 24)}
                        {c.chapterNumber !== undefined ? `（第${c.chapterNumber}章）` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="dcw-ask-input">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void ask(question); }}
          placeholder="问点什么：某个角色的发展、某一章讲了什么、伏笔收没收…"
          disabled={asking}
        />
        <button onClick={() => void ask(question)} disabled={asking || !question.trim()}>
          {asking ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
      </div>
    </>
  );
}

/* ══════════════ 角色档案页 ══════════════ */

/**
 * 一个角色的完整视图：14 字段档案 + 按章号有序的出场轨迹 + 关系网 +
 * 参与循环 + 相关伏笔。全部图谱结构化查询，没有一个字是检索猜的。
 */
function DossierStage({ slug, name, onBack }: {
  readonly slug: string; readonly name: string; readonly onBack: () => void;
}) {
  const [view, setView] = useState<CharacterDossier | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setView(null);
    setError(null);
    fetchCharacterDossier(slug, name)
      .then(setView)
      .catch((e: unknown) => setError((e as Error).message));
  }, [slug, name]);

  if (error) {
    return (
      <>
        <button className="dcw-back" onClick={onBack}><ArrowLeft size={13} /> 返回角色列表</button>
        <div className="dcw-empty">{error}</div>
      </>
    );
  }
  if (!view) return <div className="dc-loading"><Loader2 size={16} className="spin" />组装档案中…</div>;

  const d = view.dossier;
  const PROFILE: ReadonlyArray<readonly [string, string]> = [
    ["性格", d.persona], ["外貌", d.appearance], ["背景", d.bio],
    ["目标", d.goal], ["冲突", d.conflict], ["能力", d.abilities],
    ["关系", d.relationships], ["成长弧线", d.growth],
  ];

  return (
    <>
      <button className="dcw-back" onClick={onBack}><ArrowLeft size={13} /> 返回角色列表</button>
      <div className="dcw-stage-head">
        <h2>{d.name}</h2>
        <span className="dcw-total">
          {d.tier === "major" ? "主要角色" : "配角"} · 权重 {d.plotWeight}
          {d.firstChapter !== null && ` · 第 ${d.firstChapter} 章登场`}
          {d.appearanceCount > 0 && ` · 出场 ${d.appearanceCount} 章`}
        </span>
      </div>
      {d.aliases.length > 0 && <p className="dcw-dossier-alias">别名：{d.aliases.join("、")}</p>}
      {d.summary && <p className="dcw-card-summary">{d.summary}</p>}

      <div className="dcw-fields">
        {PROFILE.filter(([, v]) => v).map(([label, value]) => (
          <div key={label} className="dcw-field">
            <span className="dcw-field-label">{label}</span>
            <span className="dcw-field-value">{value}</span>
          </div>
        ))}
      </div>

      {view.cycles.length > 0 && (
        <div className="dcw-dossier-section">
          <h3>参与循环</h3>
          <p>{view.cycles.join(" → ")}</p>
        </div>
      )}

      {view.relations.length > 0 && (
        <div className="dcw-dossier-section">
          <h3>关系网（{view.relations.length} 条）</h3>
          <div className="dcw-dossier-rels">
            {view.relations.map((r, i) => (
              <span key={i} className="dcw-cite">
                {r.from} —{r.type}→ {r.to}{r.description ? `（${r.description}）` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {view.foreshadows.length > 0 && (
        <div className="dcw-dossier-section">
          <h3>身上的伏笔（{view.foreshadows.length} 条）</h3>
          {view.foreshadows.map((f, i) => (
            <div key={i} className="dcw-field">
              <span className="dcw-field-label">{f.title}（{f.status}）</span>
              <span className="dcw-field-value">
                {f.setup}{f.payoff ? ` → ${f.payoff}` : ""}
                {f.chapterStart !== null ? `（第${f.chapterStart}章起）` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="dcw-dossier-section">
        <h3>出场轨迹（{view.timeline.length} 站）</h3>
        {view.timeline.map((t) => (
          <div key={t.chapter} className="dcw-timeline-row">
            <span className="dcw-timeline-ch">第{t.chapter}章</span>
            <span className="dcw-timeline-text">
              {t.cycleTitle && <em>【{t.cycleTitle}】</em>}
              {t.summary}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
