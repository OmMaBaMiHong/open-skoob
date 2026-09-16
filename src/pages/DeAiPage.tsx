/**
 * DeAiPage — AI 检测独立工具页
 *
 * 粘贴一段文本 → 检测 AI 味（会员手动触发）→ 分数 + 问题清单 → 一键改写（会员按钮触发）。
 * 写书页的章节内嵌检测与这里是同一块面板（DeAiPanel）。
 *
 * 检测记录（迁移 051）：每次检测成功自动入库一条（同文本测三次 = 三条），
 * 账号维度持久化——退出重登/换设备回来记录还在。列表点开回放当时的完整报告，
 * 可下载 HTML 报告（页面展示什么，报告就是什么），可单条删除。
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Download, History, Loader2, Trash2 } from "lucide-react";
import { DeAiPanel } from "../components/DeAiPanel";
import { DeAiReport, fmtAigc } from "../components/DeAiReport";
import {
  listDeAiRecords, getDeAiRecord, deleteDeAiRecord,
  type DeAiRecordItem, type DeAiRecordDetail, type DeAiBand,
} from "../lib/api";
import { buildDeaiReportHtml } from "../lib/deai-report";

const SAMPLE = "综上所述，这不仅是一个具有重大历史意义的时刻，而且彻底改变了一切。值得注意的是，他深入探讨了这个问题，这无疑是非常重要的。首先我们要明确，其次我们要深入分析，最后我们要全面总结。";

const BAND_TEXT: Record<DeAiBand, string> = {
  human: "人工特征",
  suspect: "疑似 AI",
  ai: "AI 特征",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DeAiPage() {
  const [content, setContent] = useState("");
  const [records, setRecords] = useState<ReadonlyArray<DeAiRecordItem> | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const refreshRecords = useCallback(() => {
    listDeAiRecords()
      .then((r) => { setRecords(r); setListError(null); })
      .catch((e) => setListError((e as Error).message));
  }, []);

  useEffect(() => { refreshRecords(); }, [refreshRecords]);

  return (
    <div className="deai-page">
      <div className="deai-page-head">
        <h1>天工AI检测</h1>
        <p>会员独立工具，点击「开始检测」才运行，不参与写书编排。正文按段完整计分，报告显示覆盖率、分段结果与未知比例。当前检测仍处于实验阶段，风险分不能证明生成来源；缺少独立标定时不输出概率。每次检测自动留档，可回看、下载报告。</p>
      </div>
      <textarea
        className="deai-input"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="把要检测的正文粘贴到这里…"
        rows={10}
      />
      <div className="deai-page-meta">
        <span>{content.length.toLocaleString()} 字</span>
        {!content && (
          <button className="dc-btn" onClick={() => setContent(SAMPLE)}>试一段示例</button>
        )}
      </div>
      <DeAiPanel content={content} onApplyRewrite={setContent} source="page" onDetected={refreshRecords} />

      <DeAiRecords
        records={records}
        error={listError}
        onRetry={refreshRecords}
        onDeleted={(id) => setRecords((prev) => prev?.filter((r) => r.id !== id) ?? prev)}
      />
    </div>
  );
}

/* ── 检测记录：列表 + 单条回放/下载/删除 ── */
function DeAiRecords({ records, error, onRetry, onDeleted }: {
  readonly records: ReadonlyArray<DeAiRecordItem> | null;
  readonly error: string | null;
  readonly onRetry: () => void;
  /** 删除成功后把这条从列表里拿掉（详情缓存同步失效）。 */
  readonly onDeleted: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeAiRecordDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const toggle = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setDetailError(null);
    setLoadingId(id);
    try {
      setDetail(await getDeAiRecord(id));
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setLoadingId(null);
    }
  }, [expandedId]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm("删除这条检测记录？删除后不可恢复。")) return;
    try {
      await deleteDeAiRecord(id);
      onDeleted(id);
      if (expandedId === id) setExpandedId(null);
    } catch (e) {
      window.alert(`删除失败：${(e as Error).message}`);
    }
  }, [expandedId, onDeleted]);

  const download = useCallback((d: DeAiRecordDetail) => {
    const html = buildDeaiReportHtml(d);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const p = (n: number) => String(n).padStart(2, "0");
    const t = new Date(d.createdAt);
    const stamp = `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}`;
    a.href = url;
    a.download = `天工AI检测报告-风险分${fmtAigc(d.aigcValue)}-${stamp}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="deai-records">
      <div className="deai-records-head">
        <h2><History size={15} /> 检测记录</h2>
        {records && records.length > 0 && <span className="deai-records-n">{records.length} 条</span>}
      </div>
      {records === null && !error && <p className="deai-records-empty"><Loader2 size={13} className="spin" /> 读取记录…</p>}
      {error && (
        <p className="deai-records-empty">
          记录读取失败——{error} <button className="dc-btn" onClick={onRetry}>重试</button>
        </p>
      )}
      {records?.length === 0 && (
        <p className="deai-records-empty">还没有检测记录。上面测一次，这里就会存一条。</p>
      )}
      {records && records.length > 0 && records.map((r) => (
        <div key={r.id} className={`deai-rec ${expandedId === r.id ? "is-open" : ""}`}>
          <button className="deai-rec-head" onClick={() => void toggle(r.id)}>
            <span className={`deai-rec-band ${r.band ? `is-${r.band}` : ""}`}>
              {r.band ? BAND_TEXT[r.band] : "未判定"}
            </span>
            <span className="deai-rec-aigc">风险分 {fmtAigc(r.aigcValue)}</span>
            <span className="deai-rec-src">
              {r.source === "chapter" ? `章节${r.sourceLabel ? ` · ${r.sourceLabel}` : ""}` : "检测页"}
            </span>
            <span className="deai-rec-excerpt">{r.excerpt}</span>
            <span className="deai-rec-time">{fmtTime(r.createdAt)}</span>
            <ChevronDown size={14} className={`deai-rec-chevron ${expandedId === r.id ? "is-open" : ""}`} />
          </button>
          {expandedId === r.id && (
            <div className="deai-rec-body">
              {loadingId === r.id && <p className="deai-records-empty"><Loader2 size={13} className="spin" /> 读取详情…</p>}
              {detailError && <p className="deai-records-empty">详情读取失败——{detailError}</p>}
              {detail && (
                <>
                  <div className="deai-actions">
                    <button className="dc-btn" onClick={() => download(detail)}>
                      <Download size={13} /> 下载报告
                    </button>
                    <button className="dc-btn is-danger" onClick={() => void remove(r.id)}>
                      <Trash2 size={13} /> 删除记录
                    </button>
                  </div>
                  <DeAiReport result={detail.result} />
                  <div className="deai-rec-original">
                    <div className="deai-sec-t">检测原文 · {detail.content.length.toLocaleString()} 字</div>
                    <pre>{detail.content}</pre>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
