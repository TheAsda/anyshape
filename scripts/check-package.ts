// ============================================================
// The package check (NF1), on the tarball `npm pack` makes from the current
// build. Run `bun run build` first. It checks:
//   • the tarball holds the entries, their declarations and the shipped docs
//     (every page in docs/guide/), the recipe sources and their policies
//     file, and no core source and no tests;
//   • the core internals are defined once in dist/, and neither the core
//     entry nor `anyshape/recipes` reaches a `react` import;
//   • every shipped declaration file typechecks, and the declarations
//     export the same names as the source entries (stripInternal drops a
//     whole statement after a stray tag);
//   • a consumer without react imports and typechecks the core entry, and
//     runs a form built with `anyshape/recipes` that reports an error and
//     then submits;
//   • a consumer with react typechecks every entry, passes a node created
//     through `anyshape` to an `anyshape/react` hook and to `useControl`
//     from `anyshape/recipes/react`, and renders them;
//   • the recipe sources, copied out of the installed package unchanged,
//     typecheck against it;
//   • a consumer that exports a shape emits its declarations: the node
//     classes are nameable and the internal symbols stay out of them;
//   • publint and @arethetypeswrong/cli pass.
// Runs every check and exits non-zero if any failed; a failing setup step
// (npm pack, npm install, the consumer's emit) stops it at once.
// ============================================================

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The compiler JS API lives in the TypeScript 5 package; the native `typescript`
// 7.x that compiles the workspace does not ship it yet.
import ts from "typescript5";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name: string) => join(root, "node_modules", ".bin", name);

/** Files the tarball must hold. */
const REQUIRED = [
  "package.json",
  "LICENSE",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/react/index.js",
  "dist/react/index.d.ts",
  "dist/recipes/index.js",
  "dist/recipes/index.d.ts",
  "dist/recipes/react/index.js",
  "dist/recipes/react/index.d.ts",
  // The recipe sources a team copies to customize them, and their policies.
  "recipes/POLICIES.md",
  ...recipeSources(),
  // The docs agents read at node_modules/anyshape/…: every guide page in
  // the source tree, so a new page needs no edit here.
  "GLOSSARY.md",
  "docs/principles.md",
  ...readdirSync(join(root, "docs/guide"))
    .filter((f) => f.endsWith(".md"))
    .map((page) => `docs/guide/${page}`),
];
/** Path prefixes the tarball must not hold. */
const FORBIDDEN = ["src/", "test/", "bench/", "recipes/test/", "examples/", "scripts/", ".changeset/"];

const failures: string[] = [];
function check(ok: boolean, message: string): boolean {
  console.log(`${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
  return ok;
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Whether a command succeeds; its output is printed when it doesn't. */
function passes(cmd: string, args: string[], cwd: string): boolean {
  try {
    run(cmd, args, cwd);
    return true;
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    console.log(`${stdout ?? ""}${stderr ?? ""}`.trim());
    return false;
  }
}

const tmp = mkdtempSync(join(tmpdir(), "anyshape-package-"));
try {
  // ---- The tarball ----
  // npm prints an array of packs (older npm) or an object keyed by name (npm 12+).
  const raw = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", tmp], root)) as
    | [{ filename: string; files: { path: string }[] }]
    | Record<string, { filename: string; files: { path: string }[] }>;
  const packed = Array.isArray(raw) ? raw[0] : Object.values(raw)[0];
  const tarball = join(tmp, packed.filename);
  const files = packed.files.map((f) => f.path);
  for (const path of REQUIRED) check(files.includes(path), `the tarball holds ${path}`);
  for (const prefix of FORBIDDEN) {
    check(!files.some((f) => f.startsWith(prefix)), `the tarball holds nothing under ${prefix}`);
  }
  check(!files.some((f) => f.endsWith(".map")), "the tarball holds no sourcemaps");
  check(!files.some((f) => /\.test\.tsx?$/.test(f)), "the tarball holds no test files");

  // ---- A consumer without react ----
  const core = join(tmp, "core");
  writeConsumer(core, {
    "index.ts": `
      import { form, object, field, createStore, type InferValue } from "anyshape";
      const shape = form(object({ name: field<string>() }));
      const initial: InferValue<typeof shape> = { name: "" };
      const store = createStore(shape, initial);
      store.set(shape.name, "Ada");
      const name: string = store.get(shape.name);
      if (name !== "Ada") throw new Error("the store did not keep the value");
    `,
    "recipes.ts": `
      import { form, object, field, createStore } from "anyshape";
      import { control, submitting, required, handleSubmit, type InferChecked } from "anyshape/recipes";

      const shape = form(object({ name: field<string>().meta(control()) }).meta(submitting()));
      const store = createStore(shape, { name: "" }, { behaviors: [required(shape.name)] });
      const submitted: InferChecked<typeof shape>[] = [];
      const submit = handleSubmit(store, (values) => {
        submitted.push(values);
      });

      await submit();
      if (submitted.length !== 0) throw new Error("an invalid form was submitted");
      if (store.get(shape.name.error) !== "Required") throw new Error("the required rule reported no error");
      if (!store.get(shape.name.revealed)) throw new Error("the submit did not reveal the field");
      store.set(shape.name, "Ada");
      await submit();
      if (submitted[0]?.name !== "Ada") throw new Error("the valid form was not submitted: " + JSON.stringify(submitted));
    `,
  });
  run("npm", ["install", "--no-audit", "--no-fund", tarball], core);
  const dist = join(core, "node_modules", "anyshape", "dist");

  const distJs = readdirSync(dist, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".js"));
  const symbols = distJs.flatMap((f) =>
    [...readFileSync(join(dist, f), "utf8").matchAll(/Symbol\("(anyshape\.\w+)"\)/g)].map((m) => m[1]),
  );
  check(symbols.includes("anyshape.fields"), "the core internals are in dist/");
  check(
    new Set(symbols).size === symbols.length,
    `each core internal is defined once in dist/ (${symbols.join(", ")})`,
  );

  const reached = importsFrom(dist, "index.js");
  const reactImports = reached.filter(({ spec }) => /^react($|\/)/.test(spec));
  check(reactImports.length === 0, `the core entry reaches no react import (${reached.length} imports followed)`);
  const reachedByRecipes = importsFrom(dist, "recipes/index.js");
  check(
    !reachedByRecipes.some(({ spec }) => /^react($|\/)/.test(spec)),
    `anyshape/recipes reaches no react import (${reachedByRecipes.length} imports followed)`,
  );

  if (check(passes(bin("tsc"), ["-p", "."], core), "a consumer without react typechecks the core entry")) {
    run(bin("tsc"), ["-p", ".", "--noEmit", "false", "--outDir", "out"], core);
    check(passes("node", ["out/index.js"], core), "a consumer without react runs the core entry");
    check(passes("node", ["out/recipes.js"], core), "a consumer without react runs a form built with the recipes");
  }

  // ---- A consumer with react ----
  const withReact = join(tmp, "react");
  writeConsumer(withReact, {
    "index.tsx": `
      import { form, object, field, createStore } from "anyshape";
      import { StoreProvider, useField, useValue } from "anyshape/react";
      import { renderToString } from "react-dom/server";

      const shape = form(object({ name: field<string>() }));
      const store = createStore(shape, { name: "Ada" });

      function Name() {
        const binding = useField(shape.name);
        const name: string = useValue(shape.name);
        return <input value={binding.value} onChange={(e) => binding.onChange(e.target.value)} title={name} />;
      }

      const html = renderToString(<StoreProvider store={store}><Name /></StoreProvider>);
      if (!html.includes('value="Ada"')) throw new Error("the hook did not read the store: " + html);
    `,
    "recipes.tsx": `
      import { form, object, field, createStore } from "anyshape";
      import { StoreProvider } from "anyshape/react";
      import { control } from "anyshape/recipes";
      import { useControl } from "anyshape/recipes/react";
      import { renderToString } from "react-dom/server";

      const shape = form(object({ name: field<string>().meta(control()) }));
      const store = createStore(shape, { name: "Ada" });

      function Name() {
        const { value, onChange, edited, focusRef } = useControl(shape.name);
        return <input ref={focusRef} value={value} onChange={(e) => onChange(e.target.value)} title={String(edited)} />;
      }

      const html = renderToString(<StoreProvider store={store}><Name /></StoreProvider>);
      if (!html.includes('value="Ada"')) throw new Error("useControl did not read the store: " + html);
    `,
  });
  run(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      tarball,
      "react@19",
      "react-dom@19",
      "@types/react@19",
      "@types/react-dom@19",
    ],
    withReact,
  );
  // Every shipped declaration file, not only those the entries reach: a
  // module's .d.ts must not import a declaration stripInternal dropped.
  writeFileSync(
    join(withReact, "tsconfig.dist.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      include: ["node_modules/anyshape/dist/**/*.d.ts"],
      exclude: [],
    }),
  );
  check(passes(bin("tsc"), ["-p", "tsconfig.dist.json"], withReact), "every shipped declaration file typechecks");
  if (check(passes(bin("tsc"), ["-p", "."], withReact), "a consumer with react typechecks every entry")) {
    run(bin("tsc"), ["-p", ".", "--noEmit", "false", "--outDir", "out"], withReact);
    check(
      passes("node", ["out/index.js"], withReact),
      "a consumer with react renders a hook on a node from the core entry",
    );
    check(
      passes("node", ["out/recipes.js"], withReact),
      "a consumer with react renders useControl from anyshape/recipes/react on a node from the core entry",
    );
  }

  // ---- The recipe sources, copied ----
  // A team that customizes the recipes copies the shipped sources; unchanged,
  // the copy compiles against the installed package.
  const shippedRecipes = join(withReact, "node_modules", "anyshape", "recipes");
  const copied = join(withReact, "copied");
  if (existsSync(shippedRecipes)) cpSync(shippedRecipes, copied, { recursive: true });
  writeFileSync(
    join(withReact, "tsconfig.copy.json"),
    JSON.stringify({ extends: "./tsconfig.json", include: ["copied"] }),
  );
  check(
    existsSync(copied) &&
      readdirSync(copied, { recursive: true, encoding: "utf8" }).some((f) => f.endsWith(".ts")) &&
      passes(bin("tsc"), ["-p", "tsconfig.copy.json"], withReact),
    "the recipe sources, copied out of the installed package, typecheck against it",
  );

  // ---- The declarations against the source ----
  for (const [entry, source, consumer, project] of [
    ["anyshape", "src/index.ts", "index.tsx", root],
    ["anyshape/react", "src/react/index.ts", "index.tsx", root],
    ["anyshape/recipes", "recipes/index.ts", "recipes.tsx", join(root, "recipes")],
    ["anyshape/recipes/react", "recipes/react/index.ts", "recipes.tsx", join(root, "recipes")],
  ]) {
    const shipped = exportNames(join(withReact, consumer), entry, withReact);
    const expected = exportNames(join(root, source), undefined, project);
    check(
      shipped.join() === expected.join(),
      `${entry}'s declarations export the source entry's names (${expected.length})`,
    );
  }

  // ---- A consumer that exports its shapes ----
  // A library built on anyshape exports the shapes `form()` returns, so tsc
  // must be able to name those types (the node classes and the meta
  // references) in the consumer's own declarations.
  const lib = join(tmp, "declarations");
  writeConsumer(lib, {
    "index.ts": `
      import {
        createStore,
        form,
        object,
        field,
        array,
        metaKey,
        pathOf,
        type InferValue,
        type ShapeNode,
      } from "anyshape";

      const required = metaKey(false);

      const line = object({ sku: field<string>().meta({ required }), qty: field<number>() });

      export const booking = form(
        object({
          destination: field<string>(),
          travelers: array(line, { create: () => ({ sku: "", qty: 1 }) }),
        }).meta({ title: "Booking" }),
      );

      export const bookingStore = createStore(booking, { destination: "", travelers: [] });

      export type Booking = InferValue<typeof booking>;
      export const rootPath: string = pathOf(booking);
      export function label(node: ShapeNode<string>): string {
        return pathOf(node);
      }
    `,
  });
  run("npm", ["install", "--no-audit", "--no-fund", tarball], lib);
  writeFileSync(
    join(lib, "tsconfig.emit.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: "types" },
    }),
  );
  if (
    check(passes(bin("tsc"), ["-p", "tsconfig.emit.json"], lib), "an exported shape emits the consumer's declarations")
  ) {
    const emitted = readFileSync(join(lib, "types", "index.d.ts"), "utf8");
    check(/ObjectNode|FieldNode|ArrayNode/.test(emitted), "the emitted declarations name the node classes");
    check(!emitted.includes("dist/internal"), "the emitted declarations reach no internal module");
  }

  // ---- Linters ----
  check(passes(bin("publint"), ["run", "--pack", "npm", "--strict"], root), "publint passes");
  check(attwProblems(tarball).length === 0, "@arethetypeswrong/cli passes (ESM only)");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} package check(s) failed`);
  process.exit(1);
}

/**
 * The problems @arethetypeswrong/cli finds in the tarball for an ESM-only
 * package: its esm-only profile ignores node10 and node16-cjs. The profile
 * filters only problems keyed by `resolutionKind`; an internal resolution
 * error is keyed by `resolutionOption` instead, and node10 hits one in the
 * shipped recipe sources (it resolves `anyshape/recipes` to recipes/index.ts,
 * and can't resolve `anyshape`, which has only `exports`, from there). So
 * the same resolutions are dropped by either key.
 */
function attwProblems(tarball: string): unknown[] {
  const ignored = new Set(["node10", "node16-cjs"]);
  let out: string;
  try {
    out = run(bin("attw"), [tarball, "--format", "json"], root);
  } catch (error) {
    // attw exits non-zero when it finds a problem; the JSON is still printed.
    out = (error as { stdout?: string }).stdout ?? "";
  }
  const { analysis } = JSON.parse(out) as {
    analysis: { problems: { kind: string; resolutionKind?: string; resolutionOption?: string }[] };
  };
  const problems = analysis.problems.filter(
    (p) => !ignored.has(p.resolutionKind ?? "") && !ignored.has(p.resolutionOption ?? ""),
  );
  for (const p of problems) console.log(JSON.stringify(p));
  return problems;
}

/** The recipe sources the tarball ships: every `.ts` file of recipes/ outside its tests. */
function recipeSources(): string[] {
  return readdirSync(join(root, "recipes"), { recursive: true, encoding: "utf8" })
    .map((f) => f.split("\\").join("/"))
    .filter((f) => f.endsWith(".ts") && !f.startsWith("test/"))
    .map((f) => `recipes/${f}`);
}

/** A temporary consumer project: an ES module package, strict, Node resolution, full lib check. */
function writeConsumer(dir: string, sources: Record<string, string>): void {
  mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "es2022",
        module: "nodenext",
        moduleResolution: "nodenext",
        jsx: "react-jsx",
        noEmit: true,
        skipLibCheck: false,
        types: [],
      },
      include: Object.keys(sources),
    }),
  );
  for (const [name, text] of Object.entries(sources)) writeFileSync(join(dir, name), text);
}

/** Every import specifier reached from `file` by following relative imports, with the file it's in. */
function importsFrom(dir: string, file: string, seen = new Set<string>()): { file: string; spec: string }[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const text = readFileSync(join(dir, file), "utf8");
  const specs = [...text.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
  return specs.flatMap((spec) =>
    spec.startsWith(".") ? [{ file, spec }, ...importsFrom(dir, join(dirname(file), spec), seen)] : [{ file, spec }],
  );
}

/**
 * The sorted names a module exports, values and types: `file` itself, or, with
 * `specifier`, the module `file` imports under that name.
 */
function exportNames(file: string, specifier: string | undefined, project: string): string[] {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(project, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    },
  )!;
  const program = ts.createProgram([file], config.options);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file)!;
  const module = specifier
    ? source.statements
        .filter(ts.isImportDeclaration)
        .find((s) => (s.moduleSpecifier as ts.StringLiteral).text === specifier)!.moduleSpecifier
    : source;
  return checker
    .getExportsOfModule(checker.getSymbolAtLocation(module)!)
    .map((s) => s.name)
    .sort();
}
