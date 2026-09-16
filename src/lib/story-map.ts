/**
 * 分支图布局 —— 把一张 StoryGraph 摊成可画的坐标。
 *
 * 从老 studio 的 `story-flow-layout.ts` 移过来（Phase 6.2c）。老版把结果喂给
 * ReactFlow；这里只出坐标，渲染交给一段 SVG —— 新前端没有 ReactFlow，为一张
 * 只读的结构图装一整套画布库（还带自己的一套 CSS）不划算。
 *
 * 布局本身没变：BFS 深度当列，同列依次排行。纯函数，单测直接覆盖。
 */
import type { StoryGraph } from "./story-play";

export const MAP_COL = 190;
export const MAP_ROW = 74;
export const MAP_NODE_W = 132;
export const MAP_NODE_H = 40;

export interface MapNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly nodeType: string;
  /** BFS 深度（第几步能走到）。孤岛节点被排在最后一列。 */
  readonly depth: number;
  /** 从 start 出发根本走不到 —— 画成虚线灰块。 */
  readonly unreachable: boolean;
}

export interface MapEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
  /** 这条边有 condition 门槛。 */
  readonly gated: boolean;
  /** 不可逆的关键抉择（weight: critical）。 */
  readonly critical: boolean;
}

export interface StoryMap {
  readonly nodes: ReadonlyArray<MapNode>;
  readonly edges: ReadonlyArray<MapEdge>;
  readonly width: number;
  readonly height: number;
}

export function layoutStoryMap(graph: StoryGraph): StoryMap {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  /* BFS 定深度：start 是第 0 列。 */
  const start = graph.nodes.find((n) => n.type === "start") ?? graph.nodes[0];
  const depth = new Map<string, number>();
  if (start) {
    const queue: Array<{ id: string; d: number }> = [{ id: start.id, d: 0 }];
    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      if (depth.has(id)) continue;
      depth.set(id, d);
      for (const choice of nodeMap.get(id)?.choices ?? []) {
        if (ids.has(choice.targetNodeId) && !depth.has(choice.targetNodeId)) {
          queue.push({ id: choice.targetNodeId, d: d + 1 });
        }
      }
    }
  }
  // 走不到的节点单独堆在最后一列 —— 它们本身就是要给作者看的问题。
  const reached = new Set(depth.keys());
  const maxDepth = depth.size > 0 ? Math.max(...depth.values()) : 0;

  const rowByDepth = new Map<number, number>();
  const nodes: MapNode[] = graph.nodes.map((node) => {
    const d = depth.get(node.id) ?? maxDepth + 1;
    const row = rowByDepth.get(d) ?? 0;
    rowByDepth.set(d, row + 1);
    return {
      id: node.id,
      x: d * MAP_COL,
      y: row * MAP_ROW,
      label: node.title || node.id,
      nodeType: node.type,
      depth: d,
      unreachable: !reached.has(node.id),
    };
  });

  const edges: MapEdge[] = [];
  for (const node of graph.nodes) {
    for (const choice of node.choices) {
      if (!ids.has(choice.targetNodeId)) continue; // 断链交给校验器报，图上不画悬空线
      edges.push({
        id: `${node.id}->${choice.id}`,
        source: node.id,
        target: choice.targetNodeId,
        label: choice.text,
        gated: !!choice.condition,
        critical: choice.weight === "critical",
      });
    }
  }

  const cols = Math.max(1, ...nodes.map((n) => n.depth + 1));
  const rows = Math.max(1, ...rowByDepth.values());
  return {
    nodes,
    edges,
    width: cols * MAP_COL + MAP_NODE_W,
    height: rows * MAP_ROW + MAP_NODE_H,
  };
}
