import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../hooks/use-reduced-motion";

/**
 * ★ 流体火焰（原生 WebGL 稳定流体模拟，零依赖）
 *
 * 当前作为 NovaHomePage 的**全页 fixed 背景**（.nova-fluid-bg，z-index 0）挂载，
 * 一整团流体火焰在整个页面背后游走，滚动时持续流动；各 section 用半透明黑底
 * 让火焰若隐若现，卡片类保持近实底保护文字。
 *
 * 精简版 GPU stable fluids（Pavel Dobryakov WebGL-Fluid-Simulation 思路手写）：
 * 速度场 + 染料场双 ping-pong FBO，每帧依次：
 *   curl → 涡度约束（vorticity confinement，让火舌打卷）
 *   → divergence → 压力 Jacobi 迭代 ×20 → 梯度减
 *   → 半拉格朗日平流（速度场、染料场，带耗散）
 * 一个发射源沿平滑李萨如+噪声轨迹在 hero 内自主游走，边走边注入速度+染料；
 * 鼠标移动时在指针处额外注入，可搅动这团火。
 * 染料浓度 → 温度 → 火焰调色板（近黑→深红→#EA580C→#F97316→#FDBA74 亮芯）。
 *
 * 工程纪律：
 * - WebGL2 优先（RGBA16F 可渲染+可线性过滤），失败降级 WebGL1 + half-float 扩展，
 *   再失败静默隐藏 canvas，页面不受影响；
 * - prefers-reduced-motion：预热若干步后渲染一帧静态画面即停；
 * - visibilitychange 暂停/恢复 rAF（恢复时扣除暂停时长，轨迹不跳变）；
 * - 卸载时释放全部 FBO/纹理/程序/缓冲（不 loseContext：StrictMode 双挂载会复用同一 canvas）；
 * - devicePixelRatio 封顶 1.5。
 */

/** 模拟分辨率（速度/压力场短边）。128-256 之间，越高涡卷越细。 */
const SIM_RES = 256;
/** 染料分辨率（短边），决定火焰边缘细腻度。 */
const DYE_RES = 640;
/** 压力 Jacobi 迭代次数 */
const PRESSURE_ITERATIONS = 20;
/** 压力场每帧衰减（0.8 标准值） */
const PRESSURE_DECAY = 0.8;
/** 涡度约束强度：越大火舌打卷越厉害 */
const CURL_STRENGTH = 40;
/** 速度耗散（/秒）：越小流体惯性越强、尾巴拖得越久 */
const VELOCITY_DISSIPATION = 0.2;
/** 染料耗散（/秒）：尾巴 2-3 秒内消散，防止整屏积成火海 */
const DENSITY_DISSIPATION = 0.5;
/** 染料注入半径（uv 平方空间，越小注入越集中、火团越紧凑） */
const SPLAT_RADIUS = 0.0022;
/** 发射源移动注入速度场的力度 */
const SPLAT_FORCE = 5200;
/** 发射源每秒注入的染料量（温度）。真 GPU 上表现约为无头 SwiftShader 的 2-3 倍，留足余量 */
const EMITTER_DYE_RATE = 4.5;
/** 发射源轨迹时间倍速：越大游走越快 */
const EMITTER_SPEED = 2.2;
/** 启动预热步数：让第一帧合成出来的画面就是已成形的火团+尾巴（截图/首屏不空场） */
const WARMUP_STEPS = 90;
/** 预热步长（秒），90 × 1/45 ≈ 2 秒模拟量 */
const WARMUP_DT = 1 / 45;
/** 指针搅动注入力度（相对 SPLAT_FORCE 的比例） */
const POINTER_FORCE_RATIO = 0.7;
/** DPR 上限 */
const MAX_DPR = 1.5;

/* ------------------------------------------------------------------ */
/* Shaders（GLSL ES 1.00，WebGL1/2 通用）                               */
/* ------------------------------------------------------------------ */

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
precision highp sampler2D;
#else
precision mediump float;
precision mediump sampler2D;
#endif
`;

/** 高斯 splat：向目标场注入颜色/速度 */
const SPLAT_FRAG = `
${PRECISION}
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float uAspect;
uniform vec3 uColor;
uniform vec2 uPoint;
uniform float uRadius;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat, 1.0);
}
`;

/** 半拉格朗日平流 + 耗散 */
const ADVECTION_FRAG = `
${PRECISION}
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexelSize;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexelSize;
  vec4 result = texture2D(uSource, coord);
  gl_FragColor = result / (1.0 + uDissipation * uDt);
}
`;

const CURL_FRAG = `
${PRECISION}
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
void main() {
  float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
  float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}
`;

const VORTICITY_FRAG = `
${PRECISION}
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexelSize;
uniform float uCurlStrength;
uniform float uDt;
void main() {
  float L = texture2D(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture2D(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x;
  float B = texture2D(uCurl, vUv - vec2(0.0, uTexelSize.y)).x;
  float T = texture2D(uCurl, vUv + vec2(0.0, uTexelSize.y)).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurlStrength * C;
  force.y *= -1.0;
  vec2 velocity = texture2D(uVelocity, vUv).xy + force * uDt;
  velocity = clamp(velocity, vec2(-1000.0), vec2(1000.0));
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

const DIVERGENCE_FRAG = `
${PRECISION}
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
void main() {
  float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vUv.x - uTexelSize.x < 0.0) { L = -C.x; }
  if (vUv.x + uTexelSize.x > 1.0) { R = -C.x; }
  if (vUv.y - uTexelSize.y < 0.0) { B = -C.y; }
  if (vUv.y + uTexelSize.y > 1.0) { T = -C.y; }
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}
`;

const CLEAR_FRAG = `
${PRECISION}
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float uValue;
void main() {
  gl_FragColor = uValue * texture2D(uTexture, vUv);
}
`;

const PRESSURE_FRAG = `
${PRECISION}
varying vec2 vUv;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexelSize;
void main() {
  float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
  float divergence = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
}
`;

const GRADIENT_SUBTRACT_FRAG = `
${PRECISION}
varying vec2 vUv;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
void main() {
  float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

/** 染料浓度 → 火焰调色板 */
const DISPLAY_FRAG = `
${PRECISION}
varying vec2 vUv;
uniform sampler2D uDye;
void main() {
  float t = texture2D(uDye, vUv).x;
  // 轻度 gamma：把稀薄的尾巴/涡卷从近黑里提出来，但保持细丝对比度（不提成一片光晕）
  t = pow(max(t, 0.0), 0.7);
  vec3 c = vec3(0.0);
  c = mix(c, vec3(0.30, 0.03, 0.01), smoothstep(0.02, 0.15, t));   // 深红
  c = mix(c, vec3(0.918, 0.345, 0.047), smoothstep(0.12, 0.40, t)); // #EA580C
  c = mix(c, vec3(0.976, 0.451, 0.086), smoothstep(0.35, 0.70, t)); // #F97316
  c = mix(c, vec3(0.992, 0.729, 0.455), smoothstep(0.65, 1.10, t)); // #FDBA74 亮芯
  // 不透明画布 + screen 混合：黑色恒等，颜色即亮度。
  // 全页常驻背景增益 0.5：长页滚动不疲劳，火团游过局部透亮但不洗白
  gl_FragColor = vec4(c * 0.5, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* 发射源轨迹：平滑李萨如 + 多频噪声叠加，不出界、不瞬移                  */
/* ------------------------------------------------------------------ */

function emitterPath(t: number): { x: number; y: number } {
  const s = t * EMITTER_SPEED;
  const x =
    0.5 +
    0.29 * Math.sin(s * 0.29) +
    0.09 * Math.sin(s * 0.71 + 1.7) +
    0.05 * Math.sin(s * 1.31 + 0.6);
  const y =
    0.48 +
    0.23 * Math.sin(s * 0.23 + 2.1) +
    0.09 * Math.cos(s * 0.53 + 0.9) +
    0.04 * Math.cos(s * 1.13);
  return {
    x: Math.min(0.92, Math.max(0.08, x)),
    y: Math.min(0.88, Math.max(0.12, y)),
  };
}

/* ------------------------------------------------------------------ */
/* WebGL 基础设施                                                      */
/* ------------------------------------------------------------------ */

interface FBO {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
  texelX: number;
  texelY: number;
  attach: (unit: number) => number;
}

interface DoubleFBO {
  read: FBO;
  write: FBO;
  swap: () => void;
}

interface Program {
  prog: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  bind: () => void;
}

interface GLResources {
  programs: WebGLProgram[];
  shaders: WebGLShader[];
  textures: WebGLTexture[];
  fbos: WebGLFramebuffer[];
  buffers: WebGLBuffer[];
}

export function FluidFire({ className }: { readonly className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const hide = () => {
      canvas.style.display = "none";
    };

    let raf: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;
    const res: GLResources = { programs: [], shaders: [], textures: [], fbos: [], buffers: [] };

    try {
      /* ---- 上下文：WebGL2 优先，降级 WebGL1 ---- */
      let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
      let halfFloatType = 0;
      let useRGBA16F = false;

      const ctxAttrs: WebGLContextAttributes = {
        // 关键：不透明画布 + mix-blend-mode: screen。黑色区域经 screen 混合等于恒等，
        // 免去 alpha 通道在非预乘合成下对颜色的二次压暗（火焰亮度直接拉满）。
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
      };

      const gl2 = canvas.getContext("webgl2", ctxAttrs) as WebGL2RenderingContext | null;
      if (gl2 && gl2.getExtension("EXT_color_buffer_float")) {
        gl = gl2;
        halfFloatType = gl2.HALF_FLOAT;
        useRGBA16F = true;
      } else {
        const gl1 = (canvas.getContext("webgl", ctxAttrs) ??
          canvas.getContext("experimental-webgl", ctxAttrs)) as WebGLRenderingContext | null;
        if (!gl1) {
          hide();
          return;
        }
        const extHalf = gl1.getExtension("OES_texture_half_float");
        gl1.getExtension("OES_texture_half_float_linear");
        if (!extHalf) {
          hide();
          return;
        }
        gl = gl1;
        halfFloatType = extHalf.HALF_FLOAT_OES;
      }
      const GL: WebGLRenderingContext = gl;

      /* ---- 基础设施 ---- */
      const compile = (type: number, src: string): WebGLShader | null => {
        const shader = GL.createShader(type);
        if (!shader) return null;
        GL.shaderSource(shader, src);
        GL.compileShader(shader);
        if (!GL.getShaderParameter(shader, GL.COMPILE_STATUS)) {
          GL.deleteShader(shader);
          return null;
        }
        res.shaders.push(shader);
        return shader;
      };

      const createProgram = (fsSrc: string): Program | null => {
        const vs = compile(GL.VERTEX_SHADER, VERT_SRC);
        const fs = compile(GL.FRAGMENT_SHADER, fsSrc);
        if (!vs || !fs) return null;
        const prog = GL.createProgram();
        if (!prog) return null;
        GL.attachShader(prog, vs);
        GL.attachShader(prog, fs);
        GL.bindAttribLocation(prog, 0, "aPos");
        GL.linkProgram(prog);
        if (!GL.getProgramParameter(prog, GL.LINK_STATUS)) {
          GL.deleteProgram(prog);
          return null;
        }
        res.programs.push(prog);
        const uniforms: Record<string, WebGLUniformLocation | null> = {};
        const count = GL.getProgramParameter(prog, GL.ACTIVE_UNIFORMS) as number;
        for (let i = 0; i < count; i++) {
          const name = GL.getActiveUniform(prog, i)?.name;
          if (name) uniforms[name] = GL.getUniformLocation(prog, name);
        }
        return { prog, uniforms, bind: () => GL.useProgram(prog) };
      };

      const createFBO = (w: number, h: number, filter: number): FBO | null => {
        const tex = GL.createTexture();
        if (!tex) return null;
        res.textures.push(tex);
        GL.activeTexture(GL.TEXTURE0);
        GL.bindTexture(GL.TEXTURE_2D, tex);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, filter);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, filter);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
        const internal = useRGBA16F ? (GL as WebGL2RenderingContext).RGBA16F : GL.RGBA;
        GL.texImage2D(GL.TEXTURE_2D, 0, internal, w, h, 0, GL.RGBA, halfFloatType, null);
        const fbo = GL.createFramebuffer();
        if (!fbo) return null;
        res.fbos.push(fbo);
        GL.bindFramebuffer(GL.FRAMEBUFFER, fbo);
        GL.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, tex, 0);
        if (GL.checkFramebufferStatus(GL.FRAMEBUFFER) !== GL.FRAMEBUFFER_COMPLETE) {
          return null;
        }
        GL.viewport(0, 0, w, h);
        GL.clearColor(0, 0, 0, 0);
        GL.clear(GL.COLOR_BUFFER_BIT);
        return {
          fbo,
          tex,
          w,
          h,
          texelX: 1 / w,
          texelY: 1 / h,
          attach(unit: number) {
            GL.activeTexture(GL.TEXTURE0 + unit);
            GL.bindTexture(GL.TEXTURE_2D, tex);
            return unit;
          },
        };
      };

      const createDoubleFBO = (w: number, h: number, filter: number): DoubleFBO | null => {
        const a = createFBO(w, h, filter);
        const b = createFBO(w, h, filter);
        if (!a || !b) return null;
        return {
          read: a,
          write: b,
          swap() {
            const tmp = this.read;
            this.read = this.write;
            this.write = tmp;
          },
        };
      };

      /* ---- 全屏 quad ---- */
      const quad = GL.createBuffer();
      if (!quad) {
        hide();
        return;
      }
      res.buffers.push(quad);
      GL.bindBuffer(GL.ARRAY_BUFFER, quad);
      GL.bufferData(GL.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), GL.STATIC_DRAW);
      GL.enableVertexAttribArray(0);
      GL.vertexAttribPointer(0, 2, GL.FLOAT, false, 0, 0);

      const blit = (target: FBO | null) => {
        if (target) {
          GL.bindFramebuffer(GL.FRAMEBUFFER, target.fbo);
          GL.viewport(0, 0, target.w, target.h);
        } else {
          GL.bindFramebuffer(GL.FRAMEBUFFER, null);
          GL.viewport(0, 0, canvas.width, canvas.height);
        }
        GL.drawArrays(GL.TRIANGLE_STRIP, 0, 4);
      };

      /* ---- 编译程序 ---- */
      const splatProg = createProgram(SPLAT_FRAG);
      const advectionProg = createProgram(ADVECTION_FRAG);
      const curlProg = createProgram(CURL_FRAG);
      const vorticityProg = createProgram(VORTICITY_FRAG);
      const divergenceProg = createProgram(DIVERGENCE_FRAG);
      const clearProg = createProgram(CLEAR_FRAG);
      const pressureProg = createProgram(PRESSURE_FRAG);
      const gradientProg = createProgram(GRADIENT_SUBTRACT_FRAG);
      const displayProg = createProgram(DISPLAY_FRAG);
      if (
        !splatProg || !advectionProg || !curlProg || !vorticityProg ||
        !divergenceProg || !clearProg || !pressureProg || !gradientProg || !displayProg
      ) {
        hide();
        return;
      }

      /* ---- 分辨率与 FBO ---- */
      const aspect = () => (canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 1);
      const getRes = (base: number) => {
        const ar = aspect();
        const ratio = ar >= 1 ? ar : 1 / ar;
        const min = Math.round(base);
        const max = Math.round(base * ratio);
        return ar >= 1 ? { w: max, h: min } : { w: min, h: max };
      };

      let velocity: DoubleFBO | null = null;
      let dye: DoubleFBO | null = null;
      let divergenceFBO: FBO | null = null;
      let curlFBO: FBO | null = null;
      let pressure: DoubleFBO | null = null;

      const initFields = (): boolean => {
        const sim = getRes(SIM_RES);
        const dyeRes = getRes(DYE_RES);
        velocity = createDoubleFBO(sim.w, sim.h, GL.LINEAR);
        dye = createDoubleFBO(dyeRes.w, dyeRes.h, GL.LINEAR);
        divergenceFBO = createFBO(sim.w, sim.h, GL.NEAREST);
        curlFBO = createFBO(sim.w, sim.h, GL.NEAREST);
        pressure = createDoubleFBO(sim.w, sim.h, GL.NEAREST);
        return !!(velocity && dye && divergenceFBO && curlFBO && pressure);
      };

      const resizeCanvas = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      };
      resizeCanvas();
      if (!initFields()) {
        // half-float FBO 不可渲染等情况：静默降级
        hide();
        return;
      }

      resizeObserver = new ResizeObserver(() => {
        resizeCanvas();
        // 模拟场分辨率与画幅挂钩，尺寸变化时重建（染料/速度清零，可接受）
        initFields();
      });
      resizeObserver.observe(canvas);

      GL.disable(GL.BLEND);

      /* ---- splat ---- */
      const correctRadius = (radius: number) => {
        const ar = aspect();
        return ar > 1 ? radius * ar : radius;
      };

      const splat = (x: number, y: number, dx: number, dy: number, dyeAmount: number) => {
        if (!velocity || !dye) return;
        splatProg.bind();
        GL.uniform1i(splatProg.uniforms["uTarget"], velocity.read.attach(0));
        GL.uniform1f(splatProg.uniforms["uAspect"], aspect());
        GL.uniform2f(splatProg.uniforms["uPoint"], x, y);
        GL.uniform3f(splatProg.uniforms["uColor"], dx, dy, 0);
        GL.uniform1f(splatProg.uniforms["uRadius"], correctRadius(SPLAT_RADIUS));
        blit(velocity.write);
        velocity.swap();

        GL.uniform1i(splatProg.uniforms["uTarget"], dye.read.attach(0));
        GL.uniform3f(splatProg.uniforms["uColor"], dyeAmount, 0, 0);
        blit(dye.write);
        dye.swap();
      };

      /* ---- 模拟步进 ---- */
      const step = (dt: number) => {
        if (!velocity || !dye || !pressure || !curlFBO || !divergenceFBO) return;
        const tx = velocity.read.texelX;
        const ty = velocity.read.texelY;

        curlProg.bind();
        GL.uniform1i(curlProg.uniforms["uVelocity"], velocity.read.attach(0));
        GL.uniform2f(curlProg.uniforms["uTexelSize"], tx, ty);
        blit(curlFBO);

        vorticityProg.bind();
        GL.uniform1i(vorticityProg.uniforms["uVelocity"], velocity.read.attach(0));
        GL.uniform1i(vorticityProg.uniforms["uCurl"], curlFBO.attach(1));
        GL.uniform2f(vorticityProg.uniforms["uTexelSize"], tx, ty);
        GL.uniform1f(vorticityProg.uniforms["uCurlStrength"], CURL_STRENGTH);
        GL.uniform1f(vorticityProg.uniforms["uDt"], dt);
        blit(velocity.write);
        velocity.swap();

        divergenceProg.bind();
        GL.uniform1i(divergenceProg.uniforms["uVelocity"], velocity.read.attach(0));
        GL.uniform2f(divergenceProg.uniforms["uTexelSize"], tx, ty);
        blit(divergenceFBO);

        clearProg.bind();
        GL.uniform1i(clearProg.uniforms["uTexture"], pressure.read.attach(0));
        GL.uniform1f(clearProg.uniforms["uValue"], PRESSURE_DECAY);
        blit(pressure.write);
        pressure.swap();

        pressureProg.bind();
        GL.uniform1i(pressureProg.uniforms["uDivergence"], divergenceFBO.attach(0));
        GL.uniform2f(pressureProg.uniforms["uTexelSize"], tx, ty);
        for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
          GL.uniform1i(pressureProg.uniforms["uPressure"], pressure.read.attach(1));
          blit(pressure.write);
          pressure.swap();
        }

        gradientProg.bind();
        GL.uniform1i(gradientProg.uniforms["uPressure"], pressure.read.attach(0));
        GL.uniform1i(gradientProg.uniforms["uVelocity"], velocity.read.attach(1));
        GL.uniform2f(gradientProg.uniforms["uTexelSize"], tx, ty);
        blit(velocity.write);
        velocity.swap();

        advectionProg.bind();
        GL.uniform2f(advectionProg.uniforms["uTexelSize"], tx, ty);
        GL.uniform1f(advectionProg.uniforms["uDt"], dt);
        GL.uniform1i(advectionProg.uniforms["uVelocity"], velocity.read.attach(0));
        GL.uniform1i(advectionProg.uniforms["uSource"], velocity.read.attach(0));
        GL.uniform1f(advectionProg.uniforms["uDissipation"], VELOCITY_DISSIPATION);
        blit(velocity.write);
        velocity.swap();

        GL.uniform1i(advectionProg.uniforms["uVelocity"], velocity.read.attach(0));
        GL.uniform1i(advectionProg.uniforms["uSource"], dye.read.attach(1));
        GL.uniform1f(advectionProg.uniforms["uDissipation"], DENSITY_DISSIPATION);
        blit(dye.write);
        dye.swap();
      };

      const render = () => {
        if (!dye) return;
        displayProg.bind();
        GL.uniform1i(displayProg.uniforms["uDye"], dye.read.attach(0));
        blit(null);
      };

      /* ---- 发射源 + 指针 ---- */
      // 随机起始相位：每次加载火团从不同路段开始游走（也让逐次截图位置必然不同）
      const phase = Math.random() * 100;
      let simTime = 0;
      let prevEmitter = emitterPath(phase);
      const pointer = { x: 0.5, y: 0.5, dx: 0, dy: 0, moved: false };

      const onPointerMove = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = (e.clientX - rect.left) / rect.width;
        const y = 1 - (e.clientY - rect.top) / rect.height;
        // 指针在 hero 之外也注入边缘附近的力？仅 hero 范围内响应
        if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return;
        pointer.dx += (x - pointer.x) * SPLAT_FORCE * POINTER_FORCE_RATIO;
        pointer.dy += (y - pointer.y) * SPLAT_FORCE * POINTER_FORCE_RATIO;
        pointer.x = x;
        pointer.y = y;
        pointer.moved = true;
      };

      const applyForces = (dt: number) => {
        const pos = emitterPath(phase + simTime);
        // deltaUv × 力度：uv 位移直接乘 FORCE（Pavel 原版指针 splat 同公式）。
        // 真 GPU 上涡卷强度同样放大，力度收敛到 ×5/clamp 120，保持火团紧凑不甩尾满屏
        let dx = (pos.x - prevEmitter.x) * SPLAT_FORCE * 5;
        let dy = (pos.y - prevEmitter.y) * SPLAT_FORCE * 5;
        const swirlX = -dy * 0.4;
        const swirlY = dx * 0.4;
        dx += swirlX;
        dy += swirlY;
        const len = Math.hypot(dx, dy);
        const maxForce = 120;
        if (len > maxForce) {
          dx = (dx / len) * maxForce;
          dy = (dy / len) * maxForce;
        }
        splat(pos.x, pos.y, dx, dy, EMITTER_DYE_RATE * dt);
        prevEmitter = pos;

        if (pointer.moved) {
          const plen = Math.hypot(pointer.dx, pointer.dy);
          const pmax = 80;
          let pdx = pointer.dx;
          let pdy = pointer.dy;
          if (plen > pmax) {
            pdx = (pdx / plen) * pmax;
            pdy = (pdy / plen) * pmax;
          }
          splat(pointer.x, pointer.y, pdx, pdy, EMITTER_DYE_RATE * dt * 0.6);
          pointer.dx = 0;
          pointer.dy = 0;
          pointer.moved = false;
        }
      };

      /* ---- 主循环 ---- */
      // 预热：同步跑 ~2 秒模拟量，让第一帧合成出来的画面就是已成形的火团+尾巴
      for (let i = 0; i < WARMUP_STEPS; i++) {
        simTime += WARMUP_DT;
        applyForces(WARMUP_DT);
        step(WARMUP_DT);
      }

      let lastTime = performance.now();
      const tick = (now: number) => {
        if (disposed) return;
        raf = requestAnimationFrame(tick);
        const dt = Math.min((now - lastTime) / 1000, 1 / 30);
        lastTime = now;
        simTime += dt;
        applyForces(dt);
        step(dt);
        render();
      };

      const reducedMotion = prefersReducedMotion();
      if (reducedMotion) {
        // 预热后画一帧静态画面即停
        render();
      } else {
        document.addEventListener("pointermove", onPointerMove, { passive: true });
        let paused = false;
        const onVisibility = () => {
          if (document.hidden) {
            if (raf) cancelAnimationFrame(raf);
            raf = null;
            paused = true;
          } else if (paused) {
            paused = false;
            lastTime = performance.now();
            raf = requestAnimationFrame(tick);
          }
        };
        document.addEventListener("visibilitychange", onVisibility);
        raf = requestAnimationFrame(tick);

        return () => {
          disposed = true;
          document.removeEventListener("visibilitychange", onVisibility);
          document.removeEventListener("pointermove", onPointerMove);
          if (raf) cancelAnimationFrame(raf);
          resizeObserver?.disconnect();
          for (const p of res.programs) GL.deleteProgram(p);
          for (const s of res.shaders) GL.deleteShader(s);
          for (const t of res.textures) GL.deleteTexture(t);
          for (const f of res.fbos) GL.deleteFramebuffer(f);
          for (const b of res.buffers) GL.deleteBuffer(b);
          // 注意：不要 loseContext——React 18 StrictMode 会在 dev 下双挂载，
          // 同一 canvas 元素第二次 getContext 拿到的仍是已丢失的上下文，初始化必败。
          // GL 上下文跟随 canvas 元素被 DOM 移除时由浏览器回收，删资源即可。
        };
      }

      // reduced-motion 分支的清理
      return () => {
        disposed = true;
        resizeObserver?.disconnect();
        for (const p of res.programs) GL.deleteProgram(p);
        for (const s of res.shaders) GL.deleteShader(s);
        for (const t of res.textures) GL.deleteTexture(t);
        for (const f of res.fbos) GL.deleteFramebuffer(f);
        for (const b of res.buffers) GL.deleteBuffer(b);
        // 同上：不 loseContext，兼容 StrictMode 双挂载
      };
    } catch {
      // 任何初始化异常：静默降级
      hide();
      return;
    }
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "nova-fluid-bg"}
      aria-hidden="true"
    />
  );
}
