// ============================================================
// The package check (NF1), on the tarball `npm pack` makes from the current
// build. Run `bun run build` first. It checks:
//   • the tarball holds the entries, their declarations and the shipped docs,
//     and no source, tests or recipes;
//   • the core internals are defined once in dist/, and the core entry
//     reaches no `react` import;
//   • every shipped declaration file typechecks, and the declarations
//     export the same names as the source entries (stripInternal drops a
//     whole statement after a stray tag);
//   • a consumer without react imports and typechecks the core entry;
//   • a consumer with react typechecks both entries, passes a node created
//     through `anyshape` to an `anyshape/react` hook, and renders it;
//   • publint and @arethetypeswrong/cli pass.
// Runs every check and exits non-zero if any failed; a failing setup step
// (npm pack, npm install, the consumer's emit) stops it at once.
// ============================================================

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name: string) => join(root, "node_modules", ".bin", name);

/** Files the tarball must hold. */
const REQUIRED = [
  "package.json", "LICENSE",
  "dist/index.js", "dist/index.d.ts", "dist/react/index.js", "dist/react/index.d.ts",
  // The docs agents read at node_modules/anyshape/…: docs/principles.md
  // joins this list when it's written (#84).
  "GLOSSARY.md",
  "docs/guide/README.md", "docs/guide/agents.md",
  ...["shape", "store", "meta-keys", "behaviors", "guards", "arrays", "contributions", "async", "react", "your-side", "writing-a-recipe"]
    .map((page) => `docs/guide/${page}.md`),
];
/** Path prefixes the tarball must not hold. */
const FORBIDDEN = ["src/", "test/", "bench/", "recipes/", "examples/", "scripts/", ".changeset/"];

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
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", tmp], root)) as [
    { filename: string; files: { path: string }[] },
  ];
  const tarball = join(tmp, packed.filename);
  const files = packed.files.map((f) => f.path);
  for (const path of REQUIRED) check(files.includes(path), `the tarball holds ${path}`);
  for (const prefix of FORBIDDEN) {
    check(!files.some((f) => f.startsWith(prefix)), `the tarball holds nothing under ${prefix}`);
  }
  check(!files.some((f) => f.endsWith(".map")), "the tarball holds no sourcemaps");

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
  });
  run("npm", ["install", "--no-audit", "--no-fund", tarball], core);
  const dist = join(core, "node_modules", "anyshape", "dist");

  const distJs = readdirSync(dist, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".js"));
  const symbols = distJs.flatMap((f) => [...readFileSync(join(dist, f), "utf8").matchAll(/Symbol\("(anyshape\.\w+)"\)/g)].map((m) => m[1]));
  check(symbols.includes("anyshape.fields"), "the core internals are in dist/");
  check(new Set(symbols).size === symbols.length, `each core internal is defined once in dist/ (${symbols.join(", ")})`);

  const reached = importsFrom(dist, "index.js");
  const reactImports = reached.filter(({ spec }) => /^react($|\/)/.test(spec));
  check(reactImports.length === 0, `the core entry reaches no react import (${reached.length} imports followed)`);

  if (check(passes(bin("tsc"), ["-p", "."], core), "a consumer without react typechecks the core entry")) {
    run(bin("tsc"), ["-p", ".", "--noEmit", "false", "--outDir", "out"], core);
    check(passes("node", ["out/index.js"], core), "a consumer without react runs the core entry");
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
  });
  run("npm", ["install", "--no-audit", "--no-fund", tarball, "react@19", "react-dom@19", "@types/react@19", "@types/react-dom@19"], withReact);
  // Every shipped declaration file, not only those the entries reach: a
  // module's .d.ts must not import a declaration stripInternal dropped.
  writeFileSync(join(withReact, "tsconfig.dist.json"), JSON.stringify({
    extends: "./tsconfig.json", include: ["node_modules/anyshape/dist/**/*.d.ts"], exclude: [],
  }));
  check(passes(bin("tsc"), ["-p", "tsconfig.dist.json"], withReact), "every shipped declaration file typechecks");
  if (check(passes(bin("tsc"), ["-p", "."], withReact), "a consumer with react typechecks both entries")) {
    run(bin("tsc"), ["-p", ".", "--noEmit", "false", "--outDir", "out"], withReact);
    check(passes("node", ["out/index.js"], withReact), "a consumer with react renders a hook on a node from the core entry");
  }

  // ---- The declarations against the source ----
  for (const [entry, source] of [["anyshape", "src/index.ts"], ["anyshape/react", "src/react/index.ts"]]) {
    const shipped = exportNames(join(withReact, "index.tsx"), entry, withReact);
    const expected = exportNames(join(root, source), undefined, root);
    check(
      shipped.join() === expected.join(),
      `${entry}'s declarations export the source entry's names (${expected.length})`
    );
  }

  // ---- Linters ----
  check(passes(bin("publint"), ["run", "--pack", "npm", "--strict"], root), "publint passes");
  check(passes(bin("attw"), [tarball, "--profile", "esm-only"], root), "@arethetypeswrong/cli passes (ESM only)");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} package check(s) failed`);
  process.exit(1);
}

/** A temporary consumer project: an ES module package, strict, Node resolution, full lib check. */
function writeConsumer(dir: string, sources: Record<string, string>): void {
  mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      strict: true, target: "es2022", module: "nodenext", moduleResolution: "nodenext", jsx: "react-jsx",
      noEmit: true, skipLibCheck: false, types: [],
    },
    include: Object.keys(sources),
  }));
  for (const [name, text] of Object.entries(sources)) writeFileSync(join(dir, name), text);
}

/** Every import specifier reached from `file` by following relative imports, with the file it's in. */
function importsFrom(dir: string, file: string, seen = new Set<string>()): { file: string; spec: string }[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const text = readFileSync(join(dir, file), "utf8");
  const specs = [...text.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
  return specs.flatMap((spec) =>
    spec.startsWith(".")
      ? [{ file, spec }, ...importsFrom(dir, join(dirname(file), spec), seen)]
      : [{ file, spec }]
  );
}

/**
 * The sorted names a module exports, values and types: `file` itself, or, with
 * `specifier`, the module `file` imports under that name.
 */
function exportNames(file: string, specifier: string | undefined, project: string): string[] {
  const config = ts.getParsedCommandLineOfConfigFile(join(project, "tsconfig.json"), {}, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {},
  })!;
  const program = ts.createProgram([file], config.options);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file)!;
  const module = specifier
    ? source.statements
        .filter(ts.isImportDeclaration)
        .find((s) => (s.moduleSpecifier as ts.StringLiteral).text === specifier)!.moduleSpecifier
    : source;
  return checker.getExportsOfModule(checker.getSymbolAtLocation(module)!).map((s) => s.name).sort();
}
