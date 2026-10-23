import { resolve, dirname, sep } from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The library build: every entry in one build, so they share one copy of the
// core (its node internals are keyed by per-copy symbols). The recipes import
// the core entries by name, as a copy of them does; the aliases point those
// names at the entries of this build, so no recipe bundles a core of its own.
// ESM only, readable output: no minification and no sourcemaps, since src/
// isn't shipped. The declarations come from tsc (tsconfig.build.json for the
// core, tsconfig.recipes.build.json for the recipes), one per module.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^anyshape$/, replacement: resolve(__dirname, "src/index.ts") },
      { find: /^anyshape\/react$/, replacement: resolve(__dirname, "src/react/index.ts") },
    ],
  },
  build: {
    target: "es2022",
    minify: false,
    sourcemap: false,
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "react/index": resolve(__dirname, "src/react/index.ts"),
        "recipes/index": resolve(__dirname, "recipes/index.ts"),
        "recipes/react/index": resolve(__dirname, "recipes/react/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [/^react($|\/)/],
      // The code several entries import, in one chunk per directory and under
      // stable names: the core, the React bindings, and the recipes outside
      // react/. A chunk per directory keeps React out of the core chunk and
      // out of anything `anyshape/recipes` imports.
      output: {
        chunkFileNames: "[name].js",
        manualChunks(id) {
          if (id.startsWith(resolve(__dirname, "src/react") + sep)) return "react/bindings";
          if (id.startsWith(resolve(__dirname, "src") + sep)) return "core";
          if (id.startsWith(resolve(__dirname, "recipes/react") + sep)) return undefined;
          if (id.startsWith(resolve(__dirname, "recipes") + sep)) return "recipes/recipes";
          return undefined;
        },
      },
    },
  },
});
