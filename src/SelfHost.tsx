import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { authHeaders, writeAuth, clearAuth, readAuth, AUTH_CHANGED_EVENT } from "./lib/auth-storage";
import "./self-host.css";

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/v1/${path}`, { method, headers: { "Content-Type": "application/json", ...authHeaders() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `请求失败 (${response.status})`); return data;
}
export function SelfHost({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false); const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false); const [cloud, setCloud] = useState({ baseUrl: "https://skoob.cc", userId: "", configured: false, last4: "" }); const [key, setKey] = useState(""); const [saved, setSaved] = useState("");
  useEffect(() => {
    let alive = true;
    void request("account/status").then(() => { if (alive && readAuth()) setReady(true); }).catch(() => {}).finally(() => { if (alive) setChecking(false); });
    const changed = () => { if (!readAuth()) { setReady(false); setPassword(""); } };
    window.addEventListener(AUTH_CHANGED_EVENT, changed); return () => { alive = false; window.removeEventListener(AUTH_CHANGED_EVENT, changed); };
  }, []);
  async function login(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { writeAuth(await request("local/login", "POST", { password })); setPassword(""); setReady(true); } catch (e) { setError(String((e as Error).message)); } finally { setBusy(false); } }
  async function settings() { setError(""); setSaved(""); setKey(""); try { setCloud(await request("local/cloud")); setOpen(true); } catch (e) { setError((e as Error).message); } }
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await request("local/cloud", "PUT", { baseUrl: cloud.baseUrl, userId: cloud.userId, ...(key ? { apiKey: key } : {}) }); setCloud(await request("local/cloud")); setKey(""); setSaved("连接配置已保存；实际可用能力由云端授权决定。"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (checking) return <div className="local-entry">正在连接本地工作室…</div>;
  if (!ready) return <main className="local-entry"><form className="local-panel" onSubmit={login}><span className="local-eyebrow">OPEN-SKOOB · 自部署工作室</span><h1>你的故事，你的工作室</h1><p>作品、会话和模型配置保存在这个部署实例。使用自己的模型即可开始基础创作。</p><label>本地访问密码<input autoFocus type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label><p className="local-help">首次启动密码显示在服务终端；也可由部署者设置 SKOOB_LOCAL_PASSWORD。</p>{error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? "正在登录…" : "进入工作室"}</button><a href="https://skoob.cc" target="_blank" rel="noreferrer">了解官方四大引擎</a></form></main>;
  return <><div className="local-bar"><span>本地工作室 · 数据保存在你的部署中</span><div><button onClick={() => void settings()}>云端引擎连接</button><a href="https://gaotk.com" target="_blank" rel="noreferrer">OpenSkoob 中转站</a><button onClick={() => { void request("account/logout", "POST", {}).finally(clearAuth); }}>退出</button></div></div><div className="local-app">{children}</div>{open && <div className="local-modal"><form className="local-panel" onSubmit={save}><h2>连接官方云端引擎</h2><p>基础创作无需配置这里。四大引擎按官方开通资料授权；中转站模型 Key 请在「模型服务」中配置。</p><label>云端地址<input type="url" value={cloud.baseUrl} onChange={e => setCloud({ ...cloud, baseUrl: e.target.value })} required /></label><label>云端用户 ID（按开通资料填写）<input value={cloud.userId} onChange={e => setCloud({ ...cloud, userId: e.target.value })} /></label><label>云端访问凭证<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={cloud.configured ? `已配置 · 尾号 ${cloud.last4}，留空保留` : "填写官方开通的访问凭证"} /></label><p>接入申请：<a href="mailto:1651055684@qq.com">1651055684@qq.com</a></p>{error && <p role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}<div className="local-actions"><button disabled={busy}>保存</button><button type="button" onClick={() => setOpen(false)}>关闭</button>{cloud.configured && <button type="button" onClick={() => void request("local/cloud", "PUT", { baseUrl: cloud.baseUrl, userId: "", apiKey: "" }).then(() => request("local/cloud")).then(setCloud).catch(e => setError(e.message))}>断开</button>}</div></form></div>}</>;
}
