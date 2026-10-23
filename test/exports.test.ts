// ============================================================
// The public surface of every entry, as a snapshot: adding, removing or
// renaming a public name shows up as a reviewed diff. Values are the names an
// entry exports at runtime; types are the rest of what TypeScript sees.
// The agent page's API tables are checked against the same lists.
// The core's tests import no recipe (principle 7), so the recipe entries are
// read through TypeScript alone: their values are the exports TypeScript
// sees as values, a split checked against the runtime on the core entries.
// ============================================================

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The compiler JS API lives in the TypeScript 5 package; the native `typescript`
// 7.x that compiles the workspace does not ship it yet.
import ts from "typescript5";
import { expect, test } from "vitest";

import * as core from "../src/index";
import * as react from "../src/react/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreEntries = { anyshape: "src/index.ts", "anyshape/react": "src/react/index.ts" };
const recipeEntries = { "anyshape/recipes": "recipes/index.ts", "anyshape/recipes/react": "recipes/react/index.ts" };
const entries = { ...coreEntries, ...recipeEntries };

const program = ts.createProgram(
  Object.values(entries).map((file) => resolve(root, file)),
  {
    strict: true,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    // The recipes import the core entries by name, as recipes/tsconfig.json resolves them.
    paths: {
      anyshape: [resolve(root, coreEntries.anyshape)],
      "anyshape/react": [resolve(root, coreEntries["anyshape/react"])],
    },
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

/**
 * The same split, read from TypeScript alone: a value is an export that
 * resolves to a value declaration through no type-only export (`export type
 * { Behavior }` ships a class's type, not the class).
 */
function typedSurface(file: string) {
  const source = program.getSourceFile(resolve(root, file))!;
  const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!);
  const typeOnly = (s: ts.Symbol) =>
    (s.declarations ?? []).some((d) => ts.isExportSpecifier(d) && (d.isTypeOnly || d.parent.parent.isTypeOnly));
  const isValue = (s: ts.Symbol): boolean => {
    if (typeOnly(s)) return false;
    if (!(s.flags & ts.SymbolFlags.Alias)) return (s.flags & ts.SymbolFlags.Value) !== 0;
    const next = checker.getImmediateAliasedSymbol(s);
    return next ? isValue(next) : false;
  };
  return {
    values: exported
      .filter(isValue)
      .map((s) => s.name)
      .sort(),
    types: exported
      .filter((s) => !isValue(s))
      .map((s) => s.name)
      .sort(),
  };
}

test("the core entry's public names", () => {
  expect(surface(entries.anyshape, core)).toMatchSnapshot();
});

test("the React entry's public names", () => {
  expect(surface(entries["anyshape/react"], react)).toMatchSnapshot();
});

test("the recipe entry's public names", () => {
  expect(typedSurface(recipeEntries["anyshape/recipes"])).toMatchSnapshot();
});

test("the React recipe entry's public names", () => {
  expect(typedSurface(recipeEntries["anyshape/recipes/react"])).toMatchSnapshot();
});

test("reading values from TypeScript alone splits the core entries as their runtime does", () => {
  // Guards typedSurface, which the recipe entries are read with.
  expect(typedSurface(coreEntries.anyshape)).toEqual(surface(coreEntries.anyshape, core));
  expect(typedSurface(coreEntries["anyshape/react"])).toEqual(surface(coreEntries["anyshape/react"], react));
});

test("the TypeScript view of each entry includes every runtime export", () => {
  // Guards the split above: a runtime name TypeScript doesn't see would be
  // listed as a value but missing from the types it ships.
  for (const [file, runtime] of [
    [coreEntries.anyshape, core],
    [coreEntries["anyshape/react"], react],
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
