import { AgentMessageInputSchema, GeneralAttachmentSchema, GENERAL_ATTACHMENT_LIMIT, GENERAL_ATTACHMENT_MAX_BYTES,
  type AgentMessageInput, type GeneralAttachment, type ResourceRef } from "./general-agent-contracts";
import { apiUrl } from "./api-origin";
import { readAuth } from "./auth-storage";
import { answerGeneralQuestion, createGeneralSession, sendGeneralMessage, uploadGeneralAttachment } from "./general-agent-api";
import { isPromptRef, type PromptSelection } from "./prompt-library";

export type GeneralMessageSelection = Pick<AgentMessageInput, "model" | "selectedSkillAssetIds" | "selectedSkillVersions" | "selectedAgentAssetIds" | "capabilityRefs" | "creationStrategy" | "creationMode" | "officialPersonaId">;
export interface GeneralAnswerTarget { runId: string; questionId: string; revision: number; selectedOption?: number }
export interface DraftFile {
  uploadId: string; filename: string; size: number;
  status: "uploading" | "stored" | "failed" | "missing";
  attachment?: GeneralAttachment; error?: string;
}
export interface GeneralDraftState {
  sessionId: string | null; clientRequestId: string; text: string; files: DraftFile[]; references: ResourceRef[];
  pending: AgentMessageInput | null; phase: "idle" | "waiting_files" | "sending" | "uncertain";
  answer: GeneralAnswerTarget | null;
  promptSelections: PromptSelection[] | null;
  error: string | null; storageWarning: boolean;
}
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const errorText = (error: unknown) => error instanceof Error ? error.message : "请求失败，请重试";
const uuid = () => crypto.randomUUID();
const fallback = new Map<string, string>();
function browserStorage(): DraftStorage {
  try { localStorage.getItem("skoob:general-draft-check"); return localStorage; }
  catch { return { getItem: key => fallback.get(key) ?? null, setItem: (key, value) => { fallback.set(key, value); throw new Error("浏览器未提供持久存储"); }, removeItem: key => { fallback.delete(key); } }; }
}

/** Shared by the homepage and a persisted conversation. Original file bytes stay
 * in memory; completed uploads and an uncertain message receipt survive reload. */
export class GeneralAgentDraft {
  private state: GeneralDraftState;
  private listeners = new Set<() => void>();
  private files = new Map<string, File>();
  private uploads = new Map<string, Promise<void>>();
  private sessionPending: Promise<string> | null = null;
  private sendPending: Promise<{ sessionId: string; runId: string }> | null = null;
  private controller = new AbortController();
  private key: string;
  private identity = readAuth();
  constructor(private targetSessionId: string | null, private storage = browserStorage()) {
    this.key = `skoob:general-draft:v1:${encodeURIComponent(new URL(apiUrl("/"), window.location.href).origin)}:${encodeURIComponent(this.identity?.userId ?? "anonymous")}:${encodeURIComponent(targetSessionId ?? "home")}`;
    this.state = { sessionId: targetSessionId, clientRequestId: uuid(), text: "", files: [], references: [], pending: null, answer: null, promptSelections: null, phase: "idle", error: null, storageWarning: false };
    try {
      const raw = this.storage.getItem(this.key); if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || typeof saved.clientRequestId !== "string" || typeof saved.text !== "string"
        || !(saved.sessionId === null || typeof saved.sessionId === "string") || (targetSessionId && saved.sessionId !== targetSessionId)
        || !Array.isArray(saved.files) || !Array.isArray(saved.references) || saved.files.length + saved.references.length > GENERAL_ATTACHMENT_LIMIT) throw new Error("草稿格式不正确");
      const files: DraftFile[] = saved.files.map((file: DraftFile) => {
        if (typeof file.uploadId !== "string" || typeof file.filename !== "string" || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error("附件草稿格式不正确");
        const attachment = file.attachment ? GeneralAttachmentSchema.parse(file.attachment) : undefined;
        return { uploadId: file.uploadId, filename: file.filename, size: file.size, attachment,
          status: attachment ? "stored" : "missing", ...(attachment ? {} : { error: "刷新前上传未确认，请重新选择原文件" }) };
      });
      // Reuse message validation for resource shape and version checks.
      const pending = saved.pending ? AgentMessageInputSchema.parse(saved.pending) : null;
      if (pending && pending.sessionId !== saved.sessionId) throw new Error("草稿会话不一致");
      const answer = saved.answer ?? null;
      if (answer && (!pending || typeof answer.runId !== "string" || typeof answer.questionId !== "string" || !Number.isSafeInteger(answer.revision) || answer.revision < 1
        || (answer.selectedOption !== undefined && (!Number.isSafeInteger(answer.selectedOption) || answer.selectedOption < 0)))) throw new Error("回答草稿格式不正确");
      const references = saved.references.map((ref: ResourceRef) => {
        if (!["attachment", "artifact"].includes(ref.kind) || typeof ref.id !== "string" || !Number.isSafeInteger(ref.revision) || ref.revision < 1) throw new Error("引用草稿格式不正确");
        return { kind: ref.kind, id: ref.id, revision: ref.revision };
      });
      const promptSelections = saved.promptSelections == null ? null : saved.promptSelections.map((item: PromptSelection) => {
        if (!item?.ref || !isPromptRef(item.ref) || typeof item.ref.id !== "string" || typeof item.label !== "string"
          || (item.business !== undefined && !["writing", "deconstruction", "style"].includes(item.business))
          || (item.step !== undefined && typeof item.step !== "string")) throw new Error("模板选择草稿格式不正确");
        return { ref: { kind: item.ref.kind, id: item.ref.id }, label: item.label, business: item.business, step: item.step };
      });
      this.state = { ...this.state, sessionId: saved.sessionId, clientRequestId: saved.clientRequestId, text: saved.text, files, references, promptSelections,
        pending, answer, phase: pending ? "uncertain" : "idle", error: pending ? "上次发送尚未确认，重试将核对同一条消息" : null };
    } catch { this.state = { ...this.state, error: "浏览器中的草稿无法读取，请重新输入；服务端会话仍然保留" }; }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { if (this.controller.signal.aborted) this.controller = new AbortController(); }
  dispose() { this.controller.abort(); }
  private change(patch: Partial<GeneralDraftState>) {
    this.state = { ...this.state, ...patch };
    try { this.storage.setItem(this.key, JSON.stringify({ version: 1, clientRequestId: this.state.clientRequestId, sessionId: this.state.sessionId,
      text: this.state.text, files: this.state.files, references: this.state.references, pending: this.state.pending, answer: this.state.answer, promptSelections: this.state.promptSelections })); }
    catch { this.state = { ...this.state, storageWarning: true }; }
    for (const listener of this.listeners) listener();
  }
  private assertIdentity() {
    const current = readAuth();
    if (!this.identity || current?.userId !== this.identity.userId || current?.token !== this.identity.token) throw new Error("请使用原账号登录后再发送");
    this.controller.signal.throwIfAborted();
  }
  private editable() { if (this.state.phase !== "idle") throw new Error("请先确认当前发送结果"); }
  setText(text: string) { this.editable(); this.change({ text, error: null }); }
  setPromptSelections(promptSelections: PromptSelection[]) { this.editable(); this.change({ promptSelections: structuredClone(promptSelections), error: null }); }
  addReference(ref: ResourceRef) {
    this.editable();
    if (this.state.references.some(item => item.id === ref.id && item.kind === ref.kind && item.revision === ref.revision)) return;
    if (this.state.files.length + this.state.references.length >= GENERAL_ATTACHMENT_LIMIT) throw new Error("每条消息最多附加8份材料");
    this.change({ references: [...this.state.references, ref] });
  }
  removeReference(index: number) { this.editable(); this.change({ references: this.state.references.filter((_, position) => position !== index) }); }
  async ensureSession(): Promise<string> {
    this.assertIdentity();
    if (this.state.sessionId) return this.state.sessionId;
    if (!this.sessionPending) {
      const signal = this.controller.signal;
      this.sessionPending = createGeneralSession(this.state.clientRequestId, signal).then(result => {
        signal.throwIfAborted(); this.change({ sessionId: result.sessionId }); return result.sessionId;
      }).finally(() => { this.sessionPending = null; });
    }
    return this.sessionPending;
  }
  addFiles(files: File[]) {
    this.editable(); this.assertIdentity();
    if (this.state.files.length + this.state.references.length + files.length > GENERAL_ATTACHMENT_LIMIT) throw new Error("每条消息最多附加8份材料");
    if (files.some(file => file.size > GENERAL_ATTACHMENT_MAX_BYTES)) throw new Error("每个文件不能超过80 MiB");
    const added: DraftFile[] = files.map(file => { const uploadId = uuid(); this.files.set(uploadId, file); return { uploadId, filename: file.name, size: file.size, status: "uploading" }; });
    this.change({ files: [...this.state.files, ...added], error: null });
    for (const file of added) this.upload(file.uploadId);
  }
  retryFile(uploadId: string, replacement?: File) {
    this.editable(); this.assertIdentity();
    const stored = this.state.files.find(file => file.uploadId === uploadId); if (!stored) return;
    if (replacement) {
      if (replacement.name !== stored.filename || replacement.size !== stored.size) throw new Error("请选择同名、同大小的原文件；换文件请先移除旧附件");
      this.files.set(uploadId, replacement);
    }
    if (!this.files.has(uploadId)) throw new Error("请重新选择原文件");
    this.upload(uploadId);
  }
  removeFile(uploadId: string) {
    this.editable(); this.files.delete(uploadId);
    this.change({ files: this.state.files.filter(file => file.uploadId !== uploadId) });
  }
  private upload(uploadId: string) {
    if (this.uploads.has(uploadId)) return;
    const file = this.files.get(uploadId)!; const signal = this.controller.signal;
    const update = (patch: Partial<DraftFile>) => { if (!signal.aborted) this.change({ files: this.state.files.map(item => item.uploadId === uploadId ? { ...item, ...patch } : item) }); };
    update({ status: "uploading", error: undefined });
    const pending = (async () => {
      try {
        const sessionId = await this.ensureSession();
        const attachment = await uploadGeneralAttachment(sessionId, uploadId, file, file.name, signal);
        update({ status: "stored", attachment });
      } catch (error) { update({ status: "failed", error: errorText(error) }); }
    })().finally(() => { this.uploads.delete(uploadId); });
    this.uploads.set(uploadId, pending);
  }
  send(selection: GeneralMessageSelection, answer?: GeneralAnswerTarget): Promise<{ sessionId: string; runId: string }> {
    if (this.sendPending) return this.sendPending;
    this.assertIdentity(); const signal = this.controller.signal;
    this.sendPending = (async () => {
      try {
        if (!this.state.pending) {
          // Freeze user selection before awaiting uploads; settings may change in another tab.
          const fixed = structuredClone(selection);
          const fixedAnswer = answer ? structuredClone(answer) : null;
          if (!this.state.text.trim() && !this.state.files.length && !this.state.references.length) throw new Error("请输入内容或添加附件");
          this.change({ phase: this.state.files.some(file => file.status !== "stored") ? "waiting_files" : "sending", error: null });
          const sessionId = await this.ensureSession();
          await Promise.all([...this.uploads.values()]); signal.throwIfAborted();
          if (this.state.files.some(file => !file.attachment || file.status !== "stored")) throw new Error("部分附件未上传成功，请处理后再发送");
          const input = AgentMessageInputSchema.parse({ ...fixed, sessionId, messageId: uuid(), parts: [
            ...(this.state.text.trim() ? [{ type: "text", text: this.state.text }] : []),
            ...this.state.files.map(file => ({ type: "resource", ref: { kind: "attachment", id: file.attachment!.id, revision: file.attachment!.revision } })),
            ...this.state.references.map(ref => ({ type: "resource", ref })),
          ] });
          this.change({ pending: input, answer: fixedAnswer });
        }
        this.change({ phase: "sending", error: null });
        const input = this.state.pending!;
        const question = this.state.answer;
        const receipt = question ? await answerGeneralQuestion(question.runId, question.questionId, question.revision, input, question.selectedOption, signal) : await sendGeneralMessage(input, signal);
        signal.throwIfAborted();
        this.files.clear();
        this.change({ sessionId: this.targetSessionId, clientRequestId: uuid(), text: "", files: [], references: [], pending: null, answer: null, promptSelections: [], phase: "idle", error: null });
        return { sessionId: input.sessionId, runId: receipt.runId };
      } catch (error) {
        if (!signal.aborted) this.change({ phase: this.state.pending ? "uncertain" : "idle", error: errorText(error) });
        throw error;
      }
    })().finally(() => { this.sendPending = null; });
    return this.sendPending;
  }
}
