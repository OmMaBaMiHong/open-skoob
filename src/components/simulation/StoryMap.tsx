/**
 * StoryMap —— 一张影游的全貌图。
 *
 * 从老 studio 的 `FlowView` 迁过来（Phase 6.2c），但换了个立场：老的是**编辑器**
 * （拖节点、连线、改 delta），这里是**播放器的地图** —— 作者要的是「我这一局走
 * 到哪了、还有多少没走过、哪里是死路」，光靠一路点选项是看不出来的。
 *
 * 所以这里比老版多两件事：
 *   1. 走过的路点亮，当前节点高亮；
 *   2. 走不到的节点画成虚线灰块 —— 那正是最该被看见的毛病。
 *
 * 不引 ReactFlow：为一张只读结构图装一整套画布库不划算，且它自带的 CSS 会和
 * 这边手写的设计令牌打架。布局在 `lib/story-map.ts`，纯函数、有单测。
 */
import { useMemo, useState } from "react";
import { Lock, Zap, Pencil } from "lucide-react";
import { NodeEditor } from "./NodeEditor";
import {
  layoutStoryMap, MAP_NODE_W, MAP_NODE_H, type MapNode,
} from "../../lib/story-map";
import type { StoryGraph, PlayStep } from "../../lib/story-play";

interface StoryMapProps {
  readonly graph: StoryGraph;
  readonly projectId: string;
  /** 节点改完后把新图交回去 —— 播放器要用改后的文案继续放。 */
  readonly onGraphChange: (graph: StoryGraph) => void;
  /** 这一局走过的选择，用来点亮路径。 */
  readonly steps: ReadonlyArray<PlayStep>;
  /** 当前所在节点。 */
  readonly currentNodeId: string;
}

/** 节点类型 → 配色令牌（跟 CSS 里的 `.map-node.is-*` 对齐）。 */
function nodeClass(n: MapNode, walked: boolean, current: boolean): string {
  const parts = ["map-node", `is-${n.nodeType}`];
  if (n.unreachable) parts.push("is-unreachable");
  if (walked) parts.push("is-walked");
  if (current) parts.push("is-current");
  return parts.join(" ");
}

export function StoryMap({ graph, projectId, steps, currentNodeId, onGraphChange }: StoryMapProps) {
  const map = useMemo(() => layoutStoryMap(graph), [graph]);
  /*
   * 点节点 → 看它的内容，**不跳过去**。跳过去等于绕开门槛，把「变量攒够了
   * 才解锁」那套设计废掉；而作者看全貌时真正想问的是「这个格子里到底写了
   * 什么」—— 那不用玩到那儿也该能看。
   */
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const detail = picked ? graph.nodes.find((n) => n.id === picked) ?? null : null;

  /* 走过的节点与边。PlayStep 自带 nodeId，直接读就行 —— 不必重走一遍图，
     免得图被改过时（节点删了）还原出一条错的路。 */
  const { walkedNodes, walkedEdges } = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    const start = graph.nodes.find((n) => n.type === "start") ?? graph.nodes[0];
    if (start) nodes.add(start.id);
    for (const step of steps) {
      nodes.add(step.nodeId);
      edges.add(`${step.nodeId}->${step.choiceId}`);
      const target = graph.nodes.find((n) => n.id === step.nodeId)
        ?.choices.find((x) => x.id === step.choiceId)?.targetNodeId;
      if (target) nodes.add(target);
    }
    return { walkedNodes: nodes, walkedEdges: edges };
  }, [graph, steps]);

  const pos = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map]);

  if (map.nodes.length === 0) return <p className="film-dim">这张图还没有节点。</p>;

  return (
    <div className="map-wrap">
      <div className="map-legend">
        <span><i className="map-dot is-walked" />走过</span>
        <span><Lock size={10} />有门槛</span>
        <span><Zap size={10} />不可逆</span>
        <span><i className="map-dot is-unreachable" />走不到</span>
      </div>
      <div className="map-scroll">
        <svg width={map.width} height={map.height} className="map-svg">
          <defs>
            <marker id="map-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
            </marker>
          </defs>

          {map.edges.map((e) => {
            const a = pos.get(e.source);
            const b = pos.get(e.target);
            if (!a || !b) return null;
            const x1 = a.x + MAP_NODE_W;
            const y1 = a.y + MAP_NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + MAP_NODE_H / 2;
            const mid = (x1 + x2) / 2;
            const on = walkedEdges.has(e.id);
            return (
              <path
                key={e.id}
                // 三次贝塞尔：横向出、横向入，避免斜线穿过别的节点
                d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                className={`map-edge${on ? " is-walked" : ""}${e.gated ? " is-gated" : ""}${e.critical ? " is-critical" : ""}`}
                markerEnd="url(#map-arrow)"
              >
                <title>{e.label}{e.gated ? "（有门槛）" : ""}{e.critical ? "（不可逆）" : ""}</title>
              </path>
            );
          })}

          {map.nodes.map((n) => (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              className={nodeClass(n, walkedNodes.has(n.id), n.id === currentNodeId)}
              onClick={() => { setPicked(n.id === picked ? null : n.id); setEditing(false); }}
              role="button"
            >
              <rect width={MAP_NODE_W} height={MAP_NODE_H} rx={6} />
              <text x={9} y={17} className="map-node-label">
                {n.label.length > 13 ? `${n.label.slice(0, 13)}…` : n.label}
              </text>
              <text x={9} y={31} className="map-node-sub">{n.nodeType}</text>
              <title>{n.label}{n.unreachable ? " · 从开头走不到这里" : ""}</title>
            </g>
          ))}
        </svg>
      </div>

      {detail && (
        <div className="map-detail">
          <div className="map-detail-head">
            <b>{detail.title || detail.id}</b>
            <span className="map-detail-type">{detail.type}</span>
            {!editing && (
              <button type="button" className="map-detail-edit" onClick={() => setEditing(true)}>
                <Pencil size={10} /> 改这一段
              </button>
            )}
          </div>

          {editing ? (
            <NodeEditor
              projectId={projectId}
              node={detail}
              onSaved={(g) => { onGraphChange(g); setEditing(false); }}
              onCancel={() => setEditing(false)}
            />
          ) : (
          <>
          {detail.sceneDesc && <p className="map-detail-scene">{detail.sceneDesc}</p>}
          {(detail.dialogue ?? []).slice(0, 3).map((line, i) => (
            <p key={i} className="map-detail-line">
              <b>{line.speaker}</b>{line.text}
            </p>
          ))}
          {detail.choices.length === 0 ? (
            <p className="film-dim">没有选项 —— 这里是终点。</p>
          ) : (
            detail.choices.map((ch) => (
              <div key={ch.id} className="map-detail-choice">
                <span>{ch.text}</span>
                {ch.condition && <i><Lock size={9} /> {ch.condition.var}</i>}
                {ch.weight === "critical" && <i className="is-warn"><Zap size={9} /> 不可逆</i>}
              </div>
            ))
          )}
          </>
          )}
        </div>
      )}
    </div>
  );
}
