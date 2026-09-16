/**
 * SkillFormModal —— 技能新建/编辑弹层（智能体页技能区共用）。
 *
 * 表单字段与后端 POST/PUT /skills 的载荷一一对应：name/whenToUse/description/
 * triggers/body。编辑时 id 只读（改 id 等于另建一份）。
 * 「导入 .md」：解析 SKILL.md 的 frontmatter（name/description/whenToUse/triggers）
 * 与正文，灌进表单——上传文件只是省一次复制粘贴，不另走路由。
 */

import { useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { createSkill, updateSkill, type SkillInfo } from "../lib/api";

export interface SkillFormValues {
  readonly id: string;
  readonly name: string;
  readonly whenToUse: string;
  readonly description: string;
  readonly triggers: string;      // 逗号分隔，表单态
  readonly body: string;
}

const EMPTY: SkillFormValues = { id: "", name: "", whenToUse: "", description: "", triggers: "", body: "" };

/** 从 SkillInfo（编辑入口）转表单初值。 */
export function skillToForm(s: SkillInfo): SkillFormValues {
  return {
    id: s.id, name: s.name, whenToUse: s.whenToUse ?? "",
    description: s.description ?? "", triggers: (s.triggers ?? []).join(", "),
    body: s.body ?? "",
  };
}

/** 由名称生成 slug id（后端只认字母/数字/连字符；中文名回退时间戳 id）。 */
export function slugifySkillId(name: string): string {
  const base = name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return base || `skill-${Date.now().toString(36)}`;
}

/**
 * 解析 SKILL.md：frontmatter 的 name/description/whenToUse/triggers + 正文。
 * 只认 `---` 包裹的平铺键值（与后端 serializeProjectSkill 的产出一致）。
 */
export function parseSkillMarkdown(raw: string): Partial<SkillFormValues> {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { body: raw };
  const [, fm, body] = m;
  const pick = (key: string): string => {
    const line = fm.split("\n").find((l) => l.startsWith(`${key}:`));
    if (!line) return "";
    try { return JSON.parse(line.slice(key.length + 1).trim()); } catch { return line.slice(key.length + 1).trim(); }
  };
  let triggers = pick("triggers");
  if (triggers.startsWith("[")) {
    try { triggers = (JSON.parse(triggers) as string[]).join(", "); } catch { /* 原样 */ }
  }
  return {
    name: pick("name"), description: pick("description"),
    whenToUse: pick("whenToUse"), triggers, body: body.trim(),
  };
}

export function SkillFormModal({ initial, onClose, onSaved }: {
  /** 传了就是编辑（id 只读）；不传是新建。 */
  readonly initial?: SkillFormValues;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const editing = Boolean(initial?.id);
  const [v, setV] = useState<SkillFormValues>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<SkillFormValues>) => setV((prev) => ({ ...prev, ...patch }));

  const importMd = async (file: File) => {
    const parsed = parseSkillMarkdown(await file.text());
    set({
      ...parsed,
      id: v.id || (parsed.name ? slugifySkillId(parsed.name) : ""),
      name: v.name || parsed.name || "",
    });
  };

  const save = async () => {
    if (!v.name.trim()) { setError("名称必填。"); return; }
    if (!v.body.trim()) { setError("正文（SKILL.md 内容）必填。"); return; }
    const id = (editing ? v.id : (v.id.trim() || slugifySkillId(v.name))).trim();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        id,
        name: v.name.trim(),
        description: v.description.trim() || undefined,
        whenToUse: v.whenToUse.trim() || undefined,
        triggers: v.triggers.split(/[,，]/u).map((t) => t.trim()).filter(Boolean),
        body: v.body,
      };
      if (editing) await updateSkill(id, payload);
      else await createSkill(payload);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wb2-modal" onClick={onClose}>
      <div className="wb2-modal-box sfm-box" onClick={(e) => e.stopPropagation()}>
        <button className="wb2-modal-x" onClick={onClose}><X size={16} /></button>
        <h2 className="wb2-h2">{editing ? `编辑技能 · ${initial?.name || v.id}` : "新建技能"}</h2>
        <p className="wb2-lead">保存后默认自己可用；在市场里把它发布出去，别人就能安装（计数会展示安装人数）。</p>

        <div className="sfm-form">
          <label className="sfm-row">
            <span>名称 *</span>
            <input value={v.name} onChange={(e) => set({ name: e.target.value })}
              placeholder="如：武侠打斗写法" />
          </label>
          <label className="sfm-row">
            <span>ID</span>
            <input value={v.id} onChange={(e) => set({ id: e.target.value })} disabled={editing}
              placeholder={v.name ? slugifySkillId(v.name) : "留空按名称生成"} />
          </label>
          <label className="sfm-row">
            <span>何时使用</span>
            <input value={v.whenToUse} onChange={(e) => set({ whenToUse: e.target.value })}
              placeholder="什么场景该用它，一句话" />
          </label>
          <label className="sfm-row">
            <span>简介</span>
            <input value={v.description} onChange={(e) => set({ description: e.target.value })}
              placeholder="技能卡上展示的一句话" />
          </label>
          <label className="sfm-row">
            <span>触发词</span>
            <input value={v.triggers} onChange={(e) => set({ triggers: e.target.value })}
              placeholder="逗号分隔，如：打斗, 武侠, 招式" />
          </label>
          <label className="sfm-row">
            <span>正文 *</span>
            <textarea value={v.body} onChange={(e) => set({ body: e.target.value })} rows={12}
              placeholder="SKILL.md 的 Markdown 正文：写法规范、示例、禁忌…" />
          </label>
          <div className="sfm-actions">
            <input ref={fileRef} type="file" accept=".md,.markdown,text/markdown" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importMd(f); e.target.value = ""; }} />
            <button className="dc-btn" onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> 导入 .md 文件
            </button>
            <span className="sfm-hint">导入会解析 frontmatter 与正文，填进上面的表单</span>
          </div>
          {error && <div className="sfm-error">{error}</div>}
        </div>

        <div className="sfm-foot">
          <button className="dc-btn is-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 size={13} className="spin" /> : null}
            {saving ? "保存中…" : editing ? "保存修改" : "创建技能"}
          </button>
        </div>
      </div>
    </div>
  );
}
