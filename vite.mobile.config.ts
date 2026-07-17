import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const projectRoot = import.meta.dirname;

export default defineConfig({
  root: resolve(projectRoot, "mobile"),
  publicDir: resolve(projectRoot, "public"),
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  css: {
    postcss: projectRoot,
  },
  plugins: [react()],
  build: {
    outDir: resolve(projectRoot, "dist-mobile"),
    emptyOutDir: true,
  },
});
