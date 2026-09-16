import { useEffect, useState } from "react";
import { fetchJson } from "./api";

export type PromptBusiness = "writing" | "deconstruction" | "style";
export interface PromptTemplate {
  id: string; business: PromptBusiness; step: string; name: string; description: string;
  tags: string[]; enabled: boolean; isDefault: boolean;
}
export interface PromptLibrary {
  templates: PromptTemplate[];
  steps: Record<PromptBusiness, Record<string, string>>;
}
export type PromptRef = { kind: "prompt-template" | "prompt-template-once"; id: string };
export interface PromptSelection {
  ref: PromptRef; label: string; business?: PromptBusiness; step?: string;
}
export const PROMPT_SCOPE_LABEL = "当前作品（普通聊天仅本次）";
export const PROMPT_BUSINESS_LABELS: Record<PromptBusiness, string> = { writing: "创作", deconstruction: "拆书", style: "写作风格" };
export const EMPTY_PROMPT_LIBRARY: PromptLibrary = { templates: [], steps: { writing: {}, deconstruction: {}, style: { style: "写作风格" } } };

export const isPromptRef = (ref: { kind: string; id: string }): ref is PromptRef =>
  ref.kind === "prompt-template" || ref.kind === "prompt-template-once";
export const promptScopeLabel = (ref: PromptRef) => ref.kind === "prompt-template-once" ? "仅本次使用" : PROMPT_SCOPE_LABEL;
export const fetchPromptLibrary = (signal?: AbortSignal) => fetchJson<PromptLibrary>("/prompt-library", { signal });

/** Refresh on opening; the server owns availability and the private prompt text. */
export function usePromptLibrary(open: boolean) {
  const [library, setLibrary] = useState(EMPTY_PROMPT_LIBRARY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    void fetchPromptLibrary(controller.signal).then(result => {
      if (!controller.signal.aborted) setLibrary(result);
    }).catch(cause => {
      if (!controller.signal.aborted) { setLibrary(EMPTY_PROMPT_LIBRARY); setError(cause instanceof Error ? cause.message : "模板目录读取失败"); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open]);
  return { library, loading, error };
}

export function searchPromptTemplates(library: PromptLibrary, kind: "template" | "style", query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return library.templates.filter(template => template.enabled && (kind === "style" ? template.business === "style" : template.business !== "style"))
    .filter(template => {
      const text = [template.name, template.description, template.id, ...template.tags, template.step,
        library.steps[template.business]?.[template.step], PROMPT_BUSINESS_LABELS[template.business]].join(" ").toLowerCase();
      return words.every(word => text.includes(word));
    });
}

export function promptSelection(template: PromptTemplate, once: boolean): PromptSelection {
  return { ref: { kind: once ? "prompt-template-once" : "prompt-template", id: template.id },
    label: template.name, business: template.business, step: template.step };
}

export function describePrompt(ref: PromptRef, library: PromptLibrary): PromptSelection {
  const template = library.templates.find(item => item.id === ref.id);
  return template ? { ...promptSelection(template, ref.kind === "prompt-template-once"), ref } : { ref, label: ref.id };
}

export function samePromptSlot(a: Pick<PromptSelection, "business" | "step">, b: Pick<PromptSelection, "business" | "step">) {
  return !!a.business && a.business === b.business && (a.business === "style" || (!!a.step && a.step === b.step));
}

/** Explicit choices replace either scope of a slot, while preserving other capabilities. */
export function selectPrompt(previous: readonly PromptSelection[], next: PromptSelection, library: PromptLibrary): PromptSelection[] {
  return [...previous.filter(item => item.ref.id !== next.ref.id && !samePromptSlot(
    item.business ? item : describePrompt(item.ref, library), next)), next];
}

export function mergePromptRefs<T extends { kind: string; id: string }>(existing: readonly T[], selected: readonly PromptSelection[], library: PromptLibrary): Array<T | PromptRef> {
  return [...existing.filter(ref => !isPromptRef(ref) || !selected.some(item => item.ref.id === ref.id || samePromptSlot(describePrompt(ref, library), item))),
    ...selected.map(item => ({ kind: item.ref.kind, id: item.ref.id }))];
}

export function findSlashTrigger(text: string, caret: number) {
  const match = /(?:^|\n)\/([^\s/]*)$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[1]!.length - 1, query: match[1]! } : null;
}
