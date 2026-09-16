/**
 * StepOutput — 渲染某一步的产出。
 *
 * 每步的 output 形状由后端 adapter 决定（不是前端自定义的）：
 *   intent          intent-adapter.ts       { intent: { title, titleCandidates?, instruction, coreConflict?, ... } }
 *   worldview       foundation-adapter.ts   { storyFrame, bookRules, worldSettings?, powerSystem?,
 *                                             factions?[], protagonist?, antagonist?, allies?[], locations?[] }
 *   title_synopsis  foundation-adapter.ts   { candidates?[], title, synopsis }
 *   outline         foundation-adapter.ts   { volumeMap, pendingHooks, bigCycles?[], entities?[], roles?[] }
 *   chapter_plan    chapter-adapter.ts      pipeline.planChapter() 的结果（章号/标题/纲要…）
 *   chapter_write   chapter-write-adapter   { content, wordCount }
 *
 * 已知字段按语义排版；未知字段不吞掉，兜底以「其他产出」原样展示——
 * 后端加字段时前端不会静默丢内容。
 */
import { useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import type { CreationLoopStepType } from "../types/creation-loop";
import { DeAiPanel } from "./DeAiPanel";
import { RoleChips, RoleProfileModal } from "./RoleProfile";

type Rec = Readonly<Record<string, unknown>>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const arr = (v: unknown): ReadonlyArray<unknown> => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Rec =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};

/** 每步已知字段 → 中文块名。顺序即展示顺序。 */
const FIELD_BLOCKS: Readonly<Record<CreationLoopStepType, ReadonlyArray<[string, string]>>> = {
  intent: [],
  worldview: [
    ["storyFrame", "故事框架"],
    ["coreConflict", "核心冲突"],
    ["worldSettings", "世界设定"],
    ["powerSystem", "力量体系"],
    ["bookRules", "创作红线"],
  ],
  title_synopsis: [["synopsis", "简介"]],
  outline: [
    ["volumeMap", "卷册地图"],
    ["pendingHooks", "待收伏笔"],
  ],
  chapter_plan: [
    ["summary", "本卷定位"],
    ["outline", "章节编排"],
    ["cyclePlan", "循环规划"],
  ],
  chapter_write: [["content", "正文"]],
};

/** 已被专门渲染掉的键，不再进「其他产出」。 */
const HANDLED: Readonly<Record<CreationLoopStepType, ReadonlyArray<string>>> = {
  intent: ["intent"],
  worldview: [
    "storyFrame", "coreConflict", "worldSettings", "powerSystem", "bookRules",
    "factions", "allies", "locations", "artifacts", "protagonist", "antagonist",
    "titleSynopsis",
  ],
  title_synopsis: ["title", "synopsis", "candidates"],
  outline: ["volumeMap", "pendingHooks", "bigCycles", "entities", "roles", "planningLevel", "storyOverview", "buildKey"],
  chapter_plan: ["summary", "outline", "cyclePlan", "chapterNumber", "title",
    "cycle", "chapter_range", "agents", "chapters", "active_chapter", "volumePlan"],
  chapter_write: ["content", "wordCount", "title"],
};

export function StepOutput({
  type,
  output,
  roleIndex,
}: {
  readonly type: CreationLoopStepType;
  readonly output: Rec | null;
  /**
   * 名字 → 完整角色档案。由 WorkbenchPage 从大纲步的 roles[] 汇总下发，
   * 让后面几步里只有名字的角色（卷内登场名单等）也点得开同一份档案。
   */
  readonly roleIndex?: Readonly<Record<string, Rec>>;
}) {
  if (!output || Object.keys(output).length === 0) {
    return <div className="so-empty">本步尚无产出</div>;
  }

  return (
    <div className="so">
      {type === "intent" && <IntentBlocks data={rec(output.intent)} />}
      {type === "title_synopsis" && <TitleBlocks data={output} />}

      {FIELD_BLOCKS[type].map(([key, label]) => {
        const text = str(output[key]);
        if (!text.trim()) return null;
        // 章节正文：正文块头部常驻「AI 检测」——打开独立面板，由作者点击开始检测。
        if (type === "chapter_write" && key === "content") {
          return <ChapterContentBlock key={key} label={label} text={text} />;
        }
        return <TextBlock key={key} label={label} text={text} serif={key === "content"} />;
      })}

      {type === "worldview" && <WorldEntities data={output} />}
      {type === "outline" && <OutlineExtras data={output} />}
      {type === "chapter_plan" && <CyclePlanBlocks data={output} roleIndex={roleIndex} />}
      {type === "chapter_write" && <WordCount value={num(output.wordCount)} />}

      <OtherFields output={output} handled={HANDLED[type]} />
    </div>
  );
}

/* ── 通用文本块 ── */
function TextBlock({
  label, text, serif = false,
}: { readonly label: string; readonly text: string; readonly serif?: boolean }) {
  const long = text.length > 420;
  const [open, setOpen] = useState(!long);
  return (
    <section className="so-block">
      <header className="so-block-head">
        <span className="so-block-label">{label}</span>
        {long && (
          <button className="so-toggle" onClick={() => setOpen((v) => !v)}>
            <ChevronDown size={13} className={open ? "is-open" : ""} />
            {open ? "收起" : "展开"}
          </button>
        )}
      </header>
      <div className={`so-block-body ${serif ? "is-serif" : ""} ${open ? "" : "is-clamped"}`}>
        {text}
      </div>
    </section>
  );
}

/* ── 章节正文块：头部内嵌「AI 检测」——打开面板后手动检测当前章，检测结果/改写在正文下方 ── */
function ChapterContentBlock({ label, text }: { readonly label: string; readonly text: string }) {
  const long = text.length > 420;
  const [open, setOpen] = useState(!long);
  const [detecting, setDetecting] = useState(false);
  return (
    <section className="so-block">
      <header className="so-block-head">
        <span className="so-block-label">{label}</span>
        <button className="so-toggle" onClick={() => setOpen((v) => !v)}>
          <ChevronDown size={13} className={open ? "is-open" : ""} />
          {open ? "收起" : "展开"}
        </button>
        <button
          className={`so-toggle so-deai-toggle ${detecting ? "is-on" : ""}`}
          onClick={() => setDetecting((v) => !v)}
        >
          <ShieldCheck size={13} />
          {detecting ? "收起检测" : "天工 AI 检测 · 会员"}
        </button>
      </header>
      <div className={`so-block-body is-serif ${open ? "" : "is-clamped"}`}>
        {text}
      </div>
      {detecting && (
        <div className="so-deai">
          {/* 来源标记随记录入库（迁移 051）：写书页章节内嵌的检测，回检测页能看到「章节」来源 */}
          <DeAiPanel content={text} source="chapter" sourceLabel={label} />
        </div>
      )}
    </section>
  );
}

/* ── 意图卡 ── */
function IntentBlocks({ data }: { readonly data: Rec }) {
  const candidates = arr(data.titleCandidates).map(str).filter(Boolean);
  return (
    <>
      <section className="so-block">
        <header className="so-block-head"><span className="so-block-label">书名</span></header>
        <div className="so-title">{str(data.title) || "未命名"}</div>
        {candidates.length > 1 && (
          <div className="so-chips">
            {candidates.map((c) => (
              <span key={c} className={`so-chip ${c === str(data.title) ? "is-on" : ""}`}>{c}</span>
            ))}
          </div>
        )}
      </section>
      {str(data.instruction) && <TextBlock label="创作灵感" text={str(data.instruction)} />}
      {str(data.coreConflict) && <TextBlock label="核心冲突" text={str(data.coreConflict)} />}
      <div className="so-meta">
        {str(data.genreId) && <span>题材 {str(data.genreId)}</span>}
        {num(data.targetChapters) !== null && <span>目标 {num(data.targetChapters)} 章</span>}
        {num(data.chapterWordCount) !== null && <span>每章 {num(data.chapterWordCount)} 字</span>}
        {str(data.platform) && <span>平台 {str(data.platform)}</span>}
      </div>
    </>
  );
}

/* ── 书名与简介 ── */
function TitleBlocks({ data }: { readonly data: Rec }) {
  const candidates = arr(data.candidates).map(rec);
  return (
    <>
      <section className="so-block">
        <header className="so-block-head"><span className="so-block-label">书名</span></header>
        <div className="so-title">{str(data.title) || "未命名"}</div>
      </section>
      {candidates.length > 0 && (
        <section className="so-block">
          <header className="so-block-head"><span className="so-block-label">候选书名</span></header>
          <div className="so-cards">
            {candidates.map((c, i) => (
              <div key={`${str(c.title)}-${i}`} className="so-card">
                <div className="so-card-title">{str(c.title)}</div>
                {str(c.reason) && <div className="so-card-desc">{str(c.reason)}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ── 世界观实体 ── */
function WorldEntities({ data }: { readonly data: Rec }) {
  const groups: ReadonlyArray<[string, ReadonlyArray<Rec>]> = [
    ["势力", arr(data.factions).map(rec)],
    ["盟友", arr(data.allies).map(rec)],
    ["地点", arr(data.locations).map(rec)],
    ["器物", arr(data.artifacts).map(rec)],
  ];
  const leads: ReadonlyArray<[string, string]> = [
    ["主角", str(data.protagonist)],
    ["对手", str(data.antagonist)],
  ];
  const hasLeads = leads.some(([, v]) => v.trim());
  const hasGroups = groups.some(([, list]) => list.length > 0);
  if (!hasLeads && !hasGroups) return null;

  return (
    <>
      {hasLeads && (
        <section className="so-block">
          <header className="so-block-head"><span className="so-block-label">核心人物</span></header>
          <div className="so-cards">
            {leads.filter(([, v]) => v.trim()).map(([label, v]) => (
              <div key={label} className="so-card">
                <div className="so-card-title">{label}</div>
                <div className="so-card-desc">{v}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      {groups.filter(([, list]) => list.length > 0).map(([label, list]) => (
        <section key={label} className="so-block">
          <header className="so-block-head">
            <span className="so-block-label">{label}</span>
            <span className="so-block-count">{list.length}</span>
          </header>
          <div className="so-cards">
            {list.map((e, i) => (
              <div key={`${str(e.name)}-${i}`} className="so-card">
                <div className="so-card-title">{str(e.name)}</div>
                {str(e.description) && <div className="so-card-desc">{str(e.description)}</div>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/* ── 大纲：卷清单 + 智能体 ── */
function OutlineExtras({ data }: { readonly data: Rec }) {
  const cycles = arr(data.bigCycles).map(rec);
  const roles = arr(data.roles).map(rec);
  const entities = arr(data.entities).map(rec);
  return (
    <>
      {cycles.length > 0 && (
        <section className="so-block">
          <header className="so-block-head">
            <span className="so-block-label">大循环（卷）</span>
            <span className="so-block-count">{cycles.length}</span>
          </header>
          <div className="so-cycles">
            {cycles.map((c, i) => {
              const volume = rec(c.volume);
              // 真实字段是 goal/chapterRange/volume——早期只读了根本不存在的
              // summary 字段，所以每个大循环只剩个标题（白板）。
              const goal = str(c.goal) || str(c.summary);
              const meta: string[] = [];
              if (str(volume.name)) meta.push(`地图：${str(volume.name)}`);
              if (str(volume.factions)) meta.push(`势力：${str(volume.factions)}`);
              if (str(volume.constraints)) meta.push(`约束：${str(volume.constraints)}`);
              return (
                <div key={str(c.id) || i} className="so-cycle">
                  <span className="so-cycle-idx">{i + 1}</span>
                  <div className="so-cycle-main">
                    <div className="so-cycle-title">
                      {str(c.title) || `第 ${i + 1} 卷`}
                      {str(c.chapterRange) && <span className="so-cycle-range">{c.chapterRangeIsEstimate ? "预计 " : ""}{str(c.chapterRange)}</span>}
                    </div>
                    {goal && <div className="so-cycle-desc">{goal}</div>}
                    {meta.length > 0 && <div className="so-cycle-meta">{meta.join(" · ")}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {roles.length > 0 && (
        <section className="so-block">
          <header className="so-block-head">
            <span className="so-block-label">智能体档案</span>
            <span className="so-block-count">{roles.length}</span>
            <span className="so-block-hint">点开看完整档案</span>
          </header>
          {/* 档案是完整的（人设/目标/冲突/能力/关系/成长…），别只渲染名字。 */}
          <RoleChips roles={roles} />
        </section>
      )}
      {roles.length === 0 && entities.length > 0 && (
        <section className="so-block">
          <header className="so-block-head">
            <span className="so-block-label">涉及实体</span>
            <span className="so-block-count">{entities.length}</span>
          </header>
          <div className="so-chips">
            {entities.map((e, i) => (
              <span key={`${str(e.name)}-${i}`} className="so-chip">{str(e.name)}</span>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ── 卷与循环（chapter_plan）：cycleAgent 真实产出形状 ──
   { cycle: {title, chapter_range, target_word_count, cycle_goal, core_conflict, start_state, end_state?},
     agents: [{name, roleInCycle, isNew}],
     chapters: [{chapter_num, title, target_emotion, summary, purpose, core_event, state_delta, ending_hook?}],
     active_chapter: {title, pov, opening_hook, five_part_arc?} } */
function CyclePlanBlocks({
  data, roleIndex,
}: { readonly data: Rec; readonly roleIndex?: Readonly<Record<string, Rec>> }) {
  const plannedCycles = arr(rec(data.volumePlan).cycles).map(rec);
  if (plannedCycles.length > 0) return <>{plannedCycles.map((plan, i) => <CyclePlanBlocks key={str(rec(plan.cycle).id) || i} data={plan} roleIndex={roleIndex} />)}</>;
  const cycle = rec(data.cycle);
  const agents = arr(data.agents).map(rec);
  const chapters = arr(data.chapters).map(rec);
  const active = rec(data.active_chapter);
  const range = str(data.chapter_range) || str(cycle.chapter_range);
  if (Object.keys(cycle).length === 0 && chapters.length === 0) return null;
  return (
    <>
      <section className="so-block">
        <header className="so-block-head">
          <span className="so-block-label">小循环 · {str(cycle.title) || "未命名循环"}</span>
          {range && <span className="so-block-count">第 {range} 章</span>}
        </header>
        <div className="so-cycle-info">
          {str(cycle.cycle_goal) && <p><b>循环目标</b>{str(cycle.cycle_goal)}</p>}
          {str(cycle.core_conflict) && <p><b>核心冲突</b>{str(cycle.core_conflict)}</p>}
          {str(cycle.start_state) && <p><b>开局状态</b>{str(cycle.start_state)}</p>}
          {str(cycle.end_state) && <p><b>卷末状态</b>{str(cycle.end_state)}</p>}
          {num(cycle.target_word_count) !== null && (
            <p><b>目标字数</b>{num(cycle.target_word_count)!.toLocaleString()} 字</p>
          )}
        </div>
      </section>

      {agents.length > 0 && (
        <section className="so-block">
          <header className="so-block-head">
            <span className="so-block-label">本卷登场智能体</span>
            <span className="so-block-count">{agents.length}</span>
          </header>
          {/* 卷内名单只有 {name, roleInCycle}——把大纲步的完整档案合进来，
              这里的角色才点得开（同一个人不该在两步里是两种东西）。 */}
          <CycleAgentCards agents={agents} roleIndex={roleIndex} />
        </section>
      )}

      {chapters.length > 0 && (
        <section className="so-block">
          <header className="so-block-head">
            <span className="so-block-label">章节编排</span>
            <span className="so-block-count">{chapters.length} 章</span>
          </header>
          <div className="so-chapters">
            {chapters.map((ch, i) => (
              <ChapterPlanRow key={str(ch.id) || num(ch.chapter_num) || i} ch={ch} />
            ))}
          </div>
        </section>
      )}

      {(arr(active.scenes).length > 0 || str(active.opening_hook)) && (
        <section className="so-block">
          <header className="so-block-head">
            <span className="so-block-label">当前章纲 · {str(active.title)}</span>
            {str(active.pov) && <span className="so-block-count">POV {str(active.pov)}</span>}
          </header>
          {str(active.opening_hook) && (
            <div className="so-block-body">{str(active.opening_hook)}</div>
          )}
          <FivePartArc raw={str(active.five_part_arc)} />
        </section>
      )}
    </>
  );
}

/**
 * 卷内登场智能体：卷纲只给 {name, roleInCycle, isNew}，
 * 与大纲步的完整档案（roleIndex）合并后即可点开看全档。
 */
function CycleAgentCards({
  agents, roleIndex,
}: {
  readonly agents: ReadonlyArray<Rec>;
  readonly roleIndex?: Readonly<Record<string, Rec>>;
}) {
  const [open, setOpen] = useState<Rec | null>(null);
  return (
    <>
      <div className="so-cards">
        {agents.map((a, i) => {
          const name = str(a.name);
          const profile = roleIndex?.[name];
          // 合并：卷内定位（roleInCycle）优先展示，档案字段补全弹窗内容。
          const merged = profile ? { ...profile, ...a } : null;
          const body = (
            <>
              <div className="so-card-title">
                {name}
                {a.isNew === true && <span className="so-card-badge">新登场</span>}
                {merged && <span className="so-card-more">档案</span>}
              </div>
              {str(a.roleInCycle) && <div className="so-card-desc">{str(a.roleInCycle)}</div>}
            </>
          );
          return merged ? (
            <button
              key={`${name}-${i}`}
              type="button"
              className="so-card is-clickable"
              onClick={() => setOpen(merged)}
            >
              {body}
            </button>
          ) : (
            <div key={`${name}-${i}`} className="so-card">{body}</div>
          );
        })}
      </div>
      {open && <RoleProfileModal role={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** 章节编排的一行：标题 + 情绪 + 纲要，细节（作用/事件/状态变化/钩子）可展开。 */
function ChapterPlanRow({ ch }: { readonly ch: Rec }) {
  const [open, setOpen] = useState(false);
  const n = num(ch.chapter_num);
  const details: ReadonlyArray<[string, string]> = [
    ["作用", str(ch.purpose)],
    ["核心事件", str(ch.core_event)],
    ["状态变化", str(ch.state_delta)],
    ["章末钩子", str(ch.ending_hook)],
  ];
  const hasDetails = details.some(([, v]) => v);
  return (
    <div className="so-chapter">
      <button className="so-chapter-head" onClick={() => hasDetails && setOpen((v) => !v)}>
        <span className="so-chapter-no">{n !== null ? `第 ${n} 章` : "—"}</span>
        <span className="so-chapter-title">{str(ch.title)}</span>
        {str(ch.target_emotion) && <span className="so-chapter-emo">{str(ch.target_emotion)}</span>}
        {hasDetails && (
          <ChevronDown size={13} className={open ? "is-open" : ""} />
        )}
      </button>
      {str(ch.summary) && <div className="so-chapter-summary">{str(ch.summary)}</div>}
      {open && (
        <div className="so-chapter-details">
          {details.filter(([, v]) => v).map(([label, v]) => (
            <p key={label}><b>{label}</b>{v}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** 五段式章纲：后端存的是 JSON 行串（每行 {"part","content"}）。 */
function FivePartArc({ raw }: { readonly raw: string }) {
  if (!raw.trim()) return null;
  const parts = raw.split("\n")
    .map((line) => {
      try {
        const p = JSON.parse(line) as { part?: unknown; content?: unknown };
        return { part: str(p.part), content: str(p.content) };
      } catch {
        return null;
      }
    })
    .filter((p): p is { part: string; content: string } => !!p && !!p.content);
  if (parts.length === 0) return null;
  return (
    <div className="so-arc">
      {parts.map((p, i) => (
        <div key={`${p.part}-${i}`} className="so-arc-row">
          <span className="so-arc-part">{p.part || `段 ${i + 1}`}</span>
          <span className="so-arc-content">{p.content}</span>
        </div>
      ))}
    </div>
  );
}

function WordCount({ value }: { readonly value: number | null }) {
  if (value === null) return null;
  return <div className="so-meta"><span>{value.toLocaleString()} 字</span></div>;
}

/**
 * 兜底：后端加了新字段而前端还没排版时，原样露出来而不是悄悄丢掉。
 */
function OtherFields({
  output, handled,
}: { readonly output: Rec; readonly handled: ReadonlyArray<string> }) {
  const rest = Object.entries(output).filter(
    ([k, v]) => !["restoredFromFiles", "priorChapterPlan"].includes(k) && !handled.includes(k) && v !== null && v !== undefined && v !== "",
  );
  const [open, setOpen] = useState(false);
  if (rest.length === 0) return null;
  return (
    <section className="so-block is-other">
      <header className="so-block-head">
        <span className="so-block-label">其他产出</span>
        <span className="so-block-count">{rest.length}</span>
        <button className="so-toggle" onClick={() => setOpen((v) => !v)}>
          <ChevronDown size={13} className={open ? "is-open" : ""} />
          {open ? "收起" : "展开"}
        </button>
      </header>
      {open && (
        <pre className="so-raw">
          {rest.map(([k, v]) =>
            `${k}: ${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`,
          ).join("\n\n")}
        </pre>
      )}
    </section>
  );
}
