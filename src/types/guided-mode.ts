/**
 * 引导模式 — 类型定义
 * 六步：意图卡 → 世界观 → 智能体（角色卡） → 大纲 → 正文开写 → 章节后验
 */

/* ── 步骤状态 ── */
export type StepStatus = "pending" | "active" | "completed" | "error";

export interface GuidedStep {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  status: StepStatus;
  version: number;
  data: StepData;
}

export type StepData =
  | IntentCardData
  | WorldviewData
  | AgentData
  | OutlineData
  | WritingData
  | PostValidationData;

/* ── 第 1 步：意图卡 ── */
export interface IntentCardData {
  readonly stepType: "intent";
  era: string;
  worldType: string;
  coreConflict: string;
  readerPromise: string;
  targetAudience: string;
  toneReference: string;
  genre: string;
  tags: ReadonlyArray<string>;
  redlines: ReadonlyArray<string>;
}

/* ── 第 2 步：世界观 ── */
export interface WorldviewData {
  readonly stepType: "worldview";
  axioms: ReadonlyArray<{ id: string; title: string; content: string }>;
  spacetime: { era: string; geography: string; locations: ReadonlyArray<string> };
  powerStructure: { factions: ReadonlyArray<{ name: string; influence: string }>; rules: ReadonlyArray<string> };
  infoFlow: string;
  redlines: ReadonlyArray<string>;
}

/* ── 第 3 步：智能体（角色卡） ── */
export interface AgentData {
  readonly stepType: "agent";
  agents: ReadonlyArray<{
    id: string;
    name: string;
    role: string;
    tier: "major" | "minor";
    background: string;
    catchphrase: string;
    belief: string;
    relationships: ReadonlyArray<{ targetId: string; relation: string }>;
  }>;
}

/* ── 第 4 步：大纲 ── */
export interface OutlineData {
  readonly stepType: "outline";
  mainPlot: string;
  hiddenPlot: string;
  suspenseBox: { setup: string; payoff: string; chapter: number };
  conflictLevels: ReadonlyArray<{ level: number; description: string }>;
  cycles: ReadonlyArray<{ name: string; chapters: number; goal: string }>;
  protagonistDilemma: string;
  growthArc: ReadonlyArray<{ stage: string; change: string }>;
  endingTone: string;
}

/* ── 第 5 步：正文开写 ── */
export interface WritingData {
  readonly stepType: "writing";
  chapters: ReadonlyArray<{
    number: number;
    title: string;
    content: string;
    wordCount: number;
    hook: string;
    foreshadows: ReadonlyArray<string>;
    emotionalArc: string;
    status: "draft" | "reviewing" | "revised" | "final";
  }>;
  currentChapter: number;
}

/* ── 第 6 步：章节后验 ── */
export interface PostValidationData {
  readonly stepType: "postValidation";
  consistencyCheck: { passed: boolean; issues: ReadonlyArray<{ type: string; description: string; suggestion: string }> };
  foreshadows: ReadonlyArray<{ id: string; content: string; status: "planted" | "paid_off" | "pending"; chapter: number }>;
  emotionalArcCheck: { expected: string; actual: string; match: boolean };
  nextChapterPreview: { outline: string; goals: ReadonlyArray<string> };
}

/* ── 区块卡片（通用） ── */
export interface Block {
  readonly id: string;
  readonly title: string;
  readonly fields: ReadonlyArray<BlockField>;
  readonly isRedline?: boolean;
}

export interface BlockField {
  readonly key: string;
  readonly label: string;
  readonly type: "text" | "textarea" | "select" | "tags" | "list";
  value: string | ReadonlyArray<string>;
  readonly options?: ReadonlyArray<string>;
  readonly placeholder?: string;
}

/* ── Agent 消息 ── */
export interface AgentMessage {
  readonly id: string;
  readonly role: "agent" | "user";
  readonly name: string;
  readonly content: string;
  readonly timestamp: number;
}

/* ── 版本快照 ── */
export interface VersionSnapshot {
  readonly version: number;
  readonly timestamp: number;
  readonly data: StepData;
}
