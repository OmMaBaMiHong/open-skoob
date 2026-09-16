import { useEffect, useRef, useState } from "react";
import { closeGeneralArtifactPreview, openGeneralArtifactPreview, stopGeneralRunningPreview, type GeneralArtifactPreview } from "../../lib/api";

export function ArtifactHtmlPreview({ sessionId, artifact }: { sessionId: string; artifact: { id: string; revision: number; title: string } }) {
  const [generation, setGeneration] = useState(0);
  const [preview, setPreview] = useState<GeneralArtifactPreview | null>(null);
  const [status, setStatus] = useState("正在打开预览…");
  const [stopFailed, setStopFailed] = useState(false);
  const stopCurrent = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false; let stopped = false; let opened: GeneralArtifactPreview | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    stopCurrent.current = () => {
      setStopFailed(false);
      stopped = true; if (timer) clearTimeout(timer);
      setPreview(null); setStatus("预览已停止。");
      if (opened?.runningPreviewId) {
        setStatus("正在停止网页服务…");
        void stopGeneralRunningPreview(sessionId, opened.runningPreviewId).then(result => {
          if (!disposed) setStatus(result.status === "stopping" ? "已撤销访问，服务正在退出。" : "网页服务已结束。");
        }).catch(() => { if (!disposed) { setStatus("页面已关闭，服务停止尚未确认，请重试停止。"); setStopFailed(true); } });
      }
      if (opened) void closeGeneralArtifactPreview(sessionId, opened.previewId).catch(() => {
        if (!disposed && !opened?.runningPreviewId) setStatus("页面已停止，访问链接将在到期后关闭。");
      });
    };
    setPreview(null); setStopFailed(false); setStatus("正在打开预览…");
    void openGeneralArtifactPreview(sessionId, artifact.id, artifact.revision).then(result => {
      opened = result;
      if (disposed || stopped) { void closeGeneralArtifactPreview(sessionId, result.previewId).catch(() => {}); return; }
      const url = new URL(result.url);
      if (!["http:", "https:"].includes(url.protocol) || url.origin === window.location.origin || url.username || url.password
        || result.artifactId !== artifact.id || result.revision !== artifact.revision || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error("预览链接校验失败");
      setPreview(result); setStatus("");
      timer = setTimeout(() => { setPreview(null); setStatus("预览已到期，重新打开可继续查看。"); }, Math.max(0, Date.parse(result.expiresAt) - Date.now()));
    }).catch(error => {
      if (opened) void closeGeneralArtifactPreview(sessionId, opened.previewId).catch(() => {});
      if (!disposed && !stopped) setStatus(error instanceof Error ? error.message : "预览未能打开，请重试。");
    });
    return () => {
      disposed = true; if (timer) clearTimeout(timer);
      if (opened) void closeGeneralArtifactPreview(sessionId, opened.previewId).catch(() => {});
    };
  }, [sessionId, artifact.id, artifact.revision, generation]);
  return <section aria-label={`${artifact.title}预览`}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
      <span>{artifact.title} · 版本 {artifact.revision}</span>
      <button type="button" onClick={() => setGeneration(value => value + 1)}>重新打开</button>
    </div>
    {status && <p role="status">{status}</p>}
    {stopFailed && <button type="button" onClick={() => stopCurrent.current()}>重试停止服务</button>}
    {preview && <>
      <button type="button" onClick={() => stopCurrent.current()}>{preview.runningPreviewId ? "停止服务" : "停止预览"}</button>
      <iframe key={preview.previewId} title={artifact.title} src={preview.url} sandbox="allow-scripts" referrerPolicy="no-referrer"
        style={{ display: "block", width: "100%", height: "min(70vh, 720px)", minHeight: 320, border: "1px solid var(--border, #ddd)", borderRadius: 8, marginTop: 8, background: "#fff" }} />
    </>}
  </section>;
}
