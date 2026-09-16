/**
 * CastPanel — 引导向导左栏「已铸档案」。
 *
 * 设计沿用 studio 的 AB-v4 铸造向导（components/CastPanel.tsx），
 * 但步骤模型换成后端真实的六步。已确认的步骤可点击回顾。
 *
 * 「章节正文」下面挂**章节目录**：编排里每章是一个独立步骤
 * （chapter_write-1 / -2 / …），但六步视图只显示最新那一个，写到第 2 章
 * 就再也点不回第 1 章。目录把每一章都列出来，点哪章看哪章、就地重写。
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import {
  CREATION_LOOP_STEP_TYPES, CREATION_STEP_LABELS_ZH, STEP_ICON, STEP_BRIEF,
  type CreationLoopStepType,
} from "../types/creation-loop";

export type CastState = "done" | "active" | "review" | "waiting" | "failed";

/** 章节目录的一行：来自编排步骤 + 章节索引（标题/字数）。 */
export interface CastChapter {
  readonly stepId: string;
  readonly number: number;
  readonly title: string;
  readonly wordCount: number | null;
  readonly state: CastState;
}

export function CastPanel({
  bookTitle, stepsDone, stateOf, attemptOf, activeType, activeStepId, onPick,
  chapters, onPickChapter, graphHref, onOpenGraph, viewingGraph, simulationEnabled = true,
}: {
  readonly simulationEnabled?: boolean;
  readonly bookTitle: string;
  readonly stepsDone: number;
  readonly stateOf: (t: CreationLoopStepType) => CastState;
  /** 该步生成过几次（>1 说明重铸过，展示成 v2/v3）。 */
  readonly attemptOf: (t: CreationLoopStepType) => number;
  readonly activeType: CreationLoopStepType;
  /** 正在看的具体步骤 id（章节目录靠它高亮到「第几章」）。 */
  readonly activeStepId: string | null;
  readonly onPick: (t: CreationLoopStepType) => void;
  /** 章节目录（按章号升序）。空数组时不显示目录。 */
  readonly chapters: ReadonlyArray<CastChapter>;
  readonly onPickChapter: (stepId: string) => void;
  /** 图谱档案入口（/workbench/:bookId/graph）。书还没建出来（preBook）时不传不显示。 */
  readonly graphHref?: string;
  readonly onOpenGraph?: () => void;
  readonly viewingGraph?: boolean;
}) {
  const total = CREATION_LOOP_STEP_TYPES.length;
  const pct = Math.round((stepsDone / total) * 100);
  // 章节多起来会很长：默认展开（用户主要在这儿工作），可收起。
  const [chaptersOpen, setChaptersOpen] = useState(true);

  return (
    <aside className="cast">
      <div className="cast-prog">
        <div className="cast-title">{bookTitle}</div>
        <div className="cast-meta">世界铸造中 · {stepsDone} / {total}</div>
        <div className="cast-bar"><i style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="cast-cap">已铸档案</div>
      {CREATION_LOOP_STEP_TYPES.map((type) => {
        const st = stateOf(type);
        const ver = Math.max(1, attemptOf(type));
        const clickable = st === "done" || st === "active" || st === "review" || st === "failed";
        return (
          <div key={type}>
            <button
              className={`cast-item is-${st} ${activeType === type && !viewingGraph ? "is-current" : ""}`}
              onClick={() => clickable && onPick(type)}
              disabled={!clickable}
            >
              <div className="cast-item-h">
                <span className="cast-item-ico">{STEP_ICON[type]}</span>
                <span className="cast-item-t">{CREATION_STEP_LABELS_ZH[type]}</span>
                <span className={`cast-item-st is-${st}`}>
                  {st === "done" ? `✓ v${ver}`
                    : st === "review" ? "待审阅"
                    : st === "active" ? "铸造中"
                    : st === "failed" ? "失败"
                    : "待铸"}
                </span>
              </div>
              <div className="cast-item-d">{type === "chapter_write" && !simulationEnabled ? "按已确认章纲成文，完成审校与结算。" : STEP_BRIEF[type]}</div>
            </button>

            {/* 图谱档案：紧跟意图卡下面的独立入口，点开进 /workbench/:bookId/graph */}
            {type === "intent" && graphHref && (
              <Link
                className={`cast-item cast-graph ${viewingGraph ? "is-current" : ""}`}
                to={graphHref}
                title="全书实体与关系网"
                onClick={onOpenGraph ? (event) => { event.preventDefault(); onOpenGraph(); } : undefined}
              >
                <div className="cast-item-h">
                  <span className="cast-item-ico">🕸️</span>
                  <span className="cast-item-t">图谱档案</span>
                  <span className="cast-item-st">查看</span>
                </div>
                <div className="cast-item-d">全书实体与关系网，点开看整张图谱。</div>
              </Link>
            )}

            {type === "chapter_write" && chapters.length > 0 && (
              <div className="cast-toc">
                <button className="cast-toc-head" onClick={() => setChaptersOpen((v) => !v)}>
                  <ChevronDown size={12} className={chaptersOpen ? "is-open" : ""} />
                  章节目录
                  <em>{chapters.length}</em>
                </button>
                {chaptersOpen && (
                  <div className="cast-toc-list">
                    {chapters.map((ch) => (
                      <button
                        key={ch.stepId}
                        className={`cast-toc-item is-${ch.state} ${activeStepId === ch.stepId ? "is-current" : ""}`}
                        onClick={() => onPickChapter(ch.stepId)}
                        title={`第 ${ch.number} 章 ${ch.title}`}
                      >
                        <span className="cast-toc-no">{ch.number}</span>
                        <span className="cast-toc-title">{ch.title || `第 ${ch.number} 章`}</span>
                        <span className={`cast-toc-st is-${ch.state}`}>
                          {ch.state === "done" ? (ch.wordCount ? `${ch.wordCount}字` : "✓")
                            : ch.state === "review" ? "待审阅"
                            : ch.state === "active" ? "写作中"
                            : ch.state === "failed" ? "失败"
                            : "待写"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}
