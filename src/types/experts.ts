/**
 * 智能体 —— 焚决可调用的能力。
 *
 * 术语（用户定义）：
 *   智能体   单个 Agent
 *   专家团   **多个智能体组合起来一起干一件事**（编队），不是另一种东西
 *
 * 真相源是**图谱**：所有创作过程中生成的智能体都永久沉淀在 Neo4j，
 * 构成小说创作领域的知识库资产。书内的 agent_configs.md 只是给人读的快照，
 * 不要拿它当数据源（字段残缺，且只覆盖单本书）。
 *
 * ⚠️ 三类的性质完全不同，UI 上不能混为一谈：
 *
 * 1. 六师（治理链）：**自动**跑在每一步/每一章内部，用户召唤不了。
 *    把它做成"召唤按钮"是假的——它本来就一直在干活。
 *    它的价值在于让用户看见「我买的会员，每一章都过了六道工序」。
 *
 * 2. 技能（17 个）：真能召唤。走 requestedSkills，后端传进 runAgentSession，
 *    实打实改变本轮可用能力。
 *
 * 3. 智能体：图谱里跨书沉淀的画像（GET /tianyan/agents）。
 *    没有专用请求字段，召唤 = 把档案前置进 instruction
 *    （与后端 toolDirective 同一套路数）。
 *
 * 4. 能力引用：流派 / 智能体模板，走 capabilityRefs —— 后端从图谱取内容
 *    注入本轮系统提示词。
 */
import { GOVERNANCE_STAGES, type GovernanceStage } from "./creation-loop";

/* ── 一、六师（自动治理链） ── */
export interface MasterInfo {
  readonly id: GovernanceStage;
  readonly name: string;
  readonly emoji: string;
  readonly role: string;
  /** 它到底在每一步里干了什么——这句话是卖点本身。 */
  readonly does: string;
}

export const SIX_MASTERS: ReadonlyArray<MasterInfo> = GOVERNANCE_STAGES.map((g) => ({
  id: g.id,
  name: g.agent,
  emoji: g.emoji,
  role: g.label,
  does: g.description,
}));

/* ── 二、本书智能体（天衍推演产物） ── */
export type AgentTier = "主角型" | "反派/对立型" | "配角型" | "势力代表型" | "背景/器物型" | string;

export interface StoryAgent {
  readonly name: string;
  readonly tier: AgentTier;
  /** 剧情参与权重 0-100，天衍用它决定谁在推演里更活跃。 */
  readonly weight: number;
  readonly brief: string;
  readonly persona?: string;
}

/**
 * 档位归一。
 * 图谱里存的是英文枚举（protagonist/antagonist/supporting/faction_leader/
 * background/public），md 快照里是中文——两边都要认。
 */
/* ── 智能体分类（与后端 AGENT_TYPE_DEFS 一一对应） ── */

/**
 * 后端 `AGENT_TYPE_DEFS`（packages/engines/tianyan/src/services/agent-type-classifier.ts）
 * 定义了 **9 个**分类，这里是它的前端镜像。
 *
 * ⚠️ typeId / zhLabel / weight / emoji 必须与后端逐字一致——分类是分类器产出的
 * 权威结果，前端只做展示映射，不做二次判断。改后端记得改这里。
 *
 * 历史问题：旧的 tierStyle() 用 `tier.includes("主角")` 这类模糊匹配猜分类，
 * 只覆盖 6 类（漏了盟友/导师、媒体、特殊能力），而且读的是 `tier` 字段——
 * tier 是 major/minor **层级**，类型在 agentType。两件事被混成了一件。
 */
export interface AgentTypeInfo {
  readonly typeId: string;
  readonly label: string;
  readonly emoji: string;
  readonly icon: string;
  /** CSS tone，用于配色。 */
  readonly tone: string;
  /** 该分类的既定剧情权重。 */
  readonly weight: number;
  /** 它在推演里怎么行动——详情页展示，让用户看懂分类不是标签而是行为。 */
  readonly behavior: string;
}

export const AGENT_TYPES: ReadonlyArray<AgentTypeInfo> = [
  { typeId: "protagonist",   label: "主角型",      emoji: "🐕", icon: "★", tone: "lead",       weight: 99, behavior: "主动行动、带动舆论" },
  { typeId: "antagonist",    label: "反派/对立型", emoji: "🌑", icon: "⚔", tone: "foe",        weight: 90, behavior: "压制主角、操纵舆论" },
  { typeId: "faction_leader",label: "势力代表型",  emoji: "🏢", icon: "⚑", tone: "faction",    weight: 80, behavior: "官方口径、资源动员" },
  { typeId: "ally_mentor",   label: "盟友/导师型", emoji: "🛡", icon: "✥", tone: "ally",       weight: 70, behavior: "支持主角、信息供给" },
  { typeId: "media",         label: "媒体/播报型", emoji: "🗞", icon: "✍", tone: "media",      weight: 60, behavior: "报道、放大事件" },
  { typeId: "specialist",    label: "特殊能力型",  emoji: "⚔️", icon: "✦", tone: "specialist", weight: 60, behavior: "展现能力、卷入冲突" },
  { typeId: "supporting",    label: "配角型",      emoji: "👥", icon: "◆", tone: "side",       weight: 55, behavior: "参与非主导" },
  { typeId: "background",    label: "背景/器物型", emoji: "🔧", icon: "◻", tone: "prop",       weight: 20, behavior: "低存在感、被卷入才表态" },
  { typeId: "public",        label: "舆情主体型",  emoji: "👤", icon: "◇", tone: "public",     weight: 15, behavior: "围观、表态、跟风" },
];

const BY_TYPE_ID = new Map(AGENT_TYPES.map((t) => [t.typeId, t]));
/** 中文标签也能反查：历史数据里存过 zhLabel 而不是 typeId。 */
const BY_LABEL = new Map(AGENT_TYPES.map((t) => [t.label, t]));

const UNKNOWN: AgentTypeInfo = {
  typeId: "", label: "未分类", emoji: "○", icon: "○", tone: "prop",
  weight: 0, behavior: "尚未归类",
};

/**
 * 分类查询：优先 typeId，回落中文标签，再回落宽松匹配。
 *
 * 宽松匹配只为兜历史脏数据（tier 里存过类型值、中文标签写法不一），
 * 新数据一律走 typeId 精确命中。
 */
export function agentTypeOf(raw: string | undefined | null): AgentTypeInfo {
  const v = (raw ?? "").trim();
  if (!v) return UNKNOWN;
  return BY_TYPE_ID.get(v)
    ?? BY_LABEL.get(v)
    ?? AGENT_TYPES.find((t) => v.includes(t.typeId) || t.label.split("/").some((seg) => v.includes(seg)))
    ?? UNKNOWN;
}

/** 层级（major/minor）——与分类是两个维度，不要混用。 */
export function tierLabel(tier: string | undefined | null): string | null {
  const t = (tier ?? "").trim().toLowerCase();
  if (t === "major") return "主要";
  if (t === "minor") return "次要";
  return null;   // 历史脏值（tier 里存了类型）不展示，避免误导
}

/**
 * @deprecated 改用 {@link agentTypeOf}（读 agentType 字段）+ {@link tierLabel}。
 * 保留是因为它同时接受被污染的 tier 值；新代码不要再调。
 */
export function tierStyle(tier: string): { icon: string; tone: string; label: string } {
  const t = agentTypeOf(tier);
  return { icon: t.icon, tone: t.tone, label: t.label };
}

/**
 * 解析 story/tianyan/agent_configs.md 的表格。
 *
 * 后端把天衍智能体配置落成 markdown 表：
 *   | 名字 | 分类 | 档位 | 目标 | 简介 | 人设 | 剧情参与 | 流派标签 |
 * 这是目前唯一能按书拿到智能体清单的途径（没有专门的 REST 端点）。
 */
export function parseAgentConfigs(md: string): ReadonlyArray<StoryAgent> {
  const out: StoryAgent[] = [];
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 7) continue;
    const [name, tier, , , brief, persona, weightRaw] = cells;
    if (!name || name === "名字" || /^-+$/.test(name)) continue;
    const weight = Number(weightRaw);
    out.push({
      name,
      tier: tier || "未分类",
      weight: Number.isFinite(weight) ? weight : 0,
      brief: brief || persona || "",
      ...(persona ? { persona } : {}),
    });
  }
  // 按剧情参与度排：谁更重要谁在前
  return out.sort((a, b) => b.weight - a.weight);
}

/** 编队里的一个成员（图谱智能体）。 */
export interface TeamAgent {
  readonly name: string;
  readonly tier: string;
  readonly graphId?: string;
  readonly bio?: string;
  readonly persona?: string;
  readonly goal?: string;
  readonly conflict?: string;
  readonly abilities?: string;
  readonly relationships?: string;
}

/**
 * 召唤智能体时前置给 Agent 的档案块。
 *
 * 尽量把图谱里有的画像都带上——只给名字和一句简介，模型没东西可抓。
 */
export function buildAgentDirective(agents: ReadonlyArray<TeamAgent>): string {
  if (agents.length === 0) return "";
  const lines = agents.map((a) => {
    const parts = [`- **${a.name}**（${tierStyle(a.tier).label}）`];
    if (a.bio) parts.push(`简介：${a.bio}`);
    if (a.persona && a.persona !== a.bio) parts.push(`人设：${a.persona}`);
    if (a.goal) parts.push(`目标：${a.goal}`);
    if (a.conflict) parts.push(`冲突：${a.conflict}`);
    if (a.abilities) parts.push(`能力：${a.abilities}`);
    if (a.relationships) parts.push(`关系：${a.relationships}`);
    return parts.join("\n  ");
  });
  return [
    "## 本轮召集的智能体（写作时以他们为准，不要另造人物）",
    ...lines,
  ].join("\n");
}
