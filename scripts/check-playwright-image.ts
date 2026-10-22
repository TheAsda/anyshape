// Fails when the container image and the installed Playwright have drifted:
// the image tag must be the installed Playwright's version, and the browsers
// it launches must be present. Either mismatch is otherwise met as
// "Executable doesn't exist" in the middle of a test run, far from the tag
// that caused it.

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const requireFromScript = createRequire(import.meta.url);

// The container image points PLAYWRIGHT_BROWSERS_PATH at its browser
// directory; without it, this is where a local `bunx playwright install
// chromium` puts them.
const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), ".cache", "ms-playwright");

// playwright-core's exports only open its entry, so the package is located
// through its exported package.json and the two files are read beside it.
const coreDir = path.dirname(requireFromScript.resolve("playwright-core/package.json"));
const { version } = JSON.parse(fs.readFileSync(path.join(coreDir, "package.json"), "utf8")) as {
  version: string;
};
// The revisions the installed Playwright launches its browsers from.
const { browsers } = JSON.parse(fs.readFileSync(path.join(coreDir, "browsers.json"), "utf8")) as {
  browsers: { name: string; revision: string | number }[];
};

// The image tag CI runs this under, read from the workflow itself so the tag
// and this check cannot be updated without each other.
const tag = fs
  .readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
  .match(/playwright:v(\d+\.\d+\.\d+)-noble/)?.[1];

if (tag !== version) {
  console.error(
    `The image tag in .github/workflows/ci.yml is ${tag ?? "(absent)"}, but the installed Playwright is ${version}.`,
  );
  console.error(
    `The tag must be the Playwright version bun.lock pins: mcr.microsoft.com/playwright:v${version}-noble.`,
  );
  process.exit(1);
}

// The tests run Chromium through Vitest browser mode, so the chromium family
// is what has to be there; the image may ship more than the tests use.
const used = browsers.filter((browser) => browser.name.startsWith("chromium"));

// A hyphenated browser name becomes an underscored directory:
// chromium-headless-shell lives in chromium_headless_shell-<revision>.
const dirName = (browser: { name: string; revision: string | number }): string =>
  `${browser.name.replaceAll("-", "_")}-${browser.revision}`;

const missing = used.map((browser) => path.join(browsersDir, dirName(browser))).filter((dir) => !fs.existsSync(dir));

if (missing.length > 0) {
  const shipped = fs.existsSync(browsersDir) ? fs.readdirSync(browsersDir).sort().join(", ") : "(nothing)";
  console.error(`Playwright ${version} expects, but does not find in ${browsersDir}:`);
  for (const dir of missing) {
    console.error(`  ${dir}`);
  }
  console.error(`The browsers there: ${shipped}.`);
  console.error(
    `The container image in .github/workflows/ci.yml must be` +
      ` mcr.microsoft.com/playwright:v${version}-noble, the Playwright version bun.lock pins.`,
  );
  process.exit(1);
}

console.log(
  `Playwright ${version} matches the image tag and the browsers in ${browsersDir}: ${used.map(dirName).join(", ")}`,
);
