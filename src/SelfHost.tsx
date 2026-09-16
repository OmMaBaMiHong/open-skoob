import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { authHeaders, writeAuth, clearAuth, readAuth, AUTH_CHANGED_EVENT } from "./lib/auth-storage";
import "./self-host.css";
import { useNavigate, useLocation } from "react-router-dom";
import { resetApiCacheIdentity } from "./lib/api-cache";
import { CloudAccessContext, CloudAccessPrompt } from "./cloud-access";
import { CloudConnection } from "./CloudConnection";

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/v1/${path}`, { method, headers: { "Content-Type": "application/json", ...authHeaders() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `请求失败 (${response.status})`); return data;
}
export function SelfHost({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false); const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate(); const location = useLocation();
  const [access, setAccess] = useState({ ready: false, identity: "", message: "领取并选择有效 Free Key 后，即可查看官方脑洞、热点和模板。" });
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
  async function choose(value: "official" | "local") {
    setBusy(true); setError("");
    try { await request("local/onboarding", "PUT", { choice: value }); setChoice(value); if (value === "official") setOpen(true); else navigate("/settings/models"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => {
    let alive = true;
    void request("account/status").then(() => { if (alive && readAuth()) setReady(true); }).catch(() => {}).finally(() => { if (alive) setChecking(false); });
    const changed = () => { if (!readAuth()) { setReady(false); setPassword(""); } };
    window.addEventListener(AUTH_CHANGED_EVENT, changed); return () => { alive = false; window.removeEventListener(AUTH_CHANGED_EVENT, changed); };
  }, []);
  async function login(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { writeAuth(await request("local/login", "POST", { password })); setPassword(""); setReady(true); } catch (e) { setError(String((e as Error).message)); } finally { setBusy(false); } }
  if (checking) return <div className="local-entry">正在连接本地工作室…</div>;
  if (!ready) return <main className="local-entry"><form className="local-panel" onSubmit={login}><span className="local-eyebrow">OPEN-SKOOB · 自部署工作室</span><h1>你的故事，你的工作室</h1><p>作品、会话和模型配置保存在这个部署实例。使用自己的模型即可开始基础创作。</p><label>本地访问密码<input autoFocus type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label><p className="local-help">首次启动密码显示在服务终端；也可由部署者设置 SKOOB_LOCAL_PASSWORD。</p>{error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? "正在登录…" : "进入工作室"}</button><a href="https://skoob.cc" target="_blank" rel="noreferrer">了解官方四大引擎</a></form></main>;
  if (!loaded) return <div className="local-entry">正在确认工作室接入状态…</div>;
  return <CloudAccessContext.Provider value={{ ready: access.ready, message: access.message, connect: () => setOpen(true) }}>
    <div className="local-bar"><span>本地工作室 · {access.ready ? "官方 Free 已连接" : "本地模式"}</span><div><button onClick={() => setOpen(true)}>{access.ready ? "官方连接与 Free Key" : "连接官方，领取 Free Key"}</button><a href="https://gaotk.com/keys" target="_blank" rel="noreferrer">中转站密钥</a><button onClick={() => { void request("account/logout", "POST", {}).finally(clearAuth); }}>退出</button></div></div>
    <div className="local-app">{!access.ready && location.pathname === "/scan" ? <CloudAccessPrompt /> : children}</div>
    {!choice && !access.ready && !open && <div className="local-modal"><section className="local-panel" role="dialog" aria-modal="true" aria-label="开始使用工作室"><span className="local-eyebrow">OPEN-SKOOB</span><h2>先接入免费灵感，开始你的故事</h2><p>连接官方账号，领取并选择 Free Key 后，即可浏览官方脑洞、热点与模板。需要高级引擎时再开通对应套餐。</p>{error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => void choose("official")}>连接官方，领取 Free Key</button><button disabled={busy} onClick={() => void choose("local")}>使用自己的模型，暂不领取</button><p className="local-help">本地作品属于你；模型由你选择，也可稍后从顶部连接官方。</p></section></div>}
    {open && <CloudConnection onChanged={refreshAccess} onClose={() => { setOpen(false); void refreshAccess(); }} />}
  </CloudAccessContext.Provider>;
}
