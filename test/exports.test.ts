// ============================================================
// The public surface of both entries, as a snapshot: adding, removing or
// renaming a public name shows up as a reviewed diff. Values are the names an
// entry exports at runtime; types are the rest of what TypeScript sees.
// ============================================================

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "vitest";
import * as core from "../src/index";
import * as react from "../src/react/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entries = { anyshape: "src/index.ts", "anyshape/react": "src/react/index.ts" };

const program = ts.createProgram(Object.values(entries).map((file) => resolve(root, file)), {
  strict: true,
  jsx: ts.JsxEmit.ReactJSX,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
});
const checker = program.getTypeChecker();

/** Every name an entry exports, values and types alike. */
function exportNames(file: string): string[] {
  const source = program.getSourceFile(resolve(root, file))!;
  return checker.getExportsOfModule(checker.getSymbolAtLocation(source)!).map((s) => s.name);
}

function surface(file: string, runtime: object) {
  const values = Object.keys(runtime).sort();
  const types = exportNames(file).filter((name) => !values.includes(name)).sort();
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
  for (const [file, runtime] of [[entries.anyshape, core], [entries["anyshape/react"], react]] as const) {
    expect(exportNames(file)).toEqual(expect.arrayContaining(Object.keys(runtime)));
  }
});
