export interface CreationActivityItem {
  stage: string;
  status: "running" | "done" | "skipped" | "error";
  message: string;
  updatedAt: number;
}
export interface CreationActivity {
  bookId: string; stepId: string; requestId?: string; revision: number; updatedAt: number;
  items: CreationActivityItem[];
}
export const CRAFT_LABELS: Record<string, string> = {
  planner:"规划师 · 场景细化", composer:"编排师 · 上下文", writer:"执笔师 · 正文",
  "length-normalizer":"篇幅检查", auditor:"审校师 · 连续性", reviser:"修订师 · 定向修订",
  settler:"结算师 · 状态与伏笔", "state-validator":"结算依据校验", save:"保存正文与状态",
  "agent-sync":"同步智能体档案", archive:"保存章节结果", workflow:"本章任务",
};
export function mergeCreationActivity(previous: CreationActivity | undefined, incoming: CreationActivity, bookId: string): CreationActivity | undefined {
  if (incoming.bookId !== bookId || !/^chapter_write-\d+$/.test(incoming.stepId) || !Array.isArray(incoming.items)) return previous;
  if (previous?.bookId === incoming.bookId && previous.stepId === incoming.stepId) {
    if (previous.requestId === incoming.requestId && previous.revision >= incoming.revision) return previous;
    if (previous.updatedAt > incoming.updatedAt) return previous;
  }
  return incoming;
}
export function workflowIsBusy(status?: string): boolean { return status === "running" || status === "queued"; }
export function activitySummary(activity: CreationActivity | null | undefined, running: boolean): string {
  const active = activity?.items.find(i => i.status === "running");
  if (running && active) return active.message;
  if (running) return activity?.items.length ? "本章内容已处理，正在完成工作流收尾。" : "任务执行中，正在等待本章的阶段进度。";
  return activity?.items.at(-1)?.message ?? "本章暂无详细执行记录。";
}
