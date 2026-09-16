/**
 * 专家团 —— 多个智能体组合起来干一件事。
 *
 * 我们的第一个专家团是**内置的六师**：每本小说创作都在用它，
 * 六个角色（编排→执笔→治理→审校→修订→结算）在每一步/每一章内部
 * 依次出手。它不是"背景说明"，它就是一个真实存在、天天在跑的专家团。
 *
 * 第二类专家团来自**每本小说自己的领域**：创作过程中沉淀进图谱的智能体，
 * 按书聚成一支团。这是我们和通用 Agent 产品最不一样的地方——
 * 你写一本书，就长出一个领域的专家团。
 */
import { SIX_MASTERS, agentTypeOf, tierLabel } from "./experts";
import type { GraphAgent, GenreInfo } from "../lib/api";

export type TeamKind = "builtin" | "book" | "genre";

export interface TeamMember {
  readonly name: string;
  readonly role: string;
  readonly emoji?: string;
  readonly tier?: string;
  readonly bio?: string;
  readonly delivers?: string;
  readonly tags?: ReadonlyArray<string>;
}

export interface ExpertTeam {
  readonly id: string;
  readonly kind: TeamKind;
  readonly name: string;
  readonly tagline: string;
  /** 这支团能干什么。 */
  readonly does: string;
  readonly tags: ReadonlyArray<string>;
  readonly settingTags?: ReadonlyArray<string>;
  readonly members: ReadonlyArray<TeamMember>;
  /** 召唤后可以直接问的示例。 */
  readonly prompts: ReadonlyArray<string>;
  /** 来源领域（书名）；内置团为空。 */
  readonly domain?: string;
  /**
   * 书专家团的原始智能体，详情页用它展示完整设定。
   * 只有 kind === "book" 有——内置团是流水线不是提示词，流派团的提示词是写法全文。
   */
  readonly sourceAgents?: ReadonlyArray<GraphAgent>;
  /**
   * 首位成员是否标「主理人」。默认标。
   *
   * 拆书团要关掉：它的顺序是**流水线先后**（入库→测绘→…→验收），
   * 不是层级。给入库师挂个「主理人」是句假话。
   */
  readonly leadTag?: boolean;
}

/** 内置六师团 —— 我们的第一个专家团。 */
const WRITING_COPY = {
  plan: { role: "安排写作任务", bio: "结合你的创作方向、已有设定和前文，明确这一步要写什么、要承接哪些情节。", delivers: "本次写作的目标与内容安排。" },
  write: { role: "写出故事初稿", bio: "根据当前任务撰写世界观、大纲或章节，把人物行动、场景和对话写出来。", delivers: "可阅读、可继续修改的初稿。" },
  normalize: { role: "调整篇幅", bio: "检查草稿是否符合本次字数要求，调整过长或过短的内容。", delivers: "篇幅更符合要求的稿件。" },
  audit: { role: "检查前后是否一致", bio: "对照已有设定和前文，检查人物行为、时间线与情节衔接，找出矛盾和遗漏。", delivers: "需要修改的问题与建议。" },
  revise: { role: "修改发现的问题", bio: "根据审校意见修改对应段落，处理情节矛盾与表达问题。", delivers: "经过针对性修改的稿件。" },
  persist: { role: "保存成果与故事进展", bio: "保存本次稿件，并记录新发生的事件和设定变化，供后续章节衔接使用。", delivers: "已保存的稿件与更新后的故事记录。" },
};

export const SIX_MASTER_TEAM: ExpertTeam = {
  id: "builtin:six-masters",
  kind: "builtin",
  name: "写书创作专家团",
  tagline: "6 位师傅 · 从写作安排到稿件保存",
  does:
    "陪你把故事从想法写成稿件：安排写作内容、撰写初稿、调整篇幅、检查前后设定、修改问题并保存成果。进入小说创作后，六位师傅会按当前任务分工协作。",
  tags: ["小说创作", "篇幅调整", "设定检查", "稿件修订"],
  leadTag: false,
  members: SIX_MASTERS.map((m) => ({
    name: m.name,
    emoji: m.emoji,
    ...WRITING_COPY[m.id],
  })),
  prompts: [
    "帮我看看这一章有没有和前文矛盾的地方",
    "按审校意见把本章重写一遍",
    "本卷的伏笔有没有漏收的？",
  ],
};

/** 把一本书的图谱智能体聚成一支专家团。 */
export function bookTeamOf(
  bookId: string,
  bookTitle: string,
  agents: ReadonlyArray<GraphAgent>,
): ExpertTeam {
  const categories = [...new Set(agents.map(a => agentTypeOf(a.agentType).label))];
  const scope = agents[0]?.sourceScope;
  return {
    id: `book:${bookId}`,
    kind: "book",
    name: `《${bookTitle}》专家团`,
    tagline: scope ? `${agents.length} 个智能体 · ${scope.analyzedChapters === null ? "拆书成果持续更新" : `已分析 ${scope.analyzedChapters}/${scope.totalChapters} 章`}` : `${agents.length} 个智能体 · 沉淀自本书创作`,
    does: scope ? `来自《${bookTitle}》已分析章节的智能体与设定资产。召唤后可读取成员档案、关系和拆书成果；继续拆书会更新同一专家团，未分析章节不作为已有事实。` :
      `汇集《${bookTitle}》已有的人物与设定资料。召唤后可参考成员档案和关系讨论剧情，或延续已有设定创作续篇、外传。`,
    tags: categories,
    settingTags: [...new Set(agents.flatMap(a => a.flowTags ?? []))],
    members: agents.map((a) => ({
      name: a.name,
      role: agentTypeOf(a.agentType).label,
      emoji: agentTypeOf(a.agentType).emoji,
      tier: a.tier,
      bio: a.bio || a.persona,
      tags: [tierLabel(a.tier), ...(a.flowTags ?? [])].filter((tag): tag is string => Boolean(tag)),
    })),
    prompts: [
      "让主要角色在一个场景里碰面",
      "以反派视角写一段独白",
      "这些势力之间的关系还能怎么升级？",
    ],
    domain: bookTitle,
    sourceAgents: agents,
  };
}

/**
 * 流派专家团 —— 父子孙三层的父层。
 *
 * 它不是「六师换皮」：一个流派专家团 = 这套流派的写法（创作方法论）
 * + 知识库里这个分类下的所有书（每本书自带它的专家团——子层）
 * + 这些书沉淀的设定智能体（孙层）。
 * 数据由 `GET /api/v1/genres/:id/cluster` 真实聚合（HAS_GENRE 边），
 * 卡片上展示的书目/智能体数是图谱数出来的，不是占位文案。
 */
export function genreTeamOf(genre: GenreInfo): ExpertTeam {
  const stats = genre.bookCount !== undefined
    ? `${genre.bookCount} 本书 · ${genre.agentCount ?? 0} 个智能体`
    : "流派方法论";
  return {
    id: `genre:${genre.id}`,
    kind: "genre",
    name: `${genre.name}专家团`,
    tagline: `${stats} · 适合 ${genre.name} 方向的创作`,
    does:
      `以「${genre.name}」的范式、节奏、爽点配方与禁忌反模式为指导的专家团。`
      + "召唤后该流派的规则会注入系统提示词，六师按此流派配方推进创作；"
      + "名下书目沉淀的设定智能体可按需查阅——这个分类下每本书的专家团都挂在它下面。",
    tags: [genre.name, "流派方法论", genre.language === "zh" ? "中文" : "其他语言"],
    members: SIX_MASTERS.map((m) => ({
      name: m.name,
      role: m.role,
      emoji: m.emoji,
      bio: m.does,
    })),
    prompts: [
      `按${genre.name}的爽点节奏设计第一章`,
      "这套流派最容易踩的禁忌是什么？",
      "这个流派下主角契约/金手指怎么设定最稳？",
    ],
  };
}

/**
 * 拆书专家团 —— 第二支内置团。
 *
 * 与六师创作团的关系：创作团把一本书**写出来**，拆书团把一本已有的书
 * **拆进图谱**（存→测→读→理→拆→验）。两支团都是内置的、天天在跑的。
 *
 * 成员定义源在后端 `packages/core/src/tianwang/masters.ts`，经
 * `GET /api/v1/tianwang/masters` 下发——这里不再抄一份。抄一份的下场是
 * 后端加了第八位师傅、前端还在展示七位，而且没人会发现。
 */
/** 七位师傅的图标。顺序即流水线顺序：存→测→立→读→并→拆→验。 */
const MASTER_EMOJI: Readonly<Record<string, string>> = {
  archivist: "📦", cartographer: "📐", opener: "📚", ontologist: "🏛",
  chronicler: "📖", weaver: "🕸", loremaster: "🧬", auditor: "✅",
};

/** 面向读者的职责说明；成员名单与先后顺序仍由后端提供。 */
const READING_COPY: Record<string, { role: string; bio: string; delivers: string }> = {
  archivist: { role: "收好小说原文", bio: "接收并保存你提交的小说原文，让后续分析都能找到对应的原文依据。", delivers: "保存好的小说母本。" },
  cartographer: { role: "整理全书目录", bio: "识别卷、章节和各章起止位置，整理完整目录。即使本次只拆几章，也保留全书目录。", delivers: "卷章目录和各章对应的原文位置。" },
  opener: { role: "看懂开篇吸引力", bio: "先读前三章，分析题材、叙述风格、主角亮相、核心设定与开篇悬念。", delivers: "开篇分析与前三章的亮点梳理。" },
  ontologist: { role: "建立资料分类", bio: "为角色、势力、地点、物品和世界规则等资料建立分类，方便后续按类查阅。", delivers: "这本书的资料分类与关联框架。" },
  chronicler: { role: "逐章梳理剧情", bio: "阅读本次选定的章节，记录每章发生的事件、出场人物、悬念与伏笔。", delivers: "逐章剧情摘要与关键信息。" },
  weaver: { role: "串起故事脉络", bio: "把逐章剧情整理成连贯的情节段落，梳理主线、节奏变化以及伏笔的铺垫与回收。", delivers: "故事脉络、分卷梳理与逆向大纲。" },
  loremaster: { role: "整理角色与世界设定", bio: "整理人物性格、目标、能力及彼此关系，也收录势力、地点和规则，组成这本书可召唤的专家团。", delivers: "成员档案、关系资料与书籍专家团；继续拆书时持续补充。" },
  auditor: { role: "检查拆书成果", bio: "核对分析内容是否齐全、能否找到依据，并列出仍需补充的部分。全书完成并通过检查后，整理成可复用的模板。", delivers: "成果检查报告；全书验收通过后提供书籍模板。" },
};

export function deconstructionTeamOf(
  masters: ReadonlyArray<import("../lib/api").DeconstructionMaster>,
): ExpertTeam {
  return {
    id: "builtin:deconstruction-masters",
    kind: "builtin",
    name: "拆书专家团",
    tagline: `${masters.length} 位师傅 · 从小说原文到创作参考`,
    does:
      "帮你读懂一本小说的写法：从完整目录和开篇分析开始，逐章梳理剧情，再整理人物、关系、世界设定与故事结构。可以先拆几章看效果，之后在同一本书上继续。",
    tags: ["开篇分析", "逐章拆解", "人物设定", "故事结构"],
    leadTag: false,
    members: masters.map((m) => ({
      name: m.name,
      // 有 emoji 时组件展示 role（职责），没有就会回落成 tierStyle 的「未分类」。
      emoji: MASTER_EMOJI[m.id] ?? "🧩",
      ...(READING_COPY[m.id] ?? { role: "整理拆书资料", bio: "协助整理这本书的分析成果。", delivers: "本阶段的分析结果。" }),
    })),
    prompts: [
      "这本书拆到哪一关了？",
      "先帮我拆前10章，看看开篇和人物是怎么写的",
      "沿着已有进度，再拆10章",
    ],
  };
}
