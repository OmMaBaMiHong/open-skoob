import { randomUUID } from 'node:crypto';
import { complete, resolveModel, ApiError } from './models.mjs';

const now = () => new Date().toISOString();
const step = (id, type = id) => ({ id, type, version: 1, status: 'pending', attempt: 0, output: null, error: null, reviewFeedback: null });
const fields = {
  worldview: 'storyFrame、worldSettings、bookRules：均为详细文本字符串，说明世界与角色、冲突、规则。',
  title_synopsis: 'title、synopsis：字符串；candidates：数组，每项包含 title 和 reason。',
  outline: 'volumeMap、pendingHooks：字符串，描述全书卷册发展、主线与需要回收的伏笔。',
  chapter_plan: 'summary、outline：字符串，规划当前卷及各章事件与当前章节。',
};

// Public, editable basic writing workflow. No simulation, retrieval, detection or proprietary engine prompts.
export class Creation {
  constructor(store, emit) { this.store = store; this.emit = emit; this.running = new Map(); }
  book(id) { const book = this.store.get('books', id); if (!book) throw new ApiError(404, 'BOOK_NOT_FOUND', '作品不存在'); return book; }
  save(book) { book.updatedAt = now(); book.snapshot.version++; this.store.set('books', book.id, book); this.emit('creation-loop:advanced', { bookId: book.id, loopId: book.snapshot.workflowId, snapshot: book.snapshot }); }
  create(input, model, instruction = '') {
    const id = randomUUID(); const loopId = randomUUID(); const createdAt = now();
    const targetChapters = Number(input.targetChapters ?? 10); const chapterWordCount = Number(input.chapterWordCount ?? 2000);
    if (!Number.isInteger(targetChapters) || targetChapters < 1 || targetChapters > 2000 || !Number.isInteger(chapterWordCount) || chapterWordCount < 100 || chapterWordCount > 10000) throw new ApiError(400, 'INVALID_BOOK', '目标章节数须为 1–2000，每章字数须为 100–10000');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw new ApiError(400, 'INVALID_TITLE', '请填写不超过 120 字的书名');
    const intent = { ...step('intent'), status: 'confirmed', output: { intent: { ...input, instruction } } };
    const book = { id, title: input.title.trim(), genre: input.genre || '其他', platform: input.platform || 'other', language: input.language || 'zh', targetChapters, chapterWordCount,
      creationMode: input.creationMode || 'guided', status: 'outlining', createdAt, updatedAt: createdAt, instruction, model, autoRun: false,
      snapshot: { workflowId: loopId, mode: 'creation', createdAt, version: 1, status: 'paused', currentStepId: 'worldview', steps: [intent, step('worldview'), step('title_synopsis'), step('outline'), step('chapter_plan-1', 'chapter_plan'), step('chapter_write-1', 'chapter_write')] } };
    this.store.set('books', id, book); return book;
  }
  async propose(input, signal, onDelta) {
    const result = await complete(this.store, input, [
      { role: 'system', content: '你是本地小说创作助手。根据用户需求生成意图卡，只返回 JSON 对象：title、titleCandidates（3个候选书名）、genre、synopsis、platform（qidian/tomato/feilu/other）、language（zh/en）、targetChapters（1–2000）、chapterWordCount（1000–10000）。用户明确的目标优先；没有说明时建议 10 章、每章 2000 字。不调用任何云端引擎。' },
      { role: 'user', content: input.instruction },
    ], { json: true, signal, onDelta });
    if (typeof result.title !== 'string' || !result.title.trim()) throw new ApiError(502, 'INTENT_INVALID', '模型没有返回有效的书名，请重试');
    return { response: result.synopsis || '请确认创作意图卡', details: { toolExecutions: [{ id: randomUUID(), tool: 'propose_action', status: 'completed', args: { action: 'create_book', title: '建书意图卡', summary: result.synopsis || '', instruction: input.instruction, createBook: result } }] } };
  }
  start(id) {
    if (this.running.has(id)) return;
    const book = this.book(id);
    if (!book.model) throw new ApiError(400, 'MODEL_NOT_CONFIGURED', '请先选择创作模型');
    resolveModel(this.store, book.model);
    const controller = new AbortController();
    const work = this.advance(id, controller.signal).finally(() => this.running.delete(id));
    this.running.set(id, { controller, work });
  }
  context(book, current) {
    const confirmed = book.snapshot.steps.filter(s => s.status === 'confirmed' && s.type !== 'chapter_write').map(s => ({ step: s.type, output: s.output }));
    const recent = this.store.list('chapters').filter(c => c.bookId === book.id).sort((a, b) => a.number - b.number).slice(-2);
    return JSON.stringify({ book: { title: book.title, genre: book.genre, instruction: book.instruction, language: book.language, targetChapters: book.targetChapters, chapterWordCount: book.chapterWordCount }, confirmed, recentChapters: recent.map(c => ({ number: c.number, content: c.content })), currentStep: current.id, feedback: current.reviewFeedback, chapterFacts: book.snapshot.steps.filter(s => s.type === 'chapter_write' && s.status === 'confirmed').map(s => ({ chapter: s.id, summary: s.output?.summary })) });
  }
  async advance(id, signal) {
    try {
      while (!signal.aborted) {
        const book = this.book(id); const s = book.snapshot.steps.find(s => s.id === book.snapshot.currentStepId);
        if (!s || book.snapshot.status === 'succeeded') return;
        s.status = 'running'; s.error = null; s.attempt++; book.snapshot.status = 'running'; this.save(book);
        const context = this.context(book, s);
        const onDelta = text => this.emit('creation:preview', { bookId: id, stepId: s.id, text });
        let output;
        if (s.type === 'chapter_write') output = await this.writeChapter(book, s, context, signal);
        else {
          output = await complete(this.store, book.model, [{ role: 'system', content: `你是小说${s.type}步骤的创作助手。依据用户确认的上文完成本步。使用作品指定语言，只输出 JSON 对象。字段要求：${fields[s.type]}` }, { role: 'user', content: context }], { signal, onDelta, json: true, purpose: s.type });
          const required = { worldview: 'storyFrame', title_synopsis: 'synopsis', outline: 'volumeMap', chapter_plan: 'outline' }[s.type];
          if (typeof output[required] !== 'string' || !output[required].trim()) throw new ApiError(502, 'STEP_OUTPUT_INVALID', `模型未返回本步所需的 ${required}，请重试`);
        }
        signal.throwIfAborted();
        // Re-read to retain user changes made while the provider was running.
        const latest = this.book(id); const current = latest.snapshot.steps.find(x => x.id === s.id);
        current.output = output; current.status = 'awaiting_review'; current.version++; current.error = null;
        latest.snapshot.status = 'awaiting_review';
        if (s.type === 'chapter_write') {
          const number = Number(s.id.split('-')[1]);
          this.store.transaction(() => {
            this.store.set('chapters', `${id}:${number}`, { bookId: id, number, title: output.title || `第 ${number} 章`, content: output.content, wordCount: output.wordCount, lengthWarnings: output.lengthWarnings, summary: output.summary, status: 'draft', updatedAt: now() });
            this.save(latest);
            this.activity(id, s.id, 'save', 'done', '正文已保存，等待作者确认');
          });
        } else this.save(latest);
        if (!latest.autoRun) return;
        this.confirm(id, s.id);
      }
    } catch (error) {
      const book = this.store.get('books', id); if (!book) return;
      const s = book.snapshot.steps.find(s => s.id === book.snapshot.currentStepId);
      if (s) { s.status = signal.aborted ? 'paused' : 'failed'; s.error = signal.aborted ? null : error.message; }
      book.snapshot.status = signal.aborted ? 'paused' : 'failed'; this.save(book);
      if (s?.type === 'chapter_write') this.activity(id, s.id, 'workflow', signal.aborted ? 'skipped' : 'error', signal.aborted ? '已暂停，已完成环节保留' : '模型调用失败，请查看错误后重试');
    }
  }
  activity(bookId, stepId, stage, status, message) {
    const key = `${bookId}:${stepId}`;
    const activity = this.store.get('activities', key, { bookId, stepId, revision: 0, items: [] });
    activity.revision++; activity.updatedAt = Date.now();
    activity.items = activity.items.filter(item => item.stage !== stage);
    activity.items.push({ stage, status, message, updatedAt: activity.updatedAt });
    this.store.set('activities', key, activity); this.emit('creation-loop:activity', activity);
  }
  async writeChapter(book, stepState, context, signal) {
    const checkpointKey = `${book.id}:${stepState.id}`;
    const checkpoints = this.store.get('writing', checkpointKey, {});
    const roles = [
      ['planner', '规划师', '根据上下文细化本章事件、冲突和结尾钩子，只写本章计划。'],
      ['composer', '编排师', '整理本章写作所需的设定、人物动机、场景顺序与连续性约束。'],
      ['writer', '执笔师', `据已确认设定、计划和上下文撰写完整的本章正文，目标约 ${book.chapterWordCount} 字，不输出说明。`],
      ['auditor', '审校师', '检查本章正文与确认设定之间的矛盾、遗漏和可读性，给出具体可执行的修改意见；没有问题就明确说明。'],
      ['reviser', '修订师', '根据审校意见修订本章，保留原意与事实，只输出完整修订后的正文，不要输出修改报告。'],
      ['settler', '结算师', '总结本章新增事实、人物状态和待回收伏笔，供下一章参考。'],
    ];
    for (const [key, label, instruction] of roles) {
      signal.throwIfAborted(); if (checkpoints[key]) continue;
      this.activity(book.id, stepState.id, key, 'running', `${label}正在处理本章`);
      this.emit('chapter:stage', { bookId: book.id, chapter: Number(stepState.id.split('-')[1]), stage: key });
      checkpoints[key] = await complete(this.store, book.model, [{ role: 'system', content: `你是小说创作的${label}。${instruction} 请使用作品指定语言。这是本地基础写作，不使用四大云端引擎。` }, { role: 'user', content: context + '\n本章已完成环节：\n' + JSON.stringify(checkpoints) }], { signal, purpose: key, onDelta: text => this.emit('creation:preview', { bookId: book.id, stepId: stepState.id, text, stage: key }) });
      this.store.set('writing', checkpointKey, checkpoints);
      this.activity(book.id, stepState.id, key, 'done', `${label}已完成，结果已保存`);
    }
    const wordCount = [...checkpoints.reviser].filter(c => !/\s/u.test(c)).length;
    const lengthWarnings = wordCount < book.chapterWordCount * 0.8 || wordCount > book.chapterWordCount * 1.5 ? [`本章 ${wordCount} 字，目标约 ${book.chapterWordCount} 字，请审阅后确认或重写。`] : [];
    return { content: checkpoints.reviser, wordCount, lengthWarnings, title: `第 ${stepState.id.split('-')[1]} 章`, summary: checkpoints.settler };
  }
  confirm(id, stepId) {
    const book = this.book(id); const index = book.snapshot.steps.findIndex(s => s.id === stepId); const s = book.snapshot.steps[index];
    if (!s || book.snapshot.currentStepId !== stepId || s.status !== 'awaiting_review') throw new ApiError(409, 'STEP_NOT_REVIEWABLE', '该步骤当前不在待确认状态，请刷新进度');
    s.status = 'confirmed'; s.version++;
    if (s.type === 'title_synopsis' && s.output?.title) book.title = s.output.title;
    if (s.type === 'chapter_write') {
      const number = Number(s.id.split('-')[1]);
      const chapter = this.store.get('chapters', `${id}:${number}`);
      if (chapter) this.store.set('chapters', `${id}:${number}`, { ...chapter, status: 'confirmed' });
      if (number < book.targetChapters && !book.snapshot.steps[index + 1]) book.snapshot.steps.push(step(`chapter_plan-${number + 1}`, 'chapter_plan'), step(`chapter_write-${number + 1}`, 'chapter_write'));
    }
    const next = book.snapshot.steps[index + 1];
    book.snapshot.currentStepId = next?.id ?? null; book.snapshot.status = next ? 'paused' : 'succeeded'; book.status = next ? 'active' : 'completed';
    this.save(book);
    return book.snapshot;
  }
  async pause(id) {
    const run = this.running.get(id);
    if (run) { run.controller.abort(); await run.work; }
    const book = this.book(id);
    if (!['succeeded', 'awaiting_review'].includes(book.snapshot.status)) { book.snapshot.status = 'paused'; this.save(book); }
    return book.snapshot;
  }
  async regenerate(id, stepId, feedback = '') {
    await this.pause(id); const book = this.book(id); const index = book.snapshot.steps.findIndex(s => s.id === stepId);
    if (index < 1) throw new ApiError(400, 'INVALID_STEP', '请重新建书以修改意图卡');
    // Foundation changes invalidate downstream review state, but never delete authored text.
    for (let i = index; i < book.snapshot.steps.length; i++) {
      const s = book.snapshot.steps[i]; s.status = i === index ? 'pending' : 'stale'; s.error = null;
      this.store.remove('writing', `${id}:${s.id}`);
    }
    book.snapshot.steps[index].reviewFeedback = feedback; book.snapshot.currentStepId = stepId; book.snapshot.status = 'paused'; book.autoRun = false; this.save(book); this.start(id);
    return this.book(id).snapshot;
  }
  async close() { for (const run of this.running.values()) run.controller.abort(); await Promise.allSettled([...this.running.values()].map(r => r.work)); }
}
