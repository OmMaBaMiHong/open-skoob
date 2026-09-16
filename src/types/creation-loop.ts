/**
 * 创作循环 —— 前端真相源（镜像后端，不再自创步骤）。
 *
 * 对应后端：
 * - 步骤模型      packages/core/src/creation-loop/model.ts
 * - 步骤名        packages/core/src/creation-loop/step-labels.ts
 * - 创建策略      packages/core/src/creation-loop/creation-strategies.ts
 * - 编排治理策略  packages/core/src/creation-loop/orchestration-strategies.ts
 * - 工作流契约    packages/core/src/workflow/contracts.ts
 * - 天衍轮次      packages/engines/tianyan/src/rounds-config.ts
 *
 * ⚠️ 这里的字面量必须与后端逐字一致：前端不能 import @skoob/core
 * （会把 node:crypto 带进浏览器打包），只能各持一份。改后端务必同步这里。
 */

/* ══════════════════════════════════════════════════════════════════
   一、六步创作循环
   ══════════════════════════════════════════════════════════════════ */

/**
 * 后端 CreationLoopStepType。
 *
 * 注意两个历史坑：
 * 1. 「角色设计」不是独立步骤——后端已合并（智能体由世界观/大纲的结构化实体
 *    逐步生成增强，正文直接消费画像）。前端不要再造一个"角色卡"步。
 * 2. 「章节后验」不是步骤——它是六师治理链（normalize→audit→revise→persist
 *    →memory→facts）跑在 chapter_write 内部的环节。见 ORCHESTRATION_GOVERNANCE。
 */
export type CreationLoopStepType =
  | "intent"
  | "worldview"
  | "title_synopsis"
  | "outline"
  | "chapter_plan"
  | "chapter_write";

export const CREATION_LOOP_STEP_TYPES: ReadonlyArray<CreationLoopStepType> = [
  "intent",
  "worldview",
  "title_synopsis",
  "outline",
  "chapter_plan",
  "chapter_write",
];

/** 步骤中文名（与后端 CREATION_STEP_LABELS_ZH 逐字一致）。 */
export const CREATION_STEP_LABELS_ZH: Readonly<Record<CreationLoopStepType, string>> = {
  intent: "意图卡",
  worldview: "世界观生成",
  title_synopsis: "书名与简介",
  outline: "全书大纲",
  chapter_plan: "卷与循环",
  chapter_write: "章节正文",
};

/** 步骤副标题（前端展示用，后端无对应字段）。 */
export const CREATION_STEP_SUBTITLES: Readonly<Record<CreationLoopStepType, string>> = {
  intent: "一句话定方向",
  worldview: "世界底层规则",
  title_synopsis: "书名与卖点",
  outline: "全书骨架与张力走向",
  chapter_plan: "卷纲 · 逐章编排",
  chapter_write: "成文",
};

/**
 * 每步读取的上游依赖（对标站的「读取世界·角色」「前 N 层」提示条）。
 * 让用户看懂这一步是从哪来的、边界在哪，不黑盒。
 */
export const CREATION_STEP_INPUTS: Readonly<Record<CreationLoopStepType, string>> = {
  intent: "读取你的灵感与题材选择，只定方向，不展开设定。",
  worldview: "读取意图卡，确定世界规则与核心角色；仿真模式另行验证。",
  title_synopsis: "世界观确认后，生成书名与简介，可在工作台查看和修改。",
  outline: "读取意图卡与世界观，先规划卷与循环索引，再分块生成总纲；仿真模式增加推演素材。",
  chapter_plan: "读取已确认大纲，仅细化当前卷内的小循环、章节目录和当前章纲。",
  chapter_write: "细化当前章纲，经编排、执笔、审校与按需修订后结算；仿真模式增加场景预演。",
};

/** 步骤 id → 步骤类型（后端 id 形如 chapter_write-12，按前缀取类型）。 */
export function stepTypeOf(stepId: string): CreationLoopStepType | "anchor" | null {
  const base = stepId.split("-")[0] ?? stepId;
  if (base === "anchor") return "anchor";
  return (CREATION_LOOP_STEP_TYPES as ReadonlyArray<string>).includes(base)
    ? (base as CreationLoopStepType)
    : null;
}

/** 步骤显示名（未知 id 原样返回）。 */
export function creationStepLabel(stepId: string): string {
  const type = stepTypeOf(stepId);
  if (type === "anchor") return "章节锚点";
  return type ? CREATION_STEP_LABELS_ZH[type] : stepId;
}

/** chapter_write-12 → 12；非章节步骤返回 null。 */
export function chapterNumberOf(stepId: string): number | null {
  const [base, suffix] = stepId.split("-");
  if (base !== "chapter_write" && base !== "chapter_plan") return null;
  const n = Number(suffix);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* ══════════════════════════════════════════════════════════════════
   二、工作流状态（后端 workflow/contracts.ts）
   ══════════════════════════════════════════════════════════════════ */

export type WorkflowStatus =
  | "queued"
  | "running"
  | "awaiting_review"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "awaiting_review"
  | "confirmed"
  | "stale"
  | "rejected"
  | "failed"
  | "paused"
  | "cancelled";

/**
 * 终态 / 闸门态：命中即停止推进。
 * 与后端 ADVANCE_STOP_STATUS_LIST 同源——两份必须相等。
 */
export const CREATION_LOOP_STOP_STATUSES: ReadonlyArray<WorkflowStatus> = [
  "succeeded",
  "failed",
  "cancelled",
  "paused",
  "awaiting_review",
];

/** 是否还在跑（前端据此决定要不要继续轮询 / 转菊花）。 */
export function isLoopRunning(status: WorkflowStatus | null | undefined): boolean {
  return status === "queued" || status === "running";
}

/** 是否停在等人工确认（引导模式据此亮出「通过 / 重铸」）。 */
export function isAwaitingReview(status: WorkflowStatus | null | undefined): boolean {
  return status === "awaiting_review";
}

export interface WorkflowUsage {
  readonly tokens: number;
  readonly costUsd: number;
}

export interface WorkflowStepSnapshot {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly status: WorkflowStepStatus;
  readonly attempt: number;
  readonly output: Readonly<Record<string, unknown>> | null;
  readonly error: string | null;
  readonly reviewFeedback: string | null;
  readonly usage?: WorkflowUsage;
}

export interface WorkflowSnapshot {
  readonly workflowId: string;
  readonly mode: string;
  readonly createdAt: string;
  readonly version: number;
  readonly status: WorkflowStatus;
  readonly currentStepId: string | null;
  readonly usage?: WorkflowUsage;
  readonly steps: ReadonlyArray<WorkflowStepSnapshot>;
}

/* ══════════════════════════════════════════════════════════════════
   三、创建策略 / 审阅策略（两个正交轴）
   ══════════════════════════════════════════════════════════════════ */

/** 后端 CreationStrategy（orchestrate 是 legacy，运行时归一到 simulate）。 */
export type CreationStrategy = "fast" | "simulate";

/** 后端 CreationApprovalPolicy。 */
export type ApprovalPolicy = "review" | "auto";

export interface CreationStrategyInfo {
  readonly id: CreationStrategy;
  readonly label: string;
  readonly description: string;
  readonly memberOnly: boolean;
}

/** 与后端 CREATION_STRATEGIES 一致。 */
export const CREATION_STRATEGIES: ReadonlyArray<CreationStrategyInfo> = [
  {
    id: "fast",
    label: "快速直出",
    description: "六师逐步生成设定与正文，不进行天衍仿真，适合快速出稿。",
    memberOnly: false,
  },
  {
    id: "simulate",
    label: "长篇小说 · 世界模拟引擎",
    description: "六师正常编排，在世界观确认后启用天衍推演，为大纲、卷纲和正文提供素材。",
    memberOnly: true,
  },
];

/**
 * 前端入口的三种模式。
 *
 * ⚠️ 严格说这三个仍不在同一维度：引导/剧场产出**小说**，互动影游产出
 * **影游作品**。两轴划分（创作方式 × 产物形态）概念上更干净，但用户在入口选的
 * 本来就是「我要走哪条端到端的路」，多一层选择是给他加台阶。
 *
 * 接受这个取舍，但守住一条底线：**三个模式互不嵌套**。一旦出现
 * 「互动影游模式里再选剧场/引导」这种二级分叉，说明两轴的本质又冒出来了，
 * 那时再拆。详见 docs/plans/2026-09-04-four-modes-and-pg-migration.md §1.1。
 *
 * 【为什么「全自动」不在这里】
 * 它曾经是第四个模式，但它映射到的只有一件事：`approvalPolicy: "auto"` ——
 * **同一条引导循环，把审阅闸门关掉**。那是参数，不是另一条路。放在模式这一排，
 * 等于把一个正交开关摆成了并列选项，于是「剧场模式能不能也自动跑」这种问题
 * 无处安放。现在它是引导/剧场流程里的一个开关，见 {@link ApprovalPolicy}。
 *
 * `conversation` 是历史名（现在叫「剧场模式」）—— 键名不动，避免动到后端与
 * 已持久化的会话；展示名在 MODE_OPTIONS 里。
 */
export type CreationMode = "guided" | "conversation" | "film";

/**
 * 模式 → 这条路**默认**的审阅策略。
 *
 * 只是默认值：引导与剧场都跑六步编排，用户可以在入口把「全自动」打开，
 * 那时发给后端的是 `"auto"`。互动影游不走六步编排，这里对它没有意义。
 */
export const MODE_TO_BACKEND: Readonly<
  Record<CreationMode, { approvalPolicy: ApprovalPolicy }>
> = {
  guided: { approvalPolicy: "review" },
  conversation: { approvalPolicy: "review" },
  film: { approvalPolicy: "review" },
};

/**
 * 模式的展示信息。入口页和作品库共用一份——两处各写一遍，
 * 迟早出现「入口叫剧场、书架叫对话」这种对不上的情况。
 */
export const CREATION_MODE_META: Readonly<Record<CreationMode, {
  readonly icon: string; readonly label: string; readonly desc: string;
}>> = {
  guided: { icon: "⏸", label: "引导模式", desc: "六步向导，每步停下让你确认" },
  // 「对话模式」→「剧场模式」：页面里本来就叫仿真剧场，名实相符；
  // 而且和「互动影游」并排时，叫「对话」会被当成两种互动玩法之一。
  conversation: { icon: "🎭", label: "剧场模式", desc: "角色在群里把剧情演出来，你可围观、参与、引导" },
  film: { icon: "🎬", label: "互动影游", desc: "分支剧：你的选择决定走向，可重玩、可分享路线" },
};

/**
 * 打开这本书该去哪个页面。
 *
 * 以前作品库不管三七二十一都跳 /workbench —— 用剧场建的书点进去变成了
 * 引导向导，用户以为自己点错了。书用什么模式创作的，就回到那条路。
 */
export function routeForMode(mode: CreationMode, bookId: string): string {
  const id = encodeURIComponent(bookId);
  return mode === "conversation" ? `/conversation/${id}`
    : mode === "film" ? `/film/${id}`
    : `/workbench/${id}`;
}

/**
 * 能不能从 `from` 切到 `to`。
 *
 * 引导 ↔ 剧场：能。两者是**同一条六步编排的两张皮**——都调
 * fetchLoopState / reviewLoopStep，底下是同一个 workflow、同一份产出。
 * 换模式只是换了个看它的方式，不动任何数据。
 *
 * 影游：不能。它根本不跑六步编排（见 supportsAutoRun），产出是另一种东西
 * （StoryGraph 分支图，存在 interactive-films/），不是「同一本书的另一种视图」。
 * 把一本已有正文的书变成影游，是**凝练**（从定稿章节+群聊生成分支图），
 * 那是一次转换、会产生新产物，不是切换视图。反过来同理。
 */
export function canSwitchMode(from: CreationMode, to: CreationMode): boolean {
  if (from === to) return false;
  return from !== "film" && to !== "film";
}

/** 这条路跑不跑六步编排 —— 只有跑的才谈得上「要不要每步停」。 */
export function supportsAutoRun(mode: CreationMode): boolean {
  return mode === "guided" || mode === "conversation";
}

/**
 * 打开全自动之前要跟用户说清楚的三件事。
 *
 * 不是走过场：关掉闸门意味着**没人在中途拦一下**，跑歪了要么等它跑完，
 * 要么手动暂停。这三条各对应一种真实的后果，不要精简成一句「确定吗」。
 */
export const AUTO_RUN_WARNINGS: ReadonlyArray<string> = [
  "六步不再停下等你确认 —— 世界观、大纲、卷纲、正文一路成稿",
  "中途跑偏只能暂停或作废重来，没有逐步纠正的机会",
  "全程无人值守地调用模型，长篇会持续消耗额度",
];

/* ══════════════════════════════════════════════════════════════════
   四、六师治理链（不是流程步骤，是每步/每章内部的治理环节）
   ══════════════════════════════════════════════════════════════════ */

export type GovernanceStage =
  | "plan"
  | "write"
  | "normalize"
  | "audit"
  | "revise"
  | "persist";

export interface GovernanceStageInfo {
  readonly id: GovernanceStage;
  readonly label: string;
  readonly agent: string;
  readonly emoji: string;
  readonly description: string;
}

/**
 * 六师 = BaseAgent 治理框架，跑在**每一步/每一章内部**。
 * 后端 orchestration-strategies.ts：Plan → Writer → Normalize → Audit
 * → Revise → Persist → Memory → Fact。
 */
export const GOVERNANCE_STAGES: ReadonlyArray<GovernanceStageInfo> = [
  { id: "plan", label: "编排", agent: "编排师", emoji: "📐", description: "组织上下文与本步目标" },
  { id: "write", label: "执笔", agent: "执笔师", emoji: "✍️", description: "生成草稿" },
  { id: "normalize", label: "治理", agent: "规范师", emoji: "📏", description: "字数/长度调整到目标" },
  { id: "audit", label: "审校", agent: "审校师", emoji: "🔍", description: "规则与连续性审计" },
  { id: "revise", label: "修订", agent: "修订师", emoji: "🎨", description: "按审计结果定向修订" },
  { id: "persist", label: "结算", agent: "结算师", emoji: "📊", description: "落盘 + 记忆索引 + 真相文件" },
];

/* ══════════════════════════════════════════════════════════════════
   五、天衍推演（仿真编排的前置流水线）
   ══════════════════════════════════════════════════════════════════ */

/** 后端 broadcast("tianyan:pipeline-progress") 的 stage 取值。 */
export type TianyanStage =
  | "aggregate"
  | "ontology"
  | "graph"
  | "graph-done"
  | "prepare"
  | "agents"
  | "simulate"
  | "rounds"
  | "finish"
  | "done";

export interface TianyanStageInfo {
  readonly id: string;
  readonly ordinal: string;
  readonly label: string;
  readonly description: string;
  /** 后端会发的所有 stage 别名。 */
  readonly matches: ReadonlyArray<TianyanStage>;
}

/** 天衍七阶段（与 server.ts pushPipelineStepMessage 的 stageLabel 一致）。 */
export const TIANYAN_STAGES: ReadonlyArray<TianyanStageInfo> = [
  {
    id: "aggregate",
    ordinal: "①",
    label: "聚合世界观",
    description: "聚合题材设定，抽取世界规则 / 修炼体系 / 势力雏形",
    matches: ["aggregate"],
  },
  {
    id: "ontology",
    ordinal: "②",
    label: "本体生成",
    description: "分析文档与模拟需求，提取现实种子，生成本体结构",
    matches: ["ontology"],
  },
  {
    id: "graph",
    ordinal: "③",
    label: "建图 (RAG)",
    description: "基于本体对文档分块，构建知识图谱（实体/关系向量化）",
    matches: ["graph", "graph-done"],
  },
  {
    id: "agents",
    ordinal: "④⑤",
    label: "智能体 / 配置",
    description: "结合图谱整理实体与关系，初始化智能体画像与模拟配置",
    matches: ["prepare", "agents"],
  },
  {
    id: "simulate",
    ordinal: "⑥",
    label: "仿真运行",
    description: "舆情推演，每轮 agent 决策发帖 / 评论",
    matches: ["simulate", "rounds"],
  },
  {
    id: "finish",
    ordinal: "⑦",
    label: "聚合落库",
    description: "聚合推演产出，落库档案卡与事件",
    matches: ["finish", "done"],
  },
];

/** 后端 stage 值 → 前端阶段索引；未知返回 -1。 */
export function tianyanStageIndex(stage: string): number {
  return TIANYAN_STAGES.findIndex((s) =>
    (s.matches as ReadonlyArray<string>).includes(stage),
  );
}

/**
 * 仿真轮次（后端 TIANYAN_ROUNDS）。
 * staged 是各编排步骤的阶梯轮次——前期输入薄轻推演，后期设定齐重推演。
 */
export const TIANYAN_ROUNDS = {
  /** 建书基础仿真 = 模拟 72 小时。 */
  baseSimulationRounds: 72,
  /** 每卷增量。 */
  volumeSimulationRounds: 12,
  staged: {
    intent: 0,
    worldview: 24,
    title_synopsis: 0,
    outline: 48,
    chapter_plan: 24,
    chapter_write: 6,
  } as Readonly<Record<CreationLoopStepType, number>>,
} as const;

/**
 * 各阶段的仿真"场地"（后端 STAGE_PLATFORMS）。
 * twitter = 事件发酵/舆论放大；reddit = 讨论站队/对话链。
 */
export const STAGE_PLATFORMS: Readonly<Partial<Record<CreationLoopStepType, string>>> = {
  worldview: "twitter",
  outline: "twitter",
  chapter_plan: "reddit",
  chapter_write: "reddit",
};

/** 该步是否会跑仿真（轮次 > 0）。 */
export function hasSimulation(type: CreationLoopStepType): boolean {
  return TIANYAN_ROUNDS.staged[type] > 0;
}

/* ══════════════════════════════════════════════════════════════════
   六、可做模型路由的 Agent
   ══════════════════════════════════════════════════════════════════ */

export interface OverridableAgent {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** 建议用强模型（吃结构化输出/长上下文，弱模型容易写不全）。 */
  readonly needsStrong?: boolean;
}

/**
 * 支持 modelOverrides 的 agent 名单。
 *
 * 名字必须与后端 `agentCtxFor("<name>")` 的调用逐字一致——写错不会报错，
 * 只是这条覆盖永远不生效。来源：
 *   grep -rhoE 'agentCtxFor\("[a-z-]+"' packages/core/src/pipeline packages/studio/src/api
 */
export const OVERRIDABLE_AGENTS: ReadonlyArray<OverridableAgent> = [
  { id: "architect", label: "建书架构师", description: "一次生成全书基础设定（世界观/大纲/角色）", needsStrong: true },
  { id: "planner", label: "规划师", description: "章节与循环规划", needsStrong: true },
  { id: "composer", label: "编排师", description: "组织每章的上下文" },
  { id: "writer", label: "执笔师", description: "撰写正文", needsStrong: true },
  { id: "auditor", label: "审校师", description: "一致性与连续性审计" },
  { id: "reviser", label: "修订师", description: "按审计结果定向修订" },
  { id: "foundation-reviewer", label: "设定审校", description: "基础设定完整性审校" },
  { id: "state-validator", label: "状态校验", description: "章节状态一致性校验" },
  { id: "chapter-analyzer", label: "章节分析", description: "章节结构与节奏分析" },
  { id: "length-normalizer", label: "字数治理", description: "长度调整到目标区间" },
  { id: "radar", label: "市场雷达", description: "题材与市场分析" },
  { id: "fanfic-canon-importer", label: "原著导入", description: "同人：原著设定导入" },
  { id: "film-authoring", label: "互动影像", description: "互动影像创作" },
  // 非写书 agent 的两条模型路由，与其它项一样从默认接入的模型列表下拉选择。
  // 后端消费：deai/verdict 的「AI 特征审校师」（一台 chat 模型，读文本找 AI 证据给概率；
  // 困惑度打分模型是另一台，配在 .skoob/deai-scorer.json，chat 模型做不了 teacher forcing）与
  // resolveCoverGenerationRequest（skoob.json 封面/生图模型）。
  { id: "deai-scorer", label: "天工AI检测", description: "AI 特征审校师用的模型：读文本按去 AI 味判据找证据、给 AI 概率。建议与写书模型不同台（同台会判得偏宽）", needsStrong: true },
  { id: "image", label: "AI生图", description: "图片生成模型（覆盖 skoob.json 封面/生图的模型）" },
];

/* ══════════════════════════════════════════════════════════════════
   七、每步由谁执笔（舞台标题用）
   ══════════════════════════════════════════════════════════════════ */

/** 步骤 → 主笔智能体（展示用；真实调度在后端 agentCtxFor）。 */
export const STEP_AUTHOR: Readonly<Record<CreationLoopStepType, string>> = {
  intent: "规划师",
  worldview: "世界观架构师",
  title_synopsis: "编排师",
  outline: "编排师",
  chapter_plan: "规划师",
  chapter_write: "执笔师",
};

/** 步骤图标（已铸档案列表用）。 */
export const STEP_ICON: Readonly<Record<CreationLoopStepType, string>> = {
  intent: "💡",
  worldview: "🌍",
  title_synopsis: "📕",
  outline: "📖",
  chapter_plan: "🧭",
  chapter_write: "✍️",
};

/** 每步在做什么（已铸档案的一行说明）。 */
export const STEP_BRIEF: Readonly<Record<CreationLoopStepType, string>> = {
  intent: "一句话定方向、题材与篇幅，不展开设定。",
  worldview: "定世界底层规则：法则 / 时空 / 势力 / 红线。",
  title_synopsis: "依据已确认世界观，打磨书名与简介。",
  outline: "生成全书故事方向与分卷概要，当前卷的目录在下一步展开。",
  chapter_plan: "细化当前小循环：轮纲、章节目录与本章场景。",
  chapter_write: "按本章章纲成文，审校后更新状态与伏笔。",
};

/**
 * 已确认步骤对应的权威真相文件（可手工编辑的那份）。
 *
 * ⚠️ story_bible.md / book_rules.md 在新版式书里是**只读兼容层**，
 * 后端 PUT 会拒绝（"Legacy compat shim; edit outline/story_frame.md instead"）。
 * 所以世界观要指向 outline/story_frame.md。
 */
export const STEP_TRUTH_FILE: Readonly<Partial<Record<CreationLoopStepType, string>>> = {
  worldview: "outline/story_frame.md",
  title_synopsis: "synopsis.md",
  outline: "outline/volume_map.md",
};
