import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_ORIGIN || "http://127.0.0.1:28080",
        changeOrigin: false,
      },
    },
  },
  build: { sourcemap: false },
});
