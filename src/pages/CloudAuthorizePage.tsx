import { useEffect, useState } from "react";
import { fetchAccountStatus, startOAuthLogin, type AccountStatus } from "../lib/account";
import { authHeaders } from "../lib/auth-storage";
import { apiUrl } from "../lib/api-origin";
import "../styles/cloud-connect.css";

export function CloudAuthorizePage() {
  const params = new URLSearchParams(window.location.search);
  const challenge = params.get("challenge") ?? "";
  const state = params.get("state") ?? "";
  let target = "";
  try { const u = new URL(params.get("origin") ?? ""); if (!u.username && !u.password && (u.protocol === "https:" || u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))) target = u.origin; } catch { /* Invalid requests never receive credentials. */ }
  const valid = Boolean(target && /^[a-f0-9]{64}$/.test(challenge) && /^[a-f0-9]{64}$/.test(state));
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [code, setCode] = useState("");
  useEffect(() => { let alive = true; void fetchAccountStatus().then(a => { if (alive) setAccount(a); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, []);
  async function approve() {
    setBusy(true); setError("");
    try {
      const response = await fetch(apiUrl("/api/v1/account/self-hosted/authorize"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ challenge, approved: true }) });
      const data = await response.json(); if (!response.ok || !data.code) throw new Error(data.message || "授权失败，请重新登录后再试。");
      setCode(data.code);
      window.opener?.postMessage({ type: "skoob:cloud-authorization", state, code: data.code }, target);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="cloud-consent"><section><a href="/site">焚诀 Skoob</a><h1>连接你的本地工作室</h1>{!valid ? <p role="alert">连接请求无效，请回到本地工作室重新发起授权。</p> : <><p>确认将当前官方账号连接到下面的部署实例：</p><strong className="cloud-consent-origin">{target}</strong><p>该实例将能够以你的身份调用已获授权的云端能力、访问云端资源，并上传你主动选择的模板。模型用量和会员权益仍由官方平台结算与校验。请只授权你自己管理或信任的实例。</p>{account?.loggedIn ? <p>当前账号：{account.user?.username || account.user?.email || "已登录"}</p> : <p>先通过 OpenSkoob 中转站授权登录，再确认连接。</p>}{code ? <><p role="status">授权已发送，请回到本地工作室。如果没有自动连接，请在一分钟内复制下面的一次性连接码。</p><input aria-label="一次性连接码" readOnly value={code} onFocus={e => e.target.select()} /></> : account?.loggedIn ? <button disabled={busy} onClick={() => void approve()}>{busy ? "正在授权…" : "授权此工作室"}</button> : <button disabled={!account} onClick={() => startOAuthLogin(window.location.href)}>通过中转站登录授权</button>}</>}{error && <p role="alert">{error}</p>}</section></main>;
}
