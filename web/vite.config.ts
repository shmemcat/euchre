/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { privateBoundary } from "./dev/private-boundary";

export default defineConfig(({ mode }) => {
   const env = loadEnv(mode, process.cwd(), "");
   return {
      base: env.VITE_BASE_PATH || "/",
      plugins: [react(), tailwindcss(), privateBoundary()],
      resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
      server: {
         host: "127.0.0.1",
         port: 3002,
         strictPort: true,
         proxy: {
            "^/euchre/socket\\.io(?:/|\\?|$)": {
               target: env.EUCHRE_API_TARGET || env.ACCOUNT_PROXY_TARGET || "http://127.0.0.1:5000",
               ws: true,
               changeOrigin: true,
               rewrite: (p) =>
                  p.replace(/^\/euchre\/socket\.io\/?/, "/socket.io/"),
            },
            "/socket.io": {
               target: env.ACCOUNT_PROXY_TARGET || "http://127.0.0.1:5000",
               ws: true,
               changeOrigin: true,
               rewrite: (p) => p.replace(/^\/socket\.io\/?/, "/socket.io/"),
            },
            "/api/euchre/": {
               target: env.EUCHRE_API_TARGET || env.ACCOUNT_PROXY_TARGET || "http://127.0.0.1:5000",
               changeOrigin: true,
               rewrite: (p) => p.replace(/^\/api\/euchre/, "/account/euchre"),
            },
            "/api/account/euchre/": {
               target: env.EUCHRE_API_TARGET || env.ACCOUNT_PROXY_TARGET || "http://127.0.0.1:5000",
               changeOrigin: true,
               rewrite: (p) => p.replace(/^\/api/, ""),
            },
            "/api/account": {
               target: env.ACCOUNT_PROXY_TARGET || "http://127.0.0.1:5000",
               changeOrigin: true,
               rewrite: (p) => p.replace(/^\/api/, ""),
            },
         },
      },
      preview: { host: "127.0.0.1", port: 3002, strictPort: true },
      test: {
         globals: true,
         environment: "jsdom",
         setupFiles: "./src/test/setup.ts",
         include: ["src/**/*.test.{ts,tsx}"],
      },
   };
});
