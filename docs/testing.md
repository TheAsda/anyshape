# Testing

How to set up and run the checks, how the tests are organised, the conventions they follow, and the mechanisms that need a mutation check when you change them. The rules for writing a test (through the public interface, red first) are in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Setup and commands

Install the dependencies with `bun install`. The React projects run in a real browser, which each machine installs once: `bunx playwright install chromium`.

Before you open a pull request, run:

- `bun run test`: all four Vitest projects. Each also runs alone: `test:unit`, `test:recipes`, `test:react`, `test:recipes-react`.
- `bun run typecheck`: `tsc` on the source, the recipes and the type-level tests, then `kiira check` on the code samples in `README.md`, `docs/guide/` and `docs/principles.md`. The type-level tests and the samples are checked only here, never under Vitest, so CI runs both commands.

CI also runs these, which you can run by hand:

- `bun run build && bun run check:package` checks the packed tarball: its contents (the shipped docs included), one copy of the core, and consumers with and without React.
- `bun install && bun run build` in `examples/basic` and in `examples/evolution` builds each example against the library's source.

`bun run bench` runs the benchmarks, and `bun run test:memory` the memory checks (see [Benchmarks and memory](#benchmarks-and-memory)).

## Projects

The projects are defined in `vitest.config.ts`:

- `unit`: the core, in Node, with no DOM.
- `recipes`: `recipes/`, in Node, importing the core entry as `anyshape`.
- `react`: the bindings in real Chromium, through Vitest browser mode (Playwright provider) and `vitest-browser-react`.
- `recipes-react`: `recipes/react/`, in real Chromium like `react`, importing the core entries as `anyshape` and `anyshape/react`. Both are aliased to `src/`, so the recipes and the core hooks share one copy of the core.

## Files and layers

Each layer has an ID. A `describe` block is named after the layer it tests (`"F · Rule 3 – array structure channel"`), so keep the IDs when you add a section.

| File | Layer | Area |
|---|---|---|
| `test/shape.test.ts` | A | node instantiation, identity, parents, templates, structural checks |
| `test/lens.test.ts` | B | lens unit tests |
| `test/meta.test.ts` | C | `.meta()`, key definitions, meta refs, closed meta |
| `test/store.test.ts` | D, E, I | stores, scopes, `scopeStore`, `assertInScope`, reference API, own-node meta keys, row identity, array helpers |
| `test/notifications.test.ts` | F | the notification rules, flush |
| `test/origins.test.ts` | G | origins, baselines, reset (recompute and `keepOnReset` included) |
| `test/counts.test.ts` | H | `countIn`, `collect` by definition, aggregate keys |
| `test/behaviors.test.ts` | J–L | behavior runtime, scopes, ordering, writers, replacement, `touched` / `dirty` |
| `test/contributions.test.ts` | L′ | key contributions: `combine`, `contribute`, parts, in-place update, rows, order and duplicates |
| `test/async.test.ts` | J | async runs: cancellation, reruns with their cause, transactional `ctx.state`, kept work, `settle()`, definition traces |
| `test/pending.test.ts` | H | `pendingIn` / `pendingOf` for sync and async runs |
| `test/diagnostics.test.ts` | T | development diagnostics: the probe's events, the flush budget warning, the DevTools tracks, nothing in production or without `process` |
| `recipes/validation.test.ts` | M | rules, queues, async, `validate()` |
| `recipes/rules.test.ts` | N | ready-made rules, messages, reference limits, guarded by a builder block |
| `recipes/behaviors.test.ts` | N | ready-made behaviors, `exclusive`, builder |
| `recipes/features.test.ts` | N | the default behaviors of `touched` and `dirty` |
| `test/paths.test.ts` | O | `resolvePath`, server errors |
| `recipes/submit.test.ts` | O | the submit recipe: `handleSubmit`, guard, `submitting`, reveal, submittable nodes matched by definition |
| `recipes/focus.test.ts` | O | the focus recipe: `registerFocus` (scope, reset, unregister), out-of-scope nodes rejected, `focusFirst` order and skips |
| `test/types.test.ts` | S | the public type contract (asserted by `tsc`) |
| `recipes/types.test.ts` | S | the recipes' type contract (asserted by `tsc`) |
| `test/exports.test.ts` | — | each entry's public names, as a snapshot; the API tables in `docs/guide/agents.md` list exactly those names |
| `test/integration.test.ts` | INT | trip-booking scenarios across all layers |
| `test/react/react.test.tsx` | P | provider, resolution, `useValue`, `useField`, `useArray` |
| `test/react/form.test.tsx` | Q | `useForm`, `useSync` |
| `test/react/behaviors.test.tsx` | R | `useBehaviors` |
| `test/react/integration.test.tsx` | INT | the trip booking rendered |
| `recipes/react/control.test.tsx` | P | `useControl`, `showError`, `focusRef`, adapters |
| `recipes/react/submit.test.tsx` | O | DOM focus order, `handleSubmit` on a real `<form>`, DOM elements beside custom focus handles |

Shared fixtures live in `test/support/fixtures/` (`user`, `limits`, `company`) and `test/support/trip.ts`. The core tests declare their meta keys with the test-local features in `test/support/features.ts` and rules in `test/support/rules.ts`, never with the recipes. The recipe tests have their own copies of the fixtures they share with the core, in `recipes/test/`. The tests don't share code across that boundary, and the lint's boundary rules keep the core's tests from importing `recipes/`, so the copies are deliberate.

## Conventions

- **One file per layer** (the table above). Test titles state the guarantee ("a removed row drops its async result"), not the function under test.
- **Fixtures:**
  - A file's form and `initial()` stay local unless several files need them; then they move to `test/support/fixtures/`.
  - Repeated setup comes from `test.extend` fixtures, such as `store`, `lines` and `recorder` in `test/notifications.test.ts`: `test("…", ({ store: s, lines }) => …)`.
  - Use a fixture only where it removes repetition without hiding the setup the test is about. A test with its own store options creates its store explicitly.
  - A `describe` that uses another file's fixture binds it at the top (`const { shape, L, initial } = company;`) and defines its own `test`.
  - Fixtures and examples keep declarations and key access in plain view: no helper hides which keys a node declares or how a key is reached. Showing that is what an example is for.
- **React tests** (`test/react/*.test.tsx` and `recipes/react/*.test.tsx`, each side with its own copy of `test-utils.tsx`). The core React tests use only the core hooks; a field binding there is `useField` with inline handlers.
  - Render with `render()` from `vitest-browser-react`. It's async, and the tree is cleaned up before each test.
  - Drive inputs through locators and `userEvent` (`fill`, `click`, `keyboard`). These are real browser events, so focus moves and blur fires as they would for a user.
  - Assert the DOM with retrying `await expect.element(locator)`. `toHaveTextContent("…")` is an exact match in Vitest 5; `toMatchTextContent` is the substring and regex form.
  - Wrap writes made from outside React in `settle(fn)` (act) before asserting render counts, especially "nothing re-rendered", where there is no DOM change to wait for.
- **Async and timers:**
  - Control async work with `deferred()` (`test/support/harness.ts`).
  - Let results land with `flush()` from the same file.
  - Test debounce and other delays with `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync`, restoring with `onTestFinished(() => vi.useRealTimers())`.
- **Type-level assertions:** `Expect<Equal<A, B>>` and `// @ts-expect-error` inside the test files. They run under `bun run typecheck`.
- **Known bugs** are pinned with `test.fails` and a comment naming the GitHub issue (`#N`). Switch the test to `test` when the fix lands.
- **Mutation check.** After writing tests for a mechanism, break the mechanism on purpose and confirm that a test fails. The mechanisms to check this way are listed below.

## Mechanisms to mutation-check

When you touch any of these, break it on purpose and confirm that at least one test fails. A change to the run order's indexes (`order.ts`), to registration and disposal (`runtime.ts`) or to the row lifecycle (`store.ts`) also runs `bun run test:memory` by hand: a missed delete there shows up only as a leak.

| Mechanism | Where | Expected to fail |
|---|---|---|
| Unchanged lens write returns the source | `lens.ts` `propLens` / `composeLens` | structural sharing, no-op write |
| New row object re-mapped to the same store | `ArrayStore._replaceItem` | identity through row writes |
| Older row version re-attaches | `ArrayStore._sync` | undo, both-versions tests |
| Rule 4: an attachment change notifies | `BaseStore._visit` (`attachChanged`) | rule 4 tests |
| Per-phase "last seen" | `_seen[phase]` | behaviors-then-listeners tests |
| Own-origin filter | `BehaviorRuntime.onTrigger` | two-way link tests |
| Rank ordering | `RunOrder.plan` (`order.ts`) / `runNext` | dependency order, K1–K3, K6 |
| Host filter of the run order | `HostIndex.near` / `readerOf` (`order.ts`) | K5, "Run order between scope hosts", one writer between rows |
| Index and edge removal on dispose | `HostIndex.delete`, the commit of `RunOrder.plan` (`order.ts`) | collectability (`test:memory`) |
| Buffered writes dropped on error | `BehaviorRuntime.execute` | throwing behavior test |
| Row totals shifted on detach | `ArrayStore.shiftTotals` | count removal tests |
| Reset re-runs init | `BehaviorRuntime.reinit` | reset recompute tests |
| Reuse of a checked async result | the `error` key's owner in `recipes/validation.ts` (`ctx.state.checked`, `ctx.keep`) | reuse and late-result tests |
| Latest-props slots | `delegate` in `react/behaviors.ts` | latest-props tests |

## Benchmarks and memory

- **Benchmarks** (`bun run bench`, `bench/store.bench.ts`): a keystroke in a flat form of 500 fields, an edit in one of 200 rows, appending and removing in a 200-row array, `collect` over 200 rows with one error, row-by-row mounts (contributions, plain behaviors, chained behaviors with disposal), and the development diagnostics overhead on a keystroke and a row edit. The benches create production stores, so they measure the library and not the development tooling; only the diagnostics-overhead group runs in development, on purpose ([PR #60](https://github.com/TheAsda/anyshape/pull/60)). Timings are tracked over time, not asserted, because they are too noisy to fail a build on. A bench asserts the amount of work instead, such as one owner run per row mounted. CI runs the benches on pull requests as an informational job.
- **Memory** (`bun run test:memory`, `bench/rows.memory.ts`): removed rows, their stores and their meta become collectable; so do removed nested rows, a row whose disposed behavior read the whole list, rows whose disposed behaviors were linked to a root behavior that stays, and a dropped store with its rows and behaviors. The heap a store keeps per row with row-by-row chained behaviors is recorded, not asserted: it should stay flat as the rows double. The check uses `WeakRef`s and is too sensitive to the garbage collector for CI, so it runs by hand.
