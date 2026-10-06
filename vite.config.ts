import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The library build: both entries in one build, so they share one copy of the
// core (its node internals are keyed by per-copy symbols). ESM only, readable
// output: no minification and no sourcemaps, since src/ isn't shipped. The
// declarations come from tsc (tsconfig.build.json), one per module.
export default defineConfig({
  build: {
    target: "es2022",
    minify: false,
    sourcemap: false,
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "react/index": resolve(__dirname, "src/react/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [/^react($|\/)/],
      // The code both entries import: one chunk, under a stable name.
      output: { chunkFileNames: "core.js" },
    },
  },
});
