import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Pre-bundled up front: discovering them mid-run makes Vite reload the page
// and fail the files that were loading (always on a cold cache).
const optimizeDeps = {
  include: ['react', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'vitest-browser-react'],
};

// A fresh object per project: Vitest names the instances in place.
const browser = () => ({
  enabled: true,
  provider: playwright(),
  headless: true,
  instances: [{ browser: 'chromium' as const }],
});

export default defineConfig({
  test: {
    fsModuleCache: true,
    projects: [
      {
        // The core: shapes, stores, behaviors, validation. No DOM needed.
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/react/**'],
          // `npm run bench` selects this project as "unit (bench)".
          benchmark: { include: ['bench/**/*.bench.ts'] },
        },
      },
      {
        // Recipes: built only on the core entry, imported as `form-lib`.
        extends: true,
        resolve: {
          alias: [{ find: /^form-lib$/, replacement: resolve(here, 'src/index.ts') }],
        },
        test: {
          name: 'recipes',
          environment: 'node',
          include: ['recipes/**/*.test.ts'],
        },
      },
      {
        // React bindings in a real browser (vitest-browser-react).
        extends: true,
        optimizeDeps,
        test: {
          name: 'react',
          include: ['test/react/**/*.test.tsx'],
          browser: browser(),
        },
      },
      {
        // React recipes in a real browser, built on the core entries. Both
        // aliases point at src/: one copy of the core, shared with the core
        // hooks (its node internals are keyed by per-copy symbols).
        extends: true,
        resolve: {
          alias: [
            { find: /^form-lib$/, replacement: resolve(here, 'src/index.ts') },
            { find: /^form-lib\/react$/, replacement: resolve(here, 'src/react/index.ts') },
          ],
        },
        optimizeDeps,
        test: {
          name: 'recipes-react',
          include: ['recipes/react/**/*.test.tsx'],
          browser: browser(),
        },
      },
    ],
  },
});
