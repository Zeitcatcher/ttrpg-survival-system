/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// Builds the module bundle to dist/scripts/module.js and copies public/ (module.json, lang/)
// into dist/. The "module root" Foundry loads is the built dist/ folder.
export default defineConfig({
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: "src/module.ts",
      formats: ["es"],
      fileName: () => "scripts/module.js",
    },
    rollupOptions: {
      output: { assetFileNames: "styles/[name][extname]" },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
