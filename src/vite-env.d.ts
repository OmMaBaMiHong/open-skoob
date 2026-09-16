/// <reference types="vite/client" />

/**
 * 本前端**独立运行**，后端地址靠环境变量注入（不再依赖 vite 代理）。
 * 见 src/lib/api-origin.ts。
 */
interface ImportMetaEnv {
  /** 后端源地址，如 `http://127.0.0.1:4579`。不设则回落到构建期注入的默认值。 */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
