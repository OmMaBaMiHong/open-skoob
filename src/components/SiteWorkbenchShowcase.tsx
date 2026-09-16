import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Check, FileText, GitBranch, Layers, MessageSquare, ScanLine, Sparkles } from "lucide-react";
import "../styles/site-workbench.css";

const VIEWS = [
  { id: "write", label: "小说创作", Icon: FileText },
  { id: "read", label: "逆向拆书", Icon: BookOpen },
  { id: "graph", label: "设定档案", Icon: GitBranch },
  { id: "polish", label: "检测改写", Icon: ScanLine },
] as const;
type View = typeof VIEWS[number]["id"];
const STEPS = ["意图卡", "世界观生成", "书名与简介", "全书大纲", "卷与循环", "章节正文"];
const WRITERS = ["规划师", "编排师", "执笔师", "审校师", "修订师", "结算师"];
const READERS = ["入库师", "测绘师", "开卷师", "本体师", "纪事师", "脉络师", "设定师", "验收师"];
const MODES = ["引导", "剧场", "互动影游"] as const;

function SettingMap() {
  const nodes = [
    { name: "沈照", kind: "人物", x: 14, y: 24 }, { name: "雾港", kind: "地点", x: 298, y: 24 },
    { name: "守灯人", kind: "势力", x: 6, y: 142 }, { name: "铜钥匙", kind: "器物", x: 306, y: 142 },
    { name: "听潮", kind: "能力", x: 56, y: 250 }, { name: "潮汐契约", kind: "规则", x: 258, y: 250 },
  ];
  return <svg className="showcase-map" viewBox="0 0 440 324" role="img" aria-label="雾港来信设定图：人物沈照、地点雾港、守灯人势力、铜钥匙、听潮能力与潮汐契约均有档案">
    {nodes.map(node => <path key={node.name} d={`M220 151 Q${node.x + 60} 151 ${node.x + 60} ${node.y + 28}`} />)}
    <g className="showcase-map-center"><circle cx="220" cy="151" r="43" /><text x="220" y="148">雾港来信</text><text x="220" y="167" className="showcase-map-type">作品世界</text></g>
    {nodes.map(node => <g key={node.name}><rect x={node.x} y={node.y} width="120" height="55" rx="8" /><text x={node.x + 60} y={node.y + 23}>{node.name}</text><text className="showcase-map-type" x={node.x + 60} y={node.y + 42}>{node.kind} · 档案</text></g>)}
  </svg>;
}

export function SiteWorkbenchShowcase() {
  const [view, setView] = useState<View>("write");
  const [mode, setMode] = useState<typeof MODES[number]>("引导");
  const isReading = view === "read";
  return <section className="nova-section nova-showcase" id="pipeline">
    <div className="nova-section-inner">
      <div className="showcase-heading"><div><span className="nova-eyebrow">STUDIO / 创作工作台</span><h2 className="nova-section-title">故事的一切，在这里发生。</h2></div><p>写故事、拆作品、召唤设定、打磨文字。</p></div>
      <div className="showcase-window">
        <div className="showcase-titlebar"><span className="showcase-window-dots" aria-hidden="true"><i /><i /><i /></span><span>焚诀 · 雾港来信</span><span className="showcase-demo">交互示意</span></div>
        <div className="showcase-tabs" role="tablist" aria-label="工作台能力展示" onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = VIEWS.findIndex(item => item.id === view);
          const next = event.key === "Home" ? 0 : event.key === "End" ? VIEWS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length;
          setView(VIEWS[next].id); document.getElementById(`showcase-tab-${VIEWS[next].id}`)?.focus();
        }}>
          {VIEWS.map(item => <button key={item.id} id={`showcase-tab-${item.id}`} type="button" role="tab" tabIndex={view === item.id ? 0 : -1} aria-selected={view === item.id} aria-controls="showcase-panel" onClick={() => setView(item.id)}><item.Icon size={16} /><span>{item.label}</span></button>)}
        </div>
        <div className="showcase-body" id="showcase-panel" role="tabpanel" aria-labelledby={`showcase-tab-${view}`}>
          <aside className="showcase-sidebar">
            <div className="showcase-book"><BookOpen size={24} strokeWidth={1.2} /><span>雾港来信<small>悬疑 · 奇幻 / 示例作品</small></span></div>
            <span className="showcase-overline">{isReading ? "拆解进程" : "作品目录"}</span>
            <ol>{(isReading ? READERS : STEPS).map((step, index, steps) => <li key={step} className={index === steps.length - 1 ? "is-current" : ""}><span>{String(index + 1).padStart(2, "0")}</span>{step}{index < steps.length - 1 && <Check size={11} />}</li>)}</ol>
            <div className="showcase-library"><Layers size={15} /><span>模板 / 风格 / Skill<small>按步骤选择，随时引用</small></span></div>
          </aside>
          <div key={view} className="showcase-canvas" data-view={view} tabIndex={0} aria-label="工作台示意画面，可滚动查看">
            {view === "write" && <>
              <div className="showcase-canvas-toolbar"><span>第一章</span><div className="showcase-modes" role="group" aria-label="创作模式示意">{MODES.map(item => <button type="button" key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{item}</button>)}</div></div>
              {mode === "引导" ? <div className="showcase-manuscript"><span className="showcase-overline">CHAPTER 01</span><h3>一封迟到的信</h3><p>钟楼敲过十二下，沈照在门缝里发现了那封信。</p><p>纸张带着海盐的气味。信封上的邮戳，落在三天之后。</p><p>他翻过信封。背面只有一句话：</p><blockquote>“天亮之前，不要让灯塔熄灭。”</blockquote><span className="showcase-cursor" aria-hidden="true" /></div>
                : mode === "剧场" ? <div className="showcase-theater"><span className="showcase-overline">天衍 · 角色互动示意</span><div><b>沈</b><p><strong>沈照</strong>这封信，为什么知道明天的事？</p></div><div><b>守</b><p><strong>守灯人</strong>先别问信是谁写的。你听，潮声停了。</p></div><div className="showcase-director"><MessageSquare size={16} /><span>以导演身份，参与下一次选择</span></div></div>
                : <div className="showcase-branch"><span className="showcase-overline">互动影游 · 分支示意</span><h3>灯塔即将熄灭。</h3><p>沈照握紧铜钥匙，走到岔路口。</p><div className="showcase-branch-line" aria-hidden="true" /><div className="showcase-choices"><article><span>A</span><strong>前往灯塔</strong><small>追寻那封信的来源</small></article><article><span>B</span><strong>留在雾港</strong><small>找到最后一位守灯人</small></article></div></div>}
              <div className="showcase-agent-strip"><Sparkles size={14} /><span>六师协作</span><div>{WRITERS.map(name => <span key={name}>{name}</span>)}</div></div>
            </>}
            {view === "read" && <div className="showcase-analysis"><span className="showcase-overline">天王 · 逆向拆解示意</span><h3>一本小说，拆成创作的素材。</h3><div className="showcase-chapter-bars" aria-label="章节节奏示意">{[24,38,32,57,43,68,51,85,63,76,92,65,49,78,100,72].map((height,index)=><i key={index} style={{height:`${height}%`}} />)}</div><div className="showcase-structure"><article><small>开篇钩子</small><strong>来自三天后的信</strong></article><article><small>核心悬念</small><strong>谁让灯塔熄灭？</strong></article><article><small>伏笔与证据</small><strong>邮戳 → 铜钥匙 → 潮声</strong></article></div><div className="showcase-evidence"><FileText size={16}/><span>章节卡 · 逆向大纲 · 设定档案 · 原文溯源</span></div><div className="showcase-reading-team">{READERS.map(name=><span key={name}>{name}</span>)}</div></div>}
            {view === "graph" && <div className="showcase-graph"><div><span className="showcase-overline">天衍 · 图谱档案示意</span><h3>每个设定，都有来处。</h3></div><SettingMap /><div className="showcase-graph-caption"><span>详细 / 简明档案</span><ArrowRight size={14}/><span>授权后，召唤参考</span></div></div>}
            {view === "polish" && <div className="showcase-polish"><span className="showcase-overline">天工 · 文本打磨示意</span><h3>保留故事，打磨表达。</h3><div className="showcase-markup"><small>待调整的表达</small><p>他的心中<mark>不禁涌起一股难以言喻的复杂情绪</mark>。</p></div><div className="showcase-rewrite"><small>改写参考</small><p>沈照把信折了两次，手指却还在抖。</p></div><div className="showcase-signal-tags"><span>文体与指纹</span><span>困惑度评分</span><span>定位与改写</span></div><p className="showcase-fine">示例仅演示修改方式；实际检测由作者发起，结果供参考。</p></div>}
          </div>
          <aside className="showcase-context"><span className="showcase-overline">随行助手</span><div className="showcase-assistant"><Sparkles size={17}/><strong>{view === "graph" ? "设定随故事生长" : view === "polish" ? "作者决定如何修改" : isReading ? "知识留给下一次创作" : "从设定中接续故事"}</strong></div><div className="showcase-context-card"><small>{view === "graph" ? "来源与权限" : "当前引用"}</small><strong>铜钥匙</strong><p>旧灯塔的钥匙。每次转动，持有者会忘记一段往事。</p><span>器物 · 基础档案</span></div><div className="showcase-context-tags"><span>悬疑大纲</span><span>黄金一章</span><span>黄金三章</span><span>冷峻叙事</span></div><div className="showcase-input"><span>/ 选择模板、风格或技能</span><ArrowRight size={15}/></div></aside>
        </div>
        <div className="showcase-mobile-library"><Layers size={13} /><span>模板 / 风格 / Skill</span><span>黄金一章 · 黄金三章 · 悬疑大纲</span></div>
      </div>
      <div className="showcase-caption"><span>产品流程示意 · 示例内容</span><Link to="/site/docs/product-manual">查看完整能力 <ArrowRight size={14}/></Link></div>
    </div>
  </section>;
}
