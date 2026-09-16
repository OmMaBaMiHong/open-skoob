/**
 * React 图谱画布 — 1:1 自老前端 packages/studio/components/novel-graph/ReactGraphCanvas。
 *
 * d3 force simulation:forceLink/forceManyBody/forceCenter/forceCollide/forceX/forceY +
 * 节点拖拽(drag)+ 缩放(zoom)+ hover 高亮 + 点击回调。
 * 数据:小说 ontology 图谱(10 类 kind,见 graph-layout)。
 *
 * 与老前端的差异仅在外壳:studio-v2 无 tailwind,容器用 rgc-* CSS 类;
 * 节点详情浮层统一由上层(GraphStage 档案卡)展示,组件内不再开第二个。
 * 另有一处刻意不同:选中高亮拆成独立 effect、点击回调走 ref——老版把
 * selectedNodeId/回调都放进重建依赖,点一个节点整张画布推倒重排(连环抖动),
 * 现在画布只在 graph/theme 变化时重建,点节点只改描边高亮,布局纹丝不动。
 */
import { useEffect, useRef } from "react";
import { useTheme } from "../../hooks/use-theme";
import * as d3 from "d3";
import { buildGraphLayout, type GraphData, type GraphNode } from "./graph-layout";

interface ReactGraphCanvasProps {
  readonly graph: GraphData;
  /** 当前选中的节点 id(d3 高亮:紫色描边 + 相连边高亮)。 */
  readonly selectedNodeId?: string | null;
  readonly onNodeClick?: (nodeId: string, node: GraphNode) => void;
  /** 边点击回调(对齐 miroshark:关系详情)。 */
  readonly onEdgeClick?: (edge: { source: string; target: string; type: string }) => void;
}

/** d3 force 节点:GraphNode + 布局/物理字段。 */
type SimNode = GraphNode & {
  readonly radius: number;
  readonly color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
};

interface SimLink {
  source: SimNode;
  target: SimNode;
  type: string;
}

export function ReactGraphCanvas({ graph, selectedNodeId, onNodeClick, onEdgeClick }: ReactGraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // 主题适配:浅色背景下标签用深色字(固定 #e2e8f0 浅灰在浅色背景不可见);
  // 接入 useTheme 让主题切换触发重绘(effect 依赖 theme)。
  const { theme } = useTheme();
  // 点击回调走 ref:调用方(拆书/写书图谱页)传的是内联箭头函数,每次渲染都是
  // 新引用——不应成为整张画布推倒重排的理由。画布只认 graph/theme。
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const onEdgeClickRef = useRef(onEdgeClick);
  onEdgeClickRef.current = onEdgeClick;
  // 选中高亮函数由重建 effect 闭包提供,选中变化时单独调用(不重建画布)。
  const applySelectionRef = useRef<((selected: string | null | undefined) => void) | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;
    const isDark = theme === "dark";
    const labelColor = isDark ? "#e2e8f0" : "#1f2937";
    const linkLabelColor = isDark ? "#94a3b8" : "#64748b";
    const layout = buildGraphLayout(graph);

    // Book 根节点固定视口中心(d3 fx/fy 锁定),实体散落环绕;
    // 其余节点保持原版 force 布局(从中心散开,不缩放不适配)。
    const isRoot = (n: GraphNode): boolean => n.kind === "Book" || n.id === graph.graph_id;
    const nodes: SimNode[] = layout.nodes.map((n) => ({
      ...n,
      x: isRoot(n) ? width / 2 : 0,
      y: isRoot(n) ? height / 2 : 0,
      vx: 0,
      vy: 0,
      fx: isRoot(n) ? width / 2 : null,
      fy: isRoot(n) ? height / 2 : null,
    }));
    const links: SimLink[] = layout.edges.map((e) => ({
      source: nodes.find((n) => n.id === e.source) ?? nodes[0]!,
      target: nodes.find((n) => n.id === e.target) ?? nodes[0]!,
      type: e.type,
    }));

    const g = d3.select(svg);
    g.selectAll("*").remove();
    g.attr("viewBox", `0 0 ${width} ${height}`);

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => {
        view.attr("transform", event.transform);
      });
    g.call(zoomBehavior);

    const view = g.append("g");

    const link = view
      .append("g")
      .attr("stroke", "#ef4444")
      .attr("stroke-opacity", 0.55)
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 1.4)
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        onEdgeClickRef.current?.({
          source: d.source.id,
          target: d.target.id,
          type: d.type,
        });
      });

    const linkLabel = view
      .append("g")
      .selectAll<SVGTextElement, SimLink>("text")
      .data(links)
      .join("text")
      .attr("font-size", 9)
      .attr("fill", linkLabelColor)
      .text((d) => d.type);

    const node = view
      .append("g")
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", 0.85)
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.2)
      .style("cursor", "pointer")
      .on("mouseover", function () {
        d3.select(this).attr("stroke", "#fbbf24").attr("stroke-width", 2);
      })
      .on("mouseout", function () {
        d3.select(this).attr("stroke", "#fff").attr("stroke-width", 1.2);
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        // 详情浮层统一由上层(GraphStage 档案卡)展示——这里不开第二个。
        onNodeClickRef.current?.(d.id, d);
      });

    const label = view
      .append("g")
      .selectAll<SVGTextElement, SimNode>("text")
      .data(nodes)
      .join("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => d.radius + 12)
      .attr("font-size", 11)
      .attr("fill", labelColor)
      .style("pointer-events", "none")
      .text((d) => d.label);

    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(90),
      )
      .force("charge", d3.forceManyBody().strength(-160))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide(28))
      .force("x", d3.forceX(width / 2).strength(0.08))
      .force("y", d3.forceY(height / 2).strength(0.08))
      .on("tick", () => {
        link
          .attr("x1", (d) => d.source.x)
          .attr("y1", (d) => d.source.y)
          .attr("x2", (d) => d.target.x)
          .attr("y2", (d) => d.target.y);
        linkLabel
          .attr("x", (d) => (d.source.x + d.target.x) / 2)
          .attr("y", (d) => (d.source.y + d.target.y) / 2 - 3);
        node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
        label.attr("x", (d) => d.x).attr("y", (d) => d.y);
      });

    node.call(
      d3
        .drag<SVGCircleElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

    // 选中高亮(对齐 miroshark):选中节点紫色描边,相连边高亮。
    // 参数化并挂到 ref:选中变化由独立的轻量 effect 调用,不触发画布重建。
    const applySelection = (selected: string | null | undefined) => {
      node.attr("stroke", (d: SimNode) =>
        d.id === selected ? "#a78bfa" : "#fff")
        .attr("stroke-width", (d: SimNode) =>
          d.id === selected ? 4 : 1.2);
      link.attr("stroke", (d: SimLink) =>
        selected && (d.source.id === selected || d.target.id === selected)
          ? "#a78bfa"
          : "#ef4444")
        .attr("stroke-opacity", (d: SimLink) =>
          selected && (d.source.id === selected || d.target.id === selected)
            ? 1
            : 0.55)
        .attr("stroke-width", (d: SimLink) =>
          selected && (d.source.id === selected || d.target.id === selected)
            ? 2.5
            : 1.4);
    };
    applySelection(selectedNodeId);
    applySelectionRef.current = applySelection;

    return () => {
      simulation.stop();
      g.selectAll("*").remove();
      applySelectionRef.current = null;
    };
  }, [graph, theme]);

  // 选中变化:只重刷描边/连线高亮——点节点整张图纹丝不动。
  useEffect(() => {
    applySelectionRef.current?.(selectedNodeId);
  }, [selectedNodeId]);

  return (
    <div className="rgc-wrap">
      <svg
        ref={svgRef}
        className="rgc-svg"
        role="img"
        aria-label="小说图谱"
      />
    </div>
  );
}
