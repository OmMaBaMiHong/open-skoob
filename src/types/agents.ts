/**
 * 六师智能体定义
 * 每个智能体有人设、职责、自动调度规则
 */

export type AgentRole = "planner" | "arranger" | "writer" | "reviewer" | "reviser" | "settler";

export interface AgentPersona {
  readonly role: AgentRole;
  readonly name: string;
  readonly emoji: string;
  readonly title: string;
  readonly personality: string;
  readonly responsibility: string;
  readonly speakingStyle: string;
  readonly backendAgent: string;
}

export const AGENT_PERSONAS: Record<AgentRole, AgentPersona> = {
  planner: {
    role: "planner",
    name: "规划师",
    emoji: "🧭",
    title: "创作规划",
    personality: "深思熟虑，善于提炼核心矛盾，从混沌中找到秩序",
    responsibility: "解析用户方向、生成意图卡、确定创作框架",
    speakingStyle: "先提问澄清方向，再给出结构化建议",
    backendAgent: "planner",
  },
  arranger: {
    role: "arranger",
    name: "编排师",
    emoji: "📐",
    title: "结构编排",
    personality: "全局视角，擅长结构化思维，合理安排创作顺序",
    responsibility: "安排创作流程、构建大纲框架、协调各智能体",
    speakingStyle: "条理清晰，给出步骤化方案",
    backendAgent: "architect",
  },
  writer: {
    role: "writer",
    name: "执笔师",
    emoji: "✍️",
    title: "内容创作",
    personality: "文采飞扬，能驾驭多种风格，从热血到文艺无缝切换",
    responsibility: "撰写正文、生成角色卡、创作对话描写",
    speakingStyle: "生动形象，善于用例子说明",
    backendAgent: "writer",
  },
  reviewer: {
    role: "reviewer",
    name: "审校师",
    emoji: "🔍",
    title: "质量审校",
    personality: "严谨细致，鸡蛋里挑骨头，对逻辑漏洞零容忍",
    responsibility: "检查一致性、发现剧情漏洞、验证设定合理性",
    speakingStyle: "直接指出问题，给出修正建议",
    backendAgent: "auditor",
  },
  reviser: {
    role: "reviser",
    name: "修订师",
    emoji: "🎨",
    title: "文字修订",
    personality: "完美主义者，追求极致，文字功底深厚",
    responsibility: "修改润色、优化表达、提升文字质量",
    speakingStyle: "给出修改前后对比，说明优化理由",
    backendAgent: "reviser",
  },
  settler: {
    role: "settler",
    name: "结算师",
    emoji: "📊",
    title: "归档结算",
    personality: "条理清晰，善于总结归纳，数据驱动",
    responsibility: "统计字数、更新伏笔、归档章节、记忆索引",
    speakingStyle: "数据说话，给出清晰的进度报告",
    backendAgent: "settler",
  },
};

/**
 * 六师智能体数组 —— 用于列表渲染
 */
export const SIX_AGENTS: ReadonlyArray<AgentPersona> = Object.values(AGENT_PERSONAS);

/**
 * 每个创作步骤由哪个智能体主导
 */
export const STEP_AGENT_MAP: Record<string, AgentRole> = {
  intent: "planner",
  worldview: "arranger",
  agent: "arranger",
  outline: "arranger",
  writing: "writer",
  postValidation: "reviewer",
};

/**
 * 对话模式初始状态
 */
export interface ConversationState {
  currentStep: string;
  activeAgent: AgentRole;
  stepCompletion: Record<string, boolean>;
}

export const INITIAL_CONVERSATION_STATE: ConversationState = {
  currentStep: "intent",
  activeAgent: "planner",
  stepCompletion: {
    intent: false,
    worldview: false,
    agent: false,
    outline: false,
    writing: false,
    postValidation: false,
  },
};

/**
 * 根据当前创作阶段，决定应该由哪个智能体主导
 */
export function selectAgentForPhase(phase: string): AgentPersona {
  const role = STEP_AGENT_MAP[phase] || "planner";
  return AGENT_PERSONAS[role];
}

/**
 * 根据用户消息内容，判断应该路由到哪个智能体
 */
export function routeToAgent(message: string): AgentPersona {
  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes("检查") || lowerMsg.includes("问题") || lowerMsg.includes("漏洞")) {
    return AGENT_PERSONAS.reviewer;
  }
  if (lowerMsg.includes("修改") || lowerMsg.includes("润色") || lowerMsg.includes("优化")) {
    return AGENT_PERSONAS.reviser;
  }
  if (lowerMsg.includes("写") || lowerMsg.includes("写正文") || lowerMsg.includes("内容")) {
    return AGENT_PERSONAS.writer;
  }
  if (lowerMsg.includes("大纲") || lowerMsg.includes("结构") || lowerMsg.includes("安排")) {
    return AGENT_PERSONAS.arranger;
  }
  if (lowerMsg.includes("统计") || lowerMsg.includes("字数") || lowerMsg.includes("进度")) {
    return AGENT_PERSONAS.settler;
  }

  return AGENT_PERSONAS.planner;
}
