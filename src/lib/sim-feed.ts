/**
 * 仿真对话流 —— PG 的群聊 → 一场场仿真。
 *
 * 轮次存在 `chat_session` / `chat_message`：一个 session 就是一场仿真，
 * 一条消息就是一句发言。前端只做「按 stage 取那几场、按 round 归轮」。
 *
 * 纯函数，与 React 无关，单测直接覆盖。
 */
import type { CreationLoopStepType } from "../types/creation-loop";
import type { ChatSessionDto, ChatMessageDto } from "./api";

/** 仿真直播流：一轮里一个智能体的一条实质发言。 */
export interface SimSpeech {
  readonly agent: string;
  readonly type: string;
  readonly content: string;
}
export interface SimRound {
  readonly id: string;
  readonly round: number;
  readonly ts: number;
  /** 这一轮属于哪一场仿真（后端 pushSimulationRound 的 runId）。老数据没有。 */
  readonly runId: string;
  /** 这一轮服务于哪一步（pushSimulationRound 的 stage）。老数据没有 → "outline"。 */
  readonly stage: string;
  /** 正文预演才有：这是第几章的场景预演。 */
  readonly chapter: number | null;
  readonly actions: ReadonlyArray<SimSpeech>;
}

/** 一场完整仿真（= 一次 runSimulation 的全部轮次）。 */
export interface SimRun {
  readonly key: string;
  readonly runId: string;
  /** 这一场仿真服务于哪一步（取首轮的 stage）。群聊命名靠它。 */
  readonly stage: string;
  readonly chapter: number | null;
  readonly startedAt: number;
  readonly rounds: ReadonlyArray<SimRound>;
}

/** wonderwall 动作类型 → 中文对话形式。 */
export const SIM_ACTION_LABELS: Readonly<Record<string, string>> = {
  create_post: "发帖",
  create_comment: "评论",
  reply_comment: "回复",
  repost: "转发",
  quote_post: "引用",
  send_message: "私信",
};

/** 步骤 → 它消费的仿真阶段（pushSimulationRound 的 stage 标记）。
 *  旧消息没有 stage 字段：流程里第一场仿真就是大纲前仿真，归入 outline。 */
export const SIM_STAGE_OF_STEP: Readonly<Partial<Record<CreationLoopStepType, string>>> = {
  worldview: "worldview",
  outline: "outline",
  chapter_plan: "chapter_plan",
  chapter_write: "chapter_write",
};

/**
 * PG 的群聊 → 一场场仿真。
 *
 * 后端一个 `chat_session`（`kind: "round"`）就是一场仿真，所以不用再像
 * `groupSimRuns` 那样靠「轮号有没有递增」去猜分场 —— 那是 jsonl 时代没有
 * runId 才需要的启发式。
 *
 * `stage` 传了就只取那一步的场次（工作台一次只看当前步那一场）。
 */
export function runsFromChat(
  sessions: ReadonlyArray<ChatSessionDto>,
  messagesByUid: Readonly<Record<string, ReadonlyArray<ChatMessageDto>>>,
  stage?: string | null,
): ReadonlyArray<SimRun> {
  return sessions
    .filter((s) => s.kind === "round" && (!stage || s.stage === stage))
    // 早的在前：面板把最后一场当作「正在跑的那场」默认展开
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((s) => {
      const msgs = messagesByUid[s.uid] ?? [];
      // 一轮 = 同一个 round 号的连续消息
      const byRound = new Map<number, SimSpeech[]>();
      const order: number[] = [];
      for (const m of msgs) {
        if (m.senderKind !== "agent") continue;
        const r = m.round ?? 0;
        if (!byRound.has(r)) { byRound.set(r, []); order.push(r); }
        byRound.get(r)!.push({ agent: m.senderName, type: m.action, content: m.content });
      }
      const base = Date.parse(s.createdAt) || 0;
      const rounds: SimRound[] = order.map((r, i) => ({
        id: `${s.uid}#${r}`,
        round: r,
        ts: base + i,
        runId: s.runId,
        stage: s.stage,
        chapter: s.chapter,
        actions: byRound.get(r)!,
      }));
      return {
        key: s.uid,
        runId: s.runId,
        stage: s.stage,
        chapter: s.chapter,
        startedAt: base,
        rounds,
      };
    })
    .filter((run) => run.rounds.length > 0);
}
