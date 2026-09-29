import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

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
          include: ['src/**/*.test.ts'],
          exclude: ['src/react/**'],
        },
      },
      {
        // React bindings in a real browser (vitest-browser-react).
        extends: true,
        // Pre-bundled up front: discovering them mid-run makes Vite reload the
        // page and fail the files that were loading (always on a cold cache).
        optimizeDeps: {
          include: ['react', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'vitest-browser-react'],
        },
        test: {
          name: 'react',
          include: ['src/react/**/*.test.tsx'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
