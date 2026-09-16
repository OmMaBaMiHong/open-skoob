/**
 * FilmPlayerPage —— 互动影游的播放器。
 *
 * 核心判断：**播放要做成「聊天」，不是做成「阅读器」**。
 * 它的数据本来就是对话（`DialogueLine{speaker,text,emotion}`），做成
 * 「一大段文字 + 底部三个按钮」是把对话压扁成散文再让用户读。
 *
 * 三栏（复用剧场那套骨架，但**运行时完全不同**：这里是确定性状态机，零 LLM）：
 *   左  已走过的路 + 结局墙
 *   中  聊天式播放，选项停在消息流里
 *   右  变量状态 + 图信息
 *
 * 几条刻意的设计（理由见 docs/plans/2026-09-04-theater-vs-interactive-film.md §5）：
 *   1. 选项停在流里，不固定在底部 —— 往上翻能看到「我当时选的是②」；
 *   2. 不满足条件的选项**显示出来并说明原因**，不隐藏 —— 藏了就断了重玩的动机；
 *   3. `critical` 标不可逆；
 *   4. effects 行内轻提示，不弹窗。
 */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Loader2, Lock, AlertTriangle, RotateCcw, Flag, Trophy, ArrowLeft,
  Share2, Link2, Check, QrCode, Network, X,
} from "lucide-react";
import { fetchStoryGraph, createFilmShare } from "../lib/api";
import { QrCanvas } from "../components/simulation/QrCanvas";
import { FilmInspector } from "../components/simulation/FilmInspector";
import { StoryMap } from "../components/simulation/StoryMap";
import {
  startNodeOf, nodeById, endingOfNode, choiceStates, effectsText, applyEffects,
  initVarState, replay,
  type StoryGraph, type StoryNode, type VarState, type PlayStep, type Choice,
} from "../lib/story-play";

export function FilmPlayerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [graph, setGraph] = useState<StoryGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 走过的选择序列 —— 重玩、从岔路重来、以后分享路线都靠它。 */
  const [steps, setSteps] = useState<ReadonlyArray<PlayStep>>([]);
  /**
   * 全貌图。做成盖在中栏上的浮层而不是右栏一个页签 —— 分支图要横向铺开，
   * 塞进那条窄边栏等于看不清。
   */
  const [mapOpen, setMapOpen] = useState(false);
  const [node, setNode] = useState<StoryNode | null>(null);
  const [vars, setVars] = useState<VarState>({});
  /** 解锁过的结局（重玩时累计，做成结局墙）。 */
  const [unlocked, setUnlocked] = useState<ReadonlyArray<string>>([]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 分享出去的这条路线（每分享一次生成一个新链接）。 */
  const [share, setShare] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void fetchStoryGraph(projectId)
      .then((raw) => {
        if (cancelled) return;
        const g = raw as StoryGraph;
        setGraph(g);
        setNode(startNodeOf(g));
        setVars(initVarState(g.variables ?? []));
      })
      .catch(() => { if (!cancelled) setError("读不到这部影游的分支图"); });
    return () => { cancelled = true; };
  }, [projectId]);

  // 新内容出来时贴底滚动
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps.length, node]);

  const ending = useMemo(
    () => (graph && node ? endingOfNode(graph, node.id) : null),
    [graph, node],
  );

  // 走到结局就记进结局墙
  useEffect(() => {
    if (!ending) return;
    setUnlocked((prev) => (prev.includes(ending.id) ? prev : [...prev, ending.id]));
  }, [ending]);

  const pick = useCallback((choice: Choice) => {
    if (!graph || !node) return;
    setSteps((prev) => [...prev, { nodeId: node.id, choiceId: choice.id, choiceText: choice.text }]);
    setVars((prev) => applyEffects(prev, choice.effects));
    setNode(nodeById(graph, choice.targetNodeId));
  }, [graph, node]);

  /** 从走过的某一步重来（不必从头）—— 重玩设计的核心。 */
  const rewindTo = useCallback((index: number) => {
    if (!graph) return;
    const kept = steps.slice(0, index);
    const { node: at, vars: v } = replay(graph, kept);
    setSteps(kept);
    setNode(at);
    setVars(v);
  }, [graph, steps]);

  const restart = useCallback(() => rewindTo(0), [rewindTo]);

  /**
   * 分享这条路线。
   *
   * 与剧场分享的区别：对方拿到链接不是只能看，而是**能自己玩一遍**
   * （快照里带整张图）。所以这是这套社交里最能自己转起来的一环。
   */
  const shareRoute = useCallback(async () => {
    if (!projectId || sharing) return;
    setSharing(true);
    try {
      const s = await createFilmShare(projectId, {
        steps: steps.map((x) => ({ ...x })),
        ...(ending ? { endingId: ending.id } : {}),
      });
      setShare(s.url);
    } catch {
      // 分享失败不该打断玩：按钮回到可点状态就行
    } finally {
      setSharing(false);
    }
  }, [projectId, steps, ending, sharing]);

  const copyShare = useCallback(async () => {
    if (!share) return;
    await navigator.clipboard.writeText(share);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [share]);

  if (error) {
    return (
      <div className="film-player">
        <div className="film-blank">
          <p>{error}</p>
          <Link to="/film" className="film-link">回影游列表</Link>
        </div>
      </div>
    );
  }
  if (!graph) {
    return (
      <div className="film-player">
        <div className="film-blank"><Loader2 size={16} className="spin" /> 读取中…</div>
      </div>
    );
  }

  const states = node ? choiceStates(node, vars, graph.variables ?? []) : [];
  /** 走过的每一步 → 中栏要渲染的节点序列（含当前节点）。 */
  const visited = replaySequence(graph, steps);

  return (
    <div className="film-player">
      {/* ── 左：走过的路 + 结局墙 ── */}
      <aside className="film-side">
        <Link to="/film" className="film-back"><ArrowLeft size={13} /> 影游</Link>
        <div className="film-side-title">{graph.title}</div>
        <button type="button" className="film-map-btn" onClick={() => setMapOpen(true)}>
          <Network size={12} /> 看全貌（{graph.nodes.length} 个节点）
        </button>

        <div className="film-side-head">走过的路</div>
        {steps.length === 0 ? (
          <p className="film-dim">还没做过选择。</p>
        ) : (
          <ol className="film-path">
            {steps.map((s, i) => (
              <li key={`${s.nodeId}-${i}`}>
                <button type="button" onClick={() => rewindTo(i)} title="从这一步重来">
                  <span className="film-path-no">{i + 1}</span>
                  <span className="film-path-text">{s.choiceText}</span>
                  <RotateCcw size={11} />
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="film-side-head">
          <Trophy size={11} /> 结局 {unlocked.length}/{graph.endings.length}
        </div>
        <div className="film-endings">
          {graph.endings.map((e) => {
            const got = unlocked.includes(e.id);
            return (
              <div key={e.id} className={`film-ending is-${e.type}${got ? " is-got" : ""}`}>
                {/* 没解锁的显示 ??? —— 看得见有多少个才有再玩一遍的动机 */}
                <span className="film-ending-title">{got ? e.title : "???"}</span>
                <span className="film-ending-kind">{ENDING_LABEL[e.type]}</span>
              </div>
            );
          })}
        </div>

        <button type="button" className="film-restart" onClick={restart}>
          <RotateCcw size={12} /> 从头再玩
        </button>

        <div className="film-side-head">分享这条路线</div>
        {!share ? (
          <>
            <p className="film-dim">
              对方打开不是只能看 —— 他能顺着你的选择走一遍，也能自己换条路重玩。
            </p>
            <button type="button" className="film-restart" disabled={sharing} onClick={shareRoute}>
              {sharing ? <Loader2 size={12} className="spin" /> : <Share2 size={12} />}
              {steps.length === 0 ? "分享这部影游" : `分享我的 ${steps.length} 步路线`}
            </button>
          </>
        ) : (
          <>
            <div className="film-share-link">
              <Link2 size={11} />
              <input readOnly value={share} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" onClick={copyShare} title="复制">
                {copied ? <Check size={11} /> : <Link2 size={11} />}
              </button>
            </div>
            <button type="button" className="film-restart" onClick={() => setShowQr((v) => !v)}>
              <QrCode size={12} /> {showQr ? "收起二维码" : "二维码"}
            </button>
            {showQr && (
              <div className="film-share-qr">
                <QrCanvas text={share} size={150} />
              </div>
            )}
          </>
        )}
      </aside>

      {/* ── 中：聊天式播放 ── */}
      <section className="film-stage">
        <div className="film-stage-body" ref={bodyRef}>
          {visited.map((v, vi) => (
            <div key={`${v.node.id}-${vi}`}>
              {v.node.sceneDesc && (
                <div className="film-scene"><span>{v.node.sceneDesc}</span></div>
              )}
              {v.node.dialogue.map((line, i) => (
                <div key={i} className="film-line">
                  <div className="film-line-who">
                    {line.speaker}
                    {line.emotion && <i>{line.emotion}</i>}
                  </div>
                  <div className="film-bubble">{line.text}</div>
                </div>
              ))}
              {/* 已经做过的选择：留在流里，往上翻能看到「我当时选的是哪个」 */}
              {v.chosen && (
                <div className="film-chosen">
                  已选：{v.chosen.text}
                  {effectsText(v.chosen.effects, graph.variables ?? []) && (
                    <i>{effectsText(v.chosen.effects, graph.variables ?? [])}</i>
                  )}
                </div>
              )}
            </div>
          ))}

          {ending ? (
            <div className={`film-ending-card is-${ending.type}`}>
              <div className="film-ending-flag"><Flag size={12} /> {ENDING_LABEL[ending.type]}结局</div>
              <div className="film-ending-name">{ending.title}</div>
              {ending.description && <p>{ending.description}</p>}
              <button type="button" className="film-btn" onClick={restart}>
                <RotateCcw size={12} /> 换条路再走一遍
              </button>
            </div>
          ) : states.length > 0 ? (
            <div className="film-choices">
              <div className="film-choices-head">你怎么做？</div>
              {states.map(({ choice, enabled, lockedBy }) => (
                <button
                  key={choice.id}
                  type="button"
                  className={`film-choice${enabled ? "" : " is-locked"}`}
                  disabled={!enabled}
                  onClick={() => pick(choice)}
                >
                  <span className="film-choice-text">{choice.text}</span>
                  {/* 不可逆的决定要标出来 —— 不提示，玩家回头只会觉得被坑 */}
                  {choice.weight === "critical" && (
                    <span className="film-choice-warn"><AlertTriangle size={11} /> 不可逆</span>
                  )}
                  {!enabled && <span className="film-choice-lock"><Lock size={11} /> {lockedBy}</span>}
                </button>
              ))}
            </div>
          ) : (
            <p className="film-dim">这条路走到头了，但没有配结局。（图不完整）</p>
          )}
        </div>
      </section>

      {mapOpen && (
        <div className="film-map-overlay" onClick={() => setMapOpen(false)}>
          <div className="film-map-panel" onClick={(e) => e.stopPropagation()}>
            <header className="film-map-head">
              <span>《{graph.title}》分支全貌</span>
              <button type="button" onClick={() => setMapOpen(false)} aria-label="关闭"><X size={14} /></button>
            </header>
            {/* 点节点只看内容、不跳过去 —— 跳过去等于绕开门槛，把「变量攒够了
                才解锁」那套设计废掉。要跳用左栏的「回到这一步」。 */}
            <StoryMap
              graph={graph}
              projectId={projectId ?? ""}
              steps={steps}
              currentNodeId={node?.id ?? ""}
              onGraphChange={setGraph}
            />
          </div>
        </div>
      )}

      {/* ── 右：状态 / 诊断 / 导出（诊断与导出从老 studio 迁来，见 FilmInspector） ── */}
      <FilmInspector
        projectId={projectId ?? ""}
        graph={graph}
        vars={vars}
        steps={steps.length}
      />
    </div>
  );
}

const ENDING_LABEL: Readonly<Record<string, string>> = {
  good: "好", bad: "坏", neutral: "中性", secret: "隐藏",
};

/** 把选择序列展开成「一路经过的节点 + 当时选了什么」，供中栏按顺序渲染。 */
function replaySequence(
  graph: StoryGraph,
  steps: ReadonlyArray<PlayStep>,
): ReadonlyArray<{ node: StoryNode; chosen: Choice | null }> {
  const out: Array<{ node: StoryNode; chosen: Choice | null }> = [];
  let cur = startNodeOf(graph);
  for (const step of steps) {
    if (!cur) break;
    const chosen = cur.choices.find((c) => c.id === step.choiceId) ?? null;
    out.push({ node: cur, chosen });
    if (!chosen) break;
    cur = nodeById(graph, chosen.targetNodeId);
  }
  if (cur) out.push({ node: cur, chosen: null });
  return out;
}
