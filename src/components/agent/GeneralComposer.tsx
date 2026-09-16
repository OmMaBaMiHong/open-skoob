import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentMessageInput, GeneralSkillSummary, PublicEvent } from "../../lib/general-agent-contracts";
import { ArrowUp, Paperclip, Plus, X } from "lucide-react";
import { useGeneralDraft } from "../../hooks/use-general-draft";
import { useComposerData } from "../../hooks/use-composer-data";
import { ComposerSelector, type ComposerOption, type ComposerSelectorHandle } from "../ComposerSelector";
import { describePrompt, findSlashTrigger, isPromptRef, mergePromptRefs, promptScopeLabel, promptSelection, PROMPT_BUSINESS_LABELS,
  searchPromptTemplates, selectPrompt, usePromptLibrary } from "../../lib/prompt-library";
import { fetchGeneralSkills } from "../../lib/general-agent-api";
import { readAuth } from "../../lib/auth-storage";
import type { GeneralAgentDraft } from "../../lib/general-agent-draft";
import "../../styles/general-agent.css";

type MenuKind = "skill" | "template" | "style";
const MENU_TABS = [{ kind: "skill", label: "技能" }, { kind: "template", label: "模板" }, { kind: "style", label: "风格" }];

type Question = Extract<PublicEvent, { type: "question" }>["payload"] & { runId: string };
export function GeneralComposer({ sessionId = null, suggestion, strategy = "fast", capabilityRefs = [], resourceLabels = {}, banner, question, onSent, onRequireLogin, onReady, initialSelection, placeholder, officialPersonaId }: {
  officialPersonaId?: string;
  placeholder?: string;
  sessionId?: string | null; suggestion?: string; strategy?: AgentMessageInput["creationStrategy"]; capabilityRefs?: AgentMessageInput["capabilityRefs"];
  banner?: ReactNode; question?: Question; onSent: (sessionId: string) => void; onRequireLogin?: () => void; onReady?: (draft: GeneralAgentDraft | null) => void;
  resourceLabels?: Record<string, string>;
  initialSelection?: AgentMessageInput;
}) {
  const { draft, state } = useGeneralDraft(sessionId);
  const data = useComposerData({ preserveExplicitModel: true });
  const picker = useRef<HTMLInputElement>(null), replacement = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null), [skills, setSkills] = useState<GeneralSkillSummary[]>([]), [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedVersions, setSelectedVersions] = useState<Record<string, number>>({});
  const restored = useRef<GeneralAgentDraft | null>(null);
  const root = useRef<HTMLElement>(null), textarea = useRef<HTMLTextAreaElement>(null), selector = useRef<ComposerSelectorHandle>(null);
  const [menu, setMenu] = useState<MenuKind | null>(null), [query, setQuery] = useState("");
  const [token, setToken] = useState<{ start: number; end: number } | null>(null), [once, setOnce] = useState(false);
  const catalog = usePromptLibrary(menu !== null);
  const closeMenu = () => { setMenu(null); setToken(null); setQuery(""); setOnce(false); };
  useEffect(() => {
    const controller = new AbortController(); setSkills([]); setSelectedSkills([]); setSelectedVersions({}); closeMenu();
    if (readAuth()) void fetchGeneralSkills(controller.signal).then(setSkills).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "技能目录读取失败"); });
    return () => controller.abort();
  }, [draft]);
  useEffect(() => {
    if (restored.current === draft || !initialSelection) return;
    restored.current = draft;
    data.selectModel({ id: initialSelection.model.model, service: initialSelection.model.service, name: initialSelection.model.model, serviceLabel: initialSelection.model.service });
    setSelectedSkills(initialSelection.selectedSkillAssetIds);
    setSelectedVersions(initialSelection.selectedSkillVersions ?? {});
  }, [draft, initialSelection, data.selectModel]);
  const busy = state.phase === "waiting_files" || state.phase === "sending", frozen = state.phase !== "idle";
  useEffect(() => { onReady?.(draft); return () => onReady?.(null); }, [draft, onReady]);
  useEffect(() => {
    if (suggestion && draft.getSnapshot().phase === "idle") draft.setText(suggestion);
  }, [draft, suggestion]);
  useEffect(() => {
    if (state.promptSelections === null && !frozen) {
      // Previous message templates are already applied by the backend to known works.
      // In particular, never replay a previous message's once-only override.
      draft.setPromptSelections(capabilityRefs.filter(isPromptRef).map(ref => describePrompt(ref, catalog.library)));
    }
  }, [draft, state.promptSelections, frozen, capabilityRefs, catalog.library]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) closeMenu(); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [menu]);
  const perform = (action: () => void) => { try { action(); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); } };
  const pick = (files: File[]) => {
    if (!files.length) return;
    if (!readAuth()) { onRequireLogin?.(); return; }
    perform(() => {
      if (replacement.current) { draft.retryFile(replacement.current, files[0]); replacement.current = null; }
      else draft.addFiles(files);
    });
  };
  const send = async () => {
    if (!readAuth()) { onRequireLogin?.(); return; }
    try {
      const model = data.selected;
      if (!state.pending && (!model?.service || !model.id)) throw new Error("请先选择一个已配置的模型");
      const selectedOption = question?.options.indexOf(state.text.trim()) ?? -1;
      const selection = state.pending ?? { model: { service: model!.service, model: model!.id }, selectedSkillAssetIds: selectedSkills,
        selectedSkillVersions: Object.fromEntries(selectedSkills.map(id => [id, selectedVersions[id]])),
        selectedAgentAssetIds: initialSelection?.selectedAgentAssetIds ?? [],
        capabilityRefs: mergePromptRefs((initialSelection?.capabilityRefs ?? capabilityRefs).filter(ref => !isPromptRef(ref)), state.promptSelections ?? [], catalog.library),
        creationStrategy: initialSelection?.creationStrategy ?? strategy,
        creationMode: initialSelection?.creationMode ?? "guided",
        ...((initialSelection?.officialPersonaId ?? officialPersonaId) ? { officialPersonaId: initialSelection?.officialPersonaId ?? officialPersonaId } : {}) };
      const result = await draft.send(selection, question ? { runId: question.runId, questionId: question.questionId, revision: question.revision,
        ...(selectedOption >= 0 ? { selectedOption } : {}) } : undefined);
      closeMenu(); setError(null); onSent(result.sessionId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发送失败"); }
  };
  const displayedModel = state.pending ? data.models.find(model => model.service === state.pending!.model.service && model.id === state.pending!.model.model)
    ?? { service: state.pending.model.service, serviceLabel: state.pending.model.service, id: state.pending.model.model, name: state.pending.model.model } : data.selected;
  const displayedSkills = state.pending?.selectedSkillAssetIds ?? selectedSkills;
  const displayedPrompts = state.pending ? state.pending.capabilityRefs.filter(isPromptRef).map(ref =>
    state.promptSelections?.find(item => item.ref.id === ref.id && item.ref.kind === ref.kind) ?? describePrompt(ref, catalog.library)) : state.promptSelections ?? [];
  const toggleSkill = (skill: GeneralSkillSummary) => {
    const selected = selectedSkills.includes(skill.assetId);
    setSelectedSkills(previous => selected ? previous.filter(id => id !== skill.assetId) : [...previous, skill.assetId]);
    setSelectedVersions(previous => { const next = { ...previous }; if (selected) delete next[skill.assetId]; else next[skill.assetId] = skill.version; return next; });
  };
  const options: ComposerOption[] = menu === "skill" ? skills.filter(skill =>
    !query.trim() || [skill.title, skill.assetId, skill.creatorName].join(" ").toLowerCase().includes(query.trim().toLowerCase())).map(skill => ({
      key: skill.assetId, title: skill.title, selected: displayedSkills.includes(skill.assetId),
      sub: `${skill.creatorName || "作者未标注"} · #${skill.assetId} · v${selectedVersions[skill.assetId] ?? skill.version}`,
      apply: () => toggleSkill(skill),
    })) : searchPromptTemplates(catalog.library, menu === "style" ? "style" : "template", query).map(template => ({
      key: template.id, title: template.name,
      sub: `${PROMPT_BUSINESS_LABELS[template.business]} · ${catalog.library.steps[template.business]?.[template.step] ?? template.step}${template.isDefault ? " · 默认" : ""}`,
      desc: [template.description, ...template.tags].filter(Boolean).join(" · "),
      selected: displayedPrompts.some(item => item.ref.id === template.id),
      apply: () => draft.setPromptSelections(selectPrompt(state.promptSelections ?? [], promptSelection(template, once), catalog.library)),
    }));
  const choose = (option: ComposerOption) => {
    if (frozen) return;
    perform(() => {
      option.apply();
      if (token) draft.setText(state.text.slice(0, token.start) + state.text.slice(token.end));
      const caret = token?.start;
      closeMenu();
      requestAnimationFrame(() => { textarea.current?.focus(); if (caret !== undefined) textarea.current?.setSelectionRange(caret, caret); });
    });
  };
  const choices = displayedModel && !data.models.some(model => model.id === displayedModel.id && model.service === displayedModel.service) ? [displayedModel, ...data.models] : data.models;
  return <section ref={root} className="ga-composer" aria-label="通用智能体输入" onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={event => { event.preventDefault(); if (!frozen) pick(Array.from(event.dataTransfer.files)); }}>
    {menu && !frozen && <ComposerSelector ref={selector} tabs={MENU_TABS} tab={menu} onTab={tab => { setMenu(tab as MenuKind); if (token) textarea.current?.focus(); }}
      query={query} onQuery={setQuery} typed={token !== null} options={options} onPick={choose} onClose={closeMenu}
      promptScope={menu === "skill" ? undefined : { once, onChange: setOnce }} loading={menu !== "skill" && catalog.loading}
      error={menu === "skill" ? null : catalog.error} />}
    {banner}
    {question && <div className="ga-question"><p>{question.question}</p><div>{question.options.map((option, index) => <button key={index} type="button" disabled={frozen} onClick={() => perform(() => draft.setText(option))}>{option}</button>)}</div></div>}
    {(state.files.length > 0 || state.references.length > 0) && <div className="ga-files">
      {state.files.map(file => <div className="ga-file" key={file.uploadId}>
        <div><strong title={file.filename}>{file.filename}</strong><small>{(file.size / 1024).toFixed(1)} KB · {file.status === "uploading" ? "正在上传" : file.status === "stored" ? file.attachment?.status === "ready" ? "可读取" : file.attachment?.status === "failed" ? "解析失败" : "已上传，等待解析" : file.status === "missing" ? "需要原文件" : "上传失败"}</small></div>
        {(file.error || file.attachment?.error) && <span className="ga-error">{file.error ?? file.attachment?.error?.message}</span>}
        {(file.status === "failed" || file.status === "missing") && <button type="button" disabled={frozen} onClick={() => { if (file.status === "missing") { replacement.current = file.uploadId; picker.current?.click(); } else perform(() => draft.retryFile(file.uploadId)); }}>重试上传</button>}
        <button type="button" className="ga-icon-button" disabled={frozen} aria-label={`移除 ${file.filename}`} onClick={() => perform(() => draft.removeFile(file.uploadId))}><X size={14} /></button>
      </div>)}
      {state.references.map((ref, index) => <div className="ga-file" key={`${ref.kind}:${ref.id}:${ref.revision}`}><span>{resourceLabels[`${ref.kind}:${ref.id}:${ref.revision}`] ?? (ref.kind === "artifact" ? "产物" : "附件")} · 版本 {ref.revision}</span><button type="button" disabled={frozen} onClick={() => perform(() => draft.removeReference(index))}>移除引用</button></div>)}
    </div>}
    {(displayedSkills.length > 0 || displayedPrompts.length > 0) && <div className="composer-selection-chips">
      {displayedSkills.map(id => <span className="composer-selection-chip" key={`skill-${id}`}>
        {skills.find(skill => skill.assetId === id)?.title ?? `技能 #${id}`}
        <button type="button" disabled={frozen} aria-label={`移除技能 ${skills.find(skill => skill.assetId === id)?.title ?? id}`} onClick={() => {
          setSelectedSkills(previous => previous.filter(value => value !== id));
          setSelectedVersions(previous => { const next = { ...previous }; delete next[id]; return next; });
        }}><X size={12} /></button></span>)}
      {displayedPrompts.map(item => <span className="composer-selection-chip" key={`${item.ref.kind}-${item.ref.id}`}>
        {catalog.library.templates.find(template => template.id === item.ref.id)?.name ?? item.label}<small>{promptScopeLabel(item.ref)}</small>
        <button type="button" disabled={frozen} aria-label={`移除模板 ${catalog.library.templates.find(template => template.id === item.ref.id)?.name ?? item.label}`}
          onClick={() => perform(() => draft.setPromptSelections((state.promptSelections ?? []).filter(selected => selected.ref.id !== item.ref.id)))}><X size={12} /></button>
      </span>)}
    </div>}
    <textarea ref={textarea} aria-label={question ? "回答问题" : "发送给智能体"} value={state.text} readOnly={frozen} rows={3}
      placeholder={placeholder ?? "聊聊想法，上传小说拆书，或让我帮你写作、看图、编写代码…"}
      onChange={event => perform(() => {
        const text = event.target.value, caret = event.target.selectionStart;
        draft.setText(text);
        const trigger = findSlashTrigger(text, caret);
        if (trigger) { setMenu(previous => previous ?? "skill"); setQuery(trigger.query); setToken({ start: trigger.start, end: caret }); }
        else if (token) closeMenu();
      })}
      onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); pick(files); } }}
      onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (menu && !frozen && selector.current?.handleKeyDown(event)) return; if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) void send(); } }} />
    <input ref={picker} type="file" multiple hidden onChange={event => { pick(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <div className="ga-composer-toolbar">
      <div className="ga-composer-controls">
        <button type="button" className="ga-skill-trigger ga-icon-button" disabled={frozen} aria-label="选择技能、模板或风格" title="选择技能、模板或风格（/）" aria-expanded={menu !== null}
          onClick={() => {
            if (menu) { closeMenu(); return; }
            setMenu("skill"); setToken(null); setQuery("");
            if (readAuth()) void fetchGeneralSkills().then(setSkills).catch(cause => setError(cause instanceof Error ? cause.message : "技能目录读取失败"));
          }}><Plus size={19} />{displayedSkills.length + displayedPrompts.length > 0 && <span className="ga-skill-count">{displayedSkills.length + displayedPrompts.length}</span>}</button>
        <button type="button" className="ga-icon-button" disabled={frozen} aria-label="添加附件" title="添加文件或图片" onClick={() => { replacement.current = null; picker.current?.click(); }}><Paperclip size={18} /></button>
      </div>
      <div className="ga-composer-actions">
        <select aria-label="当前模型" disabled={frozen} value={displayedModel ? JSON.stringify([displayedModel.service, displayedModel.id]) : ""} onChange={event => { const model = choices.find(item => JSON.stringify([item.service, item.id]) === event.target.value); if (model) data.selectModel(model); }}>
          <option value="" disabled>选择模型</option>{choices.map(model => <option key={`${model.service}:${model.id}`} value={JSON.stringify([model.service, model.id])}>{model.name} · {model.serviceLabel}</option>)}
        </select>
        <button type="button" className="ga-send" disabled={busy || (!state.pending && !state.text.trim() && !state.files.length && !state.references.length)} onClick={() => void send()}><ArrowUp size={17} />{state.phase === "waiting_files" ? "等待附件" : state.phase === "sending" ? "正在发送" : state.pending ? "重试确认" : question ? "回答并继续" : "发送"}</button>
      </div>
    </div>
    {(error || state.error) && <p className="ga-error" role="alert">{error ?? state.error}</p>}
    {!state.pending && data.modelNotice && <p className="ga-note">{data.modelNotice} <a href="/settings/models">模型设置</a></p>}
    {state.storageWarning && <p className="ga-note">草稿无法保存在此浏览器，刷新前请复制输入内容。</p>}
    <p className="ga-composer-hint">/ 选择技能、模板或风格 · 最多8份材料，每份80 MiB · ⌘ / Ctrl + Enter 发送 · 任务进行中可继续补充</p>
  </section>;
}
