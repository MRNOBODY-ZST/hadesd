import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
export default defineConfig(({ command }) => ({
  plugins: [reactRouter()],
  ssr: { noExternal: command === "build" ? true : undefined },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_ORIGIN || "http://127.0.0.1:28080",
        changeOrigin: false,
      },
    },
  },
  preview: { host: "127.0.0.1" },
  build: { chunkSizeWarningLimit: 600, emptyOutDir: true },
}));
