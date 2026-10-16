/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
   const env = loadEnv(mode, process.cwd(), "");
   return {
      base: env.VITE_BASE_PATH || "/",
      plugins: [react(), tailwindcss()],
      resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
      server: {
         host: "127.0.0.1",
         port: 3002,
         strictPort: true,
         ...(env.ACCOUNT_PROXY_TARGET
            ? {
                 proxy: {
                    "/api/account": {
                       target: env.ACCOUNT_PROXY_TARGET,
                       changeOrigin: true,
                    },
                 },
              }
            : {}),
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
