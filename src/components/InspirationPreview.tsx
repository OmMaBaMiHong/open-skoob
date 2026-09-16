/**
 * InspirationPreview — 灵感方案预览弹窗
 *
 * 打开预览只读取评分；会员明确点击生成按钮后才生成，生成后缓存。
 * 包含：
 * 1. 改写方向（题材、核心冲突、主角设定）
 * 2. 实体风险（真实人物/组织检测）
 * 3. 操作按钮（用这个方案 / 换一个 / 编辑后使用）
 * 4. 原文链接（可跳转查看原始新闻）
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, RefreshCw, Check, Edit3, Sparkles, AlertTriangle,
  BookOpen, Users, MapPin, Building2, Loader2, ExternalLink, Lock,
} from "lucide-react";
import { generateInspirationPlan, fetchInspirationAssessment, reportFunnelEvents, ApiError, type InspirationPlan, type InspirationSource, type InspirationScore, type PublicInspirationAssessment } from "../lib/api";
import { readAuth } from "../lib/auth-storage";
import { startOAuthLogin, fetchMembership } from "../lib/account";

// ============================================================================
// 缓存：避免重复生成浪费 Token
// ============================================================================

// 服务端按用户、来源内容及策略/证据版本缓存；每次打开先核对当前版本和权限。

// ============================================================================
// 类型
// ============================================================================

interface InspirationPreviewProps {
  readonly hotTopic: InspirationSource;
  readonly onClose: () => void;
  readonly onUsePlan: (plan: InspirationPlan) => void;
}

type PlanStatus = "idle" | "loading" | "ready" | "error";

interface PlanError {
  code: string;
  message: string;
  raw?: string;
}

// ============================================================================
// 组件
// ============================================================================

export function InspirationPreview({ hotTopic, onClose, onUsePlan }: InspirationPreviewProps) {
  const [status, setStatus] = useState<PlanStatus>("idle");
  const [plan, setPlan] = useState<InspirationPlan | null>(null);
  const [error, setError] = useState<PlanError | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const generatedRef = useRef(false);
  const [assessment,setAssessment]=useState<PublicInspirationAssessment|null>(null);
  const [assessmentLoading,setAssessmentLoading]=useState(true);
  const [assessmentError,setAssessmentError]=useState("");
  const [canViewPlan,setCanViewPlan]=useState<boolean|null>(null);
  const [selectedId,setSelectedId]=useState<string|undefined>();
  const requestRef=useRef(0);
  const plansRef=useRef(new Map<string,InspirationPlan>());
  const direction=assessment?.directions.find(d=>d.id===selectedId) ?? assessment?.directions[0];
  const displayedScore=direction?.score ?? plan?.score;
  const reviewAdvice=[...new Set([...(plan?.review?.criticalIssues ?? []),...(plan?.review?.issues ?? [])])];

  // 生成方案（懒加载：只生成一次）。
  // AI 生成属于登录功能：未登录不调接口，直接跳中转站授权页（一次跳转）。
  const generatePlan = useCallback(async (directionId?:string) => {
    const request=++requestRef.current;
    setStatus("loading");setPlan(null);setEditing(false);setError(null);
    if (!readAuth()) {
      startOAuthLogin(window.location.href);
      return;
    }
    const access = await fetchMembership().catch(() => null);
    if(request!==requestRef.current)return;
    if (!access?.entitlements?.includes("hot_news.adapt")) {
      setError({ code: access?.stale ? "MEMBERSHIP_UNAVAILABLE" : "MEMBERSHIP_REQUIRED", message: access?.stale ? "会员状态暂时无法确认，请稍后重试。" : "AI 改写需要会员；上方今日灵感登录即可免费使用。" });
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const key=`${readAuth()?.userId}:${directionId ?? "default"}`;
      const saved=plansRef.current.get(key);
      const result = (saved?.status==="ready"?saved:undefined) ?? await generateInspirationPlan({...hotTopic,...(directionId?{directionId}:{})});
      plansRef.current.set(key,result);
      if(request!==requestRef.current)return;
      if (!saved && result.status === "ready") {
        void reportFunnelEvents([{ eventType: "rewrite", subjectType: "hot_topic", subjectTitle: hotTopic.title }]);
      }
      setPlan(result);
      setEditText(formatPlanForEdit(result));
      setStatus("ready");
    } catch (err) {
      if(request!==requestRef.current)return;
      // 提取详细错误信息
      const planError: PlanError = {
        code: err instanceof ApiError ? err.code ?? "UNKNOWN" : "UNKNOWN",
        message: err instanceof Error ? err.message : String(err),
      };
      // 尝试从 ApiError 中提取更多信息
      if (err instanceof Error && err.message.includes("{")) {
        try {
          const parsed = JSON.parse(err.message);
          planError.code = parsed.code || planError.code;
          planError.message = parsed.message || planError.message;
          planError.raw = parsed.raw;
        } catch {
          // 解析失败，使用原始错误信息
        }
      }
      setError(planError);
      setStatus("error");
    }
  }, [hotTopic]);

  const loadPreview=useCallback(async()=>{
    setAssessmentLoading(true);setAssessmentError("");plansRef.current.clear();++requestRef.current;
    const accessTask=(readAuth()?fetchMembership().catch(()=>null):Promise.resolve(null)).then(access=>{
      const allowed=Boolean(access?.entitlements?.includes("hot_news.adapt"));
      setCanViewPlan(allowed);if(!allowed)setPlan(null);return allowed;
    });
    let summary:PublicInspirationAssessment|null=null;
    try {summary=await fetchInspirationAssessment(hotTopic);setAssessment(summary);setSelectedId(summary.directions[0]?.id);}
    catch {setAssessmentError("暂时无法读取选题评估，请稍后重试。");}
    finally {setAssessmentLoading(false);}
    if(await accessTask) {
      if(summary && summary.status!=="unavailable") {setPlan(null);setStatus("idle");setError(null);}
      else {setStatus("error");setError({code:"ASSESSMENT_UNAVAILABLE",message:"选题评估暂未完成，请先重新查看上方评估。"});}
    }
  },[hotTopic]);

  useEffect(()=>{
    if(!generatedRef.current){generatedRef.current=true;void loadPreview();}
  },[loadPreview]);

  // 重新生成（换一个）
  const handleRegenerate = () => {
    void generatePlan(selectedId);
  };

  // 使用方案
  const handleUse = async () => {
    if (!readAuth()) { startOAuthLogin(window.location.href); return; }
    const access = await fetchMembership().catch(() => null);
    if (!access?.entitlements?.includes("hot_news.adapt")) {
      setError({ code: "MEMBERSHIP_REQUIRED", message: "请先开通AI 改写权益。" }); setStatus("error"); return;
    }
    if (plan?.status && plan.status !== "ready") return;
    const finalPlan = editing ? parseEditToPlan(editText, hotTopic.title) : plan;
    if (finalPlan) {
      onUsePlan(finalPlan);
    }
  };

  return (
    <div className="insp-preview-overlay" onClick={onClose}>
      <div className="insp-preview" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="insp-preview-header">
          <div className="insp-preview-title">
            <Sparkles size={16} />
            <span>灵感方案预览</span>
          </div>
          <button className="insp-preview-close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="insp-preview-scroll">
        {/* Source + Original Link */}
        <div className="insp-preview-source">
          <div className="insp-source-label">原始素材 · 公开评估</div>
          <div className="insp-source-title">{assessment?.source?.title ?? hotTopic.title}</div>
          {(assessment?.source?.summary || hotTopic.summary) && (
            <div className="insp-source-summary">{assessment?.source?.summary || hotTopic.summary}</div>
          )}
          <div className="insp-source-meta">
            {hotTopic.source && (
              <span className="insp-source-from">来自：{hotTopic.source}</span>
            )}
            {hotTopic.url && (
              <a
                className="insp-source-link"
                href={hotTopic.url}
                target="_blank"
                rel="noreferrer"
                title="查看原文"
              >
                <ExternalLink size={12} />
                查看原文
              </a>
            )}
          </div>
          {(assessment?.source || hotTopic.sourceMetrics) && <SourceMetrics source={assessment?.source ?? {title:hotTopic.title,...hotTopic.sourceMetrics,metrics:hotTopic.sourceMetrics?.metrics ?? {}}}/>}
          {assessmentLoading && <p className="insp-public-status" role="status">正在读取原始指标与选题评分…</p>}
          {assessment && <div className="insp-public-assessment">
            {assessment.directions.length>0 ? <>
              <div className="insp-direction-tabs" role="tablist" aria-label="改写题材方向">
                {assessment.directions.map((item,i)=><button key={item.id} id={`insp-tab-${i}`} role="tab"
                  aria-selected={item.id===direction?.id} aria-controls="insp-direction-content" tabIndex={item.id===direction?.id?0:-1}
                  onKeyDown={event=>{
                    const step=event.key==="ArrowRight"?1:event.key==="ArrowLeft"?-1:0;
                    if(!step)return;event.preventDefault();
                    const next=(i+step+assessment.directions.length)%assessment.directions.length;
                    const button=event.currentTarget.parentElement?.children[next] as HTMLButtonElement|undefined;
                    button?.focus();button?.click();
                  }} onClick={()=>{
                    if(item.id===selectedId)return;
                    setSelectedId(item.id);setEditing(false);setError(null);++requestRef.current;
                    const saved=canViewPlan?plansRef.current.get(`${readAuth()?.userId}:${item.id}`):undefined;
                    setPlan(saved ?? null);setStatus(saved?"ready":"idle");
                    if(saved)setEditText(formatPlanForEdit(saved));
                  }}>{item.strategyLabel ?? item.category}<span>{item.mode==="short"?"短篇":"长篇"} · {({fanqie:"番茄",qidian:"起点",dianzhong:"点众",qimao:"七猫",jjwxc:"晋江"} as Record<string,string>)[item.platform] ?? item.platform}</span></button>)}
              </div>
              <p className="insp-public-status">{assessment.directions.length} 个候选方向 · 评分仅供参考，会员可按兴趣生成</p>
            </> : <p>{assessment.reason}</p>}
          </div>}
          {(assessmentError || assessment?.status==="unavailable") && <div className="insp-public-status">
            {assessmentError && <p>{assessmentError}</p>}<button className="st-btn st-btn-sm" onClick={()=>void loadPreview()}>重新查看评估</button>
          </div>}
        </div>

        <div role="tabpanel" id="insp-direction-content" aria-labelledby={direction?`insp-tab-${assessment!.directions.indexOf(direction)}`:undefined}>
          <div className="insp-direction-assessment">
            {direction && <p>{direction.reason}</p>}
            {displayedScore ? <ScoreDetails score={displayedScore} weights={assessment?.weights}/> : assessment && <WeightLegend weights={assessment.weights}/>}
          </div>
        {/* Content */}
        <div className="insp-preview-body">
          {canViewPlan===false ? (
            <div className="insp-member-lock">
              <Lock size={24}/><strong>具体改写方案仅会员可见</strong>
              <p>上方原文指标、选题评分与适配说明可免费查看。会员可查看完整书名、简介和故事方案。</p>
              <a className="st-btn st-btn-sm" href="/pricing" target="_blank" rel="noreferrer">开通会员查看方案</a>
              {!readAuth() && <button className="st-btn st-btn-sm" onClick={()=>startOAuthLogin(window.location.href)}>已有会员，登录查看</button>}
            </div>
          ) : canViewPlan===null ? <p>正在核对方案查看权限…</p> : status === "idle" ? (
            <div className="insp-member-lock">
              <Sparkles size={24}/><strong>按你的兴趣生成改写方案</strong>
              <p>选好方向后点击生成。评分仅供参考，打开预览或切换方向不会自动生成方案。</p>
              <button className="st-btn st-btn-sm" disabled={assessmentLoading || !assessment || assessment.status==="unavailable"} onClick={handleRegenerate}>生成这个方向的方案</button>
            </div>
          ) : status === "loading" ? (
            <div className="insp-preview-loading">
              <Loader2 size={24} className="spin" />
              <p>AI 正在生成这个方向的方案...</p>
              <span>参考评分与写法 → 原创方案 → 内容评审</span>
            </div>
          ) : status === "error" ? (
            <div className="insp-preview-error">
              <AlertTriangle size={24} />
              <p>
                {["MEMBER_REQUIRED", "MEMBERSHIP_REQUIRED"].includes(error?.code ?? "")
                  ? "AI 改写方案是会员权益"
                  : "生成失败"}
              </p>
              {error && (
                <div className="insp-error-detail">
                  <span className="insp-error-code">{error.code}</span>
                  <span className="insp-error-msg">{error.message}</span>
                  {error.raw && <code className="insp-error-raw">{error.raw}</code>}
                </div>
              )}
              {["MEMBER_REQUIRED", "MEMBERSHIP_REQUIRED"].includes(error?.code ?? "") ? (
                <a className="st-btn st-btn-sm" href="/pricing" target="_blank" rel="noreferrer">
                  查看会员方案
                </a>
              ) : (
                <button className="st-btn st-btn-sm" onClick={handleRegenerate}>
                  <RefreshCw size={14} />
                  重试
                </button>
              )}
            </div>
          ) : plan && plan.status && plan.status !== "ready" ? (
            <div className="insp-preview-plan" role="status">
              <strong>{({needs_material:"待补充资料",material_only:"适合作为素材",not_suitable:"暂不推荐生成",review_failed:"文案暂未通过评审"})[plan.status]}</strong>
              <p>{plan.reason}</p>
              <span>评估已保留。更新素材或选择新的方向后可重新评估。</span>
            </div>
          ) : plan && (
            <>
              {reviewAdvice.length>0 && <details className="insp-review-advice"><summary>文案改进建议（{reviewAdvice.length} 项，不影响使用）</summary>
                <ul>{reviewAdvice.map(advice=><li key={advice}>{advice}</li>)}</ul>
              </details>}
              {plan.bookTitle && <h3>{plan.bookTitle}</h3>}
              {plan.synopsis && <p className="insp-plan-text" style={{whiteSpace:"pre-wrap"}}>{plan.synopsis}</p>}
              {/* Plan Content */}
              {editing ? (
                <textarea
                  className="insp-preview-editor"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={12}
                />
              ) : (
                <div className="insp-preview-plan">
                  {/* Genre */}
                  <div className="insp-plan-section">
                    <div className="insp-plan-label">
                      <BookOpen size={14} />
                      题材方向
                    </div>
                    <div className="insp-plan-genre">
                      {plan.genre.map((g) => (
                        <span key={g} className="insp-genre-tag">{g}</span>
                      ))}
                    </div>
                  </div>

                  {/* Conflict */}
                  <div className="insp-plan-section">
                    <div className="insp-plan-label">
                      <Sparkles size={14} />
                      核心冲突
                    </div>
                    <p className="insp-plan-text">{plan.coreConflict}</p>
                  </div>

                  {/* Protagonist */}
                  <div className="insp-plan-section">
                    <div className="insp-plan-label">
                      <Users size={14} />
                      主角设定
                    </div>
                    <p className="insp-plan-text">{plan.protagonist}</p>
                  </div>

                  {/* Premise */}
                  <div className="insp-plan-section">
                    <div className="insp-plan-label">
                      <BookOpen size={14} />
                      故事前提
                    </div>
                    <p className="insp-plan-text">{plan.premise}</p>
                  </div>

                  {/* Entity Risks */}
                  {plan.entityRisks.length > 0 && (
                    <div className="insp-plan-risks">
                      <div className="insp-plan-label">
                        <AlertTriangle size={14} />
                        实体风险
                      </div>
                      <div className="insp-risks-list">
                        {plan.entityRisks.map((risk, i) => (
                          <div key={i} className={`insp-risk-item is-${risk.severity}`}>
                            <RiskIcon type={risk.type} />
                            <div className="insp-risk-info">
                              <span className="insp-risk-name">{risk.name}</span>
                              <span className="insp-risk-type">{risk.type}</span>
                            </div>
                            <span className="insp-risk-action">{risk.action}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        </div>
        </div>
        {/* Actions */}
        {canViewPlan && plan && status === "ready" && (!plan.status || plan.status === "ready") && (
          <footer className="insp-preview-actions">
            <button
              className="st-btn st-btn-sm"
              onClick={() => setEditing(!editing)}
            >
              <Edit3 size={14} />
              {editing ? "完成编辑" : "编辑方案"}
            </button>
            <div className="insp-preview-actions-right">
              <button
                className="st-btn st-btn-sm"
                onClick={handleRegenerate}
                title="读取最新资料与评估结果；相同输入复用已保存结果"
              >
                <RefreshCw size={14} />
                重新查看
              </button>
              <button
                className="st-btn st-btn-sm st-btn-primary"
                onClick={handleUse}
              >
                <Check size={14} />
                用这个方案
              </button>
            </div>
          </footer>
        )}
      </div>

      <style>{`
        .insp-preview-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(2px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: inspFadeIn 0.2s ease;
        }
        @keyframes inspFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .insp-preview {
          background: var(--bg, #fff);
          border: 1px solid var(--line2, #e5e7eb);
          border-radius: 12px;
          width: 90%;
          max-width: 560px;
          max-height: 90vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
          animation: inspSlideUp 0.3s ease;
        }
        @keyframes inspSlideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .insp-preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--line2, #e5e7eb);
          background: var(--panel2, #f9fafb);
          border-radius: 12px 12px 0 0;
        }
        .insp-preview-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          font-size: 15px;
          color: var(--text, #111);
        }
        .insp-preview-title svg {
          color: var(--accent, #6366f1);
        }
        .insp-preview-close {
          border: none;
          background: none;
          cursor: pointer;
          color: var(--muted, #6b7280);
          padding: 4px;
          border-radius: 4px;
        }
        .insp-preview-close:hover {
          background: var(--panel2, #f3f4f6);
          color: var(--text, #111);
        }
        .insp-preview-source {
          flex-shrink: 0;
          padding: 12px 20px;
          background: var(--panel2, #f9fafb);
          border-bottom: 1px solid var(--line2, #e5e7eb);
        }
        .insp-preview-scroll {min-height:0;overflow-y:auto;overscroll-behavior:contain;}
        .insp-preview-header,.insp-preview-actions {flex-shrink:0;}
        .insp-direction-tabs {display:flex;gap:6px;overflow-x:auto;padding:4px 0;}
        .insp-direction-tabs button {flex:1;white-space:nowrap;border:1px solid var(--line2);border-radius:8px;background:var(--bg);color:var(--text);padding:8px 10px;cursor:pointer;font-size:13px;}
        .insp-direction-tabs button[aria-selected="true"] {border-color:var(--accent);color:var(--accent);background:var(--accent-soft);font-weight:600;}
        .insp-direction-tabs button:focus-visible {outline:2px solid var(--accent);outline-offset:2px;}
        .insp-direction-tabs span {display:block;font-size:11px;opacity:.7;margin-top:4px;font-weight:400;}
        .insp-direction-assessment {padding:12px 20px 0;font-size:13px;line-height:1.6;}
        .insp-direction-assessment>p {margin:0 0 10px;}
        .insp-score-total {display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
        .insp-score-total strong {font-size:18px;color:var(--accent);}
        .insp-score-note {font-size:11px;color:var(--muted);margin:6px 0 10px;}
        .insp-member-lock {display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding:16px 8px;}
        .insp-member-lock p {font-size:13px;line-height:1.7;color:var(--muted);margin:0;}
        .insp-public-assessment {border-top:1px solid var(--line2);margin-top:12px;padding-top:8px;font-size:12px;line-height:1.7;}
        .insp-public-status {font-size:12px;color:var(--muted);}
        .insp-source-metrics {display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;margin-top:10px;overflow-wrap:anywhere;}
        .insp-source-metrics .insp-source-metrics-full {flex-basis:100%;}
        .insp-score-grid {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0;}
        .insp-score-grid div {background:var(--panel2);border-radius:6px;padding:7px;}
        .insp-score-grid dt {font-size:11px;color:var(--muted);}
        .insp-score-grid dd {margin:3px 0 0;font-size:12px;}
        .insp-source-label {
          font-size: 11px;
          color: var(--muted, #6b7280);
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .insp-source-title {
          font-weight: 500;
          font-size: 14px;
          color: var(--text, #111);
          margin-bottom: 4px;
        }
        .insp-source-summary {
          font-size: 12px;
          color: var(--muted, #6b7280);
          line-height: 1.4;
          margin-bottom: 6px;
        }
        .insp-source-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .insp-source-from {
          font-size: 11px;
          color: var(--muted, #6b7280);
        }
        .insp-source-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--accent, #6366f1);
          text-decoration: none;
          padding: 2px 6px;
          border-radius: 4px;
          transition: background .12s;
        }
        .insp-source-link:hover {
          background: var(--accent-soft, #eef2ff);
          text-decoration: underline;
        }
        .insp-preview-body {
          padding: 20px;
        }
        .insp-preview-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 40px;
          color: var(--muted, #6b7280);
        }
        .insp-preview-loading p {
          margin: 0;
          font-size: 14px;
        }
        .insp-preview-loading span {
          font-size: 12px;
        }
        .insp-preview-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 40px;
          color: var(--danger, #ef4444);
        }
        .insp-preview-error p {
          margin: 0;
        }
        .insp-error-detail {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 12px;
          background: rgba(239, 68, 68, 0.1);
          border-radius: 6px;
          width: 100%;
          max-width: 400px;
        }
        .insp-error-code {
          font-size: 11px;
          font-weight: 600;
          color: var(--danger, #ef4444);
          text-transform: uppercase;
        }
        .insp-error-msg {
          font-size: 13px;
          color: var(--text, #374151);
          line-height: 1.4;
        }
        .insp-error-raw {
          font-size: 11px;
          color: var(--muted, #6b7280);
          background: rgba(0,0,0,0.05);
          padding: 6px;
          border-radius: 4px;
          word-break: break-all;
        }
        .insp-review-advice {font-size:12px;line-height:1.7;color:var(--muted);margin-bottom:12px;}
        .insp-preview-plan {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .insp-plan-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .insp-plan-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          color: var(--muted, #6b7280);
          text-transform: uppercase;
        }
        .insp-plan-label svg {
          color: var(--accent, #6366f1);
        }
        .insp-plan-genre {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .insp-genre-tag {
          padding: 4px 10px;
          background: var(--accent-soft, #eef2ff);
          color: var(--accent, #6366f1);
          border-radius: 12px;
          font-size: 12px;
        }
        .insp-plan-text {
          margin: 0;
          font-size: 14px;
          line-height: 1.6;
          color: var(--text, #111);
        }
        .insp-plan-risks {
          padding: 12px;
          background: #fffbeb;
          border-radius: 8px;
          border: 1px solid #fde68a;
        }
        .insp-plan-risks .insp-plan-label {
          color: #92400e;
        }
        .insp-risks-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 8px;
        }
        .insp-risk-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          background: #fff;
          border-radius: 6px;
          border: 1px solid #fde68a;
        }
        .insp-risk-item.is-high {
          border-left: 3px solid #ef4444;
        }
        .insp-risk-item.is-medium {
          border-left: 3px solid #eab308;
        }
        .insp-risk-item.is-low {
          border-left: 3px solid #3b82f6;
        }
        .insp-risk-info {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .insp-risk-name {
          font-weight: 500;
          font-size: 13px;
          color: #111;
        }
        .insp-risk-type {
          font-size: 11px;
          color: #6b7280;
        }
        .insp-risk-action {
          font-size: 11px;
          color: #16a34a;
          font-weight: 500;
        }
        .insp-preview-editor {
          width: 100%;
          padding: 12px;
          border: 1px solid var(--line2, #e5e7eb);
          border-radius: 6px;
          font-size: 14px;
          line-height: 1.6;
          font-family: inherit;
          resize: vertical;
          background: var(--bg, #fff);
          color: var(--text, #111);
        }
        .insp-preview-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 20px;
          border-top: 1px solid var(--line2, #e5e7eb);
          background: var(--panel2, #f9fafb);
          border-radius: 0 0 12px 12px;
        }
        .insp-preview-actions-right {
          display: flex;
          gap: 8px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

// ============================================================================
// 辅助组件
// ============================================================================

function RiskIcon({ type }: { type: string }) {
  switch (type) {
    case "人物": return <Users size={14} />;
    case "地点": return <MapPin size={14} />;
    case "组织": return <Building2 size={14} />;
    default: return <AlertTriangle size={14} />;
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

function formatPlanForEdit(plan: InspirationPlan): string {
  return `${plan.bookTitle ? `# 书名\n${plan.bookTitle}\n\n` : ""}${plan.synopsis ? `# 简介\n${plan.synopsis}\n\n` : ""}# 题材：${plan.genre.join(" / ")}

# 核心冲突
${plan.coreConflict}

# 主角设定
${plan.protagonist}

# 故事前提
${plan.premise}
`;
}

function parseEditToPlan(text: string, sourceTitle: string): InspirationPlan | null {
  const section = (label: string) => text.match(new RegExp(`(?:^|\\n)# ${label}\\s*\\n([\\s\\S]*?)(?=\\n# |$)`))?.[1]?.trim() || "";
  const coreConflict=section("核心冲突"),protagonist=section("主角设定"),premise=section("故事前提");
  if (!coreConflict || !protagonist || !premise) return null;

  const genreMatch = text.match(/# 题材[：:](.+)/);
  const genre = genreMatch
    ? genreMatch[1]!.split(/[、/]/).map((g) => g.trim()).filter(Boolean)
    : ["未知"];

  return {
    genre,
    bookTitle:section("书名"),synopsis:section("简介"),coreConflict,protagonist,premise,
    entityRisks: [],
    sourceTitle,
  };
}

const scoreLabels={D:"故事潜力",M:"题材市场",X:"写法匹配",H:"新闻热度",O:"新故事空间",E:"资料依据"};
const defaultWeights={D:.3,M:.2,X:.2,H:.15,O:.1,E:.05};
function WeightLegend({weights=defaultWeights,score}:{weights?:PublicInspirationAssessment["weights"];score?:InspirationScore}) {
  return <dl className="insp-score-grid">{Object.entries(scoreLabels).map(([key,label])=>{
    const k=key as keyof typeof scoreLabels;
    return <div key={key}><dt>{label} · {Math.round(weights[k]*100)}%</dt><dd>{score?`${score.contributions[k].toFixed(2)} / ${Math.round(weights[k]*100)} 分`:"待评估"}</dd></div>;
  })}</dl>;
}
function ScoreDetails({score,weights=defaultWeights}:{score:InspirationScore;weights?:PublicInspirationAssessment["weights"]}) {
  return <div className="insp-score-details">
    <div className="insp-score-total"><span>选题评分</span><strong>{score.score.toFixed(2)} / 100</strong></div>
    <p className="insp-score-note">75 分是顶部自动推荐的评分标准，不限制会员主动生成。</p>
    <details><summary>评分权重与依据</summary>
      <WeightLegend weights={weights} score={score}/>
      {[...new Set(score.reasons ?? [])].map(reason=><p key={reason}>{reason}</p>)}
      {score.missing.length>0 && <p>资料缺失可能影响评分，证据区间 {score.low.toFixed(2)}–{score.high.toFixed(2)}。{[...new Set(score.missing)].join("；")}</p>}
    </details>
  </div>;
}
function SourceMetrics({source}:{source:NonNullable<PublicInspirationAssessment["source"]>}) {
  const labels:Record<string,string>={author:"作者",category:"分类",tags:"标签",status:"状态",wordCount:"字数",metricLabel:"平台指标",update:"更新",ratingCount:"评分人数"};
  const metric=source.domain==="fiction"?source.marketScore:source.heatScore;
  return <div className="insp-source-metrics">
    {source.rank!=null && <span>榜单第 {source.rank} 名</span>}
    {source.heat!=null && !source.heatLabel && <span>原始指标 {source.heat.toLocaleString("zh-CN")}</span>}
    {source.rating!=null && <span>平台评分 {source.rating}</span>}
    {source.heatLabel && <span className="insp-source-metrics-full">{source.heatLabel}</span>}
    {Object.entries(source.metrics).filter(([key,value])=>key!=="metricLabel" || value!==source.heatLabel).map(([key,value])=><span key={key}>{labels[key] ?? key}：{value}</span>)}
    {metric && <span className="insp-source-metrics-full">{source.domain==="fiction"?"小说市场参考分":"新闻热度参考分"}：{metric.value.toFixed(2)} / 100{metric.missing.length?"（部分指标待补，含中性占位）":""}</span>}
    {source.capturedAt && <span className="insp-source-metrics-full">采集时间：{new Date(source.capturedAt).toLocaleString("zh-CN")}</span>}
  </div>;
}
