// Bundles a test file with esbuild and runs it in headless Chromium (real DOM, real React).
// Usage: node scripts/browser-test.mjs src/react/react.test.ts
import { createRequire } from "node:module";
import { resolve } from "node:path";

const GLOBAL = "/home/claude/.npm-global/lib/node_modules";
const require = createRequire(import.meta.url);
const esbuild = require(`${GLOBAL}/tsx/node_modules/esbuild`);
const { chromium } = require(`${GLOBAL}/playwright`);

const file = process.argv[2];
const result = await esbuild.build({
  entryPoints: [resolve(file)],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
  nodePaths: [GLOBAL],
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "silent",
});
const code = result.outputFiles[0].text;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (msg) => {
  const text = msg.text();
  // React's act() environment note is not a failure
  if (/not configured to support act|Download the React DevTools/.test(text)) return;
  (msg.type() === "error" ? console.error : console.log)(text);
});
page.on("pageerror", (err) => {
  console.error("PAGE ERROR", err.stack ?? err.message);
  process.exitCode = 1;
});
await page.addInitScript(() => {
  window.process = { exitCode: 0, env: { NODE_ENV: "development" } };
  window.IS_REACT_ACT_ENVIRONMENT = true;
});
await page.goto("about:blank");
await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
await page.evaluate(() => {
  window.process = window.process ?? { exitCode: 0, env: { NODE_ENV: "development" } };
  window.IS_REACT_ACT_ENVIRONMENT = true;
});
await page.addScriptTag({ content: code });
await page.waitForFunction(() => window.__testsDone === true, null, { timeout: 60_000 });
const exitCode = await page.evaluate(() => window.process.exitCode);
await browser.close();
process.exitCode = exitCode || process.exitCode || 0;
