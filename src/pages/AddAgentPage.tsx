/**
 * AddAgentPage —— 新增智能体
 *
 * 用户可以自定义创建智能体，包括：
 * 1. 基础信息（名称、类型、层级）
 * 2. 画像（简介、性格、外貌、背景）
 * 3. 能力与目标
 * 4. 关系与冲突
 */

import { useState, useCallback, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { useI18n } from "../i18n";
import {
  createAgentTemplate, updateAgentTemplate, fetchAgentTemplates, type AgentTemplatePayload,
} from "../lib/api";

type AgentTier = "major" | "minor" | "supporting" | "cameo";
type AgentType = "protagonist" | "antagonist" | "mentor" | "ally" | "neutral" | "npc";

const TIER_OPTIONS: ReadonlyArray<{ value: AgentTier; labelKey: string }> = [
  { value: "major", labelKey: "agent.tier.major" },
  { value: "minor", labelKey: "agent.tier.minor" },
  { value: "supporting", labelKey: "agent.tier.supporting" },
  { value: "cameo", labelKey: "agent.tier.cameo" },
];

const TYPE_OPTIONS: ReadonlyArray<{ value: AgentType; labelKey: string }> = [
  { value: "protagonist", labelKey: "agent.type.protagonist" },
  { value: "antagonist", labelKey: "agent.type.antagonist" },
  { value: "mentor", labelKey: "agent.type.mentor" },
  { value: "ally", labelKey: "agent.type.ally" },
  { value: "neutral", labelKey: "agent.type.neutral" },
  { value: "npc", labelKey: "agent.type.npc" },
];

interface AgentForm {
  name: string;
  tier: AgentTier;
  agentType: AgentType;
  bio: string;
  persona: string;
  appearance: string;
  background: string;
  goal: string;
  conflict: string;
  abilities: string;
  relationships: string;
}

const emptyForm: AgentForm = {
  name: "",
  tier: "minor",
  agentType: "npc",
  bio: "",
  persona: "",
  appearance: "",
  background: "",
  goal: "",
  conflict: "",
  abilities: "",
  relationships: "",
};

export function AddAgentPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  // 编辑模式：/agents/new?id=<templateId> —— 带了 id 就是改自己创建的那份
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("id");
  const [form, setForm] = useState<AgentForm>(emptyForm);
  const [loaded, setLoaded] = useState(!editId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = useCallback(<K extends keyof AgentForm>(key: K, value: AgentForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  /* 编辑模式：拉回原模板，把字段灌进表单（画像正文从 content 的分节解析回来）。 */
  useEffect(() => {
    if (!editId) return;
    let live = true;
    void (async () => {
      try {
        const list = await fetchAgentTemplates();
        const t = list.find((x) => x.id === editId);
        if (!t) throw new Error("没有找到这份自建智能体（可能已删除或不是你创建的）。");
        const sections = parseTemplateContent(t.name, t.content ?? "");
        if (live) {
          setForm({
            ...emptyForm,
            name: t.name,
            agentType: (sections.type as AgentForm["agentType"]) in TYPE_MAP ? (sections.type as AgentForm["agentType"]) : "npc",
            tier: (sections.tier as AgentForm["tier"]) in TIER_SET ? (sections.tier as AgentForm["tier"]) : "minor",
            bio: sections.bio, persona: sections.persona, appearance: sections.appearance,
            background: sections.background, goal: sections.goal, conflict: sections.conflict,
            abilities: sections.abilities, relationships: sections.relationships,
          });
          setLoaded(true);
        }
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          setLoaded(true);   // 拉不到原档案也放行表单：报错给用户看，别卡死在加载态
        }
      }
    })();
    return () => { live = false; };
  }, [editId]);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      setError(t("agent.name_required"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // 智能体模板的真实存储：图谱 upsert + asset 归属登记（创建者本人可改删）。
      const payload: AgentTemplatePayload = {
        id: editId ?? slugifyTemplateId(form.name),
        name: form.name.trim(),
        zhName: form.name.trim(),
        domain: "concept",
        form: "entity",
        keywords: [TYPE_MAP[form.agentType] ?? form.agentType, form.tier].filter(Boolean),
        content: buildTemplateContent(form),
      };
      if (editId) await updateAgentTemplate(editId, payload);
      else await createAgentTemplate(payload);
      navigate("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }, [editId, form, navigate, t]);

  return (
    <div className="page">
      <header className="page-top">
        <button className="page-back" onClick={() => navigate("/agents")}>
          <ArrowLeft size={16} />
          {t("common.back")}
        </button>
        <h1 className="page-title">{editId ? "编辑自建智能体" : t("agents.add_agent_title")}</h1>
      </header>

      <div className="page-body">
        {!loaded && (
          <div className="page-error"><Loader2 size={14} className="spin" /> 正在读取原档案…</div>
        )}
        {loaded && error && <div className="page-error">{error}</div>}

        <div className="agent-form">
          {/* 基础信息 */}
          <section className="form-section">
            <h3>{t("agent.basic_info")}</h3>
            <div className="form-grid">
              <div className="form-group">
                <label>{t("common.name")} *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder={t("agent.name_placeholder")}
                />
              </div>
              <div className="form-group">
                <label>{t("agent.tier_label")}</label>
                <select
                  value={form.tier}
                  onChange={(e) => updateField("tier", e.target.value as AgentTier)}
                >
                  {TIER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t("agent.type_label")}</label>
                <select
                  value={form.agentType}
                  onChange={(e) => updateField("agentType", e.target.value as AgentType)}
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* 画像 */}
          <section className="form-section">
            <h3>{t("agent.profile")}</h3>
            <div className="form-grid">
              <div className="form-group form-group-full">
                <label>{t("common.description")}</label>
                <textarea
                  value={form.bio}
                  onChange={(e) => updateField("bio", e.target.value)}
                  placeholder={t("agent.bio_placeholder")}
                  rows={3}
                />
              </div>
              <div className="form-group form-group-full">
                <label>{t("agent.persona")}</label>
                <textarea
                  value={form.persona}
                  onChange={(e) => updateField("persona", e.target.value)}
                  placeholder={t("agent.persona_placeholder")}
                  rows={3}
                />
              </div>
              <div className="form-group form-group-full">
                <label>{t("agent.appearance")}</label>
                <textarea
                  value={form.appearance}
                  onChange={(e) => updateField("appearance", e.target.value)}
                  placeholder={t("agent.appearance_placeholder")}
                  rows={2}
                />
              </div>
              <div className="form-group form-group-full">
                <label>{t("agent.background")}</label>
                <textarea
                  value={form.background}
                  onChange={(e) => updateField("background", e.target.value)}
                  placeholder={t("agent.background_placeholder")}
                  rows={3}
                />
              </div>
            </div>
          </section>

          {/* 能力与目标 */}
          <section className="form-section">
            <h3>{t("agent.abilities_and_goals")}</h3>
            <div className="form-grid">
              <div className="form-group form-group-full">
                <label>{t("agent.goal")}</label>
                <textarea
                  value={form.goal}
                  onChange={(e) => updateField("goal", e.target.value)}
                  placeholder={t("agent.goal_placeholder")}
                  rows={2}
                />
              </div>
              <div className="form-group form-group-full">
                <label>{t("agent.conflict")}</label>
                <textarea
                  value={form.conflict}
                  onChange={(e) => updateField("conflict", e.target.value)}
                  placeholder={t("agent.conflict_placeholder")}
                  rows={2}
                />
              </div>
              <div className="form-group form-group-full">
                <label>{t("agent.abilities")}</label>
                <textarea
                  value={form.abilities}
                  onChange={(e) => updateField("abilities", e.target.value)}
                  placeholder={t("agent.abilities_placeholder")}
                  rows={2}
                />
              </div>
            </div>
          </section>

          {/* 关系 */}
          <section className="form-section">
            <h3>{t("agent.relationships")}</h3>
            <div className="form-grid">
              <div className="form-group form-group-full">
                <label>{t("agent.relationships_desc")}</label>
                <textarea
                  value={form.relationships}
                  onChange={(e) => updateField("relationships", e.target.value)}
                  placeholder={t("agent.relationships_placeholder")}
                  rows={3}
                />
              </div>
            </div>
          </section>
        </div>

        <div className="form-actions">
          <button className="st-btn" onClick={() => navigate("/agents")}>
            {t("common.cancel")}
          </button>
          <button className="st-btn st-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 模板载荷的组装与解析 ──
 * 表单的 11 个字段不能一一直射模板 schema（那只有 name/keywords/content），
 * 画像类字段统一折进 content 的分节 Markdown；编辑时再解析回来。 */

const TYPE_MAP: Readonly<Record<AgentType, string>> = {
  protagonist: "主角", antagonist: "反派", mentor: "导师",
  ally: "盟友", neutral: "中立", npc: "路人",
};
const TIER_SET = new Set<string>(["major", "minor", "supporting", "cameo"]);

function slugifyTemplateId(name: string): string {
  const base = name.trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return `agent-${base || Date.now().toString(36)}`;
}

function buildTemplateContent(form: AgentForm): string {
  const section = (title: string, text: string): string =>
    text.trim() ? `## ${title}\n${text.trim()}\n` : "";
  return [
    `类型：${TYPE_MAP[form.agentType] ?? form.agentType} · 层级：${form.tier}`,
    "",
    section("简介", form.bio),
    section("性格", form.persona),
    section("外貌", form.appearance),
    section("背景", form.background),
    section("目标", form.goal),
    section("冲突", form.conflict),
    section("能力", form.abilities),
    section("关系", form.relationships),
  ].join("\n");
}

/** content 分节 → 表单字段（解析不出的节原样落进 bio，信息不丢）。 */
function parseTemplateContent(name: string, content: string): {
  type?: string; tier?: string;
  bio: string; persona: string; appearance: string; background: string;
  goal: string; conflict: string; abilities: string; relationships: string;
} {
  const out = {
    type: undefined as string | undefined, tier: undefined as string | undefined,
    bio: "", persona: "", appearance: "", background: "",
    goal: "", conflict: "", abilities: "", relationships: "",
  };
  const head = content.match(/^\s*类型：(.+)$/m);
  if (head) {
    const [typeCn, tierCn] = head[1].split("·").map((s) => s.trim());
    const byLabel = (label: string): string | undefined =>
      (Object.entries(TYPE_MAP) as ReadonlyArray<[AgentType, string]>).find(([, cn]) => cn === label)?.[0];
    if (typeCn) out.type = byLabel(typeCn);
    if (tierCn) {
      const byTier: Record<string, string> = { major: "major", minor: "minor", supporting: "supporting", cameo: "cameo" };
      out.tier = byTier[tierCn.replace(/^层级：/u, "")];
    }
  }
  const sections = content.split(/^## /mu);
  const byTitle: Record<string, string> = {};
  for (const s of sections) {
    const nl = s.indexOf("\n");
    if (nl === -1) continue;
    byTitle[s.slice(0, nl).trim()] = s.slice(nl + 1).trim();
  }
  out.bio = byTitle["简介"] ?? "";
  out.persona = byTitle["性格"] ?? "";
  out.appearance = byTitle["外貌"] ?? "";
  out.background = byTitle["背景"] ?? "";
  out.goal = byTitle["目标"] ?? "";
  out.conflict = byTitle["冲突"] ?? "";
  out.abilities = byTitle["能力"] ?? "";
  out.relationships = byTitle["关系"] ?? "";
  void name;
  return out;
}
