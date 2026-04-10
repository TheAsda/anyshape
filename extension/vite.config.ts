import { defineConfig, type PluginOption } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

const __dirname = new URL('.', import.meta.url).pathname;

export default defineConfig({
  root: __dirname,
  plugins: [react() as PluginOption],
  publicDir: 'public',
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        devtools: resolve(__dirname, 'devtools.html'),
        panel: resolve(__dirname, 'panel.html'),
        background: resolve(__dirname, 'src/background.ts'),
        'content-script': resolve(__dirname, 'src/content-script.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    alias: {
      'devtools-protocol/background': resolve(__dirname, '../node_modules/devtools-protocol/dist/background.js'),
      'devtools-protocol/content-script': resolve(__dirname, '../node_modules/devtools-protocol/dist/content-script.js'),
      'devtools-protocol/page': resolve(__dirname, '../node_modules/devtools-protocol/dist/page.js'),
      'devtools-protocol/panel': resolve(__dirname, '../node_modules/devtools-protocol/dist/panel.js'),
      'devtools-protocol/react': resolve(__dirname, '../node_modules/devtools-protocol/dist/react.js'),
    },
  },
});