/**
 * 官网首页（/site）—— 从老前端 packages/studio/src/pages/NovaHomePage.tsx 移植。
 *
 * 适配点：
 * - react-router v6（history 路由）替代老的 hash 路由：页内锚点仍用 id + scrollIntoView，
 *   跨页跳转全部改 navigate / Link（/create、/pricing、/site/docs/...）；
 * - 主题/语言改接 v2 全局 hooks（useTheme / useI18n），不再走 props；
 * - 天王模板库书名录（方块墙文字种子）改走 v2 的绝对地址 API（api-origin），
 *   后端不在线时静默回退到内置种子，页面不受影响。
 *
 * 视觉体系：人脸方块墙（useBlockWall）+ 流体火焰（FluidFire）双层全页 fixed 背景，
 * 半透明 section 罩在上面滚动。样式在 styles/global.css 末尾的 nova-* 段。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Menu, X, ChevronDown, ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight,
  Sun, Moon, BookOpen, Compass, FileCode2, Orbit, TrendingUp, Wrench,
  Check, Lock,
} from "lucide-react";
import { useTheme } from "../hooks/use-theme";
import { useI18n } from "../i18n";
import { apiUrl } from "../lib/api-origin";
import { prefersReducedMotion } from "../hooks/use-reduced-motion";
import { SkoobLogo } from "../components/SkoobLogo";
import { IcpNotice } from "../components/IcpNotice";
import { FluidFire } from "../components/FluidFire";
import { PLANS, type PlanInfo } from "../types/plans";
import "../styles/site-capabilities.css";
import { SiteWorkbenchShowcase } from "../components/SiteWorkbenchShowcase";

// 招牌视觉「人脸霓虹视频方块墙」（源自 nuwa.world e7 组件的 1:1 复刻）：
// 视频纹理 → 60×40 离屏采样 → 逐帧运动检测 → 运动处方块 3D 凸起 → 凸起面浮现书名文字
const NUWA_VIDEO_SRC = "/c6-circuits-face-neon.mp4";

interface Cell {
  r: number;
  g: number;
  b: number;
  motion: number;
  targetElevation: number;
  currentElevation: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * ★ 方块墙文字层：方块「大凸起」时，在顶面上浮现小说名字的一个字。
 *   字体走 CJK 无衬线栈（canvas 里没有 CSS 变量可用，与 global.css 的 --ns-font 保持同一条回退链）。
 */
const GLYPH_FONT =
  '"PingFang SC", "HarmonyOS Sans SC", "Source Han Sans SC", "Noto Sans SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
/**
 * 显字阈值，以 maxElevation 为基准的比例。
 * 注意别按「名义满格」来定：实测这段人脸视频的运动量，逐帧平滑后的 elevation
 * 峰值只到 ~25（maxElevation 的一半），所以比例取 0.55 会一个字都画不出来。
 * 0.25（≈12.5）对应典型帧百余个凸起格：字够密能读出书名，又不会盖过 Hero 标题。
 */
const GLYPH_REVEAL_RATIO = 0.25;
/**
 * 再抬升 maxElevation 的这个比例，透明度就淡入到满。
 * 跨度要窄（0.06 ≈ 再抬 3）：多数格子的 elevation 只在阈值上方几点徘徊，
 * 跨度一宽，字就永远停在 0.2 透明度上，看着像脏点而不是字。
 */
const GLYPH_FADE_RATIO = 0.06;
/** 每帧最多画多少个字，兜住最坏情况下的绘制开销（超出会按扫描顺序截断） */
const GLYPH_BUDGET = 400;
/** 顶面字号相对方块边长的比例 */
const GLYPH_SIZE_RATIO = 0.72;

/**
 * 确定性散列：同一格永远落在同一个字上。
 * 若按帧随机，方块每次凸起都会跳字，观感是噪点而不是「墙上写着书名」。
 */
export function glyphForCell(x: number, y: number, glyphCount: number): number {
  if (glyphCount <= 0) return 0;
  return (x * 7 + y * 13) % glyphCount;
}

export interface BlockWallOptions {
  /** 要浮现在凸起方块上的文字（通常是小说名）。不传则完全不画文字。 */
  readonly glyphs?: string;
}

export function useBlockWall(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  sampleRef: React.RefObject<HTMLCanvasElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options?: BlockWallOptions,
): { readonly ready: boolean } {
  const gridCols = 60;
  const gridRows = 40;
  const maxElevation = 50;
  const motionSensitivity = 0.25;
  const elevationSmoothing = 0.2;
  const backgroundColor = "#030303";
  const mirror = true;
  const gapRatio = 0.05;
  const darken = 0.6;
  const borderColor = hexToRgb("#ffffff");
  const borderOpacity = 0.08;

  const rafRef = useRef<number | null>(null);
  const gridRef = useRef<Cell[][]>([]);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const [ready, setReady] = useState(false);

  // 按码点拆分（emoji 安全）；走 ref 传给渲染循环，避免换文字时重启 rAF
  const glyphs = useMemo(() => Array.from(options?.glyphs ?? ""), [options?.glyphs]);
  const glyphsRef = useRef<readonly string[]>(glyphs);
  useEffect(() => {
    glyphsRef.current = glyphs;
  }, [glyphs]);

  // 初始化网格
  useEffect(() => {
    const grid: Cell[][] = [];
    for (let y = 0; y < gridRows; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < gridCols; x++) {
        row.push({ r: 30, g: 30, b: 30, motion: 0, targetElevation: 0, currentElevation: 0 });
      }
      grid.push(row);
    }
    gridRef.current = grid;
  }, []);

  // 加载视频
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onCanPlay = () => setReady(true);
    video.addEventListener("canplay", onCanPlay);
    video.src = NUWA_VIDEO_SRC;
    video.load();
    return () => {
      video.removeEventListener("canplay", onCanPlay);
    };
  }, [videoRef]);

  // 渲染循环
  useEffect(() => {
    const video = videoRef.current;
    const sample = sampleRef.current;
    const canvas = canvasRef.current;
    if (!video || !sample || !canvas) return;

    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      // 页面不可见时跳过采样与绘制（rAF 本身也会被浏览器节流，双保险）
      if (document.hidden) return;
      if (video.readyState < 2) return;

      const sctx = sample.getContext("2d", { willReadFrequently: true });
      const dctx = canvas.getContext("2d");
      if (!sctx || !dctx) return;

      sample.width = gridCols;
      sample.height = gridRows;
      sctx.save();
      if (mirror) {
        sctx.scale(-1, 1);
        sctx.drawImage(video, -gridCols, 0, gridCols, gridRows);
      } else {
        sctx.drawImage(video, 0, 0, gridCols, gridRows);
      }
      sctx.restore();

      const data = sctx.getImageData(0, 0, gridCols, gridRows).data;
      const prev = prevFrameRef.current;
      const grid = gridRef.current;
      const fade = 1 - darken;

      for (let y = 0; y < gridRows; y++) {
        for (let x = 0; x < gridCols; x++) {
          const o = (y * gridCols + x) * 4;
          const cell = grid[y]?.[x];
          if (!cell) continue;
          let r = data[o];
          let g = data[o + 1];
          let b = data[o + 2];
          let motion = 0;
          if (prev) {
            const diff = Math.abs(r - prev[o]) + Math.abs(g - prev[o + 1]) + Math.abs(b - prev[o + 2]);
            motion = Math.min(1, diff / 255 / motionSensitivity);
          }
          cell.motion = cell.motion * 0.7 + motion * 0.3;
          if (darken > 0) {
            r = Math.round(r * fade);
            g = Math.round(g * fade);
            b = Math.round(b * fade);
          }
          cell.r = r; cell.g = g; cell.b = b;
          cell.targetElevation = cell.motion * maxElevation;
          cell.currentElevation += (cell.targetElevation - cell.currentElevation) * elevationSmoothing;
        }
      }
      prevFrameRef.current = new Uint8ClampedArray(data);

      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dctx.fillStyle = backgroundColor;
      dctx.fillRect(0, 0, W, H);

      const Y = Math.max(W / gridCols, H / gridRows);
      const J = Y * gapRatio;
      const gridW = Y * gridCols;
      const gridH = Y * gridRows;
      const offX = (W - gridW) / 2;
      const offY = (H - gridH) / 2;

      for (let y = 0; y < gridRows; y++) {
        for (let x = 0; x < gridCols; x++) {
          const cell = grid[y]?.[x];
          if (!cell) continue;
          const bx = offX + x * Y;
          const by = offY + y * Y;
          const e = cell.currentElevation;
          const dx = -e * 1.2;
          const dy = -e * 1.8;
          if (e > 0.5) {
            dctx.fillStyle = `rgba(0,0,0,${Math.min(0.6, e * 0.04)})`;
            dctx.fillRect(bx + J / 2 + e * 1.5, by + J / 2 + e * 2, Y - J, Y - J);
            dctx.fillStyle = `rgb(${Math.max(0, cell.r - 80)},${Math.max(0, cell.g - 80)},${Math.max(0, cell.b - 80)})`;
            dctx.beginPath();
            dctx.moveTo(bx + Y - J / 2 + dx, by + J / 2 + dy);
            dctx.lineTo(bx + Y - J / 2, by + J / 2);
            dctx.lineTo(bx + Y - J / 2, by + Y - J / 2);
            dctx.lineTo(bx + Y - J / 2 + dx, by + Y - J / 2 + dy);
            dctx.closePath();
            dctx.fill();
            dctx.fillStyle = `rgb(${Math.max(0, cell.r - 50)},${Math.max(0, cell.g - 50)},${Math.max(0, cell.b - 50)})`;
            dctx.beginPath();
            dctx.moveTo(bx + J / 2 + dx, by + Y - J / 2 + dy);
            dctx.lineTo(bx + J / 2, by + Y - J / 2);
            dctx.lineTo(bx + J / 2, by + Y - J / 2);
            dctx.lineTo(bx + J / 2 + dx, by + Y - J / 2 + dy);
            dctx.closePath();
            dctx.fill();
          }
          const bright = 1 + e * 0.05;
          dctx.fillStyle = `rgb(${Math.min(255, Math.round(cell.r * bright))},${Math.min(255, Math.round(cell.g * bright))},${Math.min(255, Math.round(cell.b * bright))})`;
          dctx.fillRect(bx + J / 2 + dx, by + J / 2 + dy, Y - J, Y - J);
          dctx.strokeStyle = `rgba(${borderColor.r},${borderColor.g},${borderColor.b},${borderOpacity + e * 0.008})`;
          dctx.lineWidth = 0.5;
          dctx.strokeRect(bx + J / 2 + dx, by + J / 2 + dy, Y - J, Y - J);
        }
      }

      // ★ 文字层：单独一遍，保证字压在所有方块之上，且 font/对齐每帧只设一次
      const glyphChars = glyphsRef.current;
      const charsToRender = glyphChars;

      if (charsToRender.length > 0) {
        const revealAt = maxElevation * GLYPH_REVEAL_RATIO;
        const fadeSpan = maxElevation * GLYPH_FADE_RATIO;
        dctx.font = `700 ${(Y - J) * GLYPH_SIZE_RATIO}px ${GLYPH_FONT}`;
        dctx.textAlign = "center";
        dctx.textBaseline = "middle";
        let drawn = 0;
        for (let y = 0; y < gridRows && drawn < GLYPH_BUDGET; y++) {
          for (let x = 0; x < gridCols && drawn < GLYPH_BUDGET; x++) {
            const cell = grid[y]?.[x];
            if (!cell) continue;
            const e = cell.currentElevation;
            if (e <= revealAt) continue;
            const alpha = Math.min(0.92, ((e - revealAt) / fadeSpan) * 0.92);
            const charIndex = glyphForCell(x, y, glyphChars.length);
            const char = charsToRender[charIndex];
            if (!char) continue;
            // 顶面中心 = 方块中心 + 挤出位移（与上面的 dx/dy 同一套）
            const cx = offX + x * Y + Y / 2 - e * 1.2;
            const cy = offY + y * Y + Y / 2 - e * 1.8;
            // 两遍 fill 代替 shadowBlur：紫色偏移副本 + 近白正文，等效霓虹光晕但不掉帧
            dctx.fillStyle = `rgba(124,92,255,${alpha * 0.5})`;
            dctx.fillText(char, cx + 1.5, cy + 1.5);
            dctx.fillStyle = `rgba(245,243,255,${alpha})`;
            dctx.fillText(char, cx, cy);
            drawn++;
          }
        }
      }
    };

    rafRef.current = requestAnimationFrame(render);
    // 隐藏→可见时视频已跳帧，清掉上一帧采样，避免全墙运动量瞬时飙满
    const onVisibility = () => {
      if (!document.hidden) prevFrameRef.current = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [videoRef, sampleRef, canvasRef]);

  return { ready };
}

/* ------------------------------------------------------------------ */
/* 营销内容数据（焚诀 Skoob · AI 网文创作工作室）                        */
/* ------------------------------------------------------------------ */

/** 方块墙书名兜底种子：离线 / 天王模板库为空时用。 */
const WALL_TITLE_SEEDS = ["斗罗大陆", "斗破苍穹", "武动乾坤", "遮天", "完美世界", "凡人修仙传"] as const;

/** 天王模板库目录的最小类型（本页只用 authors[].books[].title 做方块墙文字种子）。 */
interface TianwangCatalogLite {
  readonly authors?: ReadonlyArray<{
    readonly books: ReadonlyArray<{ readonly title: string }>;
  }>;
}

/** 拉天王模板库书目：后端不在线/为空时静默回退内置种子，绝不影响首屏。 */
function useWallTitles(): readonly string[] {
  const [titles, setTitles] = useState<readonly string[]>(WALL_TITLE_SEEDS);
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/v1/tianwang/catalog"))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TianwangCatalogLite | null) => {
        if (cancelled || !data) return;
        const list = (data.authors ?? []).flatMap((a) => a.books.map((b) => b.title));
        if (list.length > 0) setTitles(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return titles;
}

const ENGINES = [
  {
    name: "天魔引擎", en: "TIANMO", role: "发现灵感", Icon: TrendingUp,
    desc: "灵感与选题：聚合热点、分析素材、生成脑洞，把值得展开的方向整理成故事种子，交给作者选择。",
    features: ["热点与素材采集", "脑洞与选题", "书名简介参考", "衔接创作意图卡"],
  },
  {
    name: "天王引擎", en: "TIANWANG", role: "积累知识", Icon: BookOpen,
    desc: "拆书与知识资产：从原文提炼结构、设定和关系，将分析结果沉淀为可检索的知识，管理创作与拆书的模板、风格和策略路由。",
    features: ["八师逆向拆书", "小说知识检索", "多模板与风格组合", "按步骤与题材路由"],
  },
  {
    name: "天衍引擎", en: "TIANYAN", role: "推演世界", Icon: Orbit,
    desc: "世界仿真：以本体、实体关系和智能体状态模拟互动与事件，为大纲、卷与循环、章节创作提供推演素材。",
    features: ["世界本体与图谱", "智能体互动", "事件与状态演化", "分阶段仿真记录"],
  },
  {
    name: "天工引擎", en: "TIANGONG", role: "创作工具", Icon: Wrench,
    desc: "工具类引擎：为小说创作提供 AI 生图、封面制作、AI 检测与文本改写，把画面与文字的打磨连接到创作过程。",
    features: ["AI 生图与小说封面", "文体与指纹检测", "困惑度评分与问题定位", "文本改写与创作工具"],
  },
] as const;

const DOC_CARDS = [
  { title: "产品手册", meta: "PRODUCT · ENGINES · PIPELINE", desc: "小说 Agent · 知识库 · 引擎与创作流程", href: "/site/docs/product-manual", Icon: Compass },
  { title: "用户指南", meta: "QUICKSTART · WORKFLOW · FAQ", desc: "从零开始创作 · 引擎使用 · 会员权益", href: "/site/docs/user-guide", Icon: BookOpen },
  { title: "开发者平台", meta: "ENGINE API · PRICING · INTEGRATION", desc: "引擎 API 能力 · 计费口径 · 接入指南", href: "/site/docs/api", Icon: FileCode2 },
] as const;

/** 官网与购买页共用套餐数据，避免价格和权益说明漂移。 */
const LANDING_PLANS: ReadonlyArray<PlanInfo & {
  href: string; ctaLabel?: string; badge?: string; excluded?: ReadonlyArray<string>;
}> = [
  { id: "free", name: "基础使用", price: 0, unit: "平台基础功能", tagline: "从你的第一个故事开始", ctaLabel: "开始创作",
    benefits: ["快速直出创作流程", "普通拆书与设定档案", "按当前账号权益使用技能", "模型用量费用另按模型服务规则结算"], href: "/create" },
  ...PLANS.map(plan => ({ ...plan, href: "/pricing" })),
];

/* ------------------------------------------------------------------ */
/* 页面组件                                                             */
/* ------------------------------------------------------------------ */

/** 页内锚点平滑滚动（history 路由下 hash 可自由用于页内锚点）。 */
function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

export function SkoobBrand({ variant = "primary" }: { variant?: "primary" | "literary" }) {
  return (
    <Link to="/site" className="nova-logo">
      <SkoobLogo className="nova-logo-img" variant={variant} />
      <span className="nova-logo-text">焚诀 Skoob</span>
    </Link>
  );
}

export function NavDropdown({
  label,
  items,
}: {
  readonly label: string;
  readonly items: ReadonlyArray<{ readonly label: string; readonly target: string }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="nova-nav-item relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button type="button" className="nova-nav-link inline-flex items-center gap-1">
        {label} <ChevronDown size={14} />
      </button>
      {open && (
        <div className="nova-dropdown">
          {items.map((item) => (
            <button
              key={item.target}
              type="button"
              className="nova-dropdown-item"
              onClick={() => {
                setOpen(false);
                scrollToId(item.target);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CheckIcon() {
  return (
    <span className="nova-check-icon">
      <ChevronRight size={12} />
    </span>
  );
}

/** A single-row capability rail: native touch scrolling, pointer drag and keyboard access. */
function CapabilityRail({ id, label, count, children, variant = "engines" }: {
  id: string; label: string; count: number; children: ReactNode; variant?: "engines" | "steps" | "masters";
}) {
  const track = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; left: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState({ overflow: false, start: true, end: true });
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () => setPosition({ overflow: el.scrollWidth > el.clientWidth + 2, start: el.scrollLeft < 2, end: el.scrollLeft >= el.scrollWidth - el.clientWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => { el.removeEventListener("scroll", update); observer.disconnect(); };
  }, [count]);
  const move = (direction: number) => {
    const el = track.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };
  return (
    <div className={`nova-rail nova-rail--${variant}`}>
      <div className="nova-rail-toolbar">
        <span>{String(count).padStart(2, "0")} <span aria-hidden="true">/</span> {label}</span>
        <div className="nova-rail-actions">
          {position.overflow && <span className="nova-rail-hint">拖动探索</span>}
          <button type="button" aria-label={`向前查看${label}`} aria-controls={id} disabled={position.start} onClick={() => move(-1)}><ArrowLeft size={17} /></button>
          <button type="button" aria-label={`向后查看${label}`} aria-controls={id} disabled={position.end} onClick={() => move(1)}><ArrowRight size={17} /></button>
        </div>
      </div>
      <div id={id} ref={track} className="nova-rail-track" role="region" aria-label={`${label}，可横向滚动`} tabIndex={0}
        data-overflow={position.overflow} data-dragging={dragging}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); }
          if (event.key === "Home" || event.key === "End") { event.preventDefault(); event.currentTarget.scrollTo({ left: event.key === "Home" ? 0 : event.currentTarget.scrollWidth, behavior: "auto" }); }
        }}
        onPointerDown={event => {
          if (event.pointerType !== "mouse" || event.button !== 0 || !position.overflow) return;
          pointer.current = { id: event.pointerId, x: event.clientX, left: event.currentTarget.scrollLeft };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={event => {
          if (pointer.current?.id === event.pointerId) event.currentTarget.scrollLeft = pointer.current.left - (event.clientX - pointer.current.x);
        }}
        onPointerUp={event => {
          if (pointer.current?.id !== event.pointerId) return;
          pointer.current = null; setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { pointer.current = null; setDragging(false); }}
        onLostPointerCapture={() => { pointer.current = null; setDragging(false); }}
      >{children}</div>
    </div>
  );
}

function EnginesSection() {
  return (
    <section className="nova-section nova-capabilities" id="engines">
      <div className="nova-section-inner">
        <div className="nova-editorial-head">
          <div><span className="nova-eyebrow">ENGINES / 四大引擎</span><h2 className="nova-section-title">创作所需，各有所长。</h2></div>
          <p>从一个念头，到一整个世界。<br />四大引擎，让灵感、知识、仿真与工具共同为故事服务。</p>
        </div>
        <CapabilityRail id="engine-capability-track" label="引擎能力" count={ENGINES.length}>
          {ENGINES.map((engine, index) => (
            <article key={engine.en} className="nova-capability-card" style={{ "--engine-color": ["#fb923c", "#e8c77b", "#7dd3c8", "#b3befc"][index] } as CSSProperties}>
              <div className="nova-capability-top"><span>{String(index + 1).padStart(2, "0")}</span><engine.Icon size={29} strokeWidth={1.25} /></div>
              <span className="nova-capability-role">{engine.role}</span>
              <h3>{engine.name}</h3>
              <span className="nova-capability-en">{engine.en}</span>
              <p>{engine.desc}</p>
              <ul>{engine.features.map(feature => <li key={feature}><Check size={13} />{feature}</li>)}</ul>
            </article>
          ))}
        </CapabilityRail>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section className="nova-section" id="pricing">
      <div className="nova-section-inner">
        <div className="nova-section-header centered">
          <span className="nova-eyebrow">PRICING / 定价</span>
          <h2 className="nova-section-title">从基础创作开始，按需选择会员。</h2>
        </div>
        <p className="nova-engine-desc">套餐展示供选购参考，成交价格与模型用量以结算页为准；可用功能以账号当前权益为准。</p>
        <div className="nova-plan-grid">
          {LANDING_PLANS.map((plan) => {
            const isFree = plan.id === "free";
            return (
            <Link
              key={plan.id}
              to={plan.href}
              className={`nova-plan-card${"featured" in plan && plan.featured ? " is-featured" : ""}${isFree ? " is-free" : ""}`}
            >
              {"badge" in plan && plan.badge ? (
                <span className={`nova-plan-badge${"featured" in plan && plan.featured ? "" : " is-plain"}`}>{plan.badge}</span>
              ) : null}
              <div className="nova-plan-head">
                <h3>{plan.name}</h3>
                <small>{plan.tagline}</small>
              </div>
              <div className="nova-plan-price">
                <strong>¥{plan.price}</strong>
                <span>{plan.unit}</span>
                {"save" in plan && plan.save ? <em>立省 {plan.save}</em> : null}
              </div>
              <ul className="nova-plan-benefits">
                {plan.benefits.map((benefit) => (
                  <li key={benefit}><span className="nova-plan-check"><Check size={12} /></span> {benefit}</li>
                ))}
                {"excluded" in plan && plan.excluded?.map((item) => (
                  <li key={item} className="is-excluded"><span className="nova-plan-check is-lock"><Lock size={11} /></span> {item}</li>
                ))}
              </ul>
              <span className="nova-plan-cta">{"ctaLabel" in plan && plan.ctaLabel ? plan.ctaLabel : "查看定价"} <ArrowRight size={14} /></span>
            </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DocsSection() {
  return (
    <section className="nova-section nova-section-dark" id="docs">
      <div className="nova-section-inner">
        <div className="nova-section-header centered">
          <span className="nova-eyebrow">DOCS / 文档</span>
          <h2 className="nova-section-title">先读懂，再上手。</h2>
        </div>
        <div className="nova-docs-grid">
          {DOC_CARDS.map((doc) => (
            <Link key={doc.href} to={doc.href} className="nova-doc-card">
              <span className="nova-doc-icon"><doc.Icon size={18} /></span>
              <strong>{doc.title}</strong>
              <p>{doc.desc}</p>
              <small>{doc.meta}</small>
              <span className="nova-doc-arrow"><ArrowUpRight size={16} /></span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="nova-footer">
      <div className="nova-footer-inner">
        <div className="nova-footer-left">
          <SkoobBrand variant="literary" />
          <p className="nova-footer-tagline">焚诀 · 小说 Agent 与知识库</p>
        </div>
        <div className="nova-footer-links">
          <div>
            <h4>产品</h4>
            <a href="#engines" onClick={(e) => { e.preventDefault(); scrollToId("engines"); }}>引擎分工</a>
            <a href="#pipeline" onClick={(e) => { e.preventDefault(); scrollToId("pipeline"); }}>创作工作台</a>
            <Link to="/pricing">定价</Link>
          </div>
          <div>
            <h4>文档</h4>
            <Link to="/site/docs/product-manual">产品手册</Link>
            <Link to="/site/docs/user-guide">用户指南</Link>
            <Link to="/site/docs/api">开发者平台</Link>
          </div>
        </div>
      </div>
      <div className="nova-footer-bottom">
        <p>© 2026 Skoob · 焚诀（Burn Art）. All rights reserved.</p>
        <IcpNotice className="nova-footer-icp" />
      </div>
    </footer>
  );
}

export function SiteHomePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sampleRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { locale, setLocale } = useI18n();
  const isDark = theme === "dark";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // 方块墙书名轮播：天王模板库真实书目优先，离线/为空时兜底首屏种子。
  const wallTitles = useWallTitles();
  const [wallTitleIndex, setWallTitleIndex] = useState(0);
  useEffect(() => {
    setWallTitleIndex(0);
  }, [wallTitles]);
  useEffect(() => {
    if (prefersReducedMotion() || wallTitles.length <= 1) return;
    const timer = window.setInterval(() => {
      setWallTitleIndex((index) => (index + 1) % wallTitles.length);
    }, 3600);
    return () => window.clearInterval(timer);
  }, [wallTitles.length]);

  const { ready } = useBlockWall(videoRef, sampleRef, canvasRef, {
    glyphs: wallTitles[wallTitleIndex] ?? WALL_TITLE_SEEDS[0],
  });

  const anchor = (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    scrollToId(id);
    setMobileMenuOpen(false);
  };

  const onOpenApp = () => navigate("/create");

  return (
    <div className={`nova-runtime ${isDark ? "dark" : ""}`}>
      {/* 全页背景双层：人脸方块墙（z0，fixed）+ 流体火焰（z1，screen 混合）。
          滚动时两层都不动，半透明 section 从上面滑过。 */}
      <video
        ref={videoRef}
        className="nova-hero-video"
        playsInline
        muted
        autoPlay
        loop
        crossOrigin="anonymous"
        aria-hidden="true"
      />
      <canvas ref={sampleRef} className="nova-hero-sample" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className={`nova-wall-bg ${ready ? "is-ready" : ""}`}
        aria-hidden="true"
      />
      <FluidFire className="nova-fluid-bg" />
      <nav className="nova-nav">
        <div className="nova-nav-inner">
          <SkoobBrand />

          <div className="nova-nav-links">
            <NavDropdown
              label="产品"
              items={[
                { label: "引擎分工", target: "engines" },
                { label: "创作工作台", target: "pipeline" },
                { label: "定价", target: "pricing" },
              ]}
            />
            <a href="#engines" className="nova-nav-link" onClick={anchor("engines")}>引擎</a>
            <a href="#pipeline" className="nova-nav-link" onClick={anchor("pipeline")}>流程</a>
            <a href="#pricing" className="nova-nav-link" onClick={anchor("pricing")}>定价</a>
            <Link to="/site/docs" className="nova-nav-link">文档</Link>
          </div>

          <div className="nova-nav-actions">
            <div className="nova-lang-switch">
              <button
                type="button"
                className={locale === "zh" ? "is-active" : ""}
                onClick={() => setLocale("zh")}
              >
                中
              </button>
              <button
                type="button"
                className={locale === "en" ? "is-active" : ""}
                onClick={() => setLocale("en")}
              >
                EN
              </button>
            </div>
            <button
              type="button"
              className="nova-icon-btn"
              onClick={toggleTheme}
              aria-label={isDark ? "切换浅色主题" : "切换深色主题"}
              title={isDark ? "切换浅色主题" : "切换深色主题"}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button type="button" className="nova-primary-btn" onClick={onOpenApp}>
              开始创作
            </button>
          </div>

          <button
            type="button"
            className="nova-mobile-toggle"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="菜单"
          >
            {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="nova-mobile-menu">
            <a href="#engines" className="nova-mobile-link" onClick={anchor("engines")}>引擎分工</a>
            <a href="#pipeline" className="nova-mobile-link" onClick={anchor("pipeline")}>创作工作台</a>
            <a href="#pricing" className="nova-mobile-link" onClick={anchor("pricing")}>定价</a>
            <Link to="/site/docs" className="nova-mobile-link">文档中心</Link>
            <button type="button" className="nova-primary-btn w-full mt-4" onClick={onOpenApp}>
              开始创作
            </button>
          </div>
        )}
      </nav>

      <section className="nova-hero">
        <div className="nova-hero-overlay" aria-hidden="true" />
        <div className="nova-hero-content">
          <span className="nova-hero-kicker">焚诀 · 小说 Agent 与知识库</span>
          <h1 className="nova-hero-title">写好故事，<br />沉淀世界。</h1>
          <p className="nova-hero-subtitle">
            从灵感、拆书到仿真创作，让故事设定沉淀为可复用的知识。
          </p>
          <div className="nova-hero-actions">
            <button type="button" className="nova-primary-btn nova-hero-btn" onClick={onOpenApp}>
              开始创作 <ArrowRight size={16} />
            </button>
            <Link to="/site/docs" className="nova-ghost-btn nova-hero-btn">
              了解产品
            </Link>
          </div>
        </div>
      </section>

      <main>
        <EnginesSection />
        <SiteWorkbenchShowcase />
        <PricingSection />
        <DocsSection />
      </main>

      <Footer />
    </div>
  );
}
