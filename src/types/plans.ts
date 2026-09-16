/**
 * 会员套餐 —— 官网与购买页共用；展示价格需在上线前与中转站套餐核对。
 *
 * 定位（沿用 2026-08-20 定案）：订单/支付/权限下发全部在中转站，
 * 本端只做「承接」——展示套餐 + 当前会员状态，购买深链中转站收银。
 */

export interface PlanInfo {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly unit: string;
  readonly tagline: string;
  readonly save?: string;
  readonly featured?: boolean;
  readonly benefits: ReadonlyArray<string>;
}

export const PLANS: ReadonlyArray<PlanInfo> = [
  {
    id: "month",
    name: "月卡",
    price: 30,
    unit: "/月",
    tagline: "入门体验",
    benefits: [
      "天魔脑洞与选题参考",
      "在基础创作流程上按权益解锁增强能力",
      "天衍仿真 · 按任务配置分阶段推演",
      "天工检测与改写 · 结果供作者参考",
    ],
  },
  {
    id: "quarter",
    name: "季卡",
    price: 90,
    unit: "/季",
    tagline: "进阶创作",
    benefits: [
      "月卡全部权益",
      "热点新闻改编 · 订阅期内使用",
      "具体功能以账号当前权益为准",
    ],
  },
  {
    id: "year",
    name: "年卡",
    price: 360,
    unit: "/年",
    tagline: "深度会员",
    featured: true,
    benefits: [
      "季卡全部权益",
      "热点新闻改编 · 订阅期内使用",
      "Token 用量与模型费用按中转站规则结算",
    ],
  },
];

/**
 * 中转站套餐 id —— /purchase 页按 plan_id 预选套餐。
 * 2026-08-20 线上创建：月卡=2 / 季卡=3 / 年卡=4。
 * ⚠️ 中转站重建套餐时必须同步这份映射，否则收银页选不中。
 */
export const SUB2API_PLAN_IDS: Readonly<Record<string, number>> = {
  month: 2,
  quarter: 3,
  year: 4,
};

/** 会员权益速览（付费墙顶部的标签条）。 */
export const MEMBER_BENEFITS: ReadonlyArray<string> = [
  "可用功能以当前权益为准",
  "设定档案与创作编排",
  "天衍世界仿真",
  "天工检测与改写",
  "热点新闻改编",
];
