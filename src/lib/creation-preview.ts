export interface CreationPreview { bookId?: string; stepId?: string; requestId?: string; updatedAt?: number; revision?: number; stage: string; label?: string; text: string; structured?: boolean; awaitingText?: boolean }
export interface OutlinePreview { text: string; done: number; total: number; phase?: string; plannedVolumes?: number; totalVolumes?: number; charactersDone?: number; charactersTotal?: number }
export function outlineProgressLabel(preview: OutlinePreview): string {
  if (preview.phase === "planning") return preview.totalVolumes ? `主线骨架已保存 · 卷规划已保存 ${preview.plannedVolumes ?? 0}/${preview.totalVolumes} 卷` : "正在逐卷规划骨架，已完成批次会保留";
  const saved = `已保存 ${preview.done}/${preview.total} 个总纲分块`;
  if (preview.phase === "characters") return `${saved} · 角色档案 ${preview.charactersDone ?? 0}/${preview.charactersTotal ?? 0}`;
  if (preview.phase === "ready") return `${saved} · 角色档案齐全，等待工作流提交`;
  return saved;
}
function stale(previous: CreationPreview | null, data: Partial<CreationPreview>): boolean {
  if (!previous || previous.bookId !== data.bookId) return false;
  if (previous.requestId === data.requestId && previous.stepId === data.stepId && previous.revision !== undefined && data.revision !== undefined) return data.revision <= previous.revision;
  return (data.updatedAt ?? Infinity) < (previous.updatedAt ?? 0);
}
export function restoreCreationPreview(previous: CreationPreview | null, incoming: CreationPreview | null): CreationPreview | null {
  if (!incoming || stale(previous, incoming)) return previous;
  if (previous && previous.bookId === incoming.bookId && previous.stepId === incoming.stepId && !incoming.text && previous.text) return previous;
  return incoming;
}
export function reduceCreationPreview(previous: CreationPreview | null, data: Partial<CreationPreview> & {phase?: string}, bookId?: string): CreationPreview | null {
  if (bookId && data.bookId !== bookId) return previous;
  if (!data.stage || stale(previous, data)) return previous;
  const sameStep = previous?.bookId === data.bookId && previous?.stepId === data.stepId;
  if (data.phase === 'start') return {...data,stage:data.stage,text:sameStep ? previous?.text ?? '' : '',structured:sameStep && previous?.text ? previous.structured : data.structured,awaitingText:true};
  if (data.phase === 'complete') return {...data,stage:data.stage,text:data.text || (sameStep ? previous?.text ?? '' : '')};
  if (data.phase !== 'delta' || !data.text) return previous;
  const same = sameStep && previous?.stage === data.stage && previous?.requestId === data.requestId;
  return {...(same ? previous : {}),...data,stage:data.stage,awaitingText:false,structured:data.structured ?? (same && !previous?.awaitingText ? previous?.structured : false),text:(same && !previous?.awaitingText ? previous?.text ?? '' : '')+data.text};
}
/** Only public output string values; never parse or display model reasoning events. */
export function previewText(text: string, structured?: boolean): string {
  if (!structured) return text.split('<AGENTS_JSON>')[0];
  const values: string[]=[];
  const token=/"((?:\\.|[^"\\])*)("|$)/gs;
  for (const match of text.matchAll(token)) {
    const tail=text.slice(match.index!+match[0].length).trimStart();
    if (match[2] === '"' && tail.startsWith(':')) continue;
    const value=match[1].replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\');
    if (['create_book','qidian','tomato','feilu','other','zh','en','fast','simulate'].includes(value) || /^(?:B|C|S|CH)\d+$/i.test(value)) continue;
    if (value.length>1 && /[\p{L}]/u.test(value)) values.push(value);
  }
  return values.join('\n\n');
}
