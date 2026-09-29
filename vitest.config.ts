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
        // React suites not yet moved to browser mode (removed once all are .tsx).
        extends: true,
        test: {
          name: 'react-dom',
          environment: 'happy-dom',
          include: ['src/react/**/*.test.ts'],
        },
      },
      {
        // React bindings in a real browser (vitest-browser-react).
        extends: true,
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
