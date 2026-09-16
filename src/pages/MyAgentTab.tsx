import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { fetchJson, type UserAgentCard } from "../lib/api";
import "../styles/platform-settings.css";

export function MyAgentTab() {
  const [draft, setDraft] = useState<UserAgentCard | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void fetchJson<{ agent: UserAgentCard }>("/user-agent").then(({ agent }) => { if (active) setDraft(agent); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "读取智能体失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const change = (patch: Partial<UserAgentCard>) => { setDraft(previous => previous ? { ...previous, ...patch } : previous); setNotice(""); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!draft) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const { name, username, bio, persona, style, plotParticipation, enabled } = draft;
      const response = await fetchJson<{ agent: UserAgentCard }>("/user-agent", { method: "PUT", body: JSON.stringify({ name, username, bio, persona, style, plotParticipation, enabled }) });
      setDraft(response.agent); setNotice("你的智能体已保存，下次参与创作时生效。");
      window.dispatchEvent(new Event("skoob:user-agent-saved"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  };
  if (loading) return <p className="tadm-loading" role="status">正在读取你的智能体…</p>;
  if (!draft) return <p className="tadm-error" role="alert">{error || "智能体暂时无法读取，请刷新重试。"}</p>;
  return <form className="platform-settings personal-agent" onSubmit={event => void save(event)}>
    <header className="tadm-heading"><div><span className="tadm-kicker">专属创作化身 / MY AGENT</span><h1>我的智能体</h1><p>每个账号都有一个专属创作化身。给它名字与性格，让它代表你的想法参与故事。</p></div><span className="tadm-badge">账号基础权益</span></header>
    <div className="personal-agent-preview"><span className="personal-agent-initial" aria-hidden="true">{draft.name.slice(0, 1)}</span><div><h3>{draft.name} <small>@{draft.username}</small></h3><p>{draft.bio}</p></div></div>
    {error && <p className="tadm-error" role="alert">{error}</p>}{notice && <p className="tadm-notice" role="status">{notice}</p>}
    <fieldset className="tadm-editor" disabled={saving}><legend>身份与性格</legend><div className="tadm-fields">
      <label className="tadm-field"><span>名字</span><input required maxLength={40} value={draft.name} onChange={event => change({ name: event.target.value })} /></label>
      <label className="tadm-field"><span>称呼句柄</span><input required maxLength={40} pattern="[a-zA-Z0-9-]+" value={draft.username} onChange={event => change({ username: event.target.value })} /><small className="tadm-field-hint">字母、数字或连字符，用于 @ 召唤。</small></label>
    </div>
    <label className="tadm-field"><span>一句话简介</span><textarea required rows={2} maxLength={300} value={draft.bio} onChange={event => change({ bio: event.target.value })} /></label>
    <label className="tadm-field"><span>性格与说话方式</span><textarea required rows={5} maxLength={2000} value={draft.persona} onChange={event => change({ persona: event.target.value })} /><small className="tadm-field-hint">例如：好奇但不冒进，说话简洁，喜欢从反派的角度提出问题。</small></label>
    <label className="tadm-field"><span>剧情引导风格</span><textarea required rows={3} maxLength={500} value={draft.style} onChange={event => change({ style: event.target.value })} /></label>
    <label className="tadm-field"><span>仿真参与程度 · {draft.plotParticipation}%</span><input type="range" min={0} max={100} value={draft.plotParticipation} onChange={event => change({ plotParticipation: Number(event.target.value) })} /><small className="tadm-field-hint">数值越高，参与故事推演的程度越深。</small></label>
    <label className="tadm-check"><input type="checkbox" checked={draft.enabled} onChange={event => change({ enabled: event.target.checked })} />在支持的创作与仿真中启用我的化身</label>
    </fieldset><div className="tadm-footer"><small>仅修改你自己的化身。官方助手的人设由平台管理。</small><button className="tadm-save" disabled={saving}><Save size={14} />{saving ? "保存中…" : "保存我的智能体"}</button></div>
  </form>;
}
