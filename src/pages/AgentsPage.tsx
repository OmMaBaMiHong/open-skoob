import { useCloudAccess } from "../cloud-access";
/**
 * AgentsPage —— 智能体 · 技能 · 连接器
 *
 * 结构参考 WorkBuddy，但有一处本质区别：
 *   **我们的智能体不是预置商品，是每本小说创作时自动沉淀出来的。**
 *   写一本书 = 长出一个领域 = 长出一支这个领域的专家团。
 *
 * 智能体分区是父子孙三层：
 *   流派专家团（父）  流派写法 + 这个分类下的所有书 —— 图谱 HAS_GENRE 边真实聚合
 *   书的专家团（子）  一本书的设定 + 它沉淀的全部智能体
 *   单个智能体（孙）  一张 14 字段档案卡
 * 顶部卡片轨道是流派层，下面「专家团」网格是书层，「智能体」网格是孙层，
 * 弹层里逐级钻取（流派 → 书 → 智能体）。
 *
 * 三个顶层分区：
 *   智能体   图谱资产（跨书永久沉淀）+ 专家团（多个智能体的组合）
 *   技能     17 个 skill，召唤走 requestedSkills
 *   连接器   外部服务集成（联网检索 / 通知渠道；MCP 尚未接入）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2, Search, Users, Wrench, Plug,
  Zap, CheckCircle2, Circle, Plus, Check, Pencil, Trash2, Store,
} from "lucide-react";
import {
  fetchSkills, fetchBooks, fetchGraphAgents, fetchGenres,
  fetchResearchSearch, fetchNotify,
  fetchSkillStore, installSkill, uninstallSkill, deleteSkill,
  fetchAgentTemplates, deleteAgentTemplate,
  type SkillInfo, type SkillStoreItem, type BookSummary, type GraphAgent, type ResearchSearchConfig,
  type GenreInfo, type AgentTemplateInfo,
  fetchDeconstructionMasters, type DeconstructionMaster,
} from "../lib/api";
import { tierStyle, agentTypeOf, tierLabel, AGENT_TYPES } from "../types/experts";
import { useInstalledSkills } from "../hooks/use-installed-skills";
import { SKILL_GROUPS } from "../types/skills";
import { SkillFormModal, skillToForm, type SkillFormValues } from "../components/SkillFormModal";
import {
  SIX_MASTER_TEAM, bookTeamOf, deconstructionTeamOf, genreTeamOf, type ExpertTeam,
} from "../types/teams";
import { useI18n } from "../i18n";
import { apiUrl } from "../lib/api-origin";
import { DetailModal, GenreTeamDetail, useGenreCategoryLabel } from "../components/GenreTeamDetail";

type Zone = "agents" | "skills" | "connectors";
/**
 * 智能体分区的三个 tab——与资产层的类型一一对应：
 *   agents    智能体（图谱 Entity / asset type='agent'）
 *   books     作品专家团（每本书一支；asset type='book' 的载体）
 *   platform  平台专家团（工具型内置团；asset type='team', team_kind='builtin'）
 */
type AgentView = "agents" | "books" | "platform";

interface Connector {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly connected: boolean;
  readonly status: string;
}

export function AgentsPage() {
  const cloud = useCloudAccess();
  const navigate = useNavigate();
  const { t } = useI18n();
  const categoryLabel = useGenreCategoryLabel();
  const [zone, setZone] = useState<Zone>("agents");
  const [view, setView] = useState<AgentView>("books");
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<string>("all");

  const [skills, setSkills] = useState<ReadonlyArray<SkillInfo>>([]);
  const [books, setBooks] = useState<ReadonlyArray<BookSummary>>([]);
  const [agents, setAgents] = useState<ReadonlyArray<GraphAgent>>([]);
  const [genres, setGenres] = useState<ReadonlyArray<GenreInfo>>([]);
  const [connectors, setConnectors] = useState<ReadonlyArray<Connector>>([]);
  /** 拆书专家团（后端 masters.ts 是定义源，前端不抄）。 */
  const [masters, setMasters] = useState<ReadonlyArray<DeconstructionMaster>>([]);
  /** 技能市场（全量 + 安装计数 + isMine）与我的自建智能体模板。 */
  const [storeSkills, setStoreSkills] = useState<ReadonlyArray<SkillStoreItem>>([]);
  const [templates, setTemplates] = useState<ReadonlyArray<AgentTemplateInfo>>([]);
  const [skillMarket, setSkillMarket] = useState(false);
  const [skillModal, setSkillModal] = useState<SkillFormValues | "new" | null>(null);
  const [skillErr, setSkillErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** 详情弹层：智能体 或 专家团（流派团走独立的集群弹层） */
  const [openAgent, setOpenAgent] = useState<GraphAgent | null>(null);
  const [openTeam, setOpenTeam] = useState<ExpertTeam | null>(null);
  const [openGenre, setOpenGenre] = useState<ExpertTeam | null>(null);
  const [openSkill, setOpenSkill] = useState<SkillInfo | null>(null);
  const { isInstalled, toggle: toggleSkill, installed } = useInstalledSkills();
  useEffect(() => {
    let alive = true;
    if (!cloud.ready) { setSkills(previous => previous.filter(x => !x.id.startsWith("official:"))); setStoreSkills(previous => previous.filter(x => !x.id.startsWith("official:"))); setGenres(previous => previous.filter(x => !x.id.startsWith("official:"))); setTemplates(previous => previous.filter(x => !x.id.startsWith("official:"))); setOpenGenre(null); setOpenSkill(null); }
    void Promise.all([
      fetchSkills().catch(() => []),
      fetchBooks().catch(() => []),
      fetchGraphAgents({ limit: 500 }).catch(() => []),
      fetchGenres().catch(() => []),
      fetchResearchSearch().catch((): ResearchSearchConfig => ({ enabled: false })),
      fetchNotify().catch(() => ({})),
      fetchDeconstructionMasters().catch(() => []),
      fetchSkillStore().catch(() => []),
      fetchAgentTemplates().catch(() => []),
    ]).then(([s, b, ag, g, rs, nt, dm, store, tpl]) => {
      if (!alive) return;
      setSkills(cloud.ready ? s : s.filter(x => !x.id.startsWith("official:"))); setBooks(b); setAgents(ag); setGenres(cloud.ready ? g : g.filter(x => !x.id.startsWith("official:")));
      setMasters(dm);
      setStoreSkills(cloud.ready ? store : store.filter(x => !x.id.startsWith("official:"))); setTemplates(cloud.ready ? tpl : tpl.filter(x => !x.id.startsWith("official:")));
      const notifyChannels = ["feishu", "telegram", "webhook", "wechatWork"] as const;
      const notifyNames: Record<string, string> = {
        feishu: "飞书", telegram: "Telegram", webhook: "Webhook", wechatWork: "企业微信",
      };
      setConnectors([
        {
          id: "research-search", name: "联网检索",
          desc: `创作时联网查证事实（provider: ${rs.provider ?? "tavily"}）`,
          connected: rs.enabled, status: rs.enabled ? "已启用" : "未启用",
        },
        ...notifyChannels.map((c) => {
          const cfg = (nt as Record<string, { enabled?: boolean } | undefined>)[c];
          return {
            id: `notify-${c}`, name: `${notifyNames[c]}通知`,
            desc: "章节完成 / 编排异常时推送到该渠道",
            connected: Boolean(cfg?.enabled), status: cfg?.enabled ? "已连接" : "未配置",
          };
        }),
        {
          id: "mcp", name: "MCP 服务",
          desc: "接入第三方 MCP / 外部工具服务",
          connected: false, status: "尚未接入",
        },
      ]);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cloud.ready]);

  /* ── 技能：安装/卸载走订阅接口（计数在服务端），本地 store 只管召唤队列 ── */
  const refreshSkillData = useCallback(() => {
    void fetchSkills().then(setSkills).catch(() => undefined);
    void fetchSkillStore().then(setStoreSkills).catch(() => undefined);
  }, []);

  const toggleSkillApi = useCallback(async (id: string) => {
    setSkillErr(null);
    try {
      if (isInstalled(id)) await uninstallSkill(id);
      else await installSkill(id);
      toggleSkill(id);
      fetchSkillStore().then(setStoreSkills).catch(() => undefined);
    } catch (e) {
      setSkillErr((e as Error).message);
    }
  }, [isInstalled, toggleSkill]);

  const removeSkill = useCallback(async (s: SkillInfo | SkillStoreItem) => {
    if (!window.confirm(`删除技能「${s.name}」？已安装它的人仍可继续使用，市场里不再展示。`)) return;
    setSkillErr(null);
    try {
      await deleteSkill(s.id);
      refreshSkillData();
    } catch (e) {
      setSkillErr((e as Error).message);
    }
  }, [refreshSkillData]);

  /* ── 我的自建智能体模板：删除（编辑走 /agents/new?id= 表单页） ── */
  const myTemplates = useMemo(() => templates.filter((t) => t.isMine), [templates]);

  const removeTemplate = useCallback(async (t: AgentTemplateInfo) => {
    if (!window.confirm(`删除自建智能体「${t.zhName || t.name}」？删除后不可恢复。`)) return;
    try {
      await deleteAgentTemplate(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      window.alert(`删除失败：${(e as Error).message}`);
    }
  }, []);

  /* ── 专家团：内置六师 + 内置拆书团 + 每本书一支 ── */
  const teams = useMemo<ReadonlyArray<ExpertTeam>>(() => {
    const byBook = new Map<string, GraphAgent[]>();
    for (const a of agents) {
      if (!a.graphId) continue;
      (byBook.get(a.graphId) ?? byBook.set(a.graphId, []).get(a.graphId)!).push(a);
    }
    const bookTeams = [...byBook.entries()].map(([gid, list]) =>
      bookTeamOf(gid, books.find((b) => b.id === gid)?.title ?? list[0]?.bookTitle ?? gid, list));
    // 拆书团要等接口回来才有；masters 为空时不塞一支空团进去。
    const builtin = masters.length
      ? [SIX_MASTER_TEAM, deconstructionTeamOf(masters)]
      : [SIX_MASTER_TEAM];
    return [...builtin, ...bookTeams.sort((a, b) => b.members.length - a.members.length)];
  }, [agents, books, masters]);

  /* ── 流派专家团：父层。统计是 HAS_GENRE 边数出来的真数，分类是流派 md 的真实 category ── */
  const genreTeams = useMemo(() => genres.map(genreTeamOf), [genres]);
  const teamByGenreId = useMemo(
    () => new Map(genreTeams.map((t) => [t.id.replace(/^genre:/, ""), t])),
    [genreTeams],
  );
  /** 按真实大类分组：轨道上一张卡片 = 一个大类，组内按集群规模排。 */
  const genreGroups = useMemo(() => {
    const m = new Map<string, GenreInfo[]>();
    for (const g of genres) {
      const label = categoryLabel(g.category);
      (m.get(label) ?? m.set(label, []).get(label)!).push(g);
    }
    return [...m.entries()]
      .map(([label, list]) => [
        label,
        list.sort((a, b) => (b.bookCount ?? -1) - (a.bookCount ?? -1)),
      ] as const)
      .sort((a, b) => b[1].length - a[1].length);
  }, [genres, categoryLabel]);

  /* ── 领域归属已并进流派集群与书专家团，不再单设「创作领域」分区 ── */

  const kw = q.trim().toLowerCase();
  // 分类计数按九类的权威顺序（剧情权重降序）排，不由数据出现顺序决定。
  const tiers = useMemo(() => {
    const set = new Map<string, number>();
    for (const a of agents) {
      const l = agentTypeOf(a.agentType || a.tier).label;
      set.set(l, (set.get(l) ?? 0) + 1);
    }
    const order = AGENT_TYPES.map((t) => t.label);
    return [...set.entries()].sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]));
  }, [agents]);

  /* ── 专家团按底层类型分两类：作品团（书）与平台工具团（内置流水线）── */
  const bookTeams = useMemo(() => teams.filter((t) => t.kind === "book"), [teams]);
  const platformTeams = useMemo(() => teams.filter((t) => t.kind === "builtin"), [teams]);

  const shownAgents = useMemo(() => agents.filter((a) =>
    (tier === "all" || agentTypeOf(a.agentType || a.tier).label === tier)
    && (!kw || a.name.toLowerCase().includes(kw)
      || (a.bio ?? "").toLowerCase().includes(kw)
      || (a.graphId ?? "").toLowerCase().includes(kw))), [agents, tier, kw]);

  const teamHit = (t: ExpertTeam) =>
    !kw || t.name.toLowerCase().includes(kw) || t.does.toLowerCase().includes(kw);
  const shownBookTeams = useMemo(() => bookTeams.filter(teamHit), [bookTeams, kw]);
  const shownPlatformTeams = useMemo(() => platformTeams.filter(teamHit), [platformTeams, kw]);

  const goSummon = useCallback((bookId?: string) => {
    const target = bookId || books[0]?.id;
    navigate(target ? `/conversation/${encodeURIComponent(target)}` : "/create");
  }, [books, navigate]);

  return (
    <div className="wb2">
      {/* ── 顶栏 ── */}
      <header className="wb2-top">
        <nav className="wb2-zones">
          <button className={zone === "agents" ? "is-on" : ""} onClick={() => setZone("agents")}>
            <Users size={14} /> {t("agents.zone.agents")}
          </button>
          <button className={zone === "skills" ? "is-on" : ""} onClick={() => setZone("skills")}>
            <Wrench size={14} /> {t("agents.zone.skills")}
          </button>
          <button className={zone === "connectors" ? "is-on" : ""} onClick={() => setZone("connectors")}>
            <Plug size={14} /> {t("agents.zone.connectors")}
          </button>
        </nav>
        <div className="wb2-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("agents.search_placeholder")} />
        </div>
      </header>

      <main className="wb2-body">
        {loading ? (
          <div className="wb2-load"><Loader2 size={20} className="spin" /> {t("agents.loading")}</div>
        ) : zone === "agents" ? (
          <>
            {/* 流派专家团：置顶卡片轨道。父层——一张卡 = 一个大类，卡里每行是一个
                流派集群：写法 + 这个分类下的所有书 + 这些书沉淀的智能体 */}
            <section className="wb2-scenes">
              <h2 className="wb2-h2">{t("agents.genre_groups")}</h2>
              <p className="wb2-lead">
                {t("agents.genre_groups_desc")}
              </p>
              <div className="wb2-gtrack">
                {genreGroups.map(([g, list]) => {
                  /* 卡背景 = 该类最大流派的真实封面；遮罩与文字颜色由 CSS 按主题组合 */
                  const bgCover = list.find((x) => x.coverUrl)?.coverUrl;
                  return (
                    <div
                      key={g} className="wb2-gcard"
                      style={bgCover ? { "--gcard-img": `url(${apiUrl(bgCover)})` } as React.CSSProperties : undefined}
                    >
                      <div className="wb2-gcard-h">
                        {g} <i>{list.length}</i>
                      </div>
                      <div className="wb2-gcard-list">
                        {list.map((genre) => {
                          const team = teamByGenreId.get(genre.id);
                          if (!team) return null;
                          const thumb = genre.coverUrl ? apiUrl(genre.coverUrl) : null;
                          return (
                            <button
                              key={genre.id} className="wb2-grow"
                              title={genre.summary ?? team.name}
                              onClick={() => setOpenGenre(team)}
                            >
                              {thumb
                                ? <img className="wb2-genre-item-a" src={thumb} alt="" loading="lazy" />
                                : <span className="wb2-genre-item-a">{genre.name.charAt(0)}</span>}
                              <span className="wb2-grow-n">{genre.name}</span>
                              {genre.bookCount !== undefined && (
                                <span className="wb2-grow-s">
                                  {t("agents.genre_stat", { books: genre.bookCount, agents: genre.agentCount ?? 0 })}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 智能体 / 天王模板专家团 / 天工创作写书拆书专家团——三个 tab 对应资产层的三种类型 */}
            <div className="wb2-subtabs">
              <button className={view === "agents" ? "is-on" : ""} onClick={() => setView("agents")}>
                {t("agents.zone.agents")} <em>{agents.length}</em>
              </button>
              <button className={view === "books" ? "is-on" : ""} onClick={() => setView("books")}>
                {t("agents.view.books")} <em>{bookTeams.length}</em>
              </button>
              <button className={view === "platform" ? "is-on" : ""} onClick={() => setView("platform")}>
                {t("agents.view.platform")} <em>{platformTeams.length}</em>
              </button>
              {view === "agents" && (
                <div className="wb2-chips">
                  <button className={tier === "all" ? "is-on" : ""} onClick={() => setTier("all")}>{t("common.all")}</button>
                  {tiers.map(([tierName, n]) => (
                    <button key={tierName} className={tier === tierName ? "is-on" : ""} onClick={() => setTier(tierName)}>
                      {tierName} <i>{n}</i>
                    </button>
                  ))}
                </div>
              )}
              {view === "agents" && (
                <button className="wb2-add-btn" onClick={() => navigate("/agents/new")}>
                  <Plus size={14} /> {t("agents.add_agent")}
                </button>
              )}
            </div>

            {view === "agents" ? (
              <>
                {myTemplates.length > 0 && (
                  <section className="wb2-skillgroup">
                    <div className="wb2-skillgroup-h">
                      <b>我的自建</b><span>自己创建的智能体，只有本人能编辑和删除</span>
                    </div>
                    <div className="wb2-grid">
                      {myTemplates.map((t) => (
                        <div key={t.id} className="wb2-card is-skill">
                          <div className="wb2-card-h">
                            <span className="wb2-avatar is-skill"><Users size={14} /></span>
                            <div className="wb2-card-id">
                              <div className="wb2-card-t">{t.zhName || t.name}</div>
                              <code className="wb2-card-s">{t.id}</code>
                            </div>
                          </div>
                          <p className="wb2-card-d">{t.keywords?.length ? t.keywords.join(" · ") : "自建智能体模板"}</p>
                          <div className="wb2-card-ops">
                            <button className="wb2-op" title="编辑"
                              onClick={() => navigate(`/agents/new?id=${encodeURIComponent(t.id)}`)}>
                              <Pencil size={13} />
                            </button>
                            <button className="wb2-op is-danger" title="删除" onClick={() => void removeTemplate(t)}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <div className="wb2-grid">
                {shownAgents.map((a) => {
                  // 分类看 agentType（tier 是 major/minor 层级）；历史脏数据回落 tier。
                  const st = agentTypeOf(a.agentType || a.tier);
                  const lv = tierLabel(a.tier);
                  return (
                    <button key={`${a.graphId}-${a.name}`} className={`wb2-card is-${st.tone}`}
                      onClick={() => setOpenAgent(a)}>
                      <div className="wb2-card-h">
                        <span className={`wb2-avatar is-${st.tone}`}>{st.emoji}</span>
                        <div className="wb2-card-id">
                          <div className="wb2-card-t">{a.name}</div>
                          <div className="wb2-card-s">
                            <span className={`wb2-tag is-${st.tone}`}>{st.label}</span>
                            {lv && <span className="wb2-tag is-lvl">{lv}</span>}
                            <span className="wb2-card-from">{a.graphId}</span>
                          </div>
                        </div>
                      </div>
                      <p className="wb2-card-d">{a.bio || a.persona || "（画像待补全）"}</p>
                    </button>
                  );
                })}
                {shownAgents.length === 0 && <div className="wb2-empty">没有匹配的智能体</div>}
              </div>
              </>
            ) : (
              <>
                <p className="wb2-lead">
                  {view === "books"
                    ? "每本书都有自己的专家团，汇集已有的人物与设定。可以召唤它们讨论剧情，也可以参考这些资料写续篇或外传。"
                    : "写书时，六位师傅协作完成稿件；拆书时，八位师傅帮你梳理剧情与设定。点开了解每位师傅的分工和成果。"}
                </p>
                <div className="wb2-grid">
                  {(view === "books" ? shownBookTeams : shownPlatformTeams).map((t) => (
                    <button key={t.id} className={`wb2-card is-team ${t.kind === "builtin" ? "is-builtin" : ""}`}
                      onClick={() => setOpenTeam(t)}>
                      <div className="wb2-card-h">
                        <span className="wb2-avatar is-team">{t.kind === "builtin" ? "⚙" : "◈"}</span>
                        <div className="wb2-card-id">
                          <div className="wb2-card-t">
                            {t.name}
                            {t.kind === "builtin" && <span className="wb2-badge">内置</span>}
                          </div>
                          <div className="wb2-card-s">{t.tagline}</div>
                        </div>
                      </div>
                      <p className="wb2-card-d">{t.does}</p>
                      <div className="wb2-tags">
                        {t.tags.map((x) => <span key={x}>{x}</span>)}
                      </div>
                      <div className="wb2-members">
                        {t.members.slice(0, 6).map((m) => (
                          <span key={m.name} className="wb2-mini" title={m.name}>
                            {m.emoji ?? tierStyle(m.tier ?? "").icon}
                          </span>
                        ))}
                        {t.members.length > 6 && <span className="wb2-mini is-more">+{t.members.length - 6}</span>}
                      </div>
                    </button>
                  ))}
                  {(view === "books" ? shownBookTeams : shownPlatformTeams).length === 0 && (
                    <div className="wb2-empty">
                      {view === "books" ? "还没有作品专家团——写一本或拆一本书就有了" : "平台专家团加载中…"}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        ) : zone === "skills" ? (
          <>
            <div className="wb2-subtabs">
              <button className={!skillMarket ? "is-on" : ""} onClick={() => setSkillMarket(false)}>
                <Wrench size={13} /> 我的技能 <em>{skills.length}</em>
              </button>
              <button className={skillMarket ? "is-on" : ""} onClick={() => setSkillMarket(true)}>
                <Store size={13} /> 技能市场 <em>{storeSkills.length}</em>
              </button>
              <button className="wb2-add-btn" onClick={() => setSkillModal("new")}>
                <Plus size={14} /> 新建技能
              </button>
            </div>
            {skillErr && <div className="wb2-empty">技能操作失败：{skillErr}</div>}
            {!skillMarket ? (
              <>
                <h2 className="wb2-h2">我的技能 <em className="wb2-h2-n">{skills.length}</em></h2>
                <p className="wb2-lead">
                  点 <b>＋</b> 安装后常驻，进对话页自动带上；也可以在对话里打 <code>/</code> 临时挂载。
                  选中的技能随本轮 <code>requestedSkills</code> 进 <code>runAgentSession</code>，
                  实打实改变可用能力。
                  {installed.length > 0 && <> 已安装 <b>{installed.length}</b> 个。</>}
                </p>
                {SKILL_GROUPS.map((g) => {
                  const list = skills.filter((s) =>
                    g.match(s) && (!kw || s.name.toLowerCase().includes(kw) || s.id.toLowerCase().includes(kw)));
                  if (list.length === 0) return null;
                  return (
                    <section key={g.id} className="wb2-skillgroup">
                      <div className="wb2-skillgroup-h">
                        <b>{g.label}</b><span>{g.hint}</span>
                      </div>
                      <div className="wb2-grid">
                        {list.map((s) => {
                          const on = isInstalled(s.id);
                          return (
                            <div key={s.id} className={`wb2-card is-skill${on ? " is-on" : ""}`}>
                              <button className="wb2-card-main" onClick={() => setOpenSkill(s)}>
                                <div className="wb2-card-h">
                                  <span className="wb2-avatar is-skill"><Wrench size={14} /></span>
                                  <div className="wb2-card-id">
                                    <div className="wb2-card-t">{s.name}</div>
                                    <code className="wb2-card-s">{s.id}</code>
                                  </div>
                                </div>
                                <p className="wb2-card-d">{s.whenToUse || s.description}</p>
                              </button>
                              <button
                                className={`wb2-install${on ? " is-on" : ""}`}
                                title={on ? "已安装，点击卸载" : "安装到对话（常驻）"}
                                aria-label={on ? `卸载 ${s.name}` : `安装 ${s.name}`}
                                onClick={() => void toggleSkillApi(s.id)}
                              >
                                {on ? <Check size={14} /> : <Plus size={14} />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </>
            ) : (
              <>
                <p className="wb2-lead">
                  全平台的技能都在这：安装人数标在卡上。自己写的默认自用，别人装了计数就涨；
                  <b>编辑/删除</b>只有作者本人看得到，别人的技能可以装来用。
                </p>
                <div className="wb2-grid">
                  {storeSkills
                    .filter((s) => !kw || s.name.toLowerCase().includes(kw) || s.id.toLowerCase().includes(kw))
                    .map((s) => {
                      const on = isInstalled(s.id);
                      const storeInfo = storeSkills.find((x) => x.id === s.id);
                      const isMine = storeInfo?.isMine ?? s.isMine ?? false;
                      return (
                        <div key={s.id} className={`wb2-card is-skill${on ? " is-on" : ""}`}>
                          <button className="wb2-card-main" onClick={() => setOpenSkill(s)}>
                            <div className="wb2-card-h">
                              <span className="wb2-avatar is-skill"><Wrench size={14} /></span>
                              <div className="wb2-card-id">
                                <div className="wb2-card-t">{s.name}</div>
                                <code className="wb2-card-s">{s.id}</code>
                              </div>
                            </div>
                            <p className="wb2-card-d">{s.whenToUse || s.description}</p>
                            <div className="wb2-card-meta">
                              <span className="wb2-installs" title="累计安装人数（卸载不减）">
                                <Store size={11} /> {(storeInfo?.installs ?? s.installs ?? 0).toLocaleString()} 人安装
                              </span>
                              {on && <span className="wb2-tag is-ok">已安装</span>}
                              {isMine && <span className="wb2-tag is-lvl">我创建的</span>}
                            </div>
                          </button>
                          <div className="wb2-card-ops">
                            {isMine && (
                              <>
                                <button className="wb2-op" title="编辑"
                                  onClick={() => { const info = storeSkills.find((x) => x.id === s.id); setSkillModal(skillToForm(info ?? s)); }}>
                                  <Pencil size={13} />
                                </button>
                                <button className="wb2-op is-danger" title="删除" onClick={() => void removeSkill(s)}>
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                            <button
                              className={`wb2-install${on ? " is-on" : ""}`}
                              title={on ? "已安装，点击卸载" : "安装到对话（常驻）"}
                              aria-label={on ? `卸载 ${s.name}` : `安装 ${s.name}`}
                              onClick={() => void toggleSkillApi(s.id)}
                            >
                              {on ? <Check size={14} /> : <Plus size={14} />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  {storeSkills.length === 0 && <div className="wb2-empty">市场还没有技能。</div>}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <h2 className="wb2-h2">连接器</h2>
            <p className="wb2-lead">
              把外部服务接进创作流程。
              <b>MCP 目前后端还没有实现</b>——这里如实标出来，不做假开关。
            </p>
            <div className="wb2-grid">
              {connectors.map((c) => (
                <div key={c.id} className={`wb2-card is-conn ${c.connected ? "is-on" : ""}`}>
                  <div className="wb2-card-h">
                    <span className={`wb2-avatar is-conn ${c.connected ? "is-on" : ""}`}>
                      {c.connected ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    </span>
                    <div className="wb2-card-id">
                      <div className="wb2-card-t">{c.name}</div>
                      <div className={`wb2-card-s ${c.connected ? "is-ok" : ""}`}>{c.status}</div>
                    </div>
                  </div>
                  <p className="wb2-card-d">{c.desc}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* ── 智能体详情 ── */}
      {openAgent && (
        <DetailModal onClose={() => setOpenAgent(null)}>
          <AgentDetail
            agent={openAgent}
            onSummon={() => {
              // 名册卡带 uid：按 ID 引用进创作，后端以 PG 完整档案注入。
              if (openAgent.uid) {
                navigate("/create", { state: { summonedCaps: [{ kind: "book-agent", id: openAgent.uid, label: openAgent.name }] } });
                return;
              }
              goSummon(openAgent.graphId);
            }}
          />
        </DetailModal>
      )}
      {/* ── 技能详情 ── */}
      {openSkill && (
        <DetailModal onClose={() => setOpenSkill(null)}>
          <SkillDetail
            skill={openSkill}
            installed={isInstalled(openSkill.id)}
            onToggle={() => void toggleSkillApi(openSkill.id)}
          />
        </DetailModal>
      )}
      {/* ── 技能新建/编辑（本人；含 .md 导入） ── */}
      {skillModal && (
        <SkillFormModal
          initial={skillModal === "new" ? undefined : skillModal}
          onClose={() => setSkillModal(null)}
          onSaved={refreshSkillData}
        />
      )}
      {/* ── 专家团详情（内置 / 书的专家团） ── */}
      {openTeam && (
        <DetailModal onClose={() => setOpenTeam(null)}>
          <TeamDetail
            team={openTeam}
            onSummon={() => {
              // 作品专家团整团召唤：带 bookId 引用进创作首页，后端注入名册+取数指引。
              const bookId = openTeam.id.startsWith("book:") ? openTeam.id.slice(5) : undefined;
              if (bookId) {
                navigate("/create", { state: { summonedCaps: [{ kind: "book-team", id: bookId, label: openTeam.name }] } });
                return;
              }
              goSummon(undefined);
            }}
          />
        </DetailModal>
      )}
      {/* ── 流派专家团详情：父层集群——写法 + 名下书目 + 精选智能体，逐级钻取 ── */}
      {openGenre && (() => {
        const info = genres.find((g) => `genre:${g.id}` === openGenre.id);
        const skill = info && skills.find((s) => s.id === `genre-${info.id}`);
        return (
          <DetailModal onClose={() => setOpenGenre(null)}>
            <GenreTeamDetail
              team={openGenre}
              {...(info ? { genre: info } : {})}
              onSummon={() => {
                const gid = openGenre.id.replace(/^genre:/, "");
                const genreName = info?.name ?? openGenre.tags[0] ?? openGenre.name.replace("专家团", "");
                // 召唤 = 把这个流派专家团以引用（capabilityRef）直接带进创作首页的
                // 输入框编队——落地就能开写，不再只是高亮一张卡片。
                navigate("/create", {
                  state: { summonedCaps: [{ kind: "genre", id: gid }], genre: genreName },
                });
              }}
              onOpenBook={(bookId) => {
                const t = teams.find((x) => x.id === `book:${bookId}`);
                setOpenGenre(null);
                // 这本书的智能体没进当前列表（或没沉淀）时，退到召唤它的对话页。
                if (t) setOpenTeam(t);
                else goSummon(bookId);
              }}
              onOpenAgent={(a) => { setOpenGenre(null); setOpenAgent(a); }}
              {...(skill ? {
                onOpenSkill: () => { setOpenGenre(null); setZone("skills"); setOpenSkill(skill); },
              } : {})}
            />
          </DetailModal>
        );
      })()}
    </div>
  );
}

/* ── 弹层壳与流派团详情抽到 components/GenreTeamDetail.tsx（创作首页共用） ── */

/* ── 技能详情 ── */
const SKILL_SOURCE_LABEL: Readonly<Record<string, string>> = {
  builtin: "内置", project: "项目内置", external: "拆书产出",
};

function SkillDetail({ skill, installed, onToggle }: {
  skill: SkillInfo; installed: boolean; onToggle: () => void;
}) {
  const [showBody, setShowBody] = useState(false);
  const facets: Array<[string, ReadonlyArray<string>]> = [
    ["触发词", skill.triggers ?? []],
    ["适用会话", skill.sessionKinds ?? []],
    ["提示词包", skill.promptPacks ?? []],
    ["工具提示", skill.toolHints ?? []],
    ["需要上下文", skill.contextNeeds ?? []],
  ].filter((f): f is [string, ReadonlyArray<string>] => f[1].length > 0);

  return (
    <>
      <div className="wb2-md-h">
        <span className="wb2-avatar is-lg is-skill"><Wrench size={20} /></span>
        <div>
          <h2>{skill.name}</h2>
          <div className="wb2-md-from"><code>{skill.id}</code></div>
        </div>
      </div>
      <div className="wb2-md-tags">
        {skill.source && (
          <span className="wb2-tag is-flow">{SKILL_SOURCE_LABEL[skill.source] ?? skill.source}</span>
        )}
        {installed && <span className="wb2-tag is-lead">已安装</span>}
        {skill.editable && <span className="wb2-tag is-lvl">可编辑</span>}
      </div>
      {/* 安装 = 常驻带上；对话里的 `/` 只影响当轮。这句必须说清楚，否则用户不知道两者区别 */}
      <button className={`wb2-summon${installed ? " is-off" : ""}`} onClick={onToggle}>
        {installed ? <><Check size={14} /> 已安装 · 点击卸载</> : <><Plus size={14} /> 安装到对话</>}
      </button>
      {skill.whenToUse && <div className="wb2-md-behavior">什么时候用：{skill.whenToUse}</div>}
      {skill.description && <p className="wb2-md-bio">{skill.description}</p>}
      {facets.length > 0 && (
        <dl className="wb2-md-facets">
          {facets.map(([k, list]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="wb2-md-chips">
                {list.map((v) => <span key={v} className="wb2-tag">{v}</span>)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {skill.body && (
        <div className="wb2-md-body">
          <button className="wb2-md-toggle" onClick={() => setShowBody((v) => !v)}>
            {showBody ? "收起" : "查看"} SKILL.md 规范全文
            {skill.path && <code>{skill.path}</code>}
          </button>
          {showBody && <pre className="wb2-md-pre">{skill.body}</pre>}
        </div>
      )}
    </>
  );
}

function AgentDetail({ agent, onSummon }: { agent: GraphAgent; onSummon: () => void }) {
  const st = agentTypeOf(agent.agentType || agent.tier);
  const lv = tierLabel(agent.tier);
  const weight = agent.plotWeight || st.weight;
  const facets: Array<[string, string]> = [
    ["目标", agent.goal], ["冲突", agent.conflict], ["能力", agent.abilities],
    ["关系", agent.relationships], ["成长", agent.growth], ["外貌", agent.appearance],
  ].filter((f): f is [string, string] => Boolean(f[1]?.trim()));

  return (
    <>
      <div className="wb2-md-h">
        <span className={`wb2-avatar is-lg is-${st.tone}`}>{st.icon}</span>
        <div>
          <h2>{agent.name}</h2>
          <div className="wb2-md-from">沉淀自《{agent.graphId}》</div>
        </div>
      </div>
      {/* 分类标签组：分类 / 层级 / 剧情权重 / 流派 —— 四个维度各自独立 */}
      <div className="wb2-md-tags">
        <span className={`wb2-tag is-${st.tone}`}>{st.emoji} {st.label}</span>
        {lv && <span className="wb2-tag is-lvl">{lv}智能体</span>}
        {weight > 0 && <span className="wb2-tag is-w">剧情权重 {weight}</span>}
        {(agent.flowTags ?? []).slice(0, 6).map((t) => (
          <span key={t} className="wb2-tag is-flow">{t}</span>
        ))}
      </div>
      {/* 分类不是标签，是行为口径：它在推演里怎么动 */}
      <div className="wb2-md-behavior">推演中的行为：{st.behavior}</div>
      <button className="wb2-summon" onClick={onSummon}>
        <Zap size={14} /> 召唤智能体
      </button>
      <p className="wb2-md-bio">{agent.bio || agent.persona || "这个智能体的画像还没填全。"}</p>
      {facets.length > 0 ? (
        <dl className="wb2-md-facets">
          {facets.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      ) : (
        <div className="wb2-md-thin">
          天衍生成时只填了人设，目标/冲突/能力等字段是空的 —— 召唤它能提供的信息有限。
        </div>
      )}
    </>
  );
}

function TeamDetail({ team, onSummon }: { team: ExpertTeam; onSummon: () => void }) {
  const [showPrompt, setShowPrompt] = useState(false);
  return (
    <>
      <div className="wb2-md-h">
        <span className="wb2-avatar is-lg is-team">{team.kind === "builtin" ? "⚙" : "◈"}</span>
        <div>
          <h2>{team.name}{team.kind === "builtin" && <span className="wb2-badge">内置</span>}</h2>
          <div className="wb2-md-from">{team.tagline}</div>
        </div>
      </div>
      <button className="wb2-summon" onClick={onSummon}>
        <Zap size={14} /> 召唤专家团
      </button>

      <div className="wb2-md-sec">这支团能干什么</div>
      <p className="wb2-md-bio">{team.does}</p>

      <div className="wb2-md-sec">{team.kind === "book" ? "成员分类" : "擅长的工作"}</div>
      <div className="wb2-md-tags">
        {team.tags.map(tag => <span key={tag} className="wb2-tag">{tag}</span>)}
      </div>
      {team.kind === "book" && <>
        <div className="wb2-md-sec">设定标签</div>
        {team.settingTags?.length ? <div className="wb2-md-tags">
          {team.settingTags.map(tag => <span key={tag} className="wb2-tag is-flow">{tag}</span>)}
        </div> : <p className="wb2-md-bio">这本书暂未整理设定标签。</p>}
      </>}

      <div className="wb2-md-sec">可以直接问</div>
      <div className="wb2-md-prompts">
        {team.prompts.map((p) => <div key={p} className="wb2-md-prompt">「{p}」</div>)}
      </div>

      {/* 展示已保存的设定内容，不把档案预览冒充实际系统提示词。 */}
      {team.kind === "book" && team.sourceAgents && team.sourceAgents.length > 0 && (
        <>
          <div className="wb2-md-sec">团队设定与成员档案</div>
          <div className="wb2-md-body">
            <button className="wb2-md-toggle" onClick={() => setShowPrompt((v) => !v)}>
              {showPrompt ? "收起" : "查看"} 完整设定 · {team.sourceAgents.length} 个智能体
            </button>
            {showPrompt && (
              <div>{team.sourceAgents.map(agent => <details key={agent.uid ?? agent.name}>
                <summary>{agent.name} · {agentTypeOf(agent.agentType).label}</summary>
                <dl className="wb2-md-facets">
                  {[["简介", agent.bio], ["性格", agent.persona], ["外貌", agent.appearance], ["目标", agent.goal],
                    ["冲突", agent.conflict], ["能力", agent.abilities], ["关系", agent.relationships],
                    ["成长", agent.growth], ["行动方式", agent.behavior]].filter(([, value]) => value?.trim()).map(([label, value]) =>
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
              </details>)}</div>
            )}
          </div>
        </>
      )}

      <div className="wb2-md-sec">
        <Users size={12} /> 团队成员 <em>{team.members.length}</em>
      </div>
      <div className="wb2-md-members">
        {team.members.map((m, i) => (
          <div key={`${m.name}-${i}`} className="wb2-md-member">
            <span className="wb2-mini">{m.emoji ?? tierStyle(m.tier ?? "").icon}</span>
            <div>
              <div className="wb2-md-mname">
                {m.name}
                <em>{m.role}</em>
                {team.kind === "builtin" && team.leadTag !== false && i === 0 && <span className="wb2-lead-tag">主理人</span>}
              </div>
              {m.bio && <div className="wb2-md-mbio">{m.bio}</div>}
              {m.delivers && <div className="wb2-md-mbio"><strong>你会得到：</strong>{m.delivers}</div>}
              {Boolean(m.tags?.length) && <div className="wb2-md-tags">{m.tags!.map(tag => <span key={tag} className="wb2-tag is-flow">{tag}</span>)}</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
