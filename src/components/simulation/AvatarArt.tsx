/**
 * AvatarArt —— 角色头像模板（12 个原型 × 名字哈希配色）。
 *
 * 为什么是自己画的 SVG，不是下载的头像包：
 *   1. 外部素材有授权与署名义务（本仓库要维护 THIRD_PARTY_NOTICES.md）；
 *   2. 二进制资源进包，构建体积和离线可用性都变差；
 *   3. SVG 能跟着名字哈希换色 —— 一套模板能长出上百张不重样的脸，
 *      而且同一个角色到哪个群都是同一张。
 *
 * 分配规则：画像有 `agentType` 就先按分类挑原型（主角像少年剑客、反派戴面具、
 * 导师是长须老者……一眼认得出身份），同分类内再按名字哈希细分；没有画像就
 * 纯按哈希取。见 {@link archetypeOf}。
 */

/** 12 个角色原型。 */
export type Archetype =
  | "swordsman"   // 少年剑客：束发 + 发带
  | "elder"       // 长须老者
  | "maiden"      // 长发 + 发簪
  | "masked"      // 覆面
  | "hooded"      // 兜帽
  | "scholar"     // 书生方巾
  | "general"     // 将军盔缨
  | "monk"        // 僧人念珠
  | "noble"       // 冠冕
  | "horned"      // 妖角
  | "merchant"    // 圆帽商贾
  | "healer";     // 束巾医者

const ALL: ReadonlyArray<Archetype> = [
  "swordsman", "elder", "maiden", "masked", "hooded", "scholar",
  "general", "monk", "noble", "horned", "merchant", "healer",
];

/**
 * 分类 → 候选原型。
 *
 * ⚠️ key 必须是后端 `AGENT_TYPE_DEFS` 的 typeId（前端镜像在 types/experts.ts
 * 的 AGENT_TYPES）。写错就静默回落到全量池——反派拿不到覆面、导师拿不到长须，
 * 看起来「随机」但其实是对不上。
 *
 * 给的是**候选集**不是单个：同一类里有好几个角色时，全长一张脸更糟。
 */
const BY_TYPE: Readonly<Record<string, ReadonlyArray<Archetype>>> = {
  protagonist: ["swordsman", "general"],
  antagonist: ["masked", "hooded", "horned"],
  faction_leader: ["noble", "general"],
  ally_mentor: ["elder", "monk", "healer"],
  media: ["scholar", "merchant"],
  specialist: ["healer", "horned", "swordsman"],
  supporting: ["scholar", "maiden", "merchant"],
  background: ["merchant", "monk"],
};

/** 稳定哈希（与 lib/sim-theater.ts 同一个算法，同名恒定同脸）。 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** BY_TYPE 的 key —— 单测据此断言它们都是后端真实存在的 typeId。 */
export const AVATAR_TYPE_KEYS: ReadonlyArray<string> = Object.keys(BY_TYPE);

export function archetypeOf(name: string, agentType?: string): Archetype {
  const pool = (agentType && BY_TYPE[agentType]) || ALL;
  return pool[hash(name) % pool.length]!;
}

/* ── 配色 ── */

const SKIN = "#F1D6BD";
const SKIN_SHADE = "#DCB694";
const INK = "#2B2320";

interface Palette {
  readonly bg: string;
  readonly hair: string;
  readonly hairLight: string;
  readonly cloth: string;
  readonly clothDark: string;
  readonly metal: string;
}

function palette(hue: number): Palette {
  return {
    bg: `hsl(${hue} 52% 90%)`,
    hair: `hsl(${hue} 30% 22%)`,
    // 老者的白发：不能跟着 hue 走太饱和，否则不像白发像染发。
    hairLight: `hsl(${hue} 16% 64%)`,
    cloth: `hsl(${hue} 46% 44%)`,
    clothDark: `hsl(${hue} 46% 31%)`,
    // 金属固定成古铜金：跟着 hue 取会出粉色头盔、粉色犄角。
    metal: "#C3922F",
  };
}

/* ── 部件 ── */

/** 肩、脖、脸、眼 —— 12 个原型共用的底子。 */
function Base({ p }: { readonly p: Palette }) {
  return (
    <>
      <path d="M6.5 40C6.5 31 12 27.5 20 27.5S33.5 31 33.5 40Z" fill={p.cloth} />
      <path d="M20 27.5c8 0 13.5 3.5 13.5 12.5h-4c0-7-4.5-10-9.5-10Z" fill={p.clothDark} />
      <path d="M17.2 23h5.6v5h-5.6z" fill={SKIN_SHADE} />
      <ellipse cx="20" cy="18" rx="8.2" ry="9" fill={SKIN} />
      <ellipse cx="16.9" cy="18.6" rx="0.95" ry="1.2" fill={INK} />
      <ellipse cx="23.1" cy="18.6" rx="0.95" ry="1.2" fill={INK} />
      <path d="M18.4 22.4h3.2v0.9h-3.2z" fill={SKIN_SHADE} opacity="0.85" />
    </>
  );
}

/** 短发帽（多数原型的发型底子）。 */
function HairCap({ fill }: { readonly fill: string }) {
  return (
    <path
      d="M11.8 18.6c0-8 4.2-9.9 8.2-9.9s8.2 1.9 8.2 9.9c0-4.3-3.2-5.9-8.2-5.9s-8.2 1.6-8.2 5.9Z"
      fill={fill}
    />
  );
}

/** 每个原型自己的部分（画在底子之上）。 */
function Costume({ kind, p }: { readonly kind: Archetype; readonly p: Palette }) {
  switch (kind) {
    case "swordsman":
      return (
        <>
          <HairCap fill={p.hair} />
          {/* 发髻：要和头发连上，光放一个圆会浮在头顶像颗痣 */}
          <path d="M18.6 7.6h2.8v4.4h-2.8z" fill={p.hair} />
          <circle cx="20" cy="6.4" r="2.7" fill={p.hair} />
          <path d="M11.9 14.8h16.2v2.2H11.9z" fill={p.metal} />
        </>
      );

    case "elder":
      return (
        <>
          <HairCap fill={p.hairLight} />
          <path d="M18.8 7.8h2.4v4.2h-2.4z" fill={p.hairLight} />
          <circle cx="20" cy="6.8" r="2.4" fill={p.hairLight} />
          {/* 长须：从两颊垂到胸前 */}
          <path d="M13.8 23c.5 8.4 2.9 12.4 6.2 12.4s5.7-4 6.2-12.4c-1.7 3.4-3.8 4.8-6.2 4.8s-4.5-1.4-6.2-4.8Z" fill={p.hairLight} />
          {/* 长眉 */}
          <path d="M14.2 15.4c1.5-.6 3-.6 4.2 0-1.4-.1-2.8 0-4.2.6zM25.8 15.4c-1.5-.6-3-.6-4.2 0 1.4-.1 2.8 0 4.2.6z" fill={p.hairLight} />
        </>
      );

    case "maiden":
      return (
        <>
          {/* 披肩长发：两侧垂下来「框住」脸，不是罩住整个头 */}
          <path d="M9.8 21.5C9.8 11.4 30.2 11.4 30.2 21.5V34h-3.4V21.5c0-6.6-13.6-6.6-13.6 0V34H9.8Z" fill={p.hair} />
          <HairCap fill={p.hair} />
          {/* 发簪 */}
          <path d="M25.4 11.1l4.7-2.3.8 1.6-4.7 2.3z" fill={p.metal} />
          <circle cx="30.8" cy="8.4" r="1.5" fill={p.metal} />
        </>
      );

    case "masked":
      return (
        <>
          <HairCap fill={p.hair} />
          {/* 覆面遮的是口鼻，不是眼睛——眼睛留着才看得出是张脸 */}
          <path d="M12.4 20.4h15.2v3.4c0 2.6-3.4 4.4-7.6 4.4s-7.6-1.8-7.6-4.4z" fill={p.clothDark} />
          <path d="M11.4 20h17.2v1.6H11.4z" fill={p.cloth} />
        </>
      );

    case "hooded":
      return (
        <>
          {/* 尖顶兜帽 */}
          <path d="M20 3.6c7.8 0 12.8 6.6 12.8 15.6V27h-4.4v-8c0-5.6-3.4-8.8-8.4-8.8S11.6 13.4 11.6 19v8H7.2v-7.8c0-9 5-15.6 12.8-15.6Z" fill={p.clothDark} />
          {/* 帽檐压下来的阴影 */}
          <path d="M11.8 16.4c1-4 4.2-6 8.2-6s7.2 2 8.2 6c-2.2-2-4.9-2.9-8.2-2.9s-6 .9-8.2 2.9Z" fill={INK} opacity="0.5" />
        </>
      );

    case "scholar":
      return (
        <>
          <HairCap fill={p.hair} />
          {/* 方巾：一顶梯形巾 + 一道帽箍 + 顶上的巾结 */}
          <path d="M11.4 15.4 12.7 9.6h14.6l1.3 5.8z" fill={p.clothDark} />
          <path d="M11.4 15.4h17.2v2H11.4z" fill={p.cloth} />
          <path d="M18.7 6.8h2.6v2.8h-2.6z" fill={p.clothDark} />
        </>
      );

    case "general":
      return (
        <>
          <HairCap fill={p.hair} />
          {/* 兜鍪 + 缨 */}
          <path d="M11 16.6c0-7 4-10.4 9-10.4s9 3.4 9 10.4h-3.2c0-5-2.6-7.6-5.8-7.6s-5.8 2.6-5.8 7.6z" fill={p.metal} />
          <path d="M19.2 3.6h1.6v3h-1.6z" fill={p.clothDark} />
          <circle cx="20" cy="2.9" r="1.9" fill={p.cloth} />
          {/* 护颊 */}
          <path d="M11 16.6h2.8v5.2H11zM26.2 16.6H29v5.2h-2.8z" fill={p.metal} />
        </>
      );

    case "monk":
      return (
        <>
          {/* 光头：只用一道颅顶阴影交代，没有头发 */}
          <path d="M12.6 16.4c.9-3.6 3.7-5.4 7.4-5.4s6.5 1.8 7.4 5.4c-1.8-2.3-4.3-3.4-7.4-3.4s-5.6 1.1-7.4 3.4Z" fill={SKIN_SHADE} />
          {/* 戒疤 */}
          <circle cx="17.4" cy="12.6" r="0.62" fill={SKIN_SHADE} />
          <circle cx="20" cy="12" r="0.62" fill={SKIN_SHADE} />
          <circle cx="22.6" cy="12.6" r="0.62" fill={SKIN_SHADE} />
          {/* 念珠：挂在领口，不要掉到画面底边外 */}
          <g fill={p.metal}>
            <circle cx="13.4" cy="29.4" r="1.35" />
            <circle cx="16.4" cy="31.8" r="1.35" />
            <circle cx="20" cy="32.6" r="1.35" />
            <circle cx="23.6" cy="31.8" r="1.35" />
            <circle cx="26.6" cy="29.4" r="1.35" />
          </g>
        </>
      );

    case "noble":
      return (
        <>
          <HairCap fill={p.hair} />
          {/* 冠冕 */}
          <path d="M11.6 15.4 12.8 8l3.6 3.2L20 6.6l3.6 4.6L27.2 8l1.2 7.4z" fill={p.metal} />
          <path d="M11.6 15.4h16.8v2.1H11.6z" fill={p.clothDark} />
          <circle cx="20" cy="13.6" r="1.25" fill={p.cloth} />
        </>
      );

    case "horned":
      return (
        <>
          <HairCap fill={p.hair} />
          {/* 犄角：短、粗、向外弯，细长的会读成兔耳 */}
          <path d="M13.4 11.8c-2.4-2.2-3.4-4.8-2.6-7.6 2.4 1.4 3.9 3.9 4.4 7.2z" fill={p.hair} />
          <path d="M26.6 11.8c2.4-2.2 3.4-4.8 2.6-7.6-2.4 1.4-3.9 3.9-4.4 7.2z" fill={p.hair} />
          {/* 竖瞳 */}
          <path d="M16.5 17h.8v3.2h-.8zM22.7 17h.8v3.2h-.8z" fill={p.metal} />
        </>
      );

    case "merchant":
      return (
        <>
          <HairCap fill={p.hair} />
          {/* 圆帽 */}
          <ellipse cx="20" cy="11.8" rx="7.2" ry="4.6" fill={p.clothDark} />
          <ellipse cx="20" cy="15.4" rx="10" ry="2.1" fill={p.cloth} />
          <circle cx="20" cy="7.6" r="1.3" fill={p.metal} />
        </>
      );

    case "healer":
    default:
      return (
        <>
          <HairCap fill={p.hair} />
          {/* 束巾 + 侧边打的结（原来那个「药囊」糊在肩上像个盒子，去掉） */}
          <path d="M11.5 13.8h17v3.2h-17z" fill={p.cloth} />
          <rect x="27.8" y="14" width="2.6" height="2.8" rx="0.8" fill={p.clothDark} />
          <path d="M30.2 14.4c1.6.5 2.6 1.5 3 3-1.2-.7-2.3-1-3.4-1zM30.2 16.4c1.5.9 2.3 2.1 2.4 3.7-1-1-2-1.7-3-2.1z" fill={p.clothDark} />
        </>
      );
  }
}

/* ── 对外组件 ── */

interface AvatarArtProps {
  readonly name: string;
  readonly hue: number;
  readonly agentType?: string;
}

export function AvatarArt({ name, hue, agentType }: AvatarArtProps) {
  const kind = archetypeOf(name, agentType);
  const p = palette(hue);
  return (
    // 圆形裁切交给容器的 border-radius + overflow:hidden —— 每张头像自带一个
    // clipPath 会在页面上堆出几十个重复 id，没必要。
    <svg viewBox="0 0 40 40" className="sim-avatar-art" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill={p.bg} />
      <Base p={p} />
      <Costume kind={kind} p={p} />
    </svg>
  );
}
