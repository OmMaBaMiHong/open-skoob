/**
 * ProductionPanel —— 右栏「产出」：这本书到目前为止生产出来的东西。
 *
 * 数据全部来自六步编排快照里各步的 output（后端 adapter 定的形状），
 * 渲染直接复用工作台那套 {@link StepOutput} —— 同一份产出在两个页面里
 * 不该长成两个样子，也不该维护两套渲染。
 *
 * 页签只列**真的有产出**的步骤：没写世界观就不该有一个空的「世界观」页签
 * 让人点进去看「本步尚无产出」。
 */
import { useState, useEffect, useMemo } from "react";
import { BookOpen, Copy, Check, Loader2, FileText } from "lucide-react";
import { StepOutput } from "../StepOutput";
import { fetchChapter, type ChapterSummary } from "../../lib/api";
import {
  CREATION_LOOP_STEP_TYPES, CREATION_STEP_LABELS_ZH, CREATION_STEP_SUBTITLES,
  TIANYAN_ROUNDS, hasSimulation, stepTypeOf, chapterNumberOf,
  type CreationLoopStepType, type WorkflowSnapshot,
} from "../../types/creation-loop";

type Rec = Readonly<Record<string, unknown>>;

interface ProductionPanelProps {
  readonly bookId: string | null;
  readonly snapshot: WorkflowSnapshot | null;
  readonly chapters: ReadonlyArray<ChapterSummary>;
  /** fast 档不建编排：如实说明，别让人盯着空页签以为卡住了。 */
  readonly noOrchestration: boolean;
}

/** 页签顺序 = 创作顺序。chapter_write 单独做成「正文」页签（要选章）。 */
const DOC_STEPS: ReadonlyArray<CreationLoopStepType> = [
  "intent", "worldview", "title_synopsis", "outline", "chapter_plan",
];

export function ProductionPanel({ bookId, snapshot, chapters, noOrchestration }: ProductionPanelProps) {
  /**
   * 每个步骤类型取**最新一条**产出。
   * chapter_plan 会有很多条（一卷一条），只看最新那卷；历史卷要回看在工作台。
   */
  const outputs = useMemo(() => {
    const map = new Map<CreationLoopStepType, Rec>();
    for (const step of snapshot?.steps ?? []) {
      const type = stepTypeOf(step.id);
      if (!type || type === "anchor" || !step.output) continue;
      if (Object.keys(step.output).length === 0) continue;
      map.set(type, step.output);
    }
    return map;
  }, [snapshot]);

  /** 大纲步产出的角色档案下发给后面几步（同工作台的做法）。 */
  const roleIndex = useMemo(() => {
    const roles = (outputs.get("outline")?.roles ?? []) as ReadonlyArray<Rec>;
    const index: Record<string, Rec> = {};
    for (const r of Array.isArray(roles) ? roles : []) {
      const name = typeof r?.name === "string" ? r.name : "";
      if (name) index[name] = r;
    }
    return index;
  }, [outputs]);

  const docTabs = DOC_STEPS.filter((t) => outputs.has(t));
  const hasChapters = chapters.length > 0;
  const tabs: ReadonlyArray<{ id: string; label: string }> = [
    ...(hasChapters ? [{ id: "chapters", label: "正文" }] : []),
    ...docTabs.map((t) => ({ id: t, label: CREATION_STEP_LABELS_ZH[t] })),
    { id: "progress", label: "进度" },
  ];

  const [tab, setTab] = useState<string>(tabs[0]?.id ?? "progress");
  // 产出是陆续出来的：第一次出现正文/大纲时把页签切过去，用户不用自己找。
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0]?.id ?? "progress");
  }, [tabs, tab]);

  return (
    <aside className="prod-panel">
      <div className="prod-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`prod-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="prod-body">
        {tab === "chapters" && <ChaptersView bookId={bookId} chapters={chapters} />}

        {docTabs.includes(tab as CreationLoopStepType) && (
          <StepOutput
            type={tab as CreationLoopStepType}
            output={outputs.get(tab as CreationLoopStepType) ?? null}
            roleIndex={roleIndex}
          />
        )}

        {tab === "progress" && (
          <ProgressView snapshot={snapshot} noOrchestration={noOrchestration} outputs={outputs} />
        )}
      </div>
    </aside>
  );
}

/* ── 正文：章节列表 + 选中章全文 ── */

function ChaptersView({
  bookId, chapters,
}: { readonly bookId: string | null; readonly chapters: ReadonlyArray<ChapterSummary> }) {
  const latest = chapters[chapters.length - 1]?.number ?? null;
  const [pick, setPick] = useState<number | null>(latest);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // 新章写出来时跟到最新一章（用户没手动选过别的章的话）。
  useEffect(() => {
    setPick((cur) => (cur === null ? latest : cur));
  }, [latest]);

  useEffect(() => {
    if (!bookId || pick === null) return;
    let cancelled = false;
    setLoading(true);
    void fetchChapter(bookId, pick)
      .then((ch) => {
        if (cancelled) return;
        setText(ch.content ?? "");
        setTitle(ch.title ?? `第 ${pick} 章`);
      })
      .catch(() => { if (!cancelled) { setText(""); setTitle(`第 ${pick} 章`); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookId, pick]);

  const copy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="prod-chapters">
      <div className="prod-chapter-picks">
        {chapters.map((c) => (
          <button
            key={c.number}
            type="button"
            className={`prod-chip${pick === c.number ? " is-active" : ""}`}
            onClick={() => setPick(c.number)}
            title={c.title ?? `第 ${c.number} 章`}
          >
            {c.number}
          </button>
        ))}
      </div>

      <div className="prod-chapter-head">
        <span className="prod-chapter-title">
          <BookOpen size={12} /> {title || "选一章"}
        </span>
        <button type="button" onClick={copy} disabled={!text} title="复制正文">
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>

      <div className="prod-chapter-text">
        {loading ? (
          <p className="prod-dim"><Loader2 size={12} className="spin" /> 读取中…</p>
        ) : text ? (
          text.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)
        ) : (
          <p className="prod-dim">这一章还没有正文。</p>
        )}
      </div>

      {text && <div className="prod-chapter-foot">{text.replace(/\s/g, "").length} 字</div>}
    </div>
  );
}

/* ── 进度：六步走到哪了（原来挤在左栏，挪到这儿） ── */

function ProgressView({
  snapshot, noOrchestration, outputs,
}: {
  readonly snapshot: WorkflowSnapshot | null;
  readonly noOrchestration: boolean;
  readonly outputs: ReadonlyMap<CreationLoopStepType, Rec>;
}) {
  // 同类型多条时以最新一条为准（章节步会有很多条）。
  const byType = useMemo(() => {
    const map = new Map<CreationLoopStepType, { status: string }>();
    for (const st of snapshot?.steps ?? []) {
      const type = stepTypeOf(st.id);
      if (!type || type === "anchor") continue;
      const prev = map.get(type);
      if (!prev || prev.status === "confirmed") map.set(type, st);
    }
    return map;
  }, [snapshot]);

  const currentType = snapshot?.currentStepId ? stepTypeOf(snapshot.currentStepId) : null;
  const focusType: CreationLoopStepType =
    currentType && currentType !== "anchor" ? currentType : "intent";
  const chapterNo = snapshot?.currentStepId ? chapterNumberOf(snapshot.currentStepId) : null;
  const done = CREATION_LOOP_STEP_TYPES.filter((t) => byType.get(t)?.status === "confirmed").length;

  return (
    <div className="prod-progress">
      <div className="prod-progress-bar">
        <div
          className="prod-progress-fill"
          style={{ width: `${(done / CREATION_LOOP_STEP_TYPES.length) * 100}%` }}
        />
      </div>
      <div className="prod-dim">
        {done} / {CREATION_LOOP_STEP_TYPES.length} 步已确认{chapterNo ? ` · 第 ${chapterNo} 章` : ""}
      </div>

      {noOrchestration && (
        <p className="prod-note">
          这本旧作品尚未绑定分步编排。已有内容保留，可在对话中继续创作。新建的快速直出作品同样由六师逐步完成。
        </p>
      )}

      <ul className="prod-steps">
        {CREATION_LOOP_STEP_TYPES.map((type, i) => {
          const st = byType.get(type);
          const ok = st?.status === "confirmed";
          const cur = currentType === type;
          const waiting = st?.status === "awaiting_review" || st?.status === "completed";
          return (
            <li key={type} className={`prod-step${ok ? " is-done" : ""}${cur ? " is-current" : ""}`}>
              <span className="prod-step-no">{ok ? <Check size={11} /> : i + 1}</span>
              <span className="prod-step-main">
                <b>{CREATION_STEP_LABELS_ZH[type]}</b>
                <i>{waiting ? "待确认" : CREATION_STEP_SUBTITLES[type]}</i>
              </span>
              {outputs.has(type) && <FileText size={11} className="prod-step-has" />}
            </li>
          );
        })}
      </ul>

      <div className="prod-note">
        本步推演：{hasSimulation(focusType)
          ? `${TIANYAN_ROUNDS.staged[focusType]} 轮智能体仿真`
          : "本步不跑仿真"}
      </div>
    </div>
  );
}
