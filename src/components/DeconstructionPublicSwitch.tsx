import { useEffect, useState } from "react";
import { fetchJson } from "../lib/api";
import "./DeconstructionPublicSwitch.css";

export interface PublicationState { public: boolean; canManage: boolean; canPublish: boolean }
export function DeconstructionPublicSwitch({ slug }: { slug: string }) {
  const [state, setState] = useState<PublicationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState(null); setError("");
    fetchJson<PublicationState>(`/deconstructions/${encodeURIComponent(slug)}/publication`, { cache: "no-store" })
      .then(value => { if (active) { setState(value); } })
      .catch(() => { if (active) setError("公开状态读取失败"); });
    return () => { active = false; };
  }, [slug, attempt]);
  async function toggle() {
    if (!state || busy) return;
    setBusy(true); setError("");
    try {
      const value = await fetchJson<PublicationState>(`/deconstructions/${encodeURIComponent(slug)}/publication`, {
        method: "PUT", body: JSON.stringify({ public: !state.public }),
      });
      setState(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "切换失败，请重试"); }
    finally { setBusy(false); }
  }
  return <div className="deconstruction-public-switch" onClick={event => { event.stopPropagation(); }}>
    {state?.canManage ? <label>
      <span>公开到全网</span>
      <button type="button" role="switch" aria-label="公开到全网" aria-checked={state.public}
        disabled={busy || (!state.public && !state.canPublish)} onClick={() => void toggle()}><span /></button>
      <small>{busy ? "正在保存…" : state.public ? "已公开" : state.canPublish ? "仅自己可见" : "拆书完成后可公开"}</small>
    </label> : state ? <span>公开模板，登录即可使用</span> : !error ? <span>正在读取公开状态…</span> : null}
    {error && <span role="alert">{error} {!state && <button onClick={() => setAttempt(n => n + 1)}>重试</button>}</span>}
  </div>;
}
