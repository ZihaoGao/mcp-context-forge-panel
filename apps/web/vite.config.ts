import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";
export default defineConfig({
  root: path.resolve("apps/web"),
  base: "./",
  plugins: [
    react(),
    {
      name: "contract-asset",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "contract.json",
          source: readFileSync("contracts/contextforge/web-contract.json"),
        });
      },
    },
  ],
  build: {
    outDir: path.resolve("dist/web"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("contracts/contextforge")) return "contract";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});
