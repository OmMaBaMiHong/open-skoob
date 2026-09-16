/**
 * 小说图谱布局纯函数 —— 1:1 自老前端 packages/studio/components/novel-graph/graph-layout.ts。
 * 数据:小说 ontology 图谱节点/边(10 类 kind + SKOOB_KG_EDGE)。
 *
 * 与老前端唯一的差异:分档输入优先用图谱持久化的 weight 字段
 * (拆书侧 plot_weight,后端对全 0 节点用 appearance_count 兜底),
 * 整图 weight 全 0 时退回老前端原逻辑(连接度 degree)。
 */

/** 小说 ontology 节点 kind(10 类)。 */
export const NOVEL_NODE_KINDS = [
  "Character",
  "Location",
  "Event",
  "Organization",
  "Item",
  "Concept",
  "Creature",
  "Ability",
  "Rule",
  "Faction",
] as const;

export type NovelNodeKind = (typeof NOVEL_NODE_KINDS)[number];

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  /** 节点详情卡片(点击展示):类型/属性/摘要。 */
  readonly type?: string;
  readonly attributes?: string;
  readonly summary?: string;
  /** 图谱持久化权重(plot_weight || appearance_count)。 */
  readonly weight?: number;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: string;
}

export interface GraphData {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
  /** 图谱根节点 id（Book 根定位用，与 Graph.graph_id 同源）。 */
  readonly graph_id?: string;
}

const KIND_COLORS: Record<string, string> = {
  Character: "#f59e0b", // amber
  Location: "#10b981", // emerald
  Event: "#3b82f6", // blue
  Organization: "#8b5cf6", // violet
  Item: "#ec4899", // pink
  Concept: "#14b8a6", // teal
  Creature: "#ef4444", // red
  Ability: "#f97316", // orange
  Rule: "#64748b", // slate
  Faction: "#06b6d4", // cyan
  // 全库图谱(知识库层)标签色:天王引擎=小说领域知识库的跨库视图。
  Setting: "#a78bfa",
  AgentTemplate: "#f472b6",
  Skill: "#fbbf24",
  Genre: "#34d399",
  Author: "#60a5fa",
  SourceBook: "#fb7185",
  BookShelf: "#94a3b8",
};

/** kind → 节点颜色(未知 kind 用 slate 灰)。 */
export function nodeKindColor(kind: string): string {
  return KIND_COLORS[kind] ?? "#64748b";
}

/** hex → [h, s, l],h/s/l 均 0..1。 */
function hexToHsl(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

/** [h, s, l](0..1) → hex。 */
function hslToHex(h: number, s: number, l: number): string {
  const hue = (h + 1) % 1;
  const fn = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toByte = (c: number): string => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0");
  return `#${toByte(fn(p, q, hue + 1 / 3))}${toByte(fn(p, q, hue))}${toByte(fn(p, q, hue - 1 / 3))}`;
}

/** 同色相压暗:ratio 0=原色,1=最暗(明度降 55%)。用于按连接度加深节点。 */
export function darkenColor(hex: string, ratio: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0.08, l * (1 - Math.min(1, Math.max(0, ratio)) * 0.55)));
}

export interface GraphLayout {
  readonly nodes: ReadonlyArray<GraphNode & { readonly radius: number; readonly color: string }>;
  readonly edges: ReadonlyArray<GraphEdge>;
}

/** 连接度分档色:灰 → 白 → 绿 → 蓝 → 紫 → 红 → 金,鲜艳度递增。
 * 孤立节点最不鲜艳(灰),连接越多的节点越鲜艳(最高档金色)。 */
export const DEGREE_COLOR_STEPS: ReadonlyArray<string> = [
  "#9ca3af", // 灰
  "#f8fafc", // 白
  "#22c55e", // 绿
  "#3b82f6", // 蓝
  "#8b5cf6", // 紫
  "#ef4444", // 红
  "#f59e0b", // 金
];

/** degree 归一化到 0..6 档位色。 */
export function degreeColor(degree: number, maxDegree: number): string {
  if (maxDegree <= 0) return DEGREE_COLOR_STEPS[0]!;
  const ratio = Math.min(1, Math.max(0, degree / maxDegree));
  const index = Math.min(DEGREE_COLOR_STEPS.length - 1, Math.round(ratio * (DEGREE_COLOR_STEPS.length - 1)));
  return DEGREE_COLOR_STEPS[index]!;
}

/** 预处理节点:半径与颜色都按权重分档——权重越高节点越大、颜色越鲜艳
 * (灰→白→绿→蓝→紫→红→金分档)。权重优先用图谱持久化字段 weight，
 * 整图全 0 时退回老前端原逻辑(连接度 degree)。 */
export function buildGraphLayout(data: GraphData): GraphLayout {
  const degree = new Map<string, number>();
  for (const edge of data.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const maxDegree = Math.max(1, ...[...degree.values()]);
  const maxWeight = Math.max(0, ...data.nodes.map((n) => n.weight ?? 0));
  const nodes = data.nodes.map((node) => {
    const deg = degree.get(node.id) ?? 0;
    // 分档输入:weight 字段优先(数据库里存的权重),全 0 退回连接度
    const ratio = maxWeight > 0 ? (node.weight ?? 0) / maxWeight : deg / maxDegree;
    return {
      ...node,
      radius: 6 + Math.min(ratio * 8, 8) * 1.5,
      color: degreeColor(ratio * maxDegree, maxDegree),
    };
  });
  return { nodes, edges: data.edges };
}
