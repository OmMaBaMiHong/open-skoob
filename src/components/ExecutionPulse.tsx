import { useEffect, useState } from "react";
import { Loader2, Activity } from "lucide-react";
import "./execution-pulse.css";

/** Public task activity only. Never renders model reasoning or invented progress. */
export function ExecutionPulse({ running, message }: { running: boolean; message: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!running) return;
    const start = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [running, message]);
  if (!message) return null;
  return <div className={`execution-pulse${running ? " is-running" : ""}`} role="status" aria-live="polite">
    {running ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Activity size={14} aria-hidden="true" />}
    <span className="execution-pulse-text" key={message} title={message}>{message}</span>
    {running && <small aria-hidden="true">{seconds} 秒</small>}
  </div>;
}
