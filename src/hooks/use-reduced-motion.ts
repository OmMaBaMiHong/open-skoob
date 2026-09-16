/**
 * 系统开启「减弱动态效果」时，一切持续动画都应降级为静态帧。
 * （移植自 studio 老前端 hooks/use-reveal.ts 的同名函数。）
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
