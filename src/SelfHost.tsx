import { useEffect, useRef, useState, type ReactNode } from "react";
import { authHeaders, writeAuth, readAuth, AUTH_CHANGED_EVENT } from "./lib/auth-storage";
import "./self-host.css";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { resetApiCacheIdentity } from "./lib/api-cache";
import { CloudAccessContext, CloudAccessPrompt } from "./cloud-access";
import { CloudConnection } from "./CloudConnection";

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/v1/${path}`, { method, headers: { "Content-Type": "application/json", ...authHeaders() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `请求失败 (${response.status})`); return data;
}
export function SelfHost({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false); const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate(); const location = useLocation();
  const [access, setAccess] = useState({ ready: false, identity: "", message: "填写有效官方 Key 后，即可查看官方脑洞、热点和模板。" });
  const accessIdentity = useRef(""); const accessRequest = useRef(0);
  const [choice, setChoice] = useState<string | null>(null); const [loaded, setLoaded] = useState(false);
  async function refreshAccess(force = false) {
    const seq = ++accessRequest.current;
    const result = await request(`local/cloud/access${force ? "?refresh=1" : ""}`).catch(() => ({ ready: false, message: "暂时无法验证官方 Free Key，请重试；本地创作仍可使用。" }));
    if (seq !== accessRequest.current || !readAuth()) return;
    const next = { ready: result.ready === true, identity: result.identity || "", message: result.message || "官方免费内容已连接" };
    if (accessIdentity.current !== next.identity) { accessIdentity.current = next.identity; resetApiCacheIdentity(); window.dispatchEvent(new Event("skoob:cloud-account-changed")); }
    setAccess(next);
  }
  useEffect(() => {
    if (!ready) { accessRequest.current++; setLoaded(false); return; }
    let alive = true;
    resetApiCacheIdentity();
    void Promise.all([refreshAccess(true), request("local/onboarding").then(x => { if (alive) setChoice(x.choice); })]).catch(e => setError(e.message)).finally(() => { if (alive) setLoaded(true); });
    const refresh = () => { if (document.visibilityState === "visible") void refreshAccess(true); };
    const timer = window.setInterval(refresh, 60000); window.addEventListener("focus", refresh); window.addEventListener("skoob:cloud-access-invalid", refresh);
    return () => { alive = false; accessRequest.current++; clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("skoob:cloud-access-invalid", refresh); };
  }, [ready]);
  async function chooseLocal() {
    setError("");
    try { await request("local/onboarding", "PUT", { choice: "local" }); setChoice("local"); setOpen(false); navigate("/settings/models"); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    let alive = true;
    async function connectLocal() {
      setChecking(true); setError("");
      try {
        const response = await fetch("/api/v1/local/session", { method: "POST", headers: { "X-Skoob-Local": "1" } });
        const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "无法连接本地工作室");
        if (alive) { writeAuth(data); setReady(true); }
      } catch (e) { if (alive) setError((e as Error).message); }
      finally { if (alive) setChecking(false); }
    }
    void connectLocal();
    const changed = () => { if (!readAuth()) { setReady(false); void connectLocal(); } };
    window.addEventListener(AUTH_CHANGED_EVENT, changed); return () => { alive = false; window.removeEventListener(AUTH_CHANGED_EVENT, changed); };
  }, []);
  if (checking) return <div className="local-entry">正在连接本地工作室…</div>;
  if (!ready) return <main className="local-entry"><section className="local-panel"><h1>暂时无法连接工作室</h1><p role="alert">{error}</p><button onClick={() => window.location.reload()}>重新连接</button></section></main>;
  if (!loaded) return <div className="local-entry">正在确认工作室接入状态…</div>;
  return <CloudAccessContext.Provider value={{ ready: access.ready, message: access.message, connect: () => setOpen(true) }}>
    {!choice && !access.ready ? <><CloudConnection initial onChanged={refreshAccess} onClose={() => void chooseLocal()} />{error && <p role="alert">{error}</p>}</> : <>
      <div className="local-bar"><span>本地工作室 · {access.ready ? "官方内容已连接" : "本地模式"}</span><div><button onClick={() => setOpen(true)}>{access.ready ? "官方连接与 Key" : "填写官方 Key / 授权登录"}</button><a href="https://gaotk.com/keys" target="_blank" rel="noreferrer">领取 Free Key</a></div></div>
      <div className="local-app">{location.pathname === "/" && choice === "local" ? <Navigate to="/settings/models" replace /> : !access.ready && location.pathname === "/scan" ? <CloudAccessPrompt /> : children}</div>
      {open && <CloudConnection onChanged={refreshAccess} onClose={() => { setOpen(false); void refreshAccess(); }} />}
    </>}

  </CloudAccessContext.Provider>;
}
