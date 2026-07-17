import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const projectRoot = import.meta.dirname;
const desktopAssets = [
  "boundary-clock-icon.webp",
  "favicon.png",
  "meadow-desk.webp",
  "state-break-four-toes.webp",
  "state-eod.webp",
  "state-idle.webp",
] as const;

function includeDesktopAssets(): Plugin {
  return {
    name: "include-desktop-assets",
    async buildStart() {
      for (const fileName of desktopAssets) {
        this.emitFile({
          type: "asset",
          fileName,
          source: await readFile(resolve(projectRoot, "public", fileName)),
        });
      }
    },
  };
}

export default defineConfig({
  root: resolve(projectRoot, "desktop"),
  base: "./",
  publicDir: false,
  resolve: {
    alias: [
      {
        find: "@/lib/platform-storage",
        replacement: resolve(projectRoot, "lib/browser-storage.ts"),
      },
      {
        find: "@capacitor/app",
        replacement: resolve(projectRoot, "lib/browser-app.ts"),
      },
      { find: "@", replacement: projectRoot },
    ],
  },
  css: {
    postcss: projectRoot,
  },
  plugins: [includeDesktopAssets()],
  build: {
    outDir: resolve(projectRoot, "dist-desktop"),
    emptyOutDir: true,
  },
});
