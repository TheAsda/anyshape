import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
// The library source, consumed directly (no build step): examples/evolution -> <repo>/src
const lib = resolve(here, "../../src");
const recipes = resolve(here, "../../recipes");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Exact matches: each entry to its source.
      { find: /^anyshape\/recipes\/react$/, replacement: resolve(recipes, "react/index.ts") },
      { find: /^anyshape\/recipes$/, replacement: resolve(recipes, "index.ts") },
      { find: /^anyshape\/react$/, replacement: resolve(lib, "react/index.ts") },
      { find: /^anyshape$/, replacement: resolve(lib, "index.ts") },
    ],
  },
  server: {
    fs: {
      // The library lives outside this example's root.
      allow: [resolve(here, "../..")],
    },
  },
});
