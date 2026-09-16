/**
 * 仿真剧场 —— 一场仿真 = 一个群聊。
 *
 * **Phase 2.5：群聊与消息现在直接来自后端**（`chat_session` / `chat_message`），
 * 不再由前端扫几十个会话文件现算。本文件因此只剩两件事：
 *   1. 把后端的 DTO 翻译成界面用的形状（成员 join 画像、头像取色）；
 *   2. 群名规则 —— **有章号就叫「第 N 章」，否则叫当前步骤名**。
 *
 * 群名仍留在前端：后端存了一个兜底标题，但命名规则会随产品调整，
 * 放在一处（这里）比让后端和前端各写一份好。
 *
 * 纯函数，与 React 无关，单测直接覆盖。
 */
import type { ChatSessionDto, ChatMessageDto, GraphAgent } from "./api";

/* ══════════════════════════════════════════════════════════════════
   一、类型
   ══════════════════════════════════════════════════════════════════ */

/** 群聊来源：仿真自动建的 / 用户拉的群 / 用户和单个智能体的私聊。 */
export type TheaterSessionKind = "round" | "custom" | "direct";

/** 成员在线态：本轮发言中=thinking，本场发过言=online，只是名册里有=offline。 */
export type TheaterStatus = "online" | "thinking" | "offline";

export interface TheaterMember {
  /** 智能体名就是 id——仿真流里没有别的稳定标识。 */
  readonly id: string;
  /** 短名（画像名可能是「名字：描述」，列表只显示冒号前那截）。 */
  readonly name: string;
  readonly fullName: string;
  /** 头像底色（名字哈希 → 0-359），同一个人到哪个群都是同一个颜色。
   *  头像本身由 components/simulation/AvatarArt.tsx 按 name + agentType 画。 */
  readonly hue: number;
  readonly agentType: string;
  readonly plotWeight: number;
  /** 本群发言条数（0 = 名册里有但这场没说话）。 */
  readonly speeches: number;
  readonly status: TheaterStatus;
  /** 一句话人设，鼠标悬停/详情用。 */
  readonly bio: string;
}

export interface TheaterMessage {
  readonly id: string;
  readonly sessionId: string;
  /** "user" = 导演本人；否则是智能体名。 */
  readonly senderId: string;
  readonly senderName: string;
  readonly kind: "agent" | "user" | "system";
  /** wonderwall 动作类型（create_post/create_comment…），系统消息为空。 */
  readonly action: string;
  readonly content: string;
  readonly round: number;
  readonly ts: number;
}

export interface TheaterSession {
  readonly id: string;
  readonly kind: TheaterSessionKind;
  readonly name: string;
  /** 服务于哪一步（worldview/outline/chapter_plan/chapter_write）。 */
  readonly stage: string;
  readonly chapter: number | null;
  readonly rounds: number;
  readonly members: ReadonlyArray<TheaterMember>;
  readonly messages: ReadonlyArray<TheaterMessage>;
  readonly lastMessage: string | null;
  /** 未读条数（后端按 chat_read_state 算）。 */
  readonly unread: number;
  /** 会话内最新一条的 seq —— 标记已读与增量拉都用它。 */
  readonly lastSeq: number;
  readonly startedAt: number;
  readonly updatedAt: number;
}

/* ══════════════════════════════════════════════════════════════════
   二、命名
   ══════════════════════════════════════════════════════════════════ */

/** 仿真阶段 → 群聊名（与六步中文名对齐，见 types/creation-loop.ts）。 */
export const THEATER_STAGE_LABELS: Readonly<Record<string, string>> = {
  worldview: "世界观推演",
  outline: "全书大纲推演",
  chapter_plan: "卷纲推演",
  chapter_write: "章节场景预演",
};

export function stageLabel(stage: string): string {
  return THEATER_STAGE_LABELS[stage] ?? "仿真推演";
}

/**
 * 群名规则（用户要求：按当前模拟的章节或对应步骤命名）。
 *
 * - 有章号 → 「第 3 章 · 场景预演」，一章一个群，回看不串场。
 * - 无章号 → 步骤名；同一步骤跑了多场（重铸过）才加「· 第 k 场」，
 *   只跑过一场就不加——没有第二场的时候标「第 1 场」是噪音。
 */
export function theaterGroupName(
  run: { readonly stage: string; readonly chapter: number | null },
  ordinalInStage: number,
  totalInStage: number,
): string {
  if (run.chapter !== null) return `第 ${run.chapter} 章 · 场景预演`;
  const label = stageLabel(run.stage);
  return totalInStage > 1 ? `${label} · 第 ${ordinalInStage} 场` : label;
}

/* ══════════════════════════════════════════════════════════════════
   三、头像
   ══════════════════════════════════════════════════════════════════ */

/** 稳定哈希：同一个名字任何时候都得到同一张脸 / 同一个颜色。 */
export function nameHash(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function hueOf(name: string): number {
  return nameHash(name) % 360;
}

/** 画像名可能是「名字：描述」——列表只显示冒号前那截。 */
export function shortName(name: string): string {
  const cut = name.split(/[:：]/)[0]?.trim();
  return cut && cut.length > 0 ? cut : name;
}

/* ══════════════════════════════════════════════════════════════════
   四、名册
   ══════════════════════════════════════════════════════════════════ */

/** 图谱画像按名字建索引（仿真流里只有名字，画像要靠名字 join）。 */
export function rosterByName(
  agents: ReadonlyArray<GraphAgent>,
): ReadonlyMap<string, GraphAgent> {
  const map = new Map<string, GraphAgent>();
  for (const a of agents) {
    map.set(a.name, a);
    // 仿真流里的名字可能带描述后缀，短名也建一条索引。
    const short = shortName(a.name);
    if (!map.has(short)) map.set(short, a);
  }
  return map;
}

/** 一个智能体（可能只有名字，没有画像）→ 成员卡。 */
export function memberOf(
  name: string,
  roster: ReadonlyMap<string, GraphAgent>,
  speeches: number,
  status: TheaterStatus,
): TheaterMember {
  const profile = roster.get(name) ?? roster.get(shortName(name));
  return {
    id: name,
    name: shortName(name),
    fullName: profile?.name ?? name,
    hue: hueOf(name),
    agentType: profile?.agentType ?? "",
    plotWeight: profile?.plotWeight ?? 0,
    speeches,
    status,
    bio: profile?.bio || profile?.persona || "",
  };
}

/* ══════════════════════════════════════════════════════════════════
   五、后端 DTO → 界面用的群聊
   ══════════════════════════════════════════════════════════════════ */

/** 后端一条消息 → 界面消息。 */
export function messageOfDto(m: ChatMessageDto, sessionId: string): TheaterMessage {
  return {
    id: `m${m.id}`,
    sessionId,
    senderId: m.senderKind === "user" ? "user" : (m.senderRef || m.senderName),
    senderName: shortName(m.senderName),
    kind: m.senderKind,
    action: m.action,
    content: m.content,
    round: m.round ?? -1,
    ts: Date.parse(m.createdAt) || 0,
  };
}

/**
 * 群名规则（用户要求：按当前模拟的章节或对应步骤命名）。
 *
 * 后端存了兜底标题，但**同一步骤跑了几场**只有把整份列表放在一起才数得出来，
 * 所以编号仍在前端算：只跑过一场就不加「第 1 场」——没有第二场时那是噪音。
 */
function nameOf(
  s: ChatSessionDto,
  ordinalInBucket: number,
  totalInBucket: number,
): string {
  if (s.kind !== "round") return s.title;
  if (s.chapter !== null) return `第 ${s.chapter} 章 · 场景预演`;
  const label = stageLabel(s.stage);
  return totalInBucket > 1 ? `${label} · 第 ${ordinalInBucket} 场` : label;
}

/**
 * 后端群聊列表 → 界面群聊列表。
 *
 * 成员从 `chat_participant` 来（后端已按发言数排好），这里只补画像与头像色。
 */
export function sessionsFromChat(
  dtos: ReadonlyArray<ChatSessionDto>,
  agents: ReadonlyArray<GraphAgent>,
  opts?: { readonly liveUid?: string | null },
): ReadonlyArray<TheaterSession> {
  const roster = rosterByName(agents);
  // 自动群按「章节 / 步骤」分桶数一遍，才知道要不要编号。
  const bucketOf = (s: ChatSessionDto) =>
    s.chapter !== null ? `ch:${s.chapter}` : `st:${s.stage}`;
  const totals = new Map<string, number>();
  for (const s of dtos) {
    if (s.kind !== "round") continue;
    totals.set(bucketOf(s), (totals.get(bucketOf(s)) ?? 0) + 1);
  }

  // 编号按时间从早到晚（第 1 场是最早那场），但列表本身是新的在前。
  const chronological = [...dtos].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const seen = new Map<string, number>();
  const named = new Map<string, string>();
  for (const s of chronological) {
    if (s.kind !== "round") { named.set(s.uid, s.title); continue; }
    const key = bucketOf(s);
    const ordinal = (seen.get(key) ?? 0) + 1;
    seen.set(key, ordinal);
    named.set(s.uid, nameOf(s, ordinal, totals.get(key) ?? 1));
  }

  return dtos.map((s) => {
    const live = opts?.liveUid === s.uid;
    const members = s.members.map((m) => memberOf(
      m.ref, roster, m.speeches, live ? "online" : "offline",
    ));
    return {
      id: s.uid,
      kind: s.kind,
      name: named.get(s.uid) ?? s.title,
      stage: s.stage,
      chapter: s.chapter,
      rounds: s.messageCount,
      members,
      messages: [],          // 消息按需拉（fetchChatMessages），不随列表一起来
      lastMessage: s.lastMessage,
      unread: s.unread,
      lastSeq: s.lastSeq,
      startedAt: Date.parse(s.createdAt) || 0,
      updatedAt: Date.parse(s.updatedAt) || 0,
    };
  });
}

/* ══════════════════════════════════════════════════════════════════
   六、用户自建群聊
   ══════════════════════════════════════════════════════════════════ */

/**
 * 用户拉智能体建群 / 私聊。
 *
 * 名字缺省也按用户要的规则走：跟着**当前模拟的步骤/章节**命名，
 * 让自建群和自动群在同一套语义里。
 */
export function makeUserSession(params: {
  readonly id: string;
  readonly memberNames: ReadonlyArray<string>;
  readonly agents: ReadonlyArray<GraphAgent>;
  readonly title?: string;
  readonly stage: string;
  readonly chapter: number | null;
  readonly now: number;
}): TheaterSession {
  const roster = rosterByName(params.agents);
  const members = params.memberNames.map((n) => memberOf(n, roster, 0, "online"));
  const kind: TheaterSessionKind = members.length <= 1 ? "direct" : "custom";
  const fallback = kind === "direct"
    ? members[0]?.name ?? "私聊"
    : params.chapter !== null
      ? `第 ${params.chapter} 章 · 加演（${members.length} 人）`
      : `${stageLabel(params.stage)} · 加演（${members.length} 人）`;
  return {
    id: params.id,
    kind,
    name: params.title?.trim() || fallback,
    stage: params.stage,
    chapter: params.chapter,
    rounds: 0,
    members,
    messages: [],
    lastMessage: null,
    unread: 0,
    lastSeq: 0,
    startedAt: params.now,
    updatedAt: params.now,
  };
}

/** 导演（用户）发言 → 一条群消息。 */
export function directorMessage(
  sessionId: string,
  content: string,
  now: number,
): TheaterMessage {
  return {
    id: `user-${now}`,
    sessionId,
    senderId: "user",
    senderName: "导演",
    kind: "user",
    action: "",
    content,
    round: -1,
    ts: now,
  };
}

/** 从发言里解析 @提及（决定这句话点名让谁回应）。 */
export function parseMentions(
  content: string,
  members: ReadonlyArray<TheaterMember>,
): ReadonlyArray<string> {
  const hit: string[] = [];
  for (const m of members) {
    if (content.includes(`@${m.name}`) || content.includes(`@${m.fullName}`)) hit.push(m.id);
  }
  return hit;
}
