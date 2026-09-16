import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { __API_ORIGIN__: JSON.stringify("") },
  build: { sourcemap: false },
  server: { port: 9002, strictPort: true, host: "127.0.0.1", proxy: { "/api": { target: `http://127.0.0.1:${process.env.SKOOB_DEV_API_PORT || "4579"}`, changeOrigin: false } } },
  preview: { port: 9002, strictPort: true, host: "127.0.0.1", proxy: { "/api": { target: `http://127.0.0.1:${process.env.SKOOB_DEV_API_PORT || "4579"}` } } },
});
