import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// The library source, consumed directly (no build step): examples/basic -> <repo>/src
const lib = resolve(here, "../../src");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // More specific entry first.
      { find: "form-lib/react", replacement: resolve(lib, "react/index.ts") },
      { find: "form-lib", replacement: resolve(lib, "index.ts") },
    ],
  },
  server: {
    fs: {
      // The library lives outside this example's root.
      allow: [resolve(here, "../..")],
    },
  },
});
