/**
 * FilmInspector —— 影游播放器的右栏：状态 / 诊断 / 导出。
 *
 * 「诊断」与「导出」是从老 studio 的 `AnalysisPanel` / `ExportBar` 迁过来的
 * （Phase 6）。它们是纯展示 + 纯链接，最该先搬 —— 也是老向导里对作者最有用的
 * 两块：一张图哪里断了、哪些变量声明了没人用、有几条路走不到结局，
 * 光靠玩是玩不出来的。
 *
 * 诊断数据来自 `GET /projects/:id/story-graph/analysis`（后端已有，没重写）。
 */
import { useState, useEffect } from "react";
import {
  AlertCircle, AlertTriangle, Info, CheckCircle2, Loader2, Download, RefreshCw,
} from "lucide-react";
import {
  fetchFilmAnalysis, filmExportUrl, type FilmAnalysis, type FilmIssue,
} from "../../lib/api";
import type { StoryGraph, VarState } from "../../lib/story-play";

type Tab = "state" | "check" | "export";

interface FilmInspectorProps {
  readonly projectId: string;
  readonly graph: StoryGraph;
  readonly vars: VarState;
  readonly steps: number;
}

/** 问题码 → 一句人话。后端的 code 是给程序看的，作者要看的是「这是什么毛病」。 */
const ISSUE_LABEL: Readonly<Record<string, string>> = {
  DEAD_END: "死路：走进去出不来",
  BROKEN_LINK: "断链：选项指向不存在的节点",
  UNREACHABLE: "孤岛：没有任何路能走到",
  NO_PATH_TO_ENDING: "走不到结局",
  VARIABLE_UNWRITTEN: "变量没人写：条件永远用默认值判",
  VARIABLE_UNUSED: "变量多余：声明了但既没人写也没人读",
  VARIABLE_NEVER_READ: "假深度：变量一直在变，却没有条件用它",
  ENDING_VARIETY: "结局区分度不够",
  IMAGE_MISSING: "缺配图",
  GATED_UNREACHABLE: "门槛过不去：条件在这条路上抬不上来",
  ENDING_UNREACHABLE: "这个结局走不到",
  ILLUSORY_BRANCH: "假分岔：选项不同、去向相同",
  LINEAR_GRAPH: "其实是条直线，没有真正的分支",
  ISOLATED_NODE: "孤立节点",
  LONG_LINEAR_CHAIN: "长直线：连着很多步都没得选",
};

const LEVEL_ICON = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

export function FilmInspector({ projectId, graph, vars, steps }: FilmInspectorProps) {
  const [tab, setTab] = useState<Tab>("state");
  const [analysis, setAnalysis] = useState<FilmAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    void fetchFilmAnalysis(projectId)
      .then(setAnalysis)
      .catch(() => setAnalysis(null))
      .finally(() => setLoading(false));
  };

  // 只在真的切到「诊断」时才拉 —— 它要在后端穷举全部路径，不该在进播放器时就跑。
  useEffect(() => {
    if (tab === "check" && !analysis && !loading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <aside className="film-vars">
      <div className="film-tabs">
        {([["state", "状态"], ["check", "诊断"], ["export", "导出"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`film-tab${tab === id ? " is-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "state" && (
        <>
          {(graph.variables ?? []).length === 0 ? (
            <p className="film-dim">这部影游没有变量。</p>
          ) : (
            (graph.variables ?? []).map((v) => (
              <div key={v.name} className="film-var">
                <span className="film-var-name">{v.desc || v.name}</span>
                <span className="film-var-value">{String(vars[v.name] ?? v.default)}</span>
              </div>
            ))
          )}
          <div className="film-side-head">这部影游</div>
          <div className="film-var"><span className="film-var-name">节点</span><span className="film-var-value">{graph.nodes.length}</span></div>
          <div className="film-var"><span className="film-var-name">结局</span><span className="film-var-value">{graph.endings.length}</span></div>
          <div className="film-var"><span className="film-var-name">已走</span><span className="film-var-value">{steps} 步</span></div>
        </>
      )}

      {tab === "check" && (
        loading ? (
          <p className="film-dim"><Loader2 size={12} className="spin" /> 校验中（要穷举全部路径）…</p>
        ) : !analysis ? (
          <p className="film-dim">读不到诊断结果。</p>
        ) : (
          <>
            <div className="film-check-head">
              {analysis.report.ok
                ? <span className="film-check-ok"><CheckCircle2 size={12} /> 没有发现问题</span>
                : <span className="film-check-bad">{analysis.report.issues.length} 处问题</span>}
              <button type="button" onClick={load} title="重新校验"><RefreshCw size={11} /></button>
            </div>

            {analysis.report.issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}

            <div className="film-side-head">路径分布</div>
            <p className="film-dim">
              共 {analysis.distribution.total} 条路径
              {analysis.distribution.truncated && "（图太大，已截断）"}
            </p>
            {Object.entries(analysis.distribution.byEnding).map(([endingId, n]) => {
              const ending = graph.endings.find((e) => e.id === endingId);
              return (
                <div key={endingId} className="film-var">
                  {/* `(dead-end)` 是后端给走不到结局的那些路的标记 */}
                  <span className="film-var-name">
                    {endingId === "(dead-end)" ? "⚠ 走不到结局" : ending?.title ?? endingId}
                  </span>
                  <span className="film-var-value">{n} 条</span>
                </div>
              );
            })}
          </>
        )
      )}

      {tab === "export" && (
        <>
          <p className="film-dim">
            导出的是这张分支图本身，不含你这一局走过的路（路线用左栏的分享）。
          </p>
          {([
            ["json", "JSON", "原始分支图，可再导入"],
            ["ink", "Ink", "Inkle 的剧本格式"],
            ["html", "可玩网页", "单文件，双击就能玩"],
          ] as const).map(([fmt, label, desc]) => (
            <a
              key={fmt}
              className="film-export"
              href={filmExportUrl(projectId, fmt)}
              target="_blank"
              rel="noreferrer"
            >
              <Download size={12} />
              <span className="film-export-main">
                <b>{label}</b>
                <i>{desc}</i>
              </span>
            </a>
          ))}
        </>
      )}
    </aside>
  );
}

function IssueRow({ issue }: { readonly issue: FilmIssue }) {
  const Icon = LEVEL_ICON[issue.level] ?? Info;
  return (
    <div className={`film-issue is-${issue.level}`}>
      <div className="film-issue-head">
        <Icon size={11} />
        {ISSUE_LABEL[issue.code] ?? issue.code}
      </div>
      <div className="film-issue-msg">{issue.message}</div>
      {issue.nodeIds.length > 0 && (
        <div className="film-issue-nodes">
          {issue.nodeIds.slice(0, 6).map((id) => <span key={id}>{id}</span>)}
          {issue.nodeIds.length > 6 && <span>+{issue.nodeIds.length - 6}</span>}
        </div>
      )}
    </div>
  );
}
