import { useEffect, useRef, useState } from "react";
import { useCloudAccess } from "./cloud-access";
import { authHeaders } from "./lib/auth-storage";

const entitlementNames: Record<string,string> = { "hot_news.adapt":"热点新闻改编", "world.simulate":"天衍世界模拟", "deai.rewrite":"天工 AI 检测与改写" };
type Connection = { baseUrl: string; configured: boolean; username?: string; userId?: string; last4?: string; method?: string };
type Template = { id: string; type: "agent" | "skill"; title: string };
type Asset = { assetId: string; title: string; visibility: string; creatorUserId?: string };
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/v1/local/cloud${path}`, { method, headers: { "Content-Type": "application/json", ...authHeaders() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || data.message || "云端请求失败"); return data;
}
export function CloudConnection({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const currentAccess = useCloudAccess();
  const [cloud,setCloud] = useState<Connection>({ baseUrl:"https://skoob.cc",configured:false });
  const [free,setFree] = useState<{ ready: boolean; message?: string; key?: { id: string; name: string }; service?: string }>({ ready: false });
  useEffect(() => { setFree(previous => ({ ...previous, ready: currentAccess.ready, message: currentAccess.message })); }, [currentAccess.ready, currentAccess.message]);
  const [keys,setKeys] = useState<Array<{ id: string; name: string; last4: string; group: string; eligible: boolean; status: string }>>([]);
  const [keyId,setKeyId] = useState(""); const [keyPage,setKeyPage] = useState(1); const [hasMore,setHasMore] = useState(false);
  const [keyUrl,setKeyUrl] = useState("https://gaotk.com/keys");
  async function loadKeys(page = 1) { const data = await request(`/keys?page=${page}`); if (!mounted.current) return; setKeys(data.keys); setKeyPage(data.page); setHasMore(data.hasMore); setKeyUrl(data.createUrl); setKeyId(""); }
  const [key,setKey] = useState(""); const [error,setError] = useState(""); const [notice,setNotice] = useState(""); const [busy,setBusy] = useState(false);
  const [account,setAccount] = useState<{ user?: { username?: string }; membership?: { plan?: string; entitlements?: string[]; stale?: boolean }; relayUrl?: string } | null>(null);
  const [templates,setTemplates] = useState<Template[]>([]); const [assets,setAssets] = useState<Asset[]>([]); const [kind,setKind] = useState<"agent"|"skill">("agent");
  const [flow,setFlow] = useState<{ state:string; authorizeUrl:string }|null>(null); const [manualCode,setManualCode] = useState("");
  const [uploaded,setUploaded] = useState<Record<string,Asset>>({}); const popup = useRef<Window|null>(null); const mounted = useRef(true); const exchanging = useRef(false);
  async function refresh() {
    setAccount(null); setAssets([]);
    const gate = await request("/access"); if (mounted.current) setFree(gate);
    const current = await request(""); if (!mounted.current) return; setCloud(current);
    const local = await request("/templates"); if (!mounted.current) return; setTemplates(local.templates);
    if (current.configured) { const status = await request("/status"); if (mounted.current) setAccount(status); await loadKeys(); }
    else { setKeys([]); setKeyId(""); setFree({ready:false}); setAccount(null); setAssets([]); setUploaded({}); }
  }
  useEffect(() => { mounted.current=true; void refresh().catch(e=>setError(e.message)); return ()=>{mounted.current=false;}; },[]);
  useEffect(() => { let alive=true; if (account && free.ready) void request(`/assets/${kind}`).then(data=>{if(alive)setAssets(data.capabilities)}).catch(e=>{if(alive)setError(e.message)}); return ()=>{alive=false}; },[account,kind,free.ready]);
  async function run(work:()=>Promise<void>) { setBusy(true);setError("");setNotice("");try{await work()}catch(e){if(mounted.current)setError((e as Error).message)}finally{if(mounted.current)setBusy(false)} }
  async function exchange(code:string,state:string) {
    if(exchanging.current)return;exchanging.current=true;
    await run(async()=>{await request("/exchange","POST",{code,state});setFlow(null);setManualCode("");setUploaded({});await onChanged();await refresh();setNotice("官方账号已连接。下一步请选择有效 Free Key，解锁官方免费列表。");});
    exchanging.current=false;
  }
  useEffect(()=>{
    if(!flow)return;
    const receive=(event:MessageEvent)=>{if(event.origin!==new URL(flow.authorizeUrl).origin || event.source!==popup.current || event.data?.type!=="skoob:cloud-authorization" || event.data?.state!==flow.state || typeof event.data?.code!=="string")return;void exchange(event.data.code,flow.state)};
    window.addEventListener("message",receive);return()=>window.removeEventListener("message",receive);
  },[flow]);
  async function authorize() {
    popup.current=window.open("about:blank","skoob-official-authorization","popup,width=640,height=760");
    await run(async()=>{const result=await request("/authorize","POST",{baseUrl:cloud.baseUrl});setFlow(result);if(popup.current)popup.current.location.href=result.authorizeUrl;});
  }
  return <div className="local-modal"><section className="local-panel cloud-panel" role="dialog" aria-modal="true" aria-label="连接 Skoob 官方平台">
    <div className="cloud-panel-heading"><h2>连接 Skoob 官方平台</h2><button type="button" onClick={onClose}>关闭</button></div>
    <p>本地创作与自有模型继续可用。连接官方账号，再领取并选择 Free Key，即可查看脑洞、热点和官方模板。高级引擎按套餐授权，自己的模板可上传到平台。</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <details><summary>官方服务地址</summary><label>服务源地址<input aria-label="官方服务地址" type="url" value={cloud.baseUrl} onChange={e=>{setCloud({...cloud,baseUrl:e.target.value});setFlow(null);}} /></label></details>
    <div className="cloud-connect-methods"><button type="button" disabled={busy} onClick={()=>void authorize()}>{cloud.configured?"重新授权 / 切换账号":"登录官方账号并授权"}</button><a href="https://gaotk.com" target="_blank" rel="noreferrer">注册或前往中转站</a></div>
    {flow&&<div className="cloud-flow"><p>请在官方页面确认授权，完成后会自动连接。</p><a href={flow.authorizeUrl} target="_blank" rel="noreferrer">打开官方授权页</a><label>没有自动连接时，粘贴官方页面的一次性连接码<input value={manualCode} onChange={e=>setManualCode(e.target.value)} autoComplete="off" /></label><button type="button" disabled={busy||!manualCode.trim()} onClick={()=>void exchange(manualCode.trim(),flow.state)}>完成连接</button></div>}
    {account && <section className="cloud-status"><h3>选择官方 Free Key</h3><p>在中转站创建或选择 openskoob-free 分组的有效 Key。这里只显示密钥尾号，验证后保存在本地；不会自动创建或替换你正在使用的模型。</p>
      <div className="cloud-connect-methods"><a href={keyUrl} target="_blank" rel="noreferrer">领取 Free Key / 创建密钥</a><button disabled={busy} onClick={() => void run(async () => { await loadKeys(); const result = await request("/access?refresh=1"); setFree(result); await onChanged(); })}>已领取，刷新密钥</button></div>
      <label>我的密钥<select aria-label="选择 Free Key" value={keyId} onChange={e => setKeyId(e.target.value)}><option value="">请选择一把有效 Free Key</option>{keys.map(k => <option key={k.id} value={k.id} disabled={!k.eligible}>{k.name || k.id} · …{k.last4} · {k.group || "未分组"}{!k.eligible ? "（非有效 Free Key）" : ""}</option>)}</select></label>
      {!keys.some(k => k.eligible) && <p>当前页没有有效 Free Key，请到中转站选择 openskoob-free 分组创建，然后回来刷新。</p>}
      <div className="cloud-connect-methods">{keyPage > 1 && <button disabled={busy} onClick={() => void run(() => loadKeys(keyPage - 1))}>上一页密钥</button>}{hasMore && <button disabled={busy} onClick={() => void run(() => loadKeys(keyPage + 1))}>下一页密钥</button>}<button disabled={busy || !keyId} onClick={() => void run(async () => { const result = await request("/keys/select", "POST", { keyId }); await onChanged(); await refresh(); setNotice(result.modelWarning || "Free Key 已验证，官方免费内容已解锁。模型由你在配置中选择。"); })}>验证并连接 Free Key</button></div>
      {free.ready ? <><p role="status">Free 已接入：{free.key?.name || free.key?.id}，官方脑洞、热点和模板已开放。</p><div className="cloud-connect-methods"><button onClick={onClose}>查看免费内容</button><a href="/settings/models">选择创作模型</a></div></> : <p>{free.message || "完成 Key 验证后才展示官方云端列表。"}</p>}
    </section>}
    <details><summary>已有官方 API Key 或登录 Token</summary><form onSubmit={e=>{e.preventDefault();void run(async()=>{await request("","PUT",{baseUrl:cloud.baseUrl,apiKey:key});setKey("");setFlow(null);setUploaded({});await onChanged();await refresh();setNotice("官方身份校验通过，请继续选择 Free Key。");})}}><label>官方访问凭证<input type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" placeholder="填写官方支持的平台访问凭证" required /></label><p className="local-help">普通模型 Key 不自动拥有引擎权限；必须通过官方校验。自有模型 Key 仍在模型配置中填写。</p><button type="submit" disabled={busy}>验证并连接</button></form></details>
    {cloud.configured&&<section className="cloud-status"><h3>{account?`已连接 · ${account.user?.username||cloud.username||cloud.userId}`:"凭证已保存，正在核验云端状态"}</h3>{account&&<><p>套餐：{account.membership?.plan||"暂无有效套餐"}{account.membership?.stale?"（权益暂时无法确认）":""}</p><p className="local-help">当前权益：{account.membership?.entitlements?.map(id=>entitlementNames[id]||"其他已开通权益").join("、")||"以官方各接口实时校验为准"}</p><nav className="cloud-engine-links"><a href="/deconstruction">天王拆书</a><a href="/scan">天魔热点</a><a href="/deai">天工检测</a><a href="/covers">天工封面</a><a href={`${cloud.baseUrl}/create`} target="_blank" rel="noreferrer">官方天衍仿真创作</a></nav><a href={account.relayUrl||"https://gaotk.com"} target="_blank" rel="noreferrer">到中转站管理套餐和用量</a></>}<button type="button" disabled={busy} onClick={()=>void run(async()=>{await request("","PUT",{baseUrl:cloud.baseUrl,apiKey:""});setAccount(null);setFlow(null);await onChanged();await refresh();setNotice("已断开官方账号，云端列表已关闭，本地作品保留。");})}>断开官方连接</button></section>}
    <section><h3>上传到我的云端</h3><p className="local-help">只上传你点击的这一份模板，先保存为自己的云端资产。公开分享需要另外提交审核。</p>{templates.length?templates.map(item=><div className="cloud-template-row" key={`${item.type}:${item.id}`}><span>{item.title}<small>{item.type==="agent"?"智能体模板":"技能"}</small></span><button disabled={busy||!account} onClick={()=>void run(async()=>{const result=await request(`/templates/${item.type}/${encodeURIComponent(item.id)}/upload`,"POST",{});setUploaded({...uploaded,[`${item.type}:${item.id}`]:result});setNotice(`已入库：${result.title}（资产 ${result.assetId}）`);if(free.ready){const list=await request(`/assets/${kind}`);setAssets(list.capabilities);}})}>上传到云端</button>{uploaded[`${item.type}:${item.id}`]&&<button disabled={busy||!account} onClick={()=>void run(async()=>{const asset=uploaded[`${item.type}:${item.id}`]!;const result=await request(`/assets/${encodeURIComponent(asset.assetId)}/publish`,"POST",{});setNotice(result.message||"已提交公开审核");})}>提交公开审核</button>}</div>):<p>还没有本地模板或技能，可先到「智能体」创建或导入。</p>}</section>
    {account&&free.ready&&<section><h3>云端能力库</h3><label>目录<select value={kind} onChange={e=>setKind(e.target.value as "agent"|"skill")}><option value="agent">智能体模板</option><option value="skill">技能</option></select></label>{assets.length?assets.map(asset=><div className="cloud-template-row" key={asset.assetId}><span>{asset.title}<small>{String(asset.creatorUserId)===cloud.userId?"我的云端资产":"平台可见资源"} · {asset.visibility==="private"?"私有":asset.visibility==="public"?"公开范围（以审核状态为准）":asset.visibility}</small></span></div>):<p>当前账号暂无可见的云端资源。</p>}<a href={`${cloud.baseUrl}/agents`} target="_blank" rel="noreferrer">在官方平台管理和使用云端模板</a></section>}
  </section></div>;
}
