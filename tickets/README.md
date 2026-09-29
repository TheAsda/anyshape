# Tickets

Bugs, improvements and chores found while building the test suite (see `TESTING_PLAN.md`). One file per ticket; delete the file (or mark it **Done**) when it lands.

| ID | Type | Title | Priority |
|---|---|---|---|
| [001](001-removed-row-async-check-not-aborted.md) | Bug | Removing a row does not abort its async check; `validate()` waits for it | High |
| [002](002-metakey-literal-inference.md) | Improvement | `metaKey(false, { aggregate })` infers the literal type `false` | Low |
| [003](003-whole-array-row-behavior-runs-twice.md) | Optimization | A row behavior triggered by its whole array runs twice per flush | Low |
| [004](004-packaging.md) | Chore | Packaging: build only emits the core entry, no `exports`/`types` | High (before release) |
| [005](005-ci.md) | Chore | CI: run tests and both typechecks on every PR | Medium |
| [006](006-createstore-quadratic-in-feature-behaviors.md) | Optimization | `createStore` is quadratic in the number of registrations (1000 `control()` fields: ~0.5 s) | Medium |
