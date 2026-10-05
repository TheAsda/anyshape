// ============================================================
// Recipes build only on the core's public interface (AGENTS.md, "Core and
// recipes"): a file under recipes/ imports the core entry (`form-lib`) or
// another file under recipes/, never a core module; a file under
// recipes/react/ may also import the core React entry (`form-lib/react`).
// The core, its tests included, imports no recipe.
// ============================================================

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";

const recipes = dirname(fileURLToPath(import.meta.url));
const reactRecipes = resolve(recipes, "react");
const core = resolve(recipes, "../src");

/** The .ts / .tsx files under `dir`, as absolute paths. */
function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !f.split(/[\\/]/).includes("node_modules"))
    .map((f) => join(dir, f));
}

/** Every module specifier a file imports or re-exports, static or dynamic. */
function specifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

const isRelative = (spec: string) => spec.startsWith(".") || spec.startsWith("/");
const isInside = (dir: string, path: string) => !relative(dir, path).startsWith("..");

/** "file: specifier" for each import of a file under `dir` that `allowed` rejects. */
function violations(dir: string, allowed: (spec: string, file: string) => boolean): string[] {
  return sources(dir).flatMap((file) =>
    specifiers(file)
      .filter((spec) => !allowed(spec, file))
      .map((spec) => `${relative(dir, file)}: ${spec}`)
  );
}

test("a recipe imports only the core entry or another recipe", () => {
  // Packages (vitest, node:*) are not the core; `form-lib/<path>` reaches past
  // the entry, except `form-lib/react` from a React recipe.
  const allowed = (spec: string, file: string) => {
    if (isRelative(spec)) return isInside(recipes, resolve(dirname(file), spec));
    if (spec === "form-lib/react") return isInside(reactRecipes, file);
    return !spec.startsWith("form-lib/");
  };
  expect(violations(recipes, allowed)).toEqual([]);
});

test("the core, its tests included, imports no recipe", () => {
  const allowed = (spec: string, file: string) =>
    !isRelative(spec) || !isInside(recipes, resolve(dirname(file), spec));
  expect(violations(core, allowed)).toEqual([]);
});
