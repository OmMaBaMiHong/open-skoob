import type { SkillInfo } from "../lib/api";

/**
 * 技能分组 —— 技能不是一盘散沙，来源和用途完全不同。
 *
 * 分组依据是后端的 id 前缀与 source 字段（`GET /api/v1/skills`），靠前的组先讲：
 *   creation-*         七步创作流程，每步一个，是编排的骨架
 *   golden-*           写作规范：黄金一章/黄金三章等硬性写作纪律
 *   tianmo-* / genre-* 流派玩法，决定题材调性
 *   source=external    拆书产出：用户扔进一本小说后逆向生成的技法模板
 *   source=builtin     内置玩法（互动影像 / 长篇写作 / 开放世界）
 */
export const SKILL_GROUPS: ReadonlyArray<{
  id: string; label: string; hint: string; match: (s: SkillInfo) => boolean;
}> = [
  {
    id: "creation", label: "创作流程", hint: "七步编排的骨架，每步一个",
    match: (s) => s.id.startsWith("creation-"),
  },
  {
    id: "writing-craft", label: "写作规范", hint: "黄金一章/黄金三章等硬性写作纪律",
    match: (s) => s.id.startsWith("golden-"),
  },
  {
    id: "quality", label: "质量门禁", hint: "章节审查 / 去 AI 味：写完必过的关卡",
    match: (s) => s.id === "chapter-quality-gate" || s.id === "deslop-zh",
  },
  {
    id: "genre", label: "流派玩法", hint: "决定题材调性与套路库",
    match: (s) => s.id.startsWith("tianmo-") || s.id.startsWith("genre-"),
  },
  {
    id: "external", label: "拆书产出", hint: "上传小说母本后逆向生成的技法模板",
    match: (s) => s.source === "external" || s.id.startsWith("novel-"),
  },
  {
    id: "builtin", label: "内置玩法", hint: "互动影像 / 长篇写作 / 开放世界",
    match: (s) => s.source === "builtin"
      && !s.id.startsWith("tianmo-") && !s.id.startsWith("genre-"),
  },
  {
    id: "other", label: "其他", hint: "未归类",
    match: (s) => !s.id.startsWith("creation-") && !s.id.startsWith("tianmo-")
      && !s.id.startsWith("genre-") && !s.id.startsWith("golden-") && !s.id.startsWith("novel-")
      && s.id !== "chapter-quality-gate" && s.id !== "deslop-zh"
      && s.source !== "external" && s.source !== "builtin",
  },
];

