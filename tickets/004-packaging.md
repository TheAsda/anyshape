# 004 · Packaging: build only emits the core entry, no `exports`/`types`

**Type:** Chore · **Priority:** High before the first release · **Plan:** NF1

## Problem
- `vite.config.ts` builds only `src/index.ts`; the React bindings (`src/react/index.ts`) are not in `dist/`.
- `package.json` has no `exports`, `main`, `module` or `types`, so consumers cannot import `form-lib` or `form-lib/react`.
- `zod` is a peer dependency but nothing imports it.
- `react`/`react-dom` are required peers even for core-only users (should be optional peers).

## Expected
- Two entries: `form-lib` (core, no `react` import in the bundle) and `form-lib/react`, each with `.d.ts`.
- `exports` map for both, `types` conditions, `sideEffects: false`.
- Drop `zod`; mark `react`/`react-dom` as optional via `peerDependenciesMeta`.

## Check (NF1)
A script that runs `vite build`, then imports `dist/` from a temp project, type-checks a small consumer of both entries, and greps the core bundle for `react`.
