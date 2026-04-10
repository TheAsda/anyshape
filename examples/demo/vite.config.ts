import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'form-lib/specs': resolve(__dirname, '../../src/specs/index.ts'),
      'form-lib/react': resolve(__dirname, '../../src/react/index.ts'),
      'form-lib/devtools': resolve(__dirname, '../../src/devtools/index.ts'),
      'form-lib/lens': resolve(__dirname, '../../src/lens/index.ts'),
      'form-lib/store': resolve(__dirname, '../../src/store/index.ts'),
      'form-lib/types': resolve(__dirname, '../../src/types/index.ts'),
      'form-lib': resolve(__dirname, '../../src/index.ts'),
      'devtools-protocol/page': resolve(__dirname, '../../../devtools-protocol/dist/page.js'),
      'devtools-protocol/react': resolve(__dirname, '../../../devtools-protocol/dist/react.js'),
      'devtools-protocol/background': resolve(__dirname, '../../../devtools-protocol/dist/background.js'),
      'devtools-protocol/content-script': resolve(__dirname, '../../../devtools-protocol/dist/content-script.js'),
      'devtools-protocol/panel': resolve(__dirname, '../../../devtools-protocol/dist/panel.js'),
    },
  },
});
