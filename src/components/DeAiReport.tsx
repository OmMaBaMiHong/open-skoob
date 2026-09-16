/**
 * DeAiReport — 天工AI检测报告渲染（检测面板与检测记录详情共用）。
 *
 * 从 DeAiPanel 拆出来：检测结果在两个地方展示——刚检测完的面板、记录列表点开的
 * 回放。两处必须是同一份渲染，否则「记录里看到的」和「当时看到的」会漂移。
 * 报告下载（buildReportHtml）的数据同源：页面展示什么，报告就是什么。
 *
 * 不含改写：改写是独立功能，报告只反映检测结果。
 */

import {
  CheckCircle2, Gauge, ScanSearch, Ruler, ShieldAlert, ShieldCheck, ShieldQuestion,
} from "lucide-react";
import type { DeAiVerdictResponse, DeAiBand, DeAiSignal } from "../lib/api";

const BAND_ICON: Record<DeAiBand, typeof ShieldCheck> = {
  human: ShieldCheck,
  suspect: ShieldQuestion,
  ai: ShieldAlert,
};

const SIGNAL_ICON: Record<DeAiSignal["id"], typeof Gauge> = {
  perplexity: Gauge,
  judge: ScanSearch,
  surface: Ruler,
};

const SIGNAL_STATUS_TEXT: Record<DeAiSignal["status"], string> = {
  ok: "",
  uncalibrated: "未标定",
  skipped: "未启用",
  failed: "失败",
};

export function fmtAigc(v: number | null): string {
  if (v === null) return "—";
  // 朱雀显示到小数点后两位（0.99 那档要能看出来），四舍五入到 0.995 以上才显示 1.00。
  return v.toFixed(2);
}

export function DeAiReport({ result }: { readonly result: DeAiVerdictResponse }) {
  const verdict = result.verdict;
  const detection = result.detection;
  const judge = result.judge;
  const band = verdict.band;
  const legacy = result.reportVersion !== "full-text-v2";

  const aiEvidence = judge?.evidence.filter((e) => e.direction === "ai") ?? [];
  const humanEvidence = judge?.evidence.filter((e) => e.direction === "human") ?? [];

  const BandIcon = band ? BAND_ICON[band] : ShieldQuestion;

  return (
    <div className="deai-result">
      <div className="deai-sec" aria-label="全文统计分析覆盖">
        <div className="deai-sec-t">全文统计分析覆盖 · {result.coverage?.status === "complete" ? "全文已分析" : result.coverage?.status === "partial" ? "部分完成" : "覆盖未验证"}</div>
        {result.coverage ? <p>
          已验证 {result.coverage.analyzedChars}/{result.coverage.totalChars} 字（{(result.coverage.ratio * 100).toFixed(1)}%）
          · 已验证段计分 {result.coverage.scoredTokens}/{result.coverage.expectedScoredTokens} 个目标 token
          {result.coverage.status !== "complete" && "；失败或未验证段不计入完整覆盖。"}
        </p> : <p>此记录未保存全文覆盖证据，不能确认是否截断。</p>}
        <p>完整分析表示文本已计分，不表示生成来源已确认。风险分是实验结果，不是 AI 字数占比。</p>
        {result.ratios && <p>
          按全文字符计：人工特征 {(result.ratios.human * 100).toFixed(1)}% · 疑似 AI {(result.ratios.suspect * 100).toFixed(1)}%
          · AI 特征 {(result.ratios.ai * 100).toFixed(1)}% · 未知 {(result.ratios.unknown * 100).toFixed(1)}%
        </p>}
      </div>
      <div className={`deai-aigc ${band ? `is-${band}` : "is-none"}`}>
        <div className="deai-aigc-num">
          <small>实验风险分</small>
          <strong>{fmtAigc(verdict.aigcValue)}</strong>
        </div>
        <div className="deai-aigc-band">
          <span className="deai-aigc-chip"><BandIcon size={14} /> {verdict.bandLabel ?? "无法判定"}</span>
          <span className="deai-aigc-meaning">
            {legacy ? "旧版记录：未保存完整覆盖与独立标定依据，原档位不能作为生成来源证明。" : verdict.bandMeaning ?? "缺少经过独立标定的模型证据，暂不能判断生成来源。"}
          </span>
          <span className="deai-aigc-conf">
            可信度 {legacy ? "旧版未验证" : "低 · 实验阶段"}
            {typeof detection.aiRisk === "number" && ` · 人味分 ${detection.score}/100`}
          </span>
        </div>
      </div>

      {/* 三档刻度条：让用户一眼知道 0.5 / 0.99 两条线在哪 */}
      <div className="deai-scale" aria-hidden>
        {verdict.scale.map((b) => (
          <div
            key={b.band}
            className={`deai-scale-seg is-${b.band} ${band === b.band ? "is-on" : ""}`}
            style={{ flexGrow: Math.max(0.12, b.max - b.min) }}
            title={`${b.label} ${b.min}–${b.max}`}
          >
            <i>{b.label}</i><em>{b.min}–{b.max}</em>
          </div>
        ))}
        {verdict.aigcValue !== null && (
          <span className="deai-scale-pin" style={{ left: `${pinLeft(verdict.aigcValue)}%` }} />
        )}
      </div>

      {/* ── 三路信号 ── */}
      <div className="deai-signals">
        {verdict.signals.map((s) => {
          const Icon = SIGNAL_ICON[s.id];
          return (
            <div key={s.id} className={`deai-signal is-${s.status}`} title={s.note ?? undefined}>
              <span className="deai-signal-h"><Icon size={13} /> {s.label}</span>
              <span className="deai-signal-v">
                {s.status === "ok" && s.value !== null ? s.value.toFixed(2) : SIGNAL_STATUS_TEXT[s.status]}
              </span>
              <span className="deai-signal-w">权重 {Math.round(s.weight * 100)}%</span>
              {s.note && <span className="deai-signal-note">{s.note}</span>}
            </div>
          );
        })}
      </div>

      {verdict.warnings.length > 0 && (
        <div className="deai-caveat">
          {verdict.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {result.segments && result.segments.length > 0 && <div className="deai-sec">
        <div className="deai-sec-t">全文分段 · {result.segments.length} 段</div>
        {result.segments.map(segment => <details key={segment.index} className="deai-evidence">
          <summary>第 {segment.index + 1} 段 · 第 {segment.start + 1}–{segment.end} 字 · {segment.status === "failed" ? "失败" : segment.status === "skipped" ? "未启用" : segment.status === "unverified" ? "覆盖未验证" : "已计分"}
            {segment.aiProbability === null ? " · 分类未知" : ` · 分段风险 ${segment.aiProbability.toFixed(2)}`}</summary>
          {segment.note && <p>{segment.note}</p>}
          {segment.coverage && <p>{segment.coverage.scoredTokens}/{segment.coverage.expectedScoredTokens} 个目标 token · {segment.coverage.modelId} · {segment.coverage.featureVersion}</p>}
          {segment.features && <p>困惑度 {segment.features.perplexity?.toFixed(2)} · logprob 波动 {segment.features.logprobStd?.toFixed(2)}（统计特征，不是 AI 概率）</p>}
          <p style={{ whiteSpace: "pre-wrap" }}>{segment.text}</p>
        </details>)}
      </div>}
      {/* ── 审校师证据 ── */}
      {judge && (
        <div className="deai-sec">
          <div className="deai-sec-t">
            AI 特征审校师{judge.model ? ` · ${judge.model}` : ""} · 本路送审 {judge.sampledChars} 字
            {judge.patternDensityPerK !== null && (
              <em className={judge.patternDensityPerK > 5 ? "is-bad" : "is-ok"}>
                {" "}AI 模式 {judge.patternDensityPerK}/千字{judge.patternDensityPerK > 5 ? "（门禁 ≤5）" : ""}
              </em>
            )}
          </div>
          {judge.summary && <p className="deai-judge-summary">{judge.summary}</p>}
          {aiEvidence.length > 0 && (
            <div className="deai-evidence-group">
              <div className="deai-evidence-label">AI 证据 {aiEvidence.length}</div>
              {aiEvidence.map((e, i) => (
                <div key={`ai-${i}`} className={`deai-evidence is-ai is-${e.severity}`}>
                  <span className="deai-evidence-pattern">{e.pattern}</span>
                  <i className="deai-evidence-cat">{e.category}</i>
                  {e.quote && <q>{e.quote}</q>}
                </div>
              ))}
            </div>
          )}
          {humanEvidence.length > 0 && (
            <div className="deai-evidence-group">
              <div className="deai-evidence-label">人味证据 {humanEvidence.length}</div>
              {humanEvidence.map((e, i) => (
                <div key={`hu-${i}`} className={`deai-evidence is-human`}>
                  <span className="deai-evidence-pattern">{e.pattern}</span>
                  <i className="deai-evidence-cat">{e.category}</i>
                  {e.quote && <q>{e.quote}</q>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 文体指标 ── */}
      {detection.stylometry?.measurable && detection.stylometry.metrics.length > 0 && (
        <div className="deai-sec">
          <div className="deai-sec-t">
            文体指标 · 对照人类小说区间
            {detection.stylometry.outOfBand > 0 && <em> {detection.stylometry.outOfBand} 项偏离</em>}
          </div>
          {detection.stylometry.metrics.map((m) => (
            <div key={m.id} className={`deai-metric ${m.deviation ? `is-${m.deviation}` : ""}`}>
              <span className="deai-metric-label" title={m.meaning}>{m.label}</span>
              <span className="deai-metric-value">{m.value}</span>
              <span className="deai-metric-band">人类 {m.humanLow}–{m.humanHigh}</span>
              {m.deviation && (
                <span className="deai-metric-dev">
                  {m.deviation === "high" ? "偏高" : "偏低"} {Math.round(m.excess * 100)}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 规则命中 ── */}
      {detection.issues.length > 0 && (
        <div className="deai-sec">
          <div className="deai-sec-t">
            规则命中 {detection.summary.totalIssues} · 高危 {detection.summary.highSeverity} · 中 {detection.summary.mediumSeverity} · 低 {detection.summary.lowSeverity}
          </div>
          {detection.issues.map((issue, i) => (
            <div key={`${issue.ruleId}-${i}`} className={`deai-issue is-${issue.severity}`}>
              <div className="deai-issue-h">
                <span>{issue.description}</span>
                <i className={`deai-sev is-${issue.severity}`}>{issue.severity}</i>
              </div>
              {issue.matchedText && <div className="deai-issue-match">「{issue.matchedText}」</div>}
              <div className="deai-issue-sug">建议:{issue.suggestion}</div>
            </div>
          ))}
        </div>
      )}

      {detection.vocabularyIssues.length > 0 && (
        <div className="deai-sec">
          <div className="deai-sec-t">词汇替换建议</div>
          {detection.vocabularyIssues.map((v, i) => (
            <div key={i} className="deai-vocab">
              <s>{v.from}</s><span>→</span><b>{v.to}</b>
              <i className="deai-vocab-n">×{v.count}</i>
              <i className={`deai-tier is-t${v.tier}`}>T{v.tier}</i>
            </div>
          ))}
        </div>
      )}

      {!judge && detection.issues.length === 0 && detection.vocabularyIssues.length === 0 && (
        <div className="deai-verdict is-pass">
          <CheckCircle2 size={14} /> 本地规则与文体指标未发现问题
        </div>
      )}
    </div>
  );
}

/**
 * 刻度条上的指针位置。三段按 flexGrow = max(0.12, 宽度) 排布，所以 0.99–1 那段
 * 被放大到 12%，指针位置要按同一套比例算，不能直接用 value*100。
 */
function pinLeft(value: number): number {
  const segs = [
    { min: 0, max: 0.5, grow: 0.5 },
    { min: 0.5, max: 0.99, grow: 0.49 },
    { min: 0.99, max: 1, grow: 0.12 },
  ];
  const total = segs.reduce((a, s) => a + s.grow, 0);
  let offset = 0;
  for (const s of segs) {
    const width = (s.grow / total) * 100;
    if (value <= s.max) {
      const frac = (value - s.min) / (s.max - s.min);
      return Math.max(0.5, Math.min(99.5, offset + frac * width));
    }
    offset += width;
  }
  return 99.5;
}
