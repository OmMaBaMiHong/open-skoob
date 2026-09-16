/**
 * 互动影游的播放内核 —— **确定性状态机，一次 LLM 都不调**。
 *
 * ⚠️ 这是 `packages/core/src/interactive-film/evaluator.ts` 的**镜像**。
 * 前端不能 import `@skoob/core`（会把 node:crypto 带进浏览器打包，见
 * types/creation-loop.ts 头注释里的同一条约束），所以两边各持一份 ——
 * **改后端务必同步这里**，两份逻辑一旦漂移，玩家看到的选项就是错的。
 *
 * 与剧场（LLM 逐轮推演）的根本区别就在这：影游是把可能性**收敛**成一张有限的
 * 图，所以能穷举、能校验、能零成本重玩。播放时不该有任何模型调用。
 */

/* ── 图的形状（镜像 core/interactive-film/graph-schema.ts） ── */

export type VarValue = number | string | boolean;
export type VarState = Record<string, VarValue>;

export interface Condition {
  readonly var: string;
  readonly op: ">=" | "<=" | ">" | "<" | "==" | "!=";
  readonly value: VarValue;
}

export interface Effect {
  readonly var: string;
  readonly op: "set" | "add" | "sub";
  readonly value: VarValue;
}

export interface Choice {
  readonly id: string;
  readonly text: string;
  readonly targetNodeId: string;
  readonly condition?: Condition;
  readonly effects?: ReadonlyArray<Effect>;
  /** 决定的分量。`critical` = 不可逆，界面要标出来。 */
  readonly weight?: "light" | "heavy" | "critical";
}

export interface DialogueLine {
  readonly speaker: string;
  readonly text: string;
  readonly emotion: string;
}

export type NodeType = "start" | "normal" | "branch" | "merge" | "ending" | "explore";

/** 节点配图。`assetRef` 空 = 还没画，诊断面板会报 IMAGE_MISSING。 */
export interface ImageSlot {
  readonly prompt: string;
  readonly assetRef?: string;
}

export interface StoryNode {
  readonly id: string;
  readonly title: string;
  readonly type: NodeType;
  readonly sceneDesc: string;
  readonly dialogue: ReadonlyArray<DialogueLine>;
  readonly choices: ReadonlyArray<Choice>;
  readonly imageSlot?: ImageSlot;
  readonly act?: string;
}

export interface Variable {
  readonly name: string;
  readonly type: "flag" | "counter" | "relationship" | "item";
  readonly default: VarValue;
  readonly desc: string;
}

export interface Ending {
  readonly id: string;
  readonly nodeId: string;
  readonly title: string;
  readonly type: "good" | "bad" | "neutral" | "secret";
  readonly description: string;
}

export interface StoryGraph {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly title: string;
  readonly characters?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly role?: string; readonly motivation?: string }>;
  readonly variables: ReadonlyArray<Variable>;
  readonly nodes: ReadonlyArray<StoryNode>;
  readonly endings: ReadonlyArray<Ending>;
}

/* ── 求值（逐字镜像后端） ── */

export function evaluateCondition(condition: Condition | undefined, vars: VarState): boolean {
  if (!condition) return true;
  const lhs = vars[condition.var];
  const rhs = condition.value;
  switch (condition.op) {
    case "==": return lhs === rhs;
    case "!=": return lhs !== rhs;
    case ">=": return Number(lhs) >= Number(rhs);
    case "<=": return Number(lhs) <= Number(rhs);
    case ">": return Number(lhs) > Number(rhs);
    case "<": return Number(lhs) < Number(rhs);
  }
}

export function applyEffects(vars: VarState, effects: ReadonlyArray<Effect> | undefined): VarState {
  if (!effects || effects.length === 0) return vars;
  const next: VarState = { ...vars };
  for (const e of effects) {
    if (e.op === "set") {
      next[e.var] = e.value;
    } else {
      const cur = Number(next[e.var] ?? 0);
      const delta = Number(e.value);
      next[e.var] = e.op === "add" ? cur + delta : cur - delta;
    }
  }
  return next;
}

export function initVarState(variables: ReadonlyArray<Variable>): VarState {
  const state: VarState = {};
  for (const v of variables) state[v.name] = v.default;
  return state;
}

/* ── 播放侧：比后端多的那点东西 ── */

/**
 * 一个选项在界面上的状态。
 *
 * 后端的 `visibleChoices` 只做过滤；界面**不能**直接照搬 ——
 * 把不满足条件的选项藏起来，玩家永远不知道这里还有一条路，重玩的动机就没了。
 * 所以这里返回全部选项，逐个标出「为什么现在选不了」。
 */
export interface ChoiceState {
  readonly choice: Choice;
  readonly enabled: boolean;
  /** 不可选的原因（`需要 胆识 ≥ 3` 这种），可选时为空。 */
  readonly lockedBy: string;
}

const OP_TEXT: Readonly<Record<Condition["op"], string>> = {
  ">=": "≥", "<=": "≤", ">": ">", "<": "<", "==": "=", "!=": "≠",
};

export function choiceStates(
  node: StoryNode,
  vars: VarState,
  variables: ReadonlyArray<Variable> = [],
): ReadonlyArray<ChoiceState> {
  const descOf = (name: string) => variables.find((v) => v.name === name)?.desc || name;
  return node.choices.map((choice) => {
    const enabled = evaluateCondition(choice.condition, vars);
    return {
      choice,
      enabled,
      lockedBy: enabled || !choice.condition
        ? ""
        : `需要 ${descOf(choice.condition.var)} ${OP_TEXT[choice.condition.op]} ${String(choice.condition.value)}`,
    };
  });
}

/** effects → 「好感 +1 · 胆识 +2」这样的行内轻提示（不弹窗，弹窗打断沉浸）。 */
export function effectsText(
  effects: ReadonlyArray<Effect> | undefined,
  variables: ReadonlyArray<Variable> = [],
): string {
  if (!effects || effects.length === 0) return "";
  const descOf = (name: string) => variables.find((v) => v.name === name)?.desc || name;
  return effects.map((e) => {
    if (e.op === "set") return `${descOf(e.var)} = ${String(e.value)}`;
    const sign = e.op === "add" ? "+" : "−";
    return `${descOf(e.var)} ${sign}${String(e.value)}`;
  }).join(" · ");
}

export function startNodeOf(graph: StoryGraph): StoryNode | null {
  return graph.nodes.find((n) => n.type === "start") ?? graph.nodes[0] ?? null;
}

export function nodeById(graph: StoryGraph, id: string): StoryNode | null {
  return graph.nodes.find((n) => n.id === id) ?? null;
}

export function endingOfNode(graph: StoryGraph, nodeId: string): Ending | null {
  return graph.endings.find((e) => e.nodeId === nodeId) ?? null;
}

/**
 * 一条走过的路径 —— 重玩与分享都靠它。
 *
 * 存的是**选择序列**而不是节点序列：选择才是玩家做的事，节点是推导出来的。
 */
export interface PlayStep {
  readonly nodeId: string;
  readonly choiceId: string;
  readonly choiceText: string;
}

/** 从头重放一条路径，得到终点节点与变量状态（用于「从某个岔路重来」与分享回放）。 */
export function replay(
  graph: StoryGraph,
  steps: ReadonlyArray<PlayStep>,
): { readonly node: StoryNode | null; readonly vars: VarState } {
  let node = startNodeOf(graph);
  let vars = initVarState(graph.variables);
  for (const step of steps) {
    if (!node) break;
    const choice = node.choices.find((ch) => ch.id === step.choiceId);
    if (!choice) break;                       // 图改过了，路径对不上就停在这
    vars = applyEffects(vars, choice.effects);
    node = nodeById(graph, choice.targetNodeId);
  }
  return { node, vars };
}
