/**
 * WorkbenchGraphPage —— /workbench/:bookId/graph 写书侧独立图谱页
 *
 * 这本书的实体关系网整张铺开：实体是点、关系是边，画布与节点档案卡
 * 与拆书页图谱总览同一套（ReactGraphCanvas + dcw-gpop 浮层卡样式）。
 *
 * 数据纪律与拆书图谱一致：**进入页面拉一次，刷新浏览器页面重拉，不做任何轮询。**
 * 写书建书时就是拿 bookId 当 graphId 建的图（工厂路径与意图卡路径都是），
 * 所以直接走 /tianyan/graph/data/:bookId。
 *
 * 点节点弹浮层档案卡：走通用节点详情（属性 + 出场章节 + 关联关系 + 活动时间线）。
 * 拆书页那个角色 dossier 接口是拆书知识库专用（/tianwang-library/kb/:slug/…），
 * 写书图谱用不了，所有节点类型统一走通用详情。
 * 没建图的书（如快速直出）图谱为空：提示一句，不报错。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, X } from "lucide-react";
import {
  fetchGraphData, fetchGraphNodeDetail, type GraphData, type GraphNodeDetail,
} from "../lib/api";
import { GraphLegend } from "../components/LiveGraph";
import { ReactGraphCanvas } from "../components/novel-graph/ReactGraphCanvas";
import { REL_TYPE_ZH, payloadEntries } from "./DeconstructionPage";

export function WorkbenchGraphPage({ onBack }: { readonly onBack?: () => void } = {}) {
  const { bookId } = useParams<{ bookId?: string }>();
  const [data, setData] = useState<GraphData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GraphNodeDetail | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  /* 进入页面拉一次就完——想看最新，刷新页面即可。 */
  useEffect(() => {
    if (!bookId) return;
    let live = true;
    setError(null);
    setData(null);
    setSelectedId(null);
    fetchGraphData(bookId)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "图谱加载失败"); });
    return () => { live = false; };
  }, [bookId, revision]);

  const selected = selectedId ? data?.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedLabel = selected?.label ?? null;

  /* 选中节点 → 拉通用档案卡（属性 + 出场章节 + 关联关系 + 时间线）。 */
  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    if (!bookId || !selectedLabel) return;
    let live = true;
    fetchGraphNodeDetail(bookId, selectedLabel)
      .then((d) => { if (live) setDetail(d); })
      .catch((e) => { if (live) setDetailError(e instanceof Error ? e.message : "档案读取失败"); });
    return () => { live = false; };
  }, [bookId, selectedLabel]);

  const loadingCard = selected !== null && detail === null && !detailError;

  return (
    <div className="wbg">
      <div className="dcw-stage-head">
        <Link
          to={`/workbench/${encodeURIComponent(bookId ?? "")}`}
          className="dcw-back"
          onClick={onBack ? (event) => { event.preventDefault(); onBack(); } : undefined}
        >
          <ArrowLeft size={16} />{onBack ? "返回生成步骤" : "返回工作台"}
        </Link>
        <h2>图谱档案 · 《{bookId}》</h2>
        {data && (
          <span className="dcw-total">
            {data.nodes.length} 个节点 · {data.edges.length} 条边 · 颜色/大小=权重（灰孤立→金核心） · 滚轮缩放 · 点节点看档案
          </span>
        )}
      </div>
      {!data && !error && <div className="dc-loading"><Loader2 size={16} className="spin" />加载中…</div>}
      {error && <div role="alert">{error} <button onClick={() => setRevision((n) => n + 1)}>重试</button></div>}
      {data && data.nodes.length === 0 && (
        <div className="dcw-empty">图谱还是空的——这本书还没建出实体（快速直出的书不进图谱）。</div>
      )}
      {data && data.nodes.length > 0 && (
        <div className="dcw-graph is-full">
          <ReactGraphCanvas
            graph={data}
            selectedNodeId={selectedId}
            onNodeClick={(id) => {
              // 点击节点 = 弹/收档案卡（再点一次收起）。
              setSelectedId(id === selectedId ? null : id);
            }}
          />
          {selected && (
            <div className="dcw-gpop">
              <div className="dcw-gpop-h">
                <b>{selected.label}</b>
                <span className="dcw-card-kind">
                  {detail?.card?.cardType || selected.type || selected.kind}
                </span>
                <button
                  type="button"
                  className="dcw-gpop-x"
                  onClick={() => setSelectedId(null)}
                  aria-label="关闭"
                >
                  <X size={13} />
                </button>
              </div>
              {detailError && <div role="alert">{detailError}</div>}
              {loadingCard && <div className="dcw-gpop-loading"><Loader2 size={13} className="spin" /></div>}

              {detail?.card && (
                <>
                  {detail.card.summary && <p className="dcw-card-summary">{detail.card.summary}</p>}
                  {payloadEntries(detail.card.payload).length > 0 && (
                    <dl className="dcw-gpop-fields">
                      {payloadEntries(detail.card.payload).map(([k, v], i) => (
                        <div key={`${k}-${i}`} className="dcw-gpop-field">
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {detail.chapters.length > 0 && (
                    <div className="dcw-gpop-sec">
                      <div className="dcw-gpop-sec-t">出场章节</div>
                      <div className="dcw-gnode-rels">
                        {detail.chapters.map((ch) => (
                          <span key={ch.number} className="dcw-cite">第 {ch.number} 章 {ch.title}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.relations.length > 0 && (
                    <div className="dcw-gpop-sec">
                      <div className="dcw-gpop-sec-t">关联关系</div>
                      <div className="dcw-gnode-rels">
                        {detail.relations.map((r, i) => (
                          <span key={i} className="dcw-cite">
                            {r.direction === "out" ? "→" : "←"} {REL_TYPE_ZH[r.relation] ?? r.relation} {r.target}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.events.length > 0 && (
                    <div className="dcw-gpop-sec">
                      <div className="dcw-gpop-sec-t">活动时间线</div>
                      <div className="dcw-gpop-events">
                        {detail.events.map((ev, i) => (
                          <div key={i} className="dcw-gpop-event">
                            <span>R{ev.round} · {ev.action}</span>
                            <p>{ev.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      {data && data.nodes.length > 0 && <GraphLegend />}
    </div>
  );
}
