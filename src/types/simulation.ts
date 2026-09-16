/**
 * 仿真剧场 —— 前端类型。
 *
 * 会话/消息/成员这些**派生自真实仿真流**的类型都在 lib/sim-theater.ts，
 * 这里只留纯 UI 侧的枚举，避免两处各定义一份形状不同的「消息」。
 */

/** 成员在场状态（见 lib/sim-theater.ts 的推导规则）。 */
export type AgentStatus = "online" | "offline" | "thinking";

/**
 * 用户在剧场里的三种身份：
 * - observe  围观：只看，不介入（默认——推演本来就是自动跑的）
 * - participate 参与：以角色身份发言，作为**建议**进入上下文
 * - guide    引导：以导演身份下**指令**，直接影响后续生成
 */
export type UserMode = "observe" | "participate" | "guide";

export const USER_MODE_LABELS: Readonly<Record<UserMode, string>> = {
  observe: "围观",
  participate: "参与",
  guide: "引导",
};

/** 左侧边栏两个页签：按群聊看 / 按角色看。 */
export type SidebarTab = "groups" | "cast";
