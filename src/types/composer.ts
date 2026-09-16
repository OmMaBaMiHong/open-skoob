/**
 * 输入框的两份共享数据形状：编队与待发附件。
 *
 * 单独成文件，是因为 Composer 组件和调用它的页面都要用，而组件互相 import
 * 类型容易绕成环。
 */
import type { PromptBusiness } from "../lib/prompt-library";
import type { SkillInfo, GraphAgent, CapabilityRef } from "../lib/api";

/**
 * 本轮编队 —— 三类召唤物走三条不同的后端通道，不能混：
 *   skills  → requestedSkills，进 runAgentSession，真改变本轮可用能力
 *   agents  → 没有专用字段，档案前置进 instruction（同后端 toolDirective 路数）
 *   caps    → capabilityRefs，后端从图谱取内容注入系统提示词
 */
export interface Summoned {
  readonly skills: ReadonlyArray<SkillInfo>;
  readonly agents: ReadonlyArray<GraphAgent>;
  readonly caps: ReadonlyArray<{ readonly ref: CapabilityRef; readonly label: string; readonly prompt?: { readonly business: PromptBusiness; readonly step: string } }>;
}

export const EMPTY_SUMMON: Summoned = { skills: [], agents: [], caps: [] };

/**
 * 待发送附件（已读成 base64 data URL，直接进 AgentRequest.attachments）。
 *
 * 后端按类型分流：图片进视觉输入；文本落盘 `.skoob/uploads/<sessionId>/`，
 * 长文（拆书原件）不注入提示词，只供 Agent 工具按 filename 读取。
 */
export interface PendingFile {
  readonly id: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly dataUrl: string;
  readonly size: number;
  /** 长文本：可作为拆书母本（tianwang_deconstruct_source 的 fileName）。 */
  readonly deconstructable: boolean;
}
