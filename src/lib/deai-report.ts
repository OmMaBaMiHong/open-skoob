/**
 * 天工AI检测报告 HTML 生成（记录详情 → 可下载的单文件 .html）。
 *
 * 原则（用户裁决 2026-09-09）：**页面展示什么，报告就是什么**——章节结构、
 * 文案、数字与 DeAiReport 完全同源（同一份 result JSON），只换皮成带内联
 * 样式的独立 HTML：双击即可打开，浏览器 Ctrl+P 可直接存成 PDF。
 *
 * 不含改写：报告只反映检测结果（改写是独立功能）。
 */

import type { DeAiRecordDetail } from "./api";
import type { DeAiSignal } from "./api";

/** band → 展示色（与页面同语义：人工绿 / 疑似琥珀 / AI 红）。 */
const BAND_COLOR: Record<string, string> = {
  human: "#15803d",
  suspect: "#b45309",
  ai: "#b91c1c",
};

const BAND_LABEL: Record<string, string> = {
  human: "人工特征",
  suspect: "疑似 AI",
  ai: "AI 特征",
};

const SIGNAL_STATUS_TEXT: Record<DeAiSignal["status"], string> = {
  ok: "",
  uncalibrated: "未标定",
  skipped: "未启用",
  failed: "失败",
};

function esc(s: string): string {
  return s
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function fmtAigc(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 记录详情 → 自包含 HTML 报告字符串（无外部依赖，双击可开，可打印成 PDF）。 */
export function buildDeaiReportHtml(record: DeAiRecordDetail): string {
  const { result } = record;
  const verdict = result.verdict;
  const detection = result.detection;
  const judge = result.judge;
  const band = verdict.band ?? "";
  const bandColor = BAND_COLOR[band] ?? "#57534e";

  const aiEvidence = judge?.evidence.filter((e) => e.direction === "ai") ?? [];
  const humanEvidence = judge?.evidence.filter((e) => e.direction === "human") ?? [];

  const coverageHtml = `<section><h2>全文统计分析覆盖</h2><p>${result.coverage
    ? `已验证 ${result.coverage.analyzedChars}/${result.coverage.totalChars} 字（${(result.coverage.ratio * 100).toFixed(1)}%）；已验证段计分 ${result.coverage.scoredTokens}/${result.coverage.expectedScoredTokens} 个目标 token`
    : "旧记录未保存全文覆盖证据，不能确认是否截断。"}</p><p>实验风险分不是 AI 生成概率或 AI 字数占比；完整计分不表示生成来源已确认。</p>
    ${result.ratios ? `<p>人工特征 ${(result.ratios.human * 100).toFixed(1)}% · 疑似 AI ${(result.ratios.suspect * 100).toFixed(1)}% · AI 特征 ${(result.ratios.ai * 100).toFixed(1)}% · 未知 ${(result.ratios.unknown * 100).toFixed(1)}%</p>` : ""}
    ${(result.segments ?? []).map(segment => `<div><h3>第 ${segment.index + 1} 段 · 第 ${segment.start + 1}–${segment.end} 字 · ${esc(segment.status)} · ${segment.aiProbability === null ? "分类未知" : segment.aiProbability.toFixed(2)}</h3><p>${esc(segment.note ?? "")}</p>${segment.features ? `<p>困惑度 ${segment.features.perplexity?.toFixed(2)} · logprob 波动 ${segment.features.logprobStd?.toFixed(2)}（统计特征，不是 AI 概率）</p>` : ""}<p style="white-space:pre-wrap">${esc(segment.text)}</p></div>`).join("")}</section>`;

  /* ── 三路信号 ── */
  const signalsHtml = verdict.signals.map((s) => `
    <tr>
      <td>${esc(s.label)}</td>
      <td>${s.status === "ok" && s.value !== null ? s.value.toFixed(2) : esc(SIGNAL_STATUS_TEXT[s.status])}</td>
      <td>${Math.round(s.weight * 100)}%</td>
      <td class="muted">${esc(s.note ?? "")}</td>
    </tr>`).join("");

  /* ── 审校师证据 ── */
  const evidenceGroup = (list: typeof aiEvidence, kind: "ai" | "human") => `
    <div class="ev-group"><div class="ev-label">${kind === "ai" ? "AI 证据" : "人味证据"} ${list.length}</div>
    ${list.map((e) => `
      <div class="ev">
        <b>${esc(e.pattern)}</b> <i>${esc(e.category)}</i>
        ${e.quote ? `<q>${esc(e.quote)}</q>` : ""}
      </div>`).join("")}
    </div>`;

  /* ── 文体指标 ── */
  const stylometry = detection.stylometry;
  const stylometryHtml = stylometry?.measurable && stylometry.metrics.length > 0 ? `
    ${secHead(`文体指标 · 对照人类小说区间${stylometry.outOfBand > 0 ? `（${stylometry.outOfBand} 项偏离）` : ""}`)}
    <table>
      <tr><th>指标</th><th>本次</th><th>人类区间</th><th>偏离</th></tr>
      ${stylometry.metrics.map((m) => `
        <tr>
          <td>${esc(m.label)}</td>
          <td>${m.value}</td>
          <td>${m.humanLow}–${m.humanHigh}</td>
          <td>${m.deviation ? `${m.deviation === "high" ? "偏高" : "偏低"} ${Math.round(m.excess * 100)}%` : "—"}</td>
        </tr>`).join("")}
    </table>` : "";

  /* ── 规则命中 ── */
  const issuesHtml = detection.issues.length > 0 ? `
    ${secHead(`规则命中 ${detection.summary.totalIssues} · 高危 ${detection.summary.highSeverity} · 中 ${detection.summary.mediumSeverity} · 低 ${detection.summary.lowSeverity}`)}
    ${detection.issues.map((issue) => `
      <div class="issue">
        <div>${esc(issue.description)} <span class="sev">${issue.severity}</span></div>
        ${issue.matchedText ? `<div class="muted">「${esc(issue.matchedText)}」</div>` : ""}
        <div class="muted">建议：${esc(issue.suggestion)}</div>
      </div>`).join("")}` : "";

  /* ── 词汇替换建议 ── */
  const vocabHtml = detection.vocabularyIssues.length > 0 ? `
    ${secHead("词汇替换建议")}
    <table>
      <tr><th>原词</th><th>建议</th><th>次数</th><th>层级</th></tr>
      ${detection.vocabularyIssues.map((v) => `
        <tr><td><s>${esc(v.from)}</s></td><td><b>${esc(v.to)}</b></td><td>×${v.count}</td><td>T${v.tier}</td></tr>`).join("")}
    </table>` : "";

  const cleanHtml = !judge && detection.issues.length === 0 && detection.vocabularyIssues.length === 0
    ? `<p class="pass">✓ 本地规则与文体指标未发现问题</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>天工AI检测报告 · 实验风险分 ${fmtAigc(verdict.aigcValue)} · ${fmtTime(record.createdAt)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 15px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
         color: #292524; max-width: 780px; margin: 0 auto; padding: 32px 20px 48px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #78716c; font-size: 13px; margin-bottom: 20px; }
  .hero { border: 1px solid #e7e5e4; border-left: 4px solid ${bandColor}; border-radius: 10px;
          padding: 18px 20px; margin-bottom: 16px; display: flex; gap: 24px; align-items: center; }
  .hero .num { font-size: 40px; font-weight: 700; color: ${bandColor}; white-space: nowrap; }
  .hero .num small { display: block; font-size: 12px; font-weight: 400; color: #78716c; }
  .hero .band { font-size: 15px; }
  .hero .band b { color: ${bandColor}; }
  .hero .conf { color: #78716c; font-size: 13px; margin-top: 4px; }
  h2 { font-size: 15px; margin: 26px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #e7e5e4; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #f0efee; vertical-align: top; }
  th { color: #78716c; font-weight: 500; white-space: nowrap; }
  .muted { color: #78716c; font-size: 13px; }
  .issue { padding: 8px 0; border-bottom: 1px dashed #f0efee; }
  .sev { font-size: 12px; color: #b91c1c; border: 1px solid currentColor; border-radius: 4px; padding: 0 5px; }
  .ev-group { margin: 8px 0; }
  .ev-label { font-size: 13px; color: #78716c; margin: 10px 0 4px; }
  .ev { padding: 6px 0; border-bottom: 1px dashed #f0efee; font-size: 14px; }
  .ev i { font-style: normal; color: #b45309; font-size: 12px; border: 1px solid #fde68a; border-radius: 4px; padding: 0 5px; }
  .ev q { display: block; color: #57534e; font-style: italic; }
  .pass { color: #15803d; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; }
  .original { white-space: pre-wrap; font-family: "Songti SC", "SimSun", serif;
              background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 8px; padding: 16px 18px; }
  .foot { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e7e5e4;
          color: #a8a29e; font-size: 12px; display: flex; justify-content: space-between; }
  @media print { .original { max-height: none; overflow: visible; } body { padding: 0; } }
</style>
</head>
<body>
  <h1>天工AI检测报告</h1>
  <div class="meta">检测时间 ${fmtTime(record.createdAt)} · ${Array.from(record.content).length.toLocaleString()} 字
    · 来源 ${record.source === "chapter" ? `写书章节${record.sourceLabel ? `（${esc(record.sourceLabel)}）` : ""}` : "检测页"}</div>

  ${coverageHtml}
  <div class="hero">
    <div class="num"><small>实验风险分</small>${fmtAigc(verdict.aigcValue)}</div>
    <div class="band">
      <b>${esc(verdict.bandLabel ?? "无法判定")}</b>（${band ? esc(BAND_LABEL[band]) : "档位未定"}）
      <div class="conf">可信度 ${result.reportVersion !== "full-text-v2" ? "旧版未验证" : "低 · 实验阶段"}
        · 人味分 ${detection.score}/100</div>
    </div>
  </div>

  <h2>三路信号</h2>
  <table><tr><th>信号</th><th>值</th><th>权重</th><th>说明</th></tr>${signalsHtml}</table>

  ${verdict.warnings.length > 0 ? `<h2>提示</h2>${verdict.warnings.map((w) => `<div class="muted">· ${esc(w)}</div>`).join("")}` : ""}

  ${judge ? `
    <h2>AI 特征审校师 · 本路送审 ${judge.sampledChars} 字${judge.model ? ` · ${esc(judge.model)}` : ""}${judge.patternDensityPerK !== null ? `（AI 模式 ${judge.patternDensityPerK}/千字）` : ""}</h2>
    ${judge.summary ? `<p>${esc(judge.summary)}</p>` : ""}
    ${aiEvidence.length > 0 ? evidenceGroup(aiEvidence, "ai") : ""}
    ${humanEvidence.length > 0 ? evidenceGroup(humanEvidence, "human") : ""}` : ""}

  ${stylometryHtml}
  ${issuesHtml}
  ${vocabHtml}
  ${cleanHtml}

  <h2>检测原文</h2>
  <div class="original">${esc(record.content)}</div>

  <div class="foot">
    <span>天工AI检测 · 三路信号融合（规则与文体统计 / 困惑度 / AI 特征审校师）</span>
    <span>报告生成于 ${fmtTime(new Date().toISOString())}</span>
  </div>
</body>
</html>`;
}

function secHead(title: string): string {
  return `<h2>${esc(title)}</h2>`;
}
