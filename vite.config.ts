import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const origin = env.VITE_API_BASE_URL?.trim() || "https://skoob.cc";
  const url = new URL(origin);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("VITE_API_BASE_URL must be an origin without credentials, path, query or fragment");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Use HTTPS for a remote API origin");
  }
  return {
    plugins: [react()],
    define: { __API_ORIGIN__: JSON.stringify(url.origin) },
    build: { sourcemap: false },
    server: { port: 9002, strictPort: true, host: "127.0.0.1" },
    preview: { port: 9002, strictPort: true, host: "127.0.0.1" },
  };
});
