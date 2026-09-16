/**
 * Composer —— 聊天输入框（编队 + 附件 + 斜杠菜单 + 模型 + 发送）。
 *
 * 结构对齐老前端 ChatPage 与主流 Agent 产品的惯例：
 *
 *   ┌──────────────────────────────────────────┐
 *   │ [编队 chips：专家 / 技能 / 流派模板]        │
 *   │ [附件 chips]                              │
 *   │ textarea（多行自增高，Enter 发送）          │
 *   ├──────────────────────────────────────────┤
 *   │ [/] [＋]                  模型 ▾   [发送]  │
 *   └──────────────────────────────────────────┘
 *          ↑ 菜单在这一行上方向上弹出
 *
 * 三处与旧版 SummonBar 的关键差别：
 *   1. 触发符**留在输入框里**。旧版检测到行首 `/` 就吞掉字符再开菜单，用户打了
 *      一个字却什么都没出现，手感是坏的。现在 `/` `@` 照常输入，后续字符实时
 *      过滤菜单，选中后再把这段 token 整体替换掉 —— 与主流 Agent 一致。
 *   2. 支持**句中触发**：`写一段 @` 也能唤出，不再要求输入框为空。
 *   3. 键盘可用：↑↓ 选择、Enter 确认、Esc 关闭。菜单开着时 Enter 不发送消息。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Paperclip, Send, Square, X, Wrench, Users, BookMarked,
  FileText, Image as ImageIcon, ChevronDown, Loader2,
} from "lucide-react";
import type { SkillInfo, GraphAgent, GenreInfo, AgentTemplateInfo, CapabilityRef } from "../lib/api";
import { ComposerSelector, type ComposerSelectorHandle } from "./ComposerSelector";
import { describePrompt, findSlashTrigger, isPromptRef, promptSelection, promptScopeLabel, PROMPT_BUSINESS_LABELS,
  samePromptSlot, searchPromptTemplates, usePromptLibrary } from "../lib/prompt-library";
import { agentTypeOf } from "../types/experts";
import type { Summoned, PendingFile } from "../types/composer";
import type { ModelChoice } from "../hooks/use-composer-data";

/** 菜单分类。技能与专家是主线，流派/模板是能力引用。 */
type MenuKind = "skill" | "agent" | "cap" | "prompt" | "style";

const MENU_TABS: ReadonlyArray<{ kind: MenuKind; label: string; icon: React.ReactNode; hint: string }> = [
  { kind: "skill", label: "技能", icon: <Wrench size={14} />, hint: "选中后本轮带上该技能（requestedSkills）" },
  { kind: "prompt", label: "模板", icon: <BookMarked size={14} />, hint: "手动选择优先于自动路由" },
  { kind: "style", label: "风格", icon: <BookMarked size={14} />, hint: "选择写作风格" },
  { kind: "agent", label: "召唤专家", icon: <Users size={14} />, hint: "把智能体档案带进本轮，写作以他们为准" },
  { kind: "cap", label: "流派 / 图谱模板", icon: <BookMarked size={14} />, hint: "把图谱内容注入本轮系统提示词" },
];

/** 一个可选条目（三类统一成同一形状，键盘导航才能一视同仁）。 */
interface Option {
  readonly key: string;
  readonly title: string;
  readonly sub?: string;
  readonly desc?: string;
  readonly tone?: string;
  readonly icon?: React.ReactNode;
  readonly apply: () => void;
}

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 5;
const DECONSTRUCT_MIN_BYTES = 50_000;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    fr.readAsDataURL(file);
  });
}

/**
 * 找光标前最近的触发 token。
 *
 * `/` 只在**行首**算命令（句中的斜杠通常是日期或路径，不该弹菜单）；
 * `@` 允许句中，前面是空白即可 —— 与老前端 `/(^|\s)@([\w-]*)$/` 同口径。
 */
export function findTrigger(text: string, caret: number): { kind: MenuKind; start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = /(?:^|\s)@([^\s@/]*)$/.exec(before);
  if (at) return { kind: "agent", start: caret - at[1]!.length - 1, query: at[1]! };
  const slash = findSlashTrigger(text, caret);
  if (slash) return { kind: "skill", ...slash };
  return null;
}

export function Composer({
  value, onChange: onText, onSend, onAbort, busy, disabled, placeholder,
  summoned, onSummonedChange, skills, agents, genres, templates,
  files, onFilesChange,
  model, models, selected, onModelChange, onManageModels, modelNotice,
  sendLabel, submitOn = "enter", banner, allowEmpty = false,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly onSend: () => void;
  readonly onAbort?: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly summoned: Summoned;
  readonly onSummonedChange: (s: Summoned) => void;
  readonly skills: ReadonlyArray<SkillInfo>;
  readonly agents: ReadonlyArray<GraphAgent>;
  readonly genres: ReadonlyArray<GenreInfo>;
  readonly templates: ReadonlyArray<AgentTemplateInfo>;
  readonly files: ReadonlyArray<PendingFile>;
  readonly onFilesChange: (f: ReadonlyArray<PendingFile>) => void;
  /** 当前选中的模型。传了 models 就是可切换下拉，只传 model 则是只读展示。 */
  readonly selected?: ModelChoice | null;
  readonly models?: ReadonlyArray<ModelChoice>;
  readonly onModelChange?: (m: ModelChoice) => void;
  /** 只读展示用（没有可选清单时的兜底，例如服务未配置）。 */
  readonly model?: string;
  readonly onManageModels?: () => void;
  /** 使用态模型选择失效回落默认时的提示（amber 一行，见 model-choice.ts）。 */
  readonly modelNotice?: string | null;
  /** 发送按钮文案。给了就显示文字（首页的「开始创作」），否则只显示图标。 */
  readonly sendLabel?: string;
  /**
   * 允许空输入就发送。
   *
   * 拆书要的输入不是文字——拆哪本书已经由选中的书决定了，再逼用户敲一句
   * 「请拆解这本书」只是走过场。
   */
  readonly allowEmpty?: boolean;
  /**
   * 发送快捷键。
   * `enter` —— 对话场景，一句一发（Shift+Enter 换行）。
   * `mod-enter` —— 首页那种「写一段完整描述」的场景，Enter 只换行，⌘/Ctrl+Enter 才发。
   */
  readonly submitOn?: "enter" | "mod-enter";
  /** 输入框顶部插槽（首页的「已选模板」提示条）。 */
  readonly banner?: React.ReactNode;
}) {
  const [menu, setMenu] = useState<MenuKind | null>(null);
  /** 触发 token 在文本里的起点；从 `/` `@` 唤起时有值，点按钮唤起时为 null。 */
  const [tokenStart, setTokenStart] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const selectorRef = useRef<ComposerSelectorHandle>(null);
  const [once, setOnce] = useState(false);
  const promptCatalog = usePromptLibrary(menu !== null);
  const [modelOpen, setModelOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendAfterUpload, setSendAfterUpload] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const requestSend = useCallback(() => {
    if (busy || disabled) return;
    if (uploading) { setSendAfterUpload(true); return; }
    if (allowEmpty || value.trim() || files.length) onSend();
  }, [busy, disabled, uploading, allowEmpty, value, files, onSend]);

  useEffect(() => {
    if (!sendAfterUpload || uploading) return;
    setSendAfterUpload(false);
    // The parent's files prop now includes the completed reads. A failed read
    // retains the draft instead of silently submitting only some attachments.
    if (!err) requestSend();
  }, [sendAfterUpload, uploading, err, requestSend]);

  /* ── textarea 自增高 ── */
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  /* ── 点外面关闭 ── */
  useEffect(() => {
    if (!menu && !modelOpen) return;
    const off = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) { setMenu(null); setModelOpen(false); }
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [menu, modelOpen]);

  const closeMenu = useCallback(() => { setMenu(null); setTokenStart(null); setQuery(""); setOnce(false); }, []);

  /** 选中条目后，把触发 token（`/out` `@沈`）从输入框抹掉。 */
  const consumeToken = useCallback(() => {
    if (tokenStart === null) return;
    const el = taRef.current;
    const caret = el?.selectionStart ?? value.length;
    onText(value.slice(0, tokenStart) + value.slice(caret));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(tokenStart, tokenStart);
    });
  }, [tokenStart, value, onText]);

  /* ── 三类条目统一成 Option[] ── */
  const kw = query.trim().toLowerCase();
  const options = useMemo<ReadonlyArray<Option>>(() => {
    const hit = (...fields: Array<string | undefined>) =>
      !kw || fields.some((f) => (f ?? "").toLowerCase().includes(kw));

    if (menu === "prompt" || menu === "style") {
      return searchPromptTemplates(promptCatalog.library, menu === "style" ? "style" : "template", query).map(template => ({
        key: template.id, title: template.name,
        sub: `${PROMPT_BUSINESS_LABELS[template.business]} · ${promptCatalog.library.steps[template.business]?.[template.step] ?? template.step}${template.isDefault ? " · 默认" : ""}`,
        desc: [template.description, ...template.tags].filter(Boolean).join(" · "),
        apply: () => {
          const next = promptSelection(template, once);
          onSummonedChange({ ...summoned, caps: [...summoned.caps.filter(cap => !isPromptRef(cap.ref) ||
            (cap.ref.id !== next.ref.id && !samePromptSlot(cap.prompt ?? describePrompt(cap.ref, promptCatalog.library), next))),
            { ref: next.ref, label: next.label, prompt: { business: template.business, step: template.step } }] });
        },
      }));
    }
    if (menu === "skill") {
      return skills
        .filter((s) => !summoned.skills.some((x) => x.id === s.id) && hit(s.name, s.id, s.description))
        .map((s) => ({
          key: s.id, title: s.name, sub: s.id, desc: s.whenToUse || s.description,
          icon: <Wrench size={12} />,
          apply: () => onSummonedChange({ ...summoned, skills: [...summoned.skills, s] }),
        }));
    }
    if (menu === "agent") {
      return agents
        .filter((a) => !summoned.agents.some((x) => x.name === a.name) && hit(a.name, a.bio, a.persona))
        .map((a) => {
          const t = agentTypeOf(a.agentType || a.tier);
          return {
            key: `${a.graphId}-${a.name}`, title: a.name, sub: t.label,
            desc: a.bio || a.persona, tone: t.tone, icon: <span>{t.emoji}</span>,
            apply: () => onSummonedChange({ ...summoned, agents: [...summoned.agents, a] }),
          };
        });
    }
    if (menu === "cap") {
      const items = [
        ...genres.map((g) => ({ ref: { kind: "genre" as const, id: g.id }, label: g.name, sub: "流派" })),
        ...templates.map((t) => ({
          ref: { kind: "template" as const, id: t.id },
          label: t.zhName || t.name, sub: t.domain ? `模板 · ${t.domain}` : "模板",
        })),
      ];
      return items
        .filter((i) => !summoned.caps.some((c) => c.ref.kind === i.ref.kind && c.ref.id === i.ref.id) && hit(i.label, i.ref.id))
        .map((i) => ({
          key: `${i.ref.kind}-${i.ref.id}`, title: i.label, sub: i.sub, desc: i.ref.id,
          icon: <BookMarked size={12} />,
          apply: () => onSummonedChange({ ...summoned, caps: [...summoned.caps, { ref: i.ref as CapabilityRef, label: i.label }] }),
        }));
    }
    return [];
  }, [menu, kw, skills, agents, genres, templates, summoned, onSummonedChange, promptCatalog.library, query, once]);

  const pick = useCallback((opt: Option) => {
    opt.apply();
    consumeToken();
    closeMenu();
  }, [consumeToken, closeMenu]);

  /* ── 输入：实时识别触发符 ── */
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    onText(next);
    const t = findTrigger(next, e.target.selectionStart ?? next.length);
    if (t) {
      setMenu(previous => t.kind === "skill" && (previous === "prompt" || previous === "style") ? previous : t.kind);
      setTokenStart(t.start);
      setQuery(t.query);
    } else if (tokenStart !== null) {
      closeMenu();   // token 被删掉/离开了，菜单跟着收
    }
  }, [onText, tokenStart, closeMenu]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (menu && selectorRef.current?.handleKeyDown(e)) return;
    if (e.key !== "Enter") return;
    const mod = e.metaKey || e.ctrlKey;
    // mod-enter 模式下裸 Enter 换行，不发送——首页要写一整段描述。
    const shouldSend = submitOn === "mod-enter" ? mod : (!e.shiftKey && !mod);
    if (shouldSend) { e.preventDefault(); requestSend(); }
  }, [menu, requestSend, submitOn]);

  /* ── 附件 ── */
  const pickFiles = useCallback(async (list: FileList | null) => {
    if (!list?.length) return;
    setErr(null);
    const room = MAX_FILES - files.length;
    if (room <= 0) { setErr(`一条消息最多 ${MAX_FILES} 个附件`); return; }
    setUploading(true);
    try {
      const next: PendingFile[] = [];
      for (const file of Array.from(list).slice(0, room)) {
        if (file.size > MAX_BYTES) { setErr(`${file.name} 超过 ${MAX_BYTES / 1024 / 1024}MB`); continue; }
        const dataUrl = await readAsDataUrl(file);
        const mediaType = file.type || "application/octet-stream";
        next.push({
          id: `${Date.now()}-${next.length}-${file.name}`,
          filename: file.name, mediaType, dataUrl, size: file.size,
          deconstructable: !mediaType.startsWith("image/") && file.size >= DECONSTRUCT_MIN_BYTES,
        });
      }
      if (next.length) onFilesChange([...files, ...next]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "读取文件失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [files, onFilesChange]);

  /** 按服务分组，菜单里带小标题——同名模型在不同中转站是两回事。 */
  const modelGroups = useMemo(() => {
    const by = new Map<string, ModelChoice[]>();
    for (const m of models ?? []) {
      const arr = by.get(m.service);
      if (arr) arr.push(m); else by.set(m.service, [m]);
    }
    return [...by.entries()];
  }, [models]);

  const teamCount = summoned.skills.length + summoned.agents.length + summoned.caps.length;
  const hasSource = files.some((f) => f.deconstructable);

  return (
    <div className="cp" ref={rootRef}>
      {/* ── 召唤菜单（在输入框上方向上弹） ── */}
      {menu && <ComposerSelector ref={selectorRef} tabs={MENU_TABS} tab={menu}
        onTab={tab => { setMenu(tab as MenuKind); if (tokenStart !== null) taRef.current?.focus(); }}
        query={query} onQuery={setQuery} typed={tokenStart !== null} options={options} onPick={pick} onClose={closeMenu}
        promptScope={menu === "prompt" || menu === "style" ? { once, onChange: setOnce } : undefined}
        loading={(menu === "prompt" || menu === "style") && promptCatalog.loading}
        error={menu === "prompt" || menu === "style" ? promptCatalog.error : null}
        empty={menu === "agent" && agents.length === 0 ? "这本书还没有智能体 —— 世界观确认后才会生成" : undefined} />}

      <div className="cp-box">
        {banner}
        {/* ── 编队 chips ── */}
        {teamCount > 0 && (
          <div className="cp-team">
            {summoned.agents.map((a) => {
              const t = agentTypeOf(a.agentType || a.tier);
              return (
                <span key={`a-${a.name}`} className={`cp-chip is-${t.tone}`}>
                  <span>{t.emoji}</span><span className="cp-chip-n">{a.name}</span>
                  <button onClick={() => onSummonedChange({ ...summoned, agents: summoned.agents.filter((x) => x.name !== a.name) })}
                    aria-label={`移出 ${a.name}`}><X size={11} /></button>
                </span>
              );
            })}
            {summoned.skills.map((s) => (
              <span key={`s-${s.id}`} className="cp-chip is-skill">
                <Wrench size={10} /><span className="cp-chip-n">{s.name}</span>
                <button onClick={() => onSummonedChange({ ...summoned, skills: summoned.skills.filter((x) => x.id !== s.id) })}
                  aria-label={`移出 ${s.name}`}><X size={11} /></button>
              </span>
            ))}
            {summoned.caps.map((c) => (
              <span key={`c-${c.ref.kind}-${c.ref.id}`} className="cp-chip is-cap">
                <BookMarked size={10} /><span className="cp-chip-n">{c.label}</span>{isPromptRef(c.ref) && <small>{promptScopeLabel(c.ref)}</small>}
                <button onClick={() => onSummonedChange({ ...summoned, caps: summoned.caps.filter((x) => !(x.ref.kind === c.ref.kind && x.ref.id === c.ref.id)) })}
                  aria-label={`移出 ${c.label}`}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}

        {/* ── 附件 chips ── */}
        {files.length > 0 && (
          <div className="cp-files">
            {files.map((f) => (
              <span key={f.id} className={`cp-chip is-file${f.deconstructable ? " is-src" : ""}`}>
                {f.mediaType.startsWith("image/") ? <ImageIcon size={11} /> : <FileText size={11} />}
                <span className="cp-chip-n">{f.filename}</span>
                <button onClick={() => onFilesChange(files.filter((x) => x.id !== f.id))}
                  aria-label={`移除 ${f.filename}`}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={taRef} rows={1} value={value}
          onChange={handleChange} onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "描述你想写的故事…（/ 选技能、模板或风格，@ 召唤专家）"}
          disabled={disabled}
          className="cp-input"
        />

        {/* ── 使用态模型回落提示（一行，出现/消失只在换模型时发生） ── */}
        {modelNotice && <div className="cp-mnotice">{modelNotice}</div>}

        {/* ── footer：左 [＋技能] [附件]，右 模型 ▾ + 发送 ── */}
        <div className="cp-foot">
          <button
            className={`cp-btn${menu ? " is-on" : ""}`} disabled={disabled}
            title="添加技能、模板、风格或召唤专家（/）" aria-label="添加技能或召唤专家"
            onClick={() => { setMenu(menu ? null : "skill"); setTokenStart(null); setQuery(""); }}
          >
            <Plus size={15} />
          </button>
          <button
            className="cp-btn" disabled={disabled || uploading}
            title="添加文件或图片" aria-label="添加文件或图片"
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 size={15} className="cp-spin" /> : <Paperclip size={15} />}
          </button>
          <input ref={fileRef} type="file" multiple hidden
            accept=".txt,.md,.markdown,.json,.csv,image/*"
            onChange={(e) => void pickFiles(e.target.files)} />

          <span className="cp-gap" />

          {models && models.length > 0 ? (
            <div className="cp-model-wrap">
              <button
                className="cp-model" onClick={() => setModelOpen((v) => !v)}
                title={selected ? `${selected.serviceLabel} · ${selected.name}` : "选择模型"}
              >
                <span>{selected?.name ?? model ?? "选择模型"}</span><ChevronDown size={13} />
              </button>
              {modelOpen && (
                <div className="cp-model-menu">
                  {modelGroups.map(([svc, list]) => (
                    <div key={svc} className="cp-model-grp">
                      <div className="cp-model-grp-h">{list[0]!.serviceLabel}</div>
                      {list.map((m) => (
                        <button
                          key={`${m.service}:${m.id}`}
                          className={m.id === selected?.id && m.service === selected?.service ? "is-on" : ""}
                          onClick={() => { onModelChange?.(m); setModelOpen(false); }}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  ))}
                  {onManageModels && (
                    <button className="cp-model-manage" onClick={onManageModels}>模型配置 →</button>
                  )}
                </div>
              )}
            </div>
          ) : model ? (
            <span className="cp-model is-static" title={model}>{model}</span>
          ) : onManageModels ? (
            <button className="cp-model is-link" onClick={onManageModels}>配置模型 →</button>
          ) : null}

          {submitOn === "mod-enter" && (
            <span className="cp-kbd">⌘/Ctrl + Enter 发送</span>
          )}
          {busy ? (
            <button className="cp-send is-stop" onClick={onAbort} disabled={!onAbort} title={onAbort ? "停止生成" : "正在处理"}>
              {onAbort ? <Square size={14} /> : <Loader2 size={14} className="cp-spin" />}
            </button>
          ) : (
            <button
              className={`cp-send${sendLabel ? " has-label" : ""}`}
              onClick={requestSend} disabled={disabled || (!allowEmpty && !value.trim() && !files.length && !uploading)}
              title={sendLabel ?? "发送"}
            >
              {sendLabel && <span>{sendLabel}</span>}
              <Send size={15} />
            </button>
          )}
        </div>
      </div>

      {hasSource && (
        <div className="cp-hint">
          检测到长文本，可以说「拆这本书」让天王拆成世界观 / 大纲 / 角色资产并生成二创 Skill。
        </div>
      )}
      {err && <div className="cp-err">{err}</div>}
    </div>
  );
}
