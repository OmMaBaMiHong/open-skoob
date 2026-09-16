/**
 * 流派专家团详情弹层 —— 智能体页与创作首页共用。
 *
 * 数据是 `GET /api/v1/genres/:id/cluster` 从图谱真实聚合的：
 *   写法      流派 md 全文（方法论：核心循环/章节配方/禁忌反模式）
 *   书目      这个分类下的所有书——每本书就是它自己的专家团（子层，点开即钻取）
 *   智能体    这些书沉淀的设定智能体，按剧情权重排序（孙层）
 *
 * 召唤语义由使用方决定（onSummon）：智能体页是「带引用去创作首页」，
 * 创作首页是「选中这个流派」。
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Zap, BookMarked, Users, X } from "lucide-react";
import {
  fetchGenreCluster,
  type GenreCluster, type GenreInfo, type GraphAgent,
} from "../lib/api";
import { agentTypeOf } from "../types/experts";
import type { ExpertTeam } from "../types/teams";
import { useI18n } from "../i18n";

/**
 * 流派大类的中文标签。key 来自流派 md 正文「Niubix 原始流派参数」的
 * category 字段——真实数据（45 个流派里 44 个标了）。
 * 没标的进「未标大类」，绝不用名字正则瞎猜（那套脏分组已删除）。
 *
 * 展示走 i18n（agents.cat.<slug>），这张表只承担「已知 slug 清单」的职责：
 * 表里的 slug 才查词典，表外的原样显示，缺省的进「未标大类」。
 */
export const GENRE_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  fantasy: "脑洞流", cultivation: "修仙修真", urban: "都市", scifi: "科幻",
  suspense: "悬疑惊悚", romance: "言情", history: "历史", game: "游戏电竞",
  business: "商战职场", experimental: "实验流派",
};

/**
 * 大类名的本地化展示。known slug → 词典；unknown slug → 原样（raw）或归入
 * 未标大类（unlabeled，分组语义用）。useI18n 在 I18nProvider 内才可用，
 * 这个 hook 只能在组件里调。
 */
export function useGenreCategoryLabel(): (category?: string, unknownAs?: "raw" | "unlabeled") => string {
  const { t } = useI18n();
  // t 按 locale 记忆化，这里跟着它记忆化——genreGroups 的 useMemo 依赖这个函数。
  return useCallback((category, unknownAs = "unlabeled") => {
    if (category && category in GENRE_CATEGORY_LABELS) return t(`agents.cat.${category}`);
    if (unknownAs === "raw" && category) return category;
    return t("agents.cat.unlabeled");
  }, [t]);
}

/* ── 弹层壳 ── */
export function DetailModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="wb2-modal" onClick={onClose}>
      <div className="wb2-modal-box" onClick={(e) => e.stopPropagation()}>
        <button className="wb2-modal-x" onClick={onClose}><X size={16} /></button>
        {children}
      </div>
    </div>
  );
}

export function GenreTeamDetail({ team, genre, summonLabel, onSummon, onOpenBook, onOpenAgent, onOpenSkill }: {
  team: ExpertTeam;
  /** 流派的真实元数据（category/badge/summary 来自流派 md 的 Niubix 参数块）。 */
  genre?: GenreInfo;
  /** 主行动按钮的文案（各页面语义不同）。 */
  summonLabel?: string;
  onSummon: () => void;
  onOpenBook: (bookId: string) => void;
  onOpenAgent: (agent: GraphAgent) => void;
  /** 流派 skill 已上架时提供——跳到技能库看/装这份写法（genre-<id>）。 */
  onOpenSkill?: () => void;
}) {
  const genreId = team.id.replace(/^genre:/, "");
  const [cluster, setCluster] = useState<GenreCluster | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showWriting, setShowWriting] = useState(false);
  const categoryLabel = useGenreCategoryLabel();

  useEffect(() => {
    let live = true;
    setCluster(null);
    setLoadFailed(false);
    fetchGenreCluster(genreId)
      .then((c) => { if (live) setCluster(c); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [genreId]);

  const genreName = team.tags[0] ?? team.name.replace(/专家团$/, "");

  return (
    <>
      <div className="wb2-md-h">
        <span className="wb2-avatar is-lg is-team">◈</span>
        <div>
          <h2>{team.name}</h2>
          <div className="wb2-md-from">{team.tagline}</div>
        </div>
      </div>
      <div className="wb2-md-tags">
        <span className="wb2-tag is-flow">流派方法论</span>
        {genre?.badge && <span className="wb2-tag is-lvl">{genre.badge}</span>}
        {genre?.category && (
          <span className="wb2-tag">{categoryLabel(genre.category, "raw")}</span>
        )}
        {cluster && (
          <>
            <span className="wb2-tag is-lvl">{cluster.books.length} 本书</span>
            <span className="wb2-tag is-w">{cluster.agents.length} 个精选智能体</span>
          </>
        )}
      </div>
      {/* 一句话定位是流派 md 里的真实摘要（Niubix 参数块），不是通用文案 */}
      {genre?.summary && <p className="wb2-md-bio"><b>{genre.summary}</b></p>}
      <button className="wb2-summon" onClick={onSummon}>
        <Zap size={14} /> {summonLabel ?? `召唤专家团 · 按「${genreName}」起新书`}
      </button>
      <p className="wb2-md-bio">{team.does}</p>

      {/* 提示词：召唤时注入系统提示词的流派写法全文，逐字可查；
          技能库入口让别人能看到/安装同一份（genre-<id>） */}
      <div className="wb2-md-sec">提示词（召唤时注入的流派写法）</div>
      {cluster === null && !loadFailed && (
        <p className="wb2-md-bio"><Loader2 size={13} className="spin" /> 读取流派写法…</p>
      )}
      {loadFailed && <p className="wb2-md-bio">流派写法读取失败——请稍后再试。</p>}
      {cluster && (
        <div className="wb2-md-body">
          <button className="wb2-md-toggle" onClick={() => setShowWriting((v) => !v)}>
            {showWriting ? "收起" : "查看"} 注入文本全文
            <code>{genreId}.md</code>
          </button>
          {showWriting && <pre className="wb2-md-pre">{cluster.body || "（正文为空）"}</pre>}
          {onOpenSkill && (
            <button className="wb2-md-toggle" onClick={onOpenSkill}>
              在技能库查看 / 安装「genre-{genreId}」
            </button>
          )}
        </div>
      )}

      {/* 子层：这个分类下的书目专家团 */}
      <div className="wb2-md-sec">
        <BookMarked size={12} /> 名下书目 <em>{cluster?.books.length ?? 0}</em>
      </div>
      {cluster && !cluster.graphAvailable && (
        <p className="wb2-md-bio">图谱暂不可用——书目与智能体只读到部分，写法不受影响。</p>
      )}
      {cluster && cluster.books.length === 0 && cluster.graphAvailable && (
        <p className="wb2-md-bio">
          这个分类下还没有书。拆完一本书或按这个流派起一本，它的专家团就会挂到这里。
        </p>
      )}
      {cluster && cluster.books.length > 0 && (
        <div className="wb2-gbooks">
          {cluster.books.map((b) => (
            <button key={b.id} className="wb2-gbook" onClick={() => onOpenBook(b.id)}>
              <span className="wb2-gbook-t">《{b.title}》专家团</span>
              <span className="wb2-gbook-m">{b.agentCount} 个智能体</span>
            </button>
          ))}
        </div>
      )}

      {/* 孙层：跨书精选智能体 */}
      {cluster && cluster.agents.length > 0 && (
        <>
          <div className="wb2-md-sec">
            <Users size={12} /> 精选智能体 <em>{cluster.agents.length}</em>
          </div>
          <div className="wb2-md-members">
            {cluster.agents.map((a) => {
              const st = agentTypeOf(a.agentType || a.tier);
              return (
                <button
                  key={`${a.graphId}-${a.name}`} className="wb2-md-member is-link"
                  onClick={() => onOpenAgent(a)}
                >
                  <span className="wb2-mini">{st.icon}</span>
                  <div>
                    <div className="wb2-md-mname">
                      {a.name}
                      <em>{st.label} · {a.graphId}</em>
                    </div>
                    {(a.bio || a.persona) && (
                      <div className="wb2-md-mbio">{a.bio || a.persona}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 执行层：流派配方落地仍走六师流水线——如实说明，不包装成「流派自己有人」 */}
      <div className="wb2-md-sec">执行层 · 六师创作流水线</div>
      <div className="wb2-md-members">
        {team.members.map((m) => (
          <div key={m.name} className="wb2-md-member">
            <span className="wb2-mini">{m.emoji}</span>
            <div>
              <div className="wb2-md-mname">{m.name}<em>{m.role}</em></div>
            </div>
          </div>
        ))}
      </div>

      <div className="wb2-md-sec">可以直接问</div>
      <div className="wb2-md-prompts">
        {team.prompts.map((p) => <div key={p} className="wb2-md-prompt">「{p}」</div>)}
      </div>
    </>
  );
}
