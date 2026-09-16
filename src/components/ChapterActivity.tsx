import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { activitySummary, CRAFT_LABELS, type CreationActivity } from "../lib/creation-activity";

export function ChapterActivity({ activity, running, chapter, error, status, variant = "board" }: {
  activity?: CreationActivity; running: boolean; chapter: number | null; error?: string; status?: string; variant?: "board" | "chat";
}) {
  const [expanded, setExpanded] = useState(variant === "chat");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!running) return; const timer = setInterval(() => setNow(Date.now()),1000); return () => clearInterval(timer); }, [running]);
  const active = activity?.items.find(item => item.status === "running");
  const elapsed = active ? Math.max(0,Math.floor((now-active.updatedAt)/1000)) : 0;
  const summary = error || (status === "paused" ? "任务已暂停，已生成内容与过程记录保留。" : activitySummary(activity, running));
  return <section className={`chapter-activity is-${variant}`} aria-label={variant === "board" ? "本章治理过程" : "本章执行进展"}>
    <button className="chapter-activity-head" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
      <span>{running && <Loader2 size={13} className="spin" />}第 {chapter ?? "—"} 章 · {variant === "board" ? "治理过程" : "执行进展"}</span>
      <ChevronDown size={14} className={expanded ? "is-open" : ""} />
    </button>
    <div className="chapter-activity-current" role="status">{summary}</div>
    {running && active && <div className="chapter-activity-time">本阶段已用 {elapsed < 60 ? `${elapsed} 秒` : `${Math.floor(elapsed/60)} 分 ${elapsed%60} 秒`}</div>}
    {expanded && <ol className="chapter-activity-items">
      {activity?.items.map(item => <li key={item.stage} data-status={item.status}>
        <span>{item.status === "running" ? running ? "◌" : "—" : item.status === "done" ? "✓" : item.status === "error" ? "!" : "—"}</span>
        <div><strong>{CRAFT_LABELS[item.stage] ?? item.stage}</strong><p>{item.message}</p></div>
      </li>)}
      {!activity?.items.length && <li>此章尚无详细阶段记录；新任务开始后会逐项更新。</li>}
    </ol>}
  </section>;
}
