import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { PROMPT_SCOPE_LABEL } from "../lib/prompt-library";
import "../styles/composer-selector.css";

export interface ComposerOption {
  key: string; title: string; sub?: string; desc?: string; icon?: ReactNode; tone?: string; selected?: boolean; apply: () => void;
}
export interface ComposerSelectorHandle { handleKeyDown: (event: KeyboardEvent) => boolean }

/** Both composers keep the real textarea focused when a slash opens this menu. */
export const ComposerSelector = forwardRef<ComposerSelectorHandle, {
  tabs: ReadonlyArray<{ kind: string; label: string; icon?: ReactNode }>;
  tab: string; onTab: (tab: string) => void; query: string; onQuery: (query: string) => void; typed: boolean;
  options: readonly ComposerOption[]; onPick: (option: ComposerOption) => void; onClose: () => void;
  promptScope?: { once: boolean; onChange: (once: boolean) => void };
  loading?: boolean; error?: string | null; empty?: string;
}>(function ComposerSelector({ tabs, tab, onTab, query, onQuery, typed, options, onPick, onClose, promptScope, loading, error, empty }, ref) {
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const index = Math.min(active, Math.max(options.length - 1, 0));
  useEffect(() => setActive(0), [tab, query]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [index]);
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") { event.preventDefault(); onClose(); return true; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setActive((index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % Math.max(options.length, 1)); return true;
    }
    if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey && options[index])) {
      event.preventDefault(); if (!loading && !error && options[index]) onPick(options[index]!); return true;
    }
    return false;
  };
  useImperativeHandle(ref, () => ({ handleKeyDown }));
  return <div className="composer-selector" role="dialog" aria-label="选择技能、模板或风格">
    <div className="composer-selector-tabs" role="tablist" aria-label="能力分类">
      {tabs.map(item => <button key={item.kind} type="button" role="tab" aria-selected={tab === item.kind}
        onClick={() => onTab(item.kind)}>{item.icon}{item.label}</button>)}
      <button type="button" aria-label="关闭选择菜单" onClick={onClose}><X size={14} /></button>
    </div>
    {!typed && <label className="composer-selector-search"><Search size={14} /><input autoFocus aria-label="搜索技能、模板或风格"
      value={query} onChange={event => onQuery(event.target.value)} onKeyDown={handleKeyDown} placeholder="搜索名称、步骤或标签…"
      role="combobox" aria-expanded="true" aria-controls={id} aria-activedescendant={options[index] ? `${id}-${index}` : undefined} /></label>}
    {promptScope && <div className="composer-selector-scope"><span>{promptScope.once ? "仅本次使用" : PROMPT_SCOPE_LABEL}</span>
      <label><input type="checkbox" checked={promptScope.once} onChange={event => promptScope.onChange(event.target.checked)} />仅本次使用</label></div>}
    <div className="composer-selector-list" ref={list} id={id} role="listbox" aria-label="可选能力">
      {loading ? <p role="status">正在读取目录…</p> : error ? <p role="alert">{error}</p> : !options.length ? <p>{empty ?? (query ? `没有匹配「${query}」的条目` : "暂无可选条目")}</p> : options.map((option, position) =>
        <button type="button" role="option" id={`${id}-${position}`} aria-selected={position === index} key={option.key}
          className="composer-selector-option" onMouseEnter={() => setActive(position)} onClick={() => onPick(option)}>
          <span>{option.icon}{option.title}{option.selected && " ✓"}</span>{option.sub && <small>{option.sub}</small>}{option.desc && <small>{option.desc}</small>}
        </button>)}
    </div>
  </div>;
});
