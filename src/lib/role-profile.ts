/**
 * 角色档案的数据映射 —— 原始 roles[] 记录 → 展示视图。
 *
 * 大纲步产出的每一项本来就是完整档案（人设/外貌/目标/冲突/能力/关系/成长/
 * 剧情权重/流派标签/md 全文），前端以前只渲染了 `name`。这里把字段口径固定下来：
 * 驼峰与下划线两种写法都认（后端各处不一致），缺字段就少一块、不报错。
 *
 * 纯函数，与 React 无关，单测直接覆盖。
 */
type Rec = Readonly<Record<string, unknown>>;

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const n = (v: unknown): number => (typeof v === "number" ? v : 0);

/** 档案里成对出现的驼峰/下划线字段：两种都认（后端各处写法不一）。 */
function pick(role: Rec, ...keys: ReadonlyArray<string>): string {
  for (const k of keys) {
    const v = s(role[k]);
    if (v) return v;
  }
  return "";
}

export interface RoleView {
  readonly name: string;
  /** 分类 typeId（protagonist / antagonist / …）。 */
  readonly type: string;
  /** 层级（major / minor）。 */
  readonly tier: string;
  readonly weight: number;
  readonly flowTags: ReadonlyArray<string>;
  readonly bio: string;
  readonly facets: ReadonlyArray<readonly [string, string]>;
  /** 天衍生成的 md 档案全文（有就能展开看逐字原文）。 */
  readonly content: string;
}

/** 原始档案记录 → 展示视图。字段缺失不报错，只是少一块。 */
export function toRoleView(role: Rec): RoleView {
  const facets: Array<readonly [string, string]> = [
    ["人设", pick(role, "persona")],
    ["外貌", pick(role, "appearance")],
    ["目标", pick(role, "goal")],
    ["冲突", pick(role, "conflict")],
    ["能力", pick(role, "abilities")],
    ["关系", pick(role, "relationships")],
    ["成长", pick(role, "growth")],
    ["归属", pick(role, "belongsTo")],
  ];
  const rawTags = role.flow_tags ?? role.flowTags;
  return {
    name: pick(role, "name"),
    // 历史脏数据把分类写进过 tier，agentTypeOf 会兜底反查。
    type: pick(role, "type", "agentType") || pick(role, "tier"),
    tier: pick(role, "tier"),
    weight: n(role.plot_weight) || n(role.plotWeight),
    flowTags: Array.isArray(rawTags) ? rawTags.map(s).filter(Boolean) : [],
    bio: pick(role, "bio", "description", "roleInCycle"),
    facets: facets.filter(([, v]) => v),
    content: pick(role, "content"),
  };
}

/** 档案是不是「有料」——只有名字的实体不值得做成可点击的卡。 */
export function hasRoleDetail(view: RoleView): boolean {
  return Boolean(view.bio || view.content || view.facets.length > 0);
}
