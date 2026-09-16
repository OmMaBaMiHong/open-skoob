import { useEffect, useRef, useState } from "react";
import type { ArtifactRef, GeneralAttachment } from "../../lib/general-agent-contracts";
import { fetchGeneralArtifact, fetchGeneralOriginal } from "../../lib/general-agent-api";
import { AgentMarkdown } from "./AgentMarkdown";
import { ArtifactHtmlPreview } from "./ArtifactHtmlPreview";

export type DeconstructionResourceRef = { sessionId: string } & (
  | { kind: "attachment"; resource: GeneralAttachment }
  | { kind: "artifact"; resource: ArtifactRef }
);
const PAGE_SIZE = 20_000;

/** Reads the exact session-owned revision. Opening a file never changes the book or starts a task. */
export function DeconstructionResource({ selection, onClose }: { selection: DeconstructionResourceRef; onClose: () => void }) {
  const [content, setContent] = useState<{ blob: Blob; url: string; text?: string; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(false), [page, setPage] = useState(0);
  const close = useRef<HTMLButtonElement>(null);
  const title = selection.kind === "artifact" ? selection.resource.title : selection.resource.filename;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let url: string | undefined;
    setContent(null); setError(null); setPage(0); setPreview(false);
    const fetch = selection.kind === "artifact" ? fetchGeneralArtifact : fetchGeneralOriginal;
    void fetch(selection.sessionId, selection.resource.id, selection.resource.revision, controller.signal).then(async blob => {
      let type = blob.type.split(";")[0];
      const isText = type.startsWith("text/") || /json|javascript|xml/.test(type) || /\.(txt|md|json|csv|ts|tsx|js|jsx|py|html|css|yaml|yml|xml)$/i.test(title);
      const text = isText ? new TextDecoder(selection.kind === "attachment" ? selection.resource.encoding || "utf-8" : "utf-8").decode(await blob.arrayBuffer()) : undefined;
      if (controller.signal.aborted) return;
      if (text !== undefined) type = "text";
      url = URL.createObjectURL(blob); setContent({ blob, url, text, type });
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "文件暂不可读"); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [selection, attempt, title]);
  const pages = Math.max(1, Math.ceil((content?.text?.length ?? 0) / PAGE_SIZE));
  return <section className="dcw-resource-view" aria-label="文件预览" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header><div><h2>{title}</h2><span>版本 {selection.resource.revision} · {selection.kind === "attachment" ? "原始附件" : "会话产物"}</span></div>
      <button ref={close} type="button" onClick={onClose}>关闭预览，返回阅读</button></header>
    <div className="dcw-resource-actions">
      {content && <a href={content.url} download={title}>下载文件</a>}
      {selection.kind === "artifact" && ["code", "file"].includes(selection.resource.kind) && <button type="button" onClick={() => setPreview(value => !value)}>{preview ? "查看文件" : "交互预览"}</button>}
    </div>
    {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>重新加载</button></p>}
    {preview && selection.kind === "artifact" ? <ArtifactHtmlPreview sessionId={selection.sessionId} artifact={selection.resource} />
      : !content ? !error && <p role="status">正在读取文件…</p>
      : content.text !== undefined ? <>
        {pages > 1 && <nav className="dcw-resource-pages" aria-label="文件分页"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一段</button><span>第 {page + 1} / {pages} 段 · 全文 {content.text.length.toLocaleString()} 字</span><button disabled={page + 1 === pages} onClick={() => setPage(value => value + 1)}>下一段</button></nav>}
        {selection.kind === "artifact" && selection.resource.kind === "report"
          ? <AgentMarkdown text={content.text.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)} />
          : <pre className="dcw-resource-text">{content.text.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}</pre>}
      </> : /^image\/(png|jpeg|webp|gif|avif)$/.test(content.type) ? <img className="dcw-resource-image" src={content.url} alt={title} />
      : content.type === "application/pdf" ? <iframe className="dcw-resource-pdf" title={title} src={content.url} sandbox="" />
      : <p>此格式暂不支持内嵌预览，可以下载原文件查看。</p>}
  </section>;
}
