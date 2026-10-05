// ============================================================
// The public surface of both entries, as a snapshot: adding, removing or
// renaming a public name shows up as a reviewed diff. Values are the names an
// entry exports at runtime; types are the rest of what TypeScript sees.
// The agent page's API tables are checked against the same lists.
// ============================================================

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { expect, test } from "vitest";

import * as core from "../src/index";
import * as react from "../src/react/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entries = { anyshape: "src/index.ts", "anyshape/react": "src/react/index.ts" };

const program = ts.createProgram(
  Object.values(entries).map((file) => resolve(root, file)),
  {
    strict: true,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
  },
);
const checker = program.getTypeChecker();

/** Every name an entry exports, values and types alike. */
function exportNames(file: string): string[] {
  const source = program.getSourceFile(resolve(root, file))!;
  return checker.getExportsOfModule(checker.getSymbolAtLocation(source)!).map((s) => s.name);
}

function surface(file: string, runtime: object) {
  const values = Object.keys(runtime).sort();
  const types = exportNames(file)
    .filter((name) => !values.includes(name))
    .sort();
  return { values, types };
}

test("the core entry's public names", () => {
  expect(surface(entries.anyshape, core)).toMatchSnapshot();
});

test("the React entry's public names", () => {
  expect(surface(entries["anyshape/react"], react)).toMatchSnapshot();
});

test("the TypeScript view of each entry includes every runtime export", () => {
  // Guards the split above: a runtime name TypeScript doesn't see would be
  // listed as a value but missing from the types it ships.
  for (const [file, runtime] of [
    [entries.anyshape, core],
    [entries["anyshape/react"], react],
  ] as const) {
    expect(exportNames(file)).toEqual(expect.arrayContaining(Object.keys(runtime)));
  }
});

// ============================================================
// The agent page (docs/guide/agents.md) lists every public name in its
// "API at a glance" section: one table per entry, under a heading that names
// the entry. A name is a backticked identifier in a row's first cell.
// ============================================================

/** The names in the first cells of each entry's table, by entry. */
function agentPageNames(): Record<string, string[]> {
  const page = readFileSync(resolve(root, "docs/guide/agents.md"), "utf8");
  const api = page.split(/^## /m).find((section) => section.startsWith("API at a glance"));
  if (!api) throw new Error('docs/guide/agents.md has no "## API at a glance" section');
  const byEntry: Record<string, string[]> = {};
  for (const table of api.split(/^### /m).slice(1)) {
    const entry = /^`([^`]+)`/.exec(table)?.[1];
    if (!entry) throw new Error(`An API table's heading names no entry: ${table.split("\n")[0]}`);
    byEntry[entry] = table
      .split("\n")
      .filter((line) => line.startsWith("|") && !/^\|\s*(-|Name\b)/.test(line))
      .flatMap((line) => [...line.split("|")[1].matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]));
  }
  return byEntry;
}

test("the agent page's API tables list each entry's public names, and only those", () => {
  const listed = agentPageNames();
  expect(Object.keys(listed).sort()).toEqual(Object.keys(entries).sort());
  for (const [entry, file] of Object.entries(entries)) {
    const names = listed[entry];
    const duplicated = names.filter((name, i) => names.indexOf(name) !== i);
    expect({ entry, duplicated }).toEqual({ entry, duplicated: [] });
    expect({ entry, names: [...names].sort() }).toEqual({ entry, names: exportNames(file).sort() });
  }
});
