import { useEffect, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { fetchJson, type AssetItem } from "../lib/api";
import "./DeconstructionChapterComparison.css";

interface OriginalChapter {
  chapterNumber: number;
  title: string;
  content: string;
  sourceRevision: string;
}

export function DeconstructionChapterComparison({ slug, item, expanded, onExpand }: {
  slug: string; item: AssetItem; expanded: boolean; onExpand: () => void;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [chapter, setChapter] = useState<OriginalChapter | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<"original" | "analysis">("original");
  // Chapter asset IDs are emitted as ch-<source chapter number>, never a title.
  const number = /^ch-([1-9]\d*)$/u.exec(item.id)?.[1];

  useEffect(() => {
    if (!showOriginal || !number) return;
    let cancelled = false;
    const controller = new AbortController();
    setChapter(null); setError("");
    fetchJson<OriginalChapter>(`/deconstructions/${encodeURIComponent(slug)}/chapters/${number}/original`, {
      signal: controller.signal, cache: "no-store",
    }).then(value => { if (!cancelled) setChapter(value); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "原文加载失败，请重试。"); });
    return () => { cancelled = true; controller.abort(); };
  }, [slug, number, showOriginal, attempt]);

  const analysis = <div className="dcw-fields">
    {item.fields?.length ? item.fields.map(field => <div className="dcw-field" key={field.label}>
      <span className="dcw-field-label">{field.label}</span>
      <span className="dcw-field-value">{field.value}</span>
    </div>) : <p>{item.summary || "本章尚未生成拆解结果，已保存的原文可以先查看。"}</p>}
  </div>;

  return <div className="chapter-comparison">
    {number && <button className="chapter-comparison-toggle" aria-expanded={showOriginal && expanded} onClick={() => {
      if (!expanded) { onExpand(); setShowOriginal(true); }
      else setShowOriginal(value => !value);
      setTab("original");
    }}><BookOpen size={15} />{showOriginal && expanded ? "收起原文对照" : "查看原文对照"}</button>}
    {expanded && (showOriginal ? <>
      <div className="chapter-comparison-tabs" role="tablist" aria-label="章节对照内容">
        <button role="tab" aria-selected={tab === "original"} onClick={() => setTab("original")}>章节原文</button>
        <button role="tab" aria-selected={tab === "analysis"} onClick={() => setTab("analysis")}>拆解结果</button>
      </div>
      <div className="chapter-comparison-columns" data-tab={tab}>
        <section className="chapter-comparison-original" aria-label="章节原文">
          <h3>章节原文 <small>已保存的拆书文本</small></h3>
          {error ? <div role="alert">{error}<button onClick={() => setAttempt(value => value + 1)}>重新加载原文</button></div>
            : !chapter ? <p role="status"><Loader2 size={15} className="spin" /> 正在读取本章原文…</p>
            : <div className="chapter-original-text">{chapter.content || "本章原文为空。"}</div>}
        </section>
        <section className="chapter-comparison-analysis" aria-label="拆解结果">
          <h3>拆解结果 <small>对照原文核验</small></h3>{analysis}
        </section>
      </div>
    </> : analysis)}
  </div>;
}
