/**
 * LiveGraph — 天衍图谱实时生长
 *
 * 数据来自后端（SSE tianyan:graph 或 GET /tianyan/graph/data/:graphId），
 * 不再用示例数据。节点位置用「种子随机 + 若干轮力松弛」算出来：
 * 同一批数据永远得到同一个布局（不用 Math.random，避免每次渲染跳来跳去），
 * 新节点进来时只在增量位置上继续松弛，视觉上就是"长出来"。
 *
 * 节点颜色复刻老前端 novel-graph/graph-layout：按权重分档换色
 * （灰→白→绿→蓝→紫→红→金，越重越鲜艳），图谱数据更新时随权重实时变化。
 */
import { useMemo, useRef, useEffect, useState } from "react";
import type { GraphData, GraphNode } from "../lib/api";

interface Placed {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
}

/** 节点类型名（tooltip 用）：按后端 kind/type 归类，未知一律「实体」。 */
const KIND_LABELS: ReadonlyArray<{ match: RegExp; label: string }> = [
  { match: /char|person|agent|人物|角色/i, label: "角色" },
  { match: /place|location|地点|地图|场景/i, label: "地图" },
  { match: /org|faction|势力|组织/i, label: "势力" },
  { match: /item|artifact|物品|道具/i, label: "物品" },
  { match: /event|事件/i, label: "事件" },
  { match: /rule|law|法则|规则/i, label: "法则" },
];

function kindLabel(node: { kind: string; type?: string }): string {
  const key = `${node.type ?? ""} ${node.kind}`;
  return KIND_LABELS.find((c) => c.match.test(key))?.label ?? "实体";
}

/** 32 位整数哈希 → [0,1)。同一个 id 永远得到同一个初始位置。 */
function seededUnit(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/* ── 权重视觉（复刻老前端 novel-graph/graph-layout：按权重分档换色） ── */

/**
 * 权重分档色：灰 → 白 → 绿 → 蓝 → 紫 → 红 → 金，鲜艳度递增。
 * 与老前端 DEGREE_COLOR_STEPS 同源：孤立节点最不鲜艳（灰），
 * 权重越高的节点越鲜艳（最高档金色）。
 */
const WEIGHT_COLOR_STEPS: ReadonlyArray<string> = [
  "#9ca3af", // 灰
  "#f8fafc", // 白
  "#22c55e", // 绿
  "#3b82f6", // 蓝
  "#8b5cf6", // 紫
  "#ef4444", // 红
  "#f59e0b", // 金
];

/** 权重比 0..1 → 档位色（对齐老前端 degreeColor：归一化后四舍五入取档）。 */
function weightStepColor(ratio: number): string {
  const r = Math.min(1, Math.max(0, ratio));
  const index = Math.min(
    WEIGHT_COLOR_STEPS.length - 1,
    Math.round(r * (WEIGHT_COLOR_STEPS.length - 1)),
  );
  return WEIGHT_COLOR_STEPS[index]!;
}

/**
 * 力导向布局：斥力（节点互推）+ 引力（有边的互拉）+ 向心力（防飘散）。
 * 迭代次数固定，纯同步——图谱几百个节点足够快，不需要动画帧循环。
 */
function layout(data: GraphData, w: number, h: number): ReadonlyArray<Placed> {
  const nodes = data.nodes;
  if (nodes.length === 0) return [];
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.38;

  // 初始位置：按 id 哈希撒在圆盘上（确定性）
  const pos = nodes.map((n) => {
    const angle = seededUnit(n.id, 1) * Math.PI * 2;
    const r = Math.sqrt(seededUnit(n.id, 2)) * radius;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });

  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links = data.edges
    .map((e) => ({ s: index.get(e.source), t: index.get(e.target) }))
    .filter((l): l is { s: number; t: number } => l.s !== undefined && l.t !== undefined);

  const ITER = 160;
  // 斥力按「每个节点应分到的面积」定标：节点越少铺得越开，越多则自动收紧，
  // 不会出现十来个节点挤在中心一小团、四周大片空白。
  const area = w * h;
  const ideal = Math.sqrt(area / nodes.length) * 0.62;
  const repulsion = ideal * ideal;
  for (let step = 0; step < ITER; step += 1) {
    const cool = 1 - step / ITER;
    // 斥力
    for (let i = 0; i < pos.length; i += 1) {
      for (let j = i + 1; j < pos.length; j += 1) {
        const a = pos[i]!;
        const b = pos[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (seededUnit(`${i}-${j}`, 3) - 0.5) || 0.5; dy = 0.5; d2 = 1; }
        const f = (repulsion / d2) * cool;
        const d = Math.sqrt(d2);
        a.x += (dx / d) * f; a.y += (dy / d) * f;
        b.x -= (dx / d) * f; b.y -= (dy / d) * f;
      }
    }
    // 引力（边）
    for (const { s, t } of links) {
      const a = pos[s]!;
      const b = pos[t]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      // 引力只在超过理想边长后才发力，避免把相连节点拽成一坨
      const f = ((d - ideal) * 0.06) * cool;
      a.x += (dx / d) * f; a.y += (dy / d) * f;
      b.x -= (dx / d) * f; b.y -= (dy / d) * f;
    }
    // 向心：只做很弱的兜底，防止孤立节点飘出画布
    for (const p of pos) {
      p.x += (cx - p.x) * 0.004 * cool;
      p.y += (cy - p.y) * 0.004 * cool;
    }
  }

  const padX = 34;
  const padTop = 20;   // 标签画在节点上方 11px 处，顶部要留出来
  const padBottom = 12;
  return nodes.map((n, i) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    x: Math.max(padX, Math.min(w - padX, pos[i]!.x)),
    y: Math.max(padTop, Math.min(h - padBottom, pos[i]!.y)),
  }));
}

export function LiveGraph({
  data,
  height = 320,
  fill = false,
  onSelect,
  selectedId = null,
}: {
  readonly data: GraphData;
  readonly height?: number;
  /** 撑满容器（忽略 height）：图谱整页展示时用。 */
  readonly fill?: boolean;
  readonly onSelect?: (node: GraphNode) => void;
  /** 当前选中节点：加描边高亮（参考老前端 ReactGraphCanvas 的选中态）。 */
  readonly selectedId?: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(480);
  /** fill 模式下 svg 高度跟随容器；非 fill 用 height prop。 */
  const [fillHeight, setFillHeight] = useState(0);
  /** 视口变换：滚轮缩放 + 背景拖拽平移（老前端 d3 zoom 的无依赖版）。 */
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  /** 节点拖拽位移覆盖：key 节点 id，值是相对布局位置的偏移（已除缩放）。 */
  const [offsets, setOffsets] = useState<ReadonlyMap<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 480;
      if (w > 0) setWidth(w);
      const h = entry?.contentRect.height ?? 0;
      if (h > 0) setFillHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 换一本书（另一份数据）时清掉拖拽痕迹与视口，布局重新开始。
  useEffect(() => {
    setOffsets(new Map());
    setView({ x: 0, y: 0, k: 1 });
  }, [data]);

  /* 滚轮缩放：以光标为锚点（k 变了，光标下的图坐标不动）。 */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(4, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        const ratio = k / v.k;
        return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const placed = useMemo(() => layout(data, width, fill ? (fillHeight || height) : height), [data, width, height, fill, fillHeight]);
  const byId = useMemo(() => {
    const m = new Map(placed.map((p) => [p.id, p]));
    // 拖拽覆盖生效
    for (const [id, off] of offsets) {
      const p = m.get(id);
      if (p) m.set(id, { ...p, x: p.x + off.x, y: p.y + off.y });
    }
    return m;
  }, [placed, offsets]);
  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);

  /*
   * 权重归一化：大小与颜色分档都按它。权重 = 图谱里持久化的 weight 字段
   * （拆书侧 plot_weight，后端对全 0 节点用 appearance_count 出场次数兜底）。
   * 整图权重全 0 的防御性兜底才是连接度——正常数据走不到。
   */
  const degreeOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.edges) {
      m.set(e.source, (m.get(e.source) ?? 0) + 1);
      m.set(e.target, (m.get(e.target) ?? 0) + 1);
    }
    return m;
  }, [data.edges]);
  const weightRatio = useMemo(() => {
    const weights = data.nodes.map((n) => n.weight ?? 0);
    const maxW = Math.max(...weights, 0);
    const maxD = Math.max(...degreeOf.values(), 1);
    const m = new Map<string, number>();
    for (const n of data.nodes) {
      m.set(n.id, maxW > 0 ? (n.weight ?? 0) / maxW : (degreeOf.get(n.id) ?? 0) / maxD);
    }
    return m;
  }, [data.nodes, degreeOf]);

  // 记录已出现过的节点：新节点才播生长动画，老节点不重播
  const seenRef = useRef<Set<string>>(new Set());
  const fresh = new Set<string>();
  for (const p of placed) {
    if (!seenRef.current.has(p.id)) fresh.add(p.id);
  }
  useEffect(() => {
    for (const p of placed) seenRef.current.add(p.id);
  }, [placed]);

  /* 背景拖拽 = 平移视口；节点拖拽 = 挪节点。点击与拖拽用 4px 位移区分。 */
  const dragRef = useRef<{
    mode: "pan" | "node"; id?: string; sx: number; sy: number; moved: boolean;
  } | null>(null);

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget && (e.target as Element).tagName !== "rect") return;
    dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    dragRef.current = { mode: "node", id, sx: e.clientX, sy: e.clientY, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.mode === "pan") {
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      d.sx = e.clientX; d.sy = e.clientY;
    } else if (d.id) {
      const id = d.id;
      setOffsets((prev) => {
        const next = new Map(prev);
        const cur = next.get(id) ?? { x: 0, y: 0 };
        next.set(id, { x: cur.x + dx / view.k, y: cur.y + dy / view.k });
        return next;
      });
      d.sx = e.clientX; d.sy = e.clientY;
    }
  };
  const onPointerUp = () => { dragRef.current = null; };

  /* 实际渲染高度：fill 模式跟容器（未测量到前退回 height prop 兜底）。 */
  const h = fill ? (fillHeight || height) : height;

  return (
    <div ref={wrapRef} className={`lg-wrap${fill ? " is-fill" : ""}`} style={fill ? undefined : { height }}>
      {placed.length === 0 ? (
        <div className="lg-empty">
          <span className="lg-empty-pulse" />
          图谱尚未生成 · 等待建图阶段
        </div>
      ) : (
        <svg
          ref={svgRef}
          width={width}
          height={h}
          className="lg-svg is-interactive"
          onPointerDown={onSvgPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {/* 透明底矩形接平移拖拽（点在空白处也能拖） */}
          <rect width={width} height={h} fill="transparent" />
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            <g className="lg-edges">
              {data.edges.map((e) => {
                const a = byId.get(e.source);
                const b = byId.get(e.target);
                if (!a || !b) return null;
                const hot = selectedId !== null && (e.source === selectedId || e.target === selectedId);
                return (
                  <line
                    key={e.id}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    className={`lg-edge${hot ? " is-hot" : ""}`}
                  />
                );
              })}
            </g>
            <g className="lg-nodes">
              {placed.map((p) => {
                const node = nodeById.get(p.id);
                const ratio = weightRatio.get(p.id) ?? 0;
                // 复刻老前端：颜色按权重分档换色（灰→金），不再按类型定色相。
                const color = weightStepColor(ratio);
                // 权重定大小：最轻 4px，最重 13px（根节点固定大一点）。
                const isRoot = node?.kind === "Book";
                const r = isRoot ? 11 : 4 + ratio * 9;
                const pos = byId.get(p.id) ?? p;
                return (
                  <g
                    key={p.id}
                    className={`lg-node is-draggable ${fresh.has(p.id) ? "is-new" : ""}${selectedId === p.id ? " is-on" : ""}`}
                    transform={`translate(${pos.x},${pos.y})`}
                    onPointerDown={(e) => onNodePointerDown(e, p.id)}
                    onClick={() => {
                      // 拖拽结束的抬起不算点击
                      if (dragRef.current?.moved) return;
                      if (node) onSelect?.(node);
                    }}
                  >
                    <circle r={r + 5} fill={color} opacity={0.14} className="lg-halo" />
                    {/* 描边走 CSS（.lg-dot）：白色档在浅色背景上靠描边撑出轮廓 */}
                    <circle r={r} fill={color} className="lg-dot" />
                    <text y={-11} className="lg-label">{p.label}</text>
                    <title>{`${p.label} · ${node ? kindLabel(node) : "实体"}${node?.weight ? ` · 权重 ${node.weight}` : ""}`}</title>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      )}
    </div>
  );
}

/** 图例：权重色阶（节点颜色只表权重、不表类型——与老前端分档色一致）。 */
export function GraphLegend() {
  return (
    <div className="lg-legend">
      <span className="lg-legend-item">权重</span>
      {WEIGHT_COLOR_STEPS.map((color) => (
        <span key={color} className="lg-legend-item">
          <i style={{ background: color, border: "1px solid var(--line)" }} />
        </span>
      ))}
      <span className="lg-legend-item">孤立 → 核心</span>
    </div>
  );
}
