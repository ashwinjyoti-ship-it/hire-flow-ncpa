import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // SPA dev: forward /api to the Pages dev server running the API + local D1/R2.
      "/api": {
        target: "http://localhost:8788",
        changeOrigin: true,
      },
    },
  },
});
