/**
 * DeAiPanel — 天工AI检测面板（页面与章节内嵌共用）
 *
 * 1. 检测：POST /deai/verdict —— 三路信号（规则/文体 · 困惑度 · AI 特征审校师）
 *    融合成实验风险分（0–1）：人工特征 0–0.5 / 疑似 AI 0.5–0.99 / AI 特征 0.99–1。
 *    检测成功即自动入库一条记录（迁移 051），source 由使用方传入标来源。
 * 2. 报告：AIGC 值 + 档位 + 各路信号 + 审校师证据 + 文体指标 + 规则命中 + 词汇建议。
 *    渲染拆在 DeAiReport（与记录详情回放共用同一份）。
 * 3. 一键改写：POST /deai/rewrite（会员；非会员 403 显示开通引导）。
 *    改写永远按钮触发，不自动跑；记录与报告不含改写——检测只做检测的事。
 *
 * 头部展示的主指标是 AIGC 值（越高越像 AI），旧的「人味分」降为辅助信息——
 * 两者方向相反，同时放大字号会读反。
 */

import { useState, useCallback } from "react";
import { AlertTriangle, RefreshCw, FileText, Zap, Copy, Check, Crown } from "lucide-react";
import {
  deAiVerdict, deAiRewrite,
  type DeAiVerdictResponse, type DeAiRewriteResult,
} from "../lib/api";
import { useMembership } from "../hooks/use-membership";
import { Link } from "react-router-dom";
import { DeAiReport } from "./DeAiReport";

interface DeAiPanelProps {
  /** 受控文本（父组件持有 textarea/正文）。 */
  readonly content: string;
  /** 记录来源：page=检测页手动，chapter=写书页章节内嵌（迁移 051）。缺省 page。 */
  readonly source?: "page" | "chapter";
  /** 来源展示名（章节块标签等），随记录入库。 */
  readonly sourceLabel?: string;
  /** 改写完成后回写文本（父组件决定是否替换原稿）。 */
  readonly onApplyRewrite?: (content: string) => void;
  /** 一次检测成功入库后回调（检测页靠它刷新记录列表）。 */
  readonly onDetected?: () => void;
}

export function DeAiPanel({ content, source = "page", sourceLabel, onApplyRewrite, onDetected }: DeAiPanelProps) {
  const [result, setResult] = useState<DeAiVerdictResponse | null>(null);
  const [rewrite, setRewrite] = useState<DeAiRewriteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberLocked, setMemberLocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const membership = useMembership();
  const canUse = membership.entitlements.includes("deai.rewrite");

  const handleDetect = useCallback(async () => {
    if (!content.trim() || loading || membership.loading) return;
    if (!canUse) { setMemberLocked(true); return; }
    setLoading(true);
    setError(null);
    setMemberLocked(false);
    setRewrite(null);
    try {
      const out = await deAiVerdict(content, { source, sourceLabel });
      setResult(out);
      onDetected?.();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "MEMBERSHIP_REQUIRED") setMemberLocked(true);
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [content, loading, source, sourceLabel, onDetected, membership.loading, canUse]);

  const handleRewrite = useCallback(async () => {
    if (!content.trim() || rewriting || membership.loading) return;
    if (!canUse) { setMemberLocked(true); return; }
    setRewriting(true);
    setError(null);
    setMemberLocked(false);
    try {
      const out = await deAiRewrite(content);
      setRewrite(out);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "MEMBERSHIP_REQUIRED") setMemberLocked(true);
      else setError(err.message);
    } finally {
      setRewriting(false);
    }
  }, [content, rewriting, membership.loading, canUse]);

  const copyRewrite = useCallback(async () => {
    if (!rewrite) return;
    await navigator.clipboard.writeText(rewrite.rewritten).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [rewrite]);

  const verdict = result?.verdict ?? null;
  const detection = result?.detection ?? null;
  const band = verdict?.band ?? null;
  const needsRewrite = band === "suspect" || band === "ai" || (band === null && detection ? !detection.passed : false);

  return (
    <div className="deai-panel">
      <div className="deai-toolbar">
        <span className="deai-title"><FileText size={14} /> 天工AI检测</span>
        <div className="deai-actions">
          <button className="dc-btn" onClick={() => void handleDetect()} disabled={loading || membership.loading || !content.trim()}>
            {loading ? <RefreshCw size={13} className="spin" /> : <Zap size={13} />}
            {loading ? "检测中…" : "开始检测 · 会员"}
          </button>
          {result && needsRewrite && (
            <button className="dc-btn is-primary" onClick={() => void handleRewrite()} disabled={rewriting}>
              {rewriting ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />}
              {rewriting ? "改写中…" : "一键改写"}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="deai-progress">
          正在逐段分析正文并汇总证据；长文需要更多时间，请勿重复提交…
        </div>
      )}
      {error && <div className="deai-error"><AlertTriangle size={13} /> {error}</div>}
      <p className="deai-page-meta">独立工具，仅在你点击开始检测时运行。检测结果不影响创作步骤的通过与继续。</p>
      {(memberLocked || (!membership.loading && !canUse)) && (
        <div className="deai-locked">
          <Crown size={14} />
          <span>天工 AI 检测与改写是会员功能。<Link to="/pricing">开通会员</Link> 后使用。</span>
        </div>
      )}

      {result && <DeAiReport result={result} />}

      {rewrite && (
        <div className="deai-sec">
          <div className="deai-sec-t">
            改写结果（人味分 {rewrite.improvement >= 0 ? "+" : ""}{rewrite.improvement} → {rewrite.newScore}/100，改写后请重新检测取 AIGC 值）
          </div>
          <div className="deai-rewritten">{rewrite.rewritten}</div>
          <div className="deai-actions" style={{ marginTop: 8 }}>
            <button className="dc-btn" onClick={() => void copyRewrite()}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "已复制" : "复制"}
            </button>
            {onApplyRewrite && (
              <button className="dc-btn is-primary" onClick={() => onApplyRewrite(rewrite.rewritten)}>
                替换原稿
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
