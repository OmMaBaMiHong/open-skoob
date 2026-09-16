/**
 * CreateHomePage —— 创作首页。
 *
 * 三大类模板：
 * 1. 天王模板（小说书籍）— 可按流派筛选
 * 2. 流派模板（流派设定）— 不是书，是流派世界观
 * 3. 智能体模板（角色卡）— 各种角色设定
 *
 * 布局：顶部导航 + 中央输入框 + 分类标签页 + 模板画廊
 */
import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  BookOpen, Bot,
  Search, Loader2, Layers, Wand2, Flame, Radar,
} from "lucide-react";
import {
  fetchTianwangCatalog, startSourceDeconstruction,
  fetchAgentPrototypes,
  type TianwangCatalog, type TianwangDeconstructionStatus,
  type CapabilityRef,
} from "../lib/api";
import { useCloudAccess, CloudAccessPrompt } from "../cloud-access";
import { Composer } from "../components/Composer";
import { DetailModal, GenreTeamDetail } from "../components/GenreTeamDetail";
import { genreTeamOf } from "../types/teams";
import { EMPTY_SUMMON, type Summoned, type PendingFile } from "../types/composer";
import { useComposerData, withInstalledSkills } from "../hooks/use-composer-data";
import { useTianwangBook } from "../lib/api";
import { HotboardPanel } from "../components/HotboardPanel";
import { ScanPanel } from "../components/ScanPanel";
import {
  MODE_TO_BACKEND, supportsAutoRun, AUTO_RUN_WARNINGS, CREATION_MODE_META,
  type CreationMode, type CreationStrategy,
} from "../types/creation-loop";
import { useMembership } from "../hooks/use-membership";
import { readAuth, getVisitorId } from "../lib/auth-storage";
import { apiUrl } from "../lib/api-origin";
import { agentTypeOf } from "../types/experts";
import { startOAuthLogin } from "../lib/account";
import { GeneralAgentDraft } from "../lib/general-agent-draft";
import { sendHomeAgent } from "../lib/home-agent";

/** 三个模式只是入口 UI，落到后端就是 approvalPolicy 一个字段。 */
// 展示信息在 types/creation-loop 的 CREATION_MODE_META —— 作品库要用同一份。
// 「全自动」不在这排：它只是把审阅闸门关掉，是引导/剧场的一个开关，不是第四条路。
const MODE_OPTIONS: ReadonlyArray<{
  readonly id: CreationMode; readonly icon: string;
  readonly label: string; readonly desc: string;
}> = (["guided", "conversation", "film"] as const)
  .map((id) => ({ id, ...CREATION_MODE_META[id] }));

/* ── 类型 ── */
interface BookTemplate {
  readonly id: string;
  readonly kind: "book";
  readonly title: string;
  readonly author: string;
  readonly genre: string;
  readonly cover: string;
  readonly tags: ReadonlyArray<string>;
  readonly description: string;
  /**
   * 已拆 = 有世界观/大纲/角色/技法资产可直接二创；
   * 未拆 = 只有书目条形，要先拆书才能用。两者能做的事完全不同，必须分开展示。
   */
  readonly ready: boolean;
  /**
   * 拆书状态。「拆书中」也要显示——一本书只要存在就该在天王模板里看得见，
   * 不能用是可以的，看不见不行。
   */
  readonly status: TianwangDeconstructionStatus;
  /** 书目 slug —— 「使用」接口按它取图谱/专家团/母本。 */
  readonly slug: string;
  /** 拆书产物 id（ready 时有），二创时按它引用母本。 */
  readonly sourceId?: string;
  /** asset 表数字主键，用于封面 API */
  readonly assetId?: string | null;
  /** 封面地址（短期签名）——列表接口随模板一并返回，就是模板数据的一部分 */
  readonly coverUrl?: string | null;
}

interface GenreTemplate {
  readonly id: string;
  readonly kind: "genre";
  readonly name: string;
  readonly cover: string;
  readonly tags: ReadonlyArray<string>;
  readonly description: string;
  /** asset 表数字主键，用于封面 API */
  readonly assetId?: string | null;
  /** 封面地址（短期签名）——列表接口随模板一并返回。 */
  readonly coverUrl?: string | null;
}

interface AgentTemplate {
  readonly id: string;
  readonly kind: "agent";
  readonly name: string;
  readonly role: string;
  readonly cover: string;
  readonly tags: ReadonlyArray<string>;
  readonly description: string;
  /** asset 表数字主键，用于封面 API */
  readonly assetId?: string | null;
  /** 封面地址（短期签名）——列表接口随模板一并返回。 */
  readonly coverUrl?: string | null;
  /** 业务分类（智能体九类 slug），入库字段，随接口返回 */
  readonly category?: string | null;
}

type Template = BookTemplate | GenreTemplate | AgentTemplate;

type MainTab = "hot" | "scan" | "book" | "genre" | "agent";

/* ── 灵感来源 ──
   天魔脑洞排在最前：模板是「照着谁写」，热榜是「此刻写什么」，
   后者更能解决空白页问题，所以做默认落地页。 */
const MAIN_TABS: ReadonlyArray<{ key: MainTab; label: string; icon: typeof BookOpen; desc: string }> = [
  { key: "hot", label: "天魔脑洞", icon: Flame, desc: "全网热榜" },
  { key: "scan", label: "天魔扫榜", icon: Radar, desc: "网文榜单与选题分析" },
  { key: "book", label: "天王模板", icon: BookOpen, desc: "小说书籍" },
  { key: "genre", label: "流派模板", icon: Layers, desc: "流派设定" },
  { key: "agent", label: "智能体模板", icon: Bot, desc: "角色卡" },
];

/* ── 封面渐变 ── */
const COVER_GRADIENTS = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)",
  "linear-gradient(135deg, #f46b45 0%, #eea849 100%)",
  "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)",
  "linear-gradient(135deg, #fc5c7d 0%, #6a82fb 100%)",
];

function gradientForIndex(i: number): string {
  return COVER_GRADIENTS[i % COVER_GRADIENTS.length];
}

/* ── 流派列表（子分类） ── */
const GENRES = [
  { key: "all", label: "全部" },
  { key: "xuanhuan", label: "玄幻" },
  { key: "dushi", label: "都市" },
  { key: "kehuan", label: "科幻" },
  { key: "yanqing", label: "言情" },
  { key: "xuanyi", label: "悬疑" },
  { key: "lishi", label: "历史" },
  { key: "xiuxian", label: "仙侠" },
  { key: "wangyou", label: "网游" },
  { key: "yanjing", label: "惊悚" },
] as const;

/* ── 流派栏无硬编码清单：完全由真实流派库（/api/v1/genres）驱动，
      接口没回来就显示空态，宁可空也不摆假数据 ── */

/* ── 智能体原型数据：完全由 /api/v1/agent-prototypes 驱动（asset 表 type='agent'），
      接口没回来就显示空态，不再硬编码 ── */

/* ── 将天王目录数据转为书籍模板 ── */
function catalogToBookTemplates(catalog: TianwangCatalog): ReadonlyArray<BookTemplate> {
  const templates: BookTemplate[] = [];
  let idx = 0;

  for (const author of catalog.authors) {
    for (const book of author.books) {
      const genre = book.tags?.[0] || "其他";
      templates.push({
        id: `book-${book.slug}`,
        kind: "book",
        title: book.title,
        author: author.name,
        genre,
        cover: gradientForIndex(idx++),
        tags: book.tags || [],
        description: book.shortDescription || "",
        ready: book.deconstructionStatus === "ready",
        status: book.deconstructionStatus,
        slug: book.slug,
        assetId: book.assetId ?? null,
        coverUrl: book.coverUrl ?? null,
        ...(book.sourceId ? { sourceId: book.sourceId } : {}),
      });
    }
  }

  return templates;
}

export function CreateHomePage() {
  const cloudAccess = useCloudAccess();
  const templatesAllowed = cloudAccess.ready && cloudAccess.entitlements.includes("templates.read");
  const hotboardAllowed = cloudAccess.ready && cloudAccess.entitlements.includes("hotboard.read");
  const brainstormAllowed = cloudAccess.ready && cloudAccess.entitlements.includes("brainstorm.read");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const genreParam = searchParams.get("genre");
  const tianmoTab = searchParams.get("tianmo");
  /** 从智能体页「召唤流派/作品专家团/成员」带过来的引用编队与流派。 */
  const routeState = (location.state ?? null) as
    | { summonedCaps?: ReadonlyArray<CapabilityRef & { label?: string }>; genre?: string; scanSeed?: string }
    | null;
  const [mainTab, setMainTab] = useState<MainTab>(routeState?.scanSeed || tianmoTab === "scan" ? "scan" : genreParam || routeState?.genre ? "genre" : "hot");
  const [scanVisited, setScanVisited] = useState(mainTab === "scan");
  useEffect(() => { if (mainTab === "scan") setScanVisited(true); }, [mainTab]);
  useEffect(() => { if (tianmoTab === "scan" || tianmoTab === "hot") setMainTab(tianmoTab); }, [tianmoTab]);
  function selectMainTab(tab: MainTab) {
    setMainTab(tab);
    setSelectedTemplate(null);
    if (tianmoTab || tab === "scan") setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (tab === "scan" || tab === "hot") next.set("tianmo", tab);
      else next.delete("tianmo");
      return next;
    }, { replace: true });
  }
  const [genreFilter, setGenreFilter] = useState<string>("all");
  /** 流派模板详情弹层（点流派卡 = 看详情，不是直接选中）。 */
  const [openGenreTemplate, setOpenGenreTemplate] = useState<GenreTemplate | null>(null);

  // 同一路由内 query 变化（/create?genre=…）不会触发重挂载，靠 effect 同步 tab。
  useEffect(() => {
    if (genreParam) setMainTab("genre");
  }, [genreParam]);
  useEffect(() => {
    if (routeState?.genre) setMainTab("genre");
  }, [routeState?.genre]);
  // 扫榜页「用这个开写」带过来的选题种子：进输入框，保留扫榜阅读入口。
  useEffect(() => {
    if (routeState?.scanSeed) {
      setInput(routeState.scanSeed);
      setMainTab("scan");
      navigate(`${location.pathname}?tianmo=scan`, { replace: true, state: null });
      requestAnimationFrame(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
        textarea?.focus(); textarea?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState?.scanSeed]);
  /**
   * 拆书状态筛选。一张书架 + 状态 chip，不再分两个看板：
   * 1 vs 210 的数量差让「已拆书」独立成栏永远近乎空屏，状态信息卡片角标
   * 本来就有，筛选只是浏览辅助。
   */
  const [readyFilter, setReadyFilter] = useState<"all" | "ready" | "todo">("all");
  const [input, setInput] = useState("");
  /* ── 输入框能力：编队 / 附件 —— 数据由 useComposerData 统一提供 ── */
  const [summoned, setSummoned] = useState<Summoned>(EMPTY_SUMMON);
  const [files, setFiles] = useState<ReadonlyArray<PendingFile>>([]);
  // 智能体是**跨书**沉淀的资产：新书还不存在，但旧书的角色/势力可以拿来起头。
  const composerData = useComposerData({ preserveExplicitModel: true });
  const { skills, agents: graphAgents, genres, templates: agentTemplates, llm, installed } = composerData;

  useEffect(() => {
    setSummoned((prev) => withInstalledSkills(prev, skills, installed));
  }, [installed, skills]);

  /*
   * 智能体页「召唤流派专家团」带过来的引用 → 直接进输入框编队条。
   *
   * 落地即生效：流派 chip 已在编队里，用户写一句想法就能发——
   * 不用再去找流派卡点一遍。label 等流派库到了再还原。
   */
  useEffect(() => {
    const caps = routeState?.summonedCaps;
    if (!caps?.length) return;
    setSummoned((prev) => {
      const have = new Set(prev.caps.map((c) => `${c.ref.kind}:${c.ref.id}`));
      const add = caps
        .filter((c) => !have.has(`${c.kind}:${c.id}`))
        .map((c) => {
          const g = genres.find((x) => x.id === c.id);
          const label = c.label ?? (
            c.kind === "book-team" ? `作品专家团（${c.id}）`
            : c.kind === "book-agent" ? `智能体（${c.id.slice(0, 12)}）`
            : g?.name ?? c.id);
          return { ref: { kind: c.kind, id: c.id }, label };
        });
      return add.length === 0 ? prev : { ...prev, caps: [...prev.caps, ...add] };
    });
  }, [routeState?.summonedCaps, genres]);

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  /**
   * 这次要干的是「写书」还是「拆书」。
   *
   * 两条路完全不同：写书走 /workbench 的意图卡引导，拆书走七师流水线。
   * 原先没有这个区分——点「去拆书」只是往输入框塞一句提示词，
   * 然后照样跳 /workbench 进写书引导，用户以为在拆书，实际在建新书。
   */
  const [intent, setIntent] = useState<"create" | "deconstruct">("create");
  const [deconstructTarget, setDeconstructTarget] = useState<BookTemplate | null>(null);
  const [deconstructError, setDeconstructError] = useState<string | null>(null);
  const [mode, setMode] = useState<CreationMode>("guided");
  /** 全自动开关。不进模式那一排 —— 它是「怎么跑」，不是「跑哪条路」。 */
  /** 创作引擎与模式正交：simulate = 天衍 72 轮仿真 + 图谱（会员）。 */
  const [strategy, setStrategy] = useState<CreationStrategy>("fast");
  const [showGate, setShowGate] = useState(false);
  const membership = useMembership();
  const canSimulate = membership.entitlements.includes("world.simulate");

  // Everyone starts with standard creation; simulation is an explicit choice.
  const [bookTemplates, setBookTemplates] = useState<ReadonlyArray<BookTemplate>>([]);
  const [agentPrototypes, setAgentPrototypes] = useState<ReadonlyArray<AgentTemplate>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 调试日志：mode 变化时打印
  useEffect(() => {
    console.log("[CreateHomePage] mode 已更新为:", mode);
  }, [mode]);

  // 加载天王模板（书籍）+ 智能体原型
  useEffect(() => {
    let alive = true;
    if (!templatesAllowed) { setBookTemplates([]); setAgentPrototypes(previous => previous.filter(x => !x.id.startsWith("official:"))); setOpenGenreTemplate(null); setAssetGateBook(null); setSelectedTemplate(null); setLoading(false); }
    Promise.all([
      (templatesAllowed ? fetchTianwangCatalog() : Promise.resolve({ authors: [] } as unknown as TianwangCatalog)).then(catalogToBookTemplates).then(books => { if (alive) { setBookTemplates(books); setLoading(false); } }),
      fetchAgentPrototypes().then((protos) =>
        protos.map((p, i) => ({
          id: p.id, kind: "agent" as const, name: p.name, role: p.role,
          tags: p.tags, description: p.description, assetId: p.assetId,
          coverUrl: p.coverUrl ?? null,
          category: p.category ?? null,
          cover: gradientForIndex(i + 5),
        })),
      ).then(items => { if (alive) setAgentPrototypes(templatesAllowed ? items : items.filter(x => !x.id.startsWith("official:"))); }),
    ])
      .then(() => { if (alive) setLoading(false); })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "加载模板失败");
        setLoading(false);
      });
    return () => { alive = false; };
  }, [templatesAllowed]);

  // 当前展示的模板列表
  const currentTemplates: ReadonlyArray<Template> = (() => {
    if (mainTab === "hot" || mainTab === "scan") return [];
    if (mainTab === "book") {
      return bookTemplates.filter((t) =>
        // 「拆书中」归进待拆筛选——它还不能用，但必须看得见（含进度状态）。
        (readyFilter === "all" ? true : readyFilter === "ready" ? t.ready : !t.ready)
        && (genreFilter === "all" || t.genre === GENRES.find((g) => g.key === genreFilter)?.label));
    }
    if (mainTab === "genre") {
      /*
       * 流派栏只认真实流派库（46 个官方流派 + 项目自定义，/api/v1/genres），
       * 与智能体页的流派专家团同源——从那里「召唤」带过来的 ?genre= 名字
       * 才能命中高亮。接口没回来就空着，不摆假数据。
       */
      return genres.map((g, i) => ({
        id: g.id, kind: "genre" as const, name: g.name,
        tags: [g.name],
        description: g.bookCount !== undefined
          ? `名下 ${g.bookCount} 本书 · ${g.agentCount ?? 0} 个设定智能体。选中即挂载该流派的写法规范。`
          : `选中即挂载「${g.name}」的写法规范（核心循环 / 章节配方 / 禁忌反模式）。`,
        cover: gradientForIndex(i),
        assetId: g.assetId ?? null,
        coverUrl: g.coverUrl ?? null,
      }));
    }
    return agentPrototypes;
  })();

  /**
   * 发起拆书。
   *
   * 后端拆书走 Agent 工具 `tianwang_deconstruct_source`：Agent 会先问作者名/授权，
   * 齐了再执行。所以这里不直接调接口，而是把请求写进输入框交给对话——用户还能
   * 在同一轮里补充「按 XX 的路数拆」这类要求。
   */
  /**
   * 使用一本已拆的书 —— 真挂上，不是嘴上说说。
   *
   * 后端返回三样：skillId（挂进本轮，Agent 才有查询母本的四个工具）、
   * graphId、以及这本书的专家团。此前这里只往输入框塞一句「参考《X》的风格」，
   * 后端什么都没收到，用户以为在二创，其实模型对这本书一无所知。
   */
  const [useBusy, setUseBusy] = useState<string | null>(null);
  const useBook = async (t: BookTemplate) => {
    // 使用要挂真实资产（调 /use 接口），匿名点等于白点——先走授权。
    if (!readAuth()) {
      startOAuthLogin(window.location.href);
      return;
    }
    setUseBusy(t.id);
    try {
      const payload = await useTianwangBook(t.slug);
      setSummoned((prev) => {
        const skill = skills.find((s) => s.id === payload.skillId);
        const haveSkill = new Set(prev.skills.map((x) => x.id));
        const haveAgent = new Set(prev.agents.map((x) => x.name));
        return {
          ...prev,
          skills: skill && !haveSkill.has(skill.id) ? [...prev.skills, skill] : prev.skills,
          // 专家团只带核心几位进编队，其余仍可在 `@` 菜单里召唤——
          // 一次塞 22 个进提示词会把上下文挤爆。
          agents: [
            ...prev.agents,
            ...payload.agents.filter((a) => !haveAgent.has(a.name)).slice(0, 5),
          ],
        };
      });
      setSelectedTemplate(t);
      setInput(`基于《${payload.title}》二创：`);
      document.querySelector<HTMLTextAreaElement>("textarea.cp-input")?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setError(error instanceof Error ? error.message : "模板暂时无法使用，请重试。");
    } finally {
      setUseBusy(null);
    }
  };

  const startDeconstruct = (t: BookTemplate) => {
    setIntent("deconstruct");
    setDeconstructTarget(t);
    setSelectedTemplate(t);
    setDeconstructError(null);
    // 输入框在拆书意图下不是必填——拆什么已经由选中的书决定了。
    setInput("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** 退回写书意图（用户清掉选中的书时）。 */
  const clearIntent = () => {
    setIntent("create");
    setDeconstructTarget(null);
    setDeconstructError(null);
    setSelectedTemplate(null);
  };

  const readyCount = bookTemplates.filter((t) => t.ready).length;
  const todoCount = bookTemplates.length - readyCount;

  /*
   * 已拆完的书有两个动作，触发点分开设计：
   *   点卡片本体 → 公开模板简介；
   *   卡片上的「去二创」按钮 → 挂载进输入框直接写书——登录即可。
   * 浏览给大点击区、动作用显式按钮，和流派卡「点卡看详情、详情里选用」一个心智。
   */
  const [assetGateBook, setAssetGateBook] = useState<BookTemplate | null>(null);
  const openAssetDetail = (t: BookTemplate) => { setAssetGateBook(t); };

  // 选择模板
  const handleSelectTemplate = (template: Template) => {
    if (!readAuth()) { startOAuthLogin(window.location.href); return; }
    setSelectedTemplate(template);
    let prefix = "";
    if (template.kind === "book") {
      prefix = `参考《${template.title}》的风格`;
    } else if (template.kind === "genre") {
      prefix = `使用「${template.name}」流派设定`;
    } else {
      prefix = `使用「${template.name}」角色模板`;
    }
    setInput(prefix + "，");
  };

  // 发送
  // ── 天魔脑洞卡：卡流展示已迁到「天魔脑洞」板块顶部图文轨道（HotboardPanel）。
  // 这里只保留来源卡 id——点轨道卡填进来的种子要透传 book_source_topic（书↔热点溯源）。
  const [sourceCardId, setSourceCardId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const homeDraft = useRef<GeneralAgentDraft | null>(null);
  const sendLock = useRef(false);

  const handleSend = () => {
    if (sendLock.current) return;
    /*
     * 产品流程的登录拦截点：创作首页人人可看，点「开始创作/开始拆书」这类
     * 真正创作动作时，未登录就**直接跳中转站授权页**（一次跳转，登录授权后
     * 回到本页重试）。不做任何中间承接页。
     */
    if (!readAuth()) {
      startOAuthLogin(window.location.href);
      return;
    }
    /* ── 拆书：走七师流水线，不进写书引导 ── */
    if (intent === "deconstruct" && deconstructTarget) {
      const target = deconstructTarget;
      setUseBusy(target.id);
      setDeconstructError(null);
      void startSourceDeconstruction({ sourceId: target.slug })
        .then((started) => {
          navigate(`/deconstruction/${encodeURIComponent(started.slug)}`);
        })
        .catch((e: unknown) => {
          // 常见的是「已在拆书中」——这不是错误，直接把用户送到进度页看着。
          const message = (e as Error).message;
          if (/已在拆书|正在拆|busy/iu.test(message)) {
            navigate(`/deconstruction/${encodeURIComponent(target.slug)}`);
            return;
          }
          setDeconstructError(message);
        })
        .finally(() => setUseBusy(null));
      return;
    }

    if (!input.trim() && !files.length) return;
    // Free input is understood by the agent before any creation page is opened.
    // Selecting a creation template remains an explicit existing creation entry.
    if (!selectedTemplate) {
      sendLock.current = true; setSending(true); setSendError(null);
      const draft = homeDraft.current ??= new GeneralAgentDraft(null);
      void sendHomeAgent(draft, { text: input, files, summoned, model: composerData.selected }, mode, strategy)
        .then(result => navigate(`/agent/${encodeURIComponent(result.sessionId)}`))
        .catch(error => setSendError(error instanceof Error ? error.message : "发送失败，输入已保留"))
        .finally(() => { sendLock.current = false; setSending(false); });
      return;
    }
    // 对话模式下书还不存在，不能伪造 bookId（后端会 BOOK_NOT_FOUND）：
    // 开一个 book-create 会话，让 Agent 在对话过程中建书。
    // ⚠️ 绝不要伪造 bookId 进工作台——后端 404，页面所有按钮都是死的。
    // 三种模式统一走「先建书」：各自的页面会先出意图卡，确认后才拿到真 id。
    // 编队与附件随 state 带进下游页面：在首页选的技能、召唤的专家、扔进来的
    // 小说母本，进对话/工作台后要接着生效，不能在跳转时丢掉。
    // 选中的流派模板同样要进编队（capabilityRefs 通道）——否则「召唤流派专家团
    // 起新书」到了对话里只剩一句文本，Agent 不知道当前流派是哪个。
    const genreCap = selectedTemplate?.kind === "genre"
      ? [{ kind: "genre" as const, id: selectedTemplate.id }]
      : [];
    const state = {
      instruction: input, templateId: selectedTemplate?.id, mode, strategy,
      brainstormCardId: sourceCardId ?? undefined,
      approvalPolicy: MODE_TO_BACKEND[mode].approvalPolicy,
      summonedSkillIds: summoned.skills.map((s) => s.id),
      summonedAgentNames: summoned.agents.map((a) => a.name),
      summonedCaps: [
        ...summoned.caps.map((c) => c.ref),
        ...genreCap.filter((g) => !summoned.caps.some((c) => c.ref.kind === "genre" && c.ref.id === g.id)),
      ],
      attachments: files.map((f) => ({
        id: f.id, filename: f.filename, mediaType: f.mediaType, dataUrl: f.dataUrl,
      })),
      initialInput: {
        text: input, files, model: composerData.selected,
        brainstormCardId: sourceCardId ?? undefined,
        summoned: {
          ...summoned,
          caps: [...summoned.caps, ...genreCap.filter((g) => !summoned.caps.some((c) => c.ref.kind === "genre" && c.ref.id === g.id))
            .map(ref => ({ ref, label: selectedTemplate?.kind === "genre" ? selectedTemplate.name : ref.id }))],
        },
      },
    };
    /*
     * 从首页出发一律进工作台。
     *
     * 原来「开了全自动就直接去 /auto（观看推演）」——那个分支跟着首页的开关
     * 一起去掉了：现在全自动是工作台里的开关，人本来就在工作台，不需要另开
     * 一个页面。想纯观看的话工作台打开开关即可，闸门自己会过。
     */
    navigate(
      mode === "conversation" ? "/conversation"
        : mode === "film" ? "/film"
        : "/workbench",
      { state },
    );
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* 交互形式与创作策略独立，两种策略均保留六师编排。 */}
      <div className="ch-modes">
        <span className="ch-modes-label">创作模式</span>
        <div className="ch-mode-row">
          {MODE_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={`ch-mode ${mode === o.id ? "is-on" : ""}`}
              onClick={() => setMode(o.id)}
            >
              {/* 宽屏图标与名字同一行；窄屏上下两行，让卡片能压到三等分。 */}
              <span className="ch-mode-head">
                <span className="ch-mode-icon">{o.icon}</span>
                <span className="ch-mode-name">{o.label}</span>
              </span>
              <span className="ch-mode-desc">{o.desc}</span>
            </button>
          ))}
        </div>

        {/*
          窄屏上三张卡压缩成图标 + 名字（说明藏起来，否则三段文字要占掉大半屏），
          选中那个的说明单独放这一行。桌面上这行不显示——那边三段说明都在卡里。

          为什么不做成横滑：三个并列的选项，滑动意味着**看不全**——用户得先
          划一遍才知道有哪几种，而且很容易以为只有一个。三个东西正好排得下。
        */}
        <p className="ch-mode-hint">
          {MODE_OPTIONS.find((o) => o.id === mode)?.desc}
        </p>

        {/*
          「全自动运行」不在这里。

          它是**跑起来之后**才想改的事：审了两步觉得没问题，才想让它一路跑完。
          放在首页等于要求用户在还没看过任何产出时就决定要不要放弃每一道确认门
          ——那时他既没有判断依据，也不知道自己在放弃什么。开关搬到工作台，
          就在闸门旁边（见 WorkbenchPage 的 wb-auto）。
        */}

        <div className="ch-engine" role="group" aria-label="创作策略">
          <button className={`ch-engine-link ${strategy === "fast" ? "is-primary" : ""}`} aria-pressed={strategy === "fast"} onClick={() => setStrategy("fast")}>⚡ 快速直出 · 普通用户可用</button>
          <button className={`ch-engine-link ${strategy === "simulate" ? "is-primary" : ""}`} aria-pressed={strategy === "simulate"} onClick={() => canSimulate ? setStrategy("simulate") : setShowGate(true)}>🌐 仿真创作 · 会员</button>
          <span>{strategy === "fast" ? "六师逐步完成意图卡、大纲与正文，不进行天衍仿真。" : "六师编排结合智能体仿真，推演角色互动与剧情走向。"}</span>
        </div>
      </div>

      {showGate && (
        <div className="ch-gate" onClick={() => setShowGate(false)}>
          <div className="ch-gate-box" onClick={(e) => e.stopPropagation()}>
            <div className="ch-gate-title">🌐 世界模拟引擎是会员能力</div>
            <p className="ch-gate-desc">会员仿真在六师创作流程中增加天衍推演，为大纲、卷纲和正文提供角色互动与剧情素材。</p>
            <p className="ch-gate-note">普通用户可直接使用快速直出：同样保留意图卡、大纲和正文等步骤，六师持续参与，只有天衍仿真不启用。</p>
            <div className="ch-gate-actions">
              <button className="ch-gate-btn" onClick={() => setShowGate(false)}>先用快速直出</button>
              {/* 统一收敛到承接页选套餐，不直接跳中转站收银 */}
              <button
                className="ch-gate-btn is-primary"
                onClick={() => navigate("/pricing?from=simulate")}
              >
                {membership.loggedIn ? "查看会员套餐" : "登录并开通"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 模板简介公开展示，只有使用动作要求登录。 */}
      {assetGateBook && (
        <div className="ch-gate" role="dialog" aria-modal="true" aria-label="天王模板详情" onClick={() => setAssetGateBook(null)}>
          <div className="ch-gate-box" onClick={(e) => e.stopPropagation()}>
            <div className="ch-gate-title">《{assetGateBook.title}》</div>
            <p className="ch-gate-desc">{assetGateBook.description}</p>
            <p className="ch-gate-note">查看本书的拆解成果，或使用模板创作。</p>
            <div className="ch-gate-actions">
              <button className="ch-gate-btn" onClick={() => setAssetGateBook(null)}>继续浏览</button>
              {membership.loggedIn && <button className="ch-gate-btn" onClick={() => navigate(`/deconstruction/${encodeURIComponent(assetGateBook.slug)}`)}>查看拆书资产</button>}
              <button className="ch-gate-btn is-primary" onClick={() => { void useBook(assetGateBook); setAssetGateBook(null); }}>
                {membership.loggedIn ? "使用此模板" : "登录使用"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 流派模板详情：写法全文 / 名下书目 / 精选智能体，点「用这个流派创作」才选中 */}
      {openGenreTemplate && (() => {
        const info = genres.find((g) => g.id === openGenreTemplate.id);
        return (
          <DetailModal onClose={() => setOpenGenreTemplate(null)}>
            <GenreTeamDetail
              team={genreTeamOf(info ?? {
                id: openGenreTemplate.id, name: openGenreTemplate.name,
              })}
              {...(info ? { genre: info } : {})}
              summonLabel={`用这个流派创作 · ${openGenreTemplate.name}`}
              onSummon={() => {
                handleSelectTemplate(openGenreTemplate);
                setOpenGenreTemplate(null);
              }}
              onOpenBook={(bookId) => navigate(`/conversation/${encodeURIComponent(bookId)}`)}
              onOpenAgent={(a) => navigate(`/conversation/${encodeURIComponent(a.graphId)}`, {
                state: { summonedAgentNames: [a.name] },
              })}
            />
          </DetailModal>
        );
      })()}

      {/* ── 主内容 ── */}
      <main className="main-content" style={{ flex: 1, maxWidth: 1200, margin: "0 auto", padding: "0 24px 40px", width: "100%" }}>
        {/* 标题 */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1
            style={{
              fontSize: "clamp(28px, 4vw, 40px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              marginBottom: 8,
            }}
          >
            <span className="serif">{intent === "deconstruct" ? "把这本书，拆开看。" : "把故事，写下去。"}</span>
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 15 }}>
            {intent === "deconstruct"
              ? "七位师傅依次过一遍：存原文、量骨架、立图谱、读章纲、并脉络、拆智能体、逐条验收"
              : mode === "conversation"
              ? "角色在群里把剧情演出来 —— 你可以围观、参与，也可以以导演身份引导"
              : mode === "film"
              ? "做一部分支剧：选择决定走向，通关后可以重玩，也可以把你的路线分享出去"
              : "选一个模板开始，或直接描述你想写的世界"}
          </p>
        </div>

        {/* 天魔脑洞卡流已迁至「天魔脑洞」板块顶部图文轨道（HotboardPanel，用户裁决 2026-09-09）。
            聊天框上方不再重复展示。 */}

        {/* ── 输入框区域（所有模式共享，与对话页同一个 Composer） ── */}
        <div style={{ maxWidth: 720, margin: "0 auto 48px" }}>
          {!selectedTemplate && <button type="button" className="btn" style={{ marginBottom: 16 }} disabled={!input.trim() || !composerData.selected} onClick={() => navigate(mode === "film" ? "/film" : mode === "conversation" ? "/conversation" : "/workbench", { state: { instruction: input, mode, strategy: "fast", initialInput: { text: input, files, model: composerData.selected, summoned } } })}>
            {mode === "film" ? "以此灵感制作影游" : "以此灵感开始六步创作"}
          </button>}
          <Composer
            value={input}
            onChange={setInput}
            onSend={handleSend}
            disabled={sending}
            placeholder={
              mode === "conversation"
                ? "描述你想写的故事，规划师会帮你梳理方向…（/ 唤技能，@ 召唤专家）"
                : mode === "film"
                ? "描述这部影游的前提：什么世界、主角面临什么选择…"
                : "聊聊故事想法，也可以上传小说拆书、看图或直接提问…（/ 唤技能，@ 召唤专家）"
            }
            // 首页要写一整段描述，Enter 换行，⌘/Ctrl+Enter 才发。
            submitOn="mod-enter"
            sendLabel={intent === "deconstruct"
              ? "开始拆书"
              : sending ? "正在发送…" : !selectedTemplate ? "发送"
              : mode === "conversation" ? "进剧场"
                : mode === "film" ? "做影游"
                : "开始创作"}
            {...(intent === "deconstruct" ? { allowEmpty: true } : {})}
            banner={selectedTemplate
              ? <SelectedTemplateBanner
                  template={selectedTemplate}
                  intent={intent}
                  {...(deconstructError ? { error: deconstructError } : {})}
                  onClear={clearIntent}
                />
              : undefined}
            summoned={summoned}
            onSummonedChange={setSummoned}
            skills={skills}
            agents={graphAgents}
            genres={genres}
            templates={agentTemplates}
            files={files}
            onFilesChange={setFiles}
            models={composerData.models}
            selected={composerData.selected}
            onModelChange={composerData.selectModel}
            model={llm?.model}
            modelNotice={composerData.modelNotice}
            onManageModels={() => navigate("/settings")}
          />
          {sendError && <p role="alert" style={{ color: "var(--danger, #b33434)", fontSize: 13 }}>{sendError}</p>}
        </div>

        {/* ── 灵感来源：热榜 + 三类模板（三种模式通用，都是往输入框里塞方向） ── */}
        {true && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {MAIN_TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    aria-pressed={mainTab === tab.key}
                    onClick={() => selectMainTab(tab.key)}
                    style={{
                      padding: "10px 18px",
                      borderRadius: 12,
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      border: `1px solid ${mainTab === tab.key ? "var(--accent)" : "var(--line)"}`,
                      background: mainTab === tab.key ? "var(--accent-soft)" : "var(--panel)",
                      color: mainTab === tab.key ? "var(--accent)" : "var(--muted)",
                      transition: "all 0.15s",
                    }}
                  >
                    <Icon size={15} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* ── 天魔脑洞：原有脑洞卡与全网热榜 ── */}
            <div hidden={mainTab !== "hot"}>
              {(hotboardAllowed || brainstormAllowed) ? <HotboardPanel key={cloudAccess.entitlements.join(",")} hotboardEnabled={hotboardAllowed} brainstormEnabled={brainstormAllowed}
                onScan={() => selectMainTab("scan")}
                onPick={(seed, cardId) => {
                  setInput(seed);
                  setSelectedTemplate(null);
                  // 脑洞卡来源透传（书↔热点溯源）；点热榜条目时清掉，避免串源。
                  setSourceCardId(cardId ?? null);
                  // 选完热点直接把焦点交回输入框，用户可以接着补一句自己的想法
                  requestAnimationFrame(() => {
                    const ta = document.querySelector<HTMLTextAreaElement>("textarea");
                    ta?.focus();
                    ta?.scrollIntoView({ behavior: "smooth", block: "center" });
                  });
                }}
              /> : <CloudAccessPrompt />}
            </div>

            {/* ── 天魔扫榜：同级入口，切换后保留已打开的报告 ── */}
            <div hidden={mainTab !== "scan"}>
              {!hotboardAllowed && <CloudAccessPrompt />}
              {hotboardAllowed && (scanVisited || mainTab === "scan") && <ScanPanel onPick={(seed) => {
                setInput(seed);
                setSelectedTemplate(null);
                setSourceCardId(null);
                requestAnimationFrame(() => {
                  const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
                  textarea?.focus();
                  textarea?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
              }} />}
            </div>

            {/* ── 天王模板：拆书状态筛选（一张书架 + 状态 chip）── */}
            {mainTab === "book" && !templatesAllowed && <CloudAccessPrompt />}
            {mainTab === "book" && templatesAllowed && (
              <div className="category-bar" style={{ marginBottom: 12 }}>
                <button
                  onClick={() => setReadyFilter("all")}
                  style={{
                    padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600, flexShrink: 0,
                    border: `1px solid ${readyFilter === "all" ? "var(--accent)" : "var(--line)"}`,
                    background: readyFilter === "all" ? "var(--accent-soft)" : "var(--panel)",
                    color: readyFilter === "all" ? "var(--accent)" : "var(--muted)",
                  }}
                >
                  全部 {bookTemplates.length}
                </button>
                <button
                  onClick={() => setReadyFilter("ready")}
                  style={{
                    padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600, flexShrink: 0,
                    border: `1px solid ${readyFilter === "ready" ? "var(--accent)" : "var(--line)"}`,
                    background: readyFilter === "ready" ? "var(--accent-soft)" : "var(--panel)",
                    color: readyFilter === "ready" ? "var(--accent)" : "var(--muted)",
                  }}
                >
                  可二创 {readyCount}
                </button>
                <button
                  onClick={() => setReadyFilter("todo")}
                  style={{
                    padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600, flexShrink: 0,
                    border: `1px solid ${readyFilter === "todo" ? "var(--accent)" : "var(--line)"}`,
                    background: readyFilter === "todo" ? "var(--accent-soft)" : "var(--panel)",
                    color: readyFilter === "todo" ? "var(--accent)" : "var(--muted)",
                  }}
                >
                  待拆 {todoCount}
                </button>
              </div>
            )}

            {/* ── 天王模板：流派子筛选 ── */}
            {mainTab === "book" && (
              <div className="category-bar" style={{ marginBottom: 20 }}>
                {GENRES.map((genre) => (
                  <button
                    key={genre.key}
                    onClick={() => setGenreFilter(genre.key)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      flexShrink: 0,
                      border: `1px solid ${genreFilter === genre.key ? "var(--accent)" : "var(--line)"}`,
                      background: genreFilter === genre.key ? "var(--accent-soft)" : "var(--panel)",
                      color: genreFilter === genre.key ? "var(--accent)" : "var(--muted)",
                    }}
                  >
                    {genre.label}
                  </button>
                ))}
              </div>
            )}

            {/* ── 模板卡片网格 ── */}
            {mainTab === "hot" || mainTab === "scan" ? null : loading && mainTab === "book" ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "var(--faint)" }}>
                <Loader2 size={28} style={{ margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
                <p>加载模板中…</p>
              </div>
            ) : error && mainTab === "book" ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "var(--warn)" }}>
                <p>{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  style={{ marginTop: 12, color: "var(--accent)", fontSize: 13 }}
                >
                  重试
                </button>
              </div>
            ) : (
              <div className="template-grid">
                {currentTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isSelected={selectedTemplate?.id === template.id}
                    highlighted={mainTab === "genre" && template.kind === "genre" && genreParam === template.name}
                    onSelect={() => {
                      // 已拆完的书：卡片本体 = 查看拆书资产（会员门在 openAssetDetail 里）
                      if (template.kind === "book" && template.ready) { openAssetDetail(template); return; }
                      // 拆书中 / 已失败的书点进流程页——它可能正卡在评审闸门上等人点通过。
                      // 原先这里会落到 handleSelectTemplate，往输入框塞一句「参考《X》的风格」，
                      // 而这本书根本还不能用，等于把用户带偏。
                      if (template.kind === "book"
                        && (template.status === "in_progress" || template.status === "partial"
                          || template.status === "failed")) {
                        navigate(`/deconstruction?book=${encodeURIComponent(template.slug)}`);
                        return;
                      }
                      // 流派卡 = 先看详情（写法/名下书目/精选智能体），
                      // 在详情里点「用这个流派创作」才选中——不再一点就只塞一句文本。
                      if (template.kind === "genre") { setOpenGenreTemplate(template); return; }
                      handleSelectTemplate(template);
                    }}
                    {...(template.kind === "book" && !template.ready
                      && template.status !== "in_progress" && template.status !== "partial"
                      ? { onDeconstruct: () => startDeconstruct(template) }
                      : {})}
                    {...(template.kind === "book" && template.ready
                      ? { onUse: () => void useBook(template) }
                      : {})}
                    busy={useBusy === template.id}
                  />
                ))}
              </div>
            )}

            {/* 热榜页没有"模板"这个概念，别把模板空状态漏出来 */}
            {mainTab !== "hot" && mainTab !== "scan" && (mainTab !== "book" || templatesAllowed) && !loading && !error && currentTemplates.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 0", color: "var(--faint)" }}>
                <Search size={32} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                <p>{!templatesAllowed ? "暂无本地模板；连接 Free Key 后可浏览官方模板" : "该分类暂无模板"}</p>
              </div>
            )}
          </>
        )}
        </main>
      </div>
    );
  }

  /* ── 已选模板提示条 ── */
  function SelectedTemplateBanner({ template, onClear, intent, error }: {
    template: Template;
    onClear: () => void;
    intent: "create" | "deconstruct";
    error?: string;
  }) {
    const label =
      template.kind === "book"
        ? `《${template.title}》${template.author ? ` · ${template.author}` : ""}`
        : template.kind === "genre"
        ? `「${template.name}」流派`
        : `「${template.name}」角色`;
    const deconstructing = intent === "deconstruct";

    return (
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 8,
            background: deconstructing ? "var(--warn-soft)" : "var(--accent-soft)",
            fontSize: 12,
            color: deconstructing ? "var(--warn)" : "var(--accent)",
          }}
        >
          {deconstructing ? <Layers size={14} /> : <Wand2 size={14} />}
          <span>
            {deconstructing ? "要拆的书：" : "已选模板："}<strong>{label}</strong>
          </span>
          <button onClick={onClear} style={{ marginLeft: "auto", color: "var(--muted)" }}>
            ✕
          </button>
        </div>
        {/* 拆书是另一条路，得说清楚，否则用户以为点下去是开始写 */}
        {deconstructing && (
          <p style={{ margin: "6px 2px 0", fontSize: 11.5, color: "var(--muted)", lineHeight: 1.7 }}>
            这会把这本书拆进知识图谱（角色、势力、关系、逆向大纲），拆完才能拿它二创。
            不是开始写一本新书。
          </p>
        )}
        {error && (
          <p style={{ margin: "6px 2px 0", fontSize: 12, color: "var(--warn)" }}>{error}</p>
        )}
      </div>
    );
  }

/* ── 模板卡片 ── */
function TemplateCard({
  template,
  isSelected,
  highlighted,
  onSelect,
  onDeconstruct,
  onUse,
  busy,
}: {
  template: Template;
  isSelected: boolean;
  /** 从 URL ?genre= 进入时高亮对应流派卡片，不触发选中逻辑。 */
  highlighted?: boolean;
  onSelect: () => void;
  /** 未拆书的书目：点它去拆。拆完才有资产可用。 */
  onDeconstruct?: () => void;
  /** 已拆完的书：卡片上的「去二创」——挂载进输入框（卡片本体点击是看资产）。 */
  onUse?: () => void;
  /** 正在挂载这本书的资产（拉 Skill + 专家团）。 */
  busy?: boolean;
}) {
  const title = template.kind === "book" ? template.title : template.name;
  const subtitle = template.kind === "book" ? template.author : template.kind === "genre" ? "流派模板" : template.role;

  // 封面跟模板是同一条数据（列表接口已带 coverUrl，库里的永久路径、不含域名），
  // 这里按部署环境拼上后端源直接展示；没带封面就回落渐变色。
  const coverSrc = template.coverUrl ? apiUrl(template.coverUrl) : null;
  const coverBg = coverSrc
    ? `url(${coverSrc}) center/cover no-repeat`
    : template.cover;

  return (
    <button
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        overflow: "hidden",
        border: isSelected || highlighted ? "2px solid var(--accent)" : "1px solid var(--line)",
        background: "var(--panel)",
        boxShadow: isSelected || highlighted ? "var(--shadow-lg)" : "var(--shadow)",
        transition: "all 0.2s",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-4px)";
        e.currentTarget.style.boxShadow = "var(--shadow-lg)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = isSelected || highlighted ? "var(--shadow-lg)" : "var(--shadow)";
      }}
    >
      {/* 封面 */}
      <div
        style={{
          aspectRatio: "3/4",
          background: coverBg,
          position: "relative",
          display: "flex",
          alignItems: "flex-end",
          padding: 12,
        }}
      >
        {template.kind === "book" && (
          <span
            style={{
              position: "absolute", top: 8, right: 8,
              padding: "3px 8px", borderRadius: 6,
              background: template.ready ? "rgba(232,89,12,.92)"
                : template.status === "in_progress" || template.status === "partial" ? "rgba(14,116,180,.92)"
                : template.status === "failed" ? "rgba(220,38,38,.88)"
                : "rgba(0,0,0,.42)",
              color: "#fff", fontSize: 10, fontWeight: 600, backdropFilter: "blur(4px)",
            }}
          >
            {busy ? "挂载中…"
              : template.ready ? "已拆书 · 可用"
              : template.status === "in_progress" || template.status === "partial" ? "拆书中…"
              : template.status === "failed" ? "拆书失败"
              : "待拆书"}
          </span>
        )}
        <span
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            padding: "3px 8px",
            borderRadius: 6,
            background: "rgba(0,0,0,0.5)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            backdropFilter: "blur(4px)",
          }}
        >
          {template.kind === "book" ? "书籍" : template.kind === "genre" ? "流派" : "智能体"}
        </span>

        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)",
          }}
        />
        <div style={{ position: "relative", color: "#fff" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, opacity: 0.8 }}>{subtitle}</div>}
        </div>
      </div>

      {/* 信息 */}
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
          {/* 智能体模板：分类是库里的字段（asset_category），有就置顶展示 */}
          {template.kind === "agent" && template.category && (
            <span
              style={{
                padding: "2px 6px", borderRadius: 4, background: "var(--warn-soft)",
                color: "var(--warn)", fontSize: 10, fontWeight: 600,
              }}
            >
              {agentTypeOf(template.category).label}
            </span>
          )}
          {template.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              style={{
                padding: "2px 6px",
                borderRadius: 4,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
        <p
          style={{
            fontSize: 11,
            color: "var(--muted)",
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {template.description}
        </p>
        {/* 待拆书：给一个明确的动作入口，否则用户点了卡片只是「参考风格」，
            拿不到任何资产，也不知道还能拆。 */}
        {onDeconstruct && (
          <span
            role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onDeconstruct(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onDeconstruct(); } }}
            style={{
              marginTop: 8, display: "block", textAlign: "center", cursor: "pointer",
              padding: "5px 0", borderRadius: 8, fontSize: 11, fontWeight: 600,
              border: "1px solid var(--accent)", color: "var(--accent)",
            }}
          >
            去拆书 · 拆完可上传得奖励
          </span>
        )}
        {/* 已拆完的书：第二个触发点。卡片本体点击 = 看拆书资产；
            这个按钮 = 挂载进输入框去二创。两个动作各有显式入口。 */}
        {onUse && (
          <span
            role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onUse(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onUse(); } }}
            style={{
              marginTop: 8, display: "block", textAlign: "center", cursor: "pointer",
              padding: "5px 0", borderRadius: 8, fontSize: 11, fontWeight: 600,
              border: "1px solid var(--accent)", color: "var(--accent)",
              background: "var(--accent-soft)",
            }}
          >
            {busy ? "挂载中…" : "去二创 · 挂载进输入框"}
          </span>
        )}
      </div>
    </button>
  );
}
