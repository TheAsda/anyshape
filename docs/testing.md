# Testing

How to set up and run the checks, how the tests are organised, the conventions they follow, and the mechanisms that need a mutation check when you change them. The rules for writing a test (through the public interface, red first) are in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Setup and commands

Install the dependencies with `bun install`. The React projects run in a real browser, which each machine installs once: `bunx playwright install chromium`.

Before you open a pull request, run:

- `bun run test`: all four Vitest projects. Each also runs alone: `test:unit`, `test:recipes`, `test:react`, `test:recipes-react`.
- `bun run typecheck`: `tsc` on the source, the recipes and the type-level tests, then `kiira check` on the code samples in `README.md`, `docs/guide/` and `docs/principles.md`. The type-level tests and the samples are checked only here, never under Vitest, so CI runs both commands.
- `bun run lint`: oxlint, configured in `.oxlintrc.json`. Its boundary rules check that recipes and examples import only the entries `anyshape` and `anyshape/react` (and the recipes), and that the core, its tests and benches import no recipe. `bun run lint:fix` applies the fixes oxlint can make.
- `bun run format:check`: oxfmt, configured in `.oxfmtrc.json`, on the code, JSON, YAML and Markdown. `bun run format` rewrites the files.

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

## Where a test goes

The file names and `describe` titles say what each file covers; there is no list to keep up. Place a new test by these rules:

- **Core:** `test/`, in the file named after the area of the core the test covers (`notifications.test.ts`, `counts.test.ts`, `async.test.ts`). In the file, put it under the `describe` for its topic, or add a `describe` named after the topic.
- **A new area** of the core gets its own file, named after it.
- **React bindings:** `test/react/`, by the same rule (`form.test.tsx` covers `useForm` and `useSync`).
- **Recipes:** beside the recipe, in the file named after it (`recipes/submit.ts` is tested in `recipes/submit.test.ts`). A test that needs a real browser, such as DOM focus or a rendered field, goes in `recipes/react/`.
- **The type contract:** `test/types.test.ts` for the core entries, `recipes/types.test.ts` for the recipes. `tsc` asserts them under `bun run typecheck`; Vitest runs the files but checks no types.
- **The public names:** `test/exports.test.ts` keeps each entry's names as a snapshot, and checks that the API tables in `docs/guide/agents.md` list exactly those names. A change to the public interface updates both.
- **Scenarios across the core:** the trip booking (`test/support/trip.ts`) in `test/integration.test.ts`, and rendered in `test/react/integration.test.tsx`.
- **Benchmarks and memory checks:** `bench/` (see [Benchmarks and memory](#benchmarks-and-memory)).

The project that runs a file follows from its folder and extension (see [Projects](#projects)).

Shared fixtures live in `test/support/fixtures/` (`user`, `limits`, `company`) and `test/support/trip.ts`. The core tests declare their meta keys with the test-local features in `test/support/features.ts` and rules in `test/support/rules.ts`, never with the recipes. The recipe tests have their own copies of the fixtures they share with the core, in `recipes/test/`. The tests don't share code across that boundary, and the lint's boundary rules keep the core's tests from importing `recipes/`, so the copies are deliberate.

## Conventions

- **Titles:** a file is named after the area it covers, and a `describe` after the topic it groups. Test titles state the guarantee ("a removed row drops its async result"), not the function under test.
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

The last column names the `describe` blocks and tests that fail, as `grep -n` finds them; `…` stands for the rest of a title.

| Mechanism                                            | Where                                                                                | Expected to fail                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unchanged lens write returns the source              | `lens.ts` `propLens` / `composeLens`                                                 | "propLens.set returns the source…", the "no-op write" tests                                                                                       |
| New row object re-mapped to the same store           | `ArrayStore._replaceItem`                                                            | "writes through an item store preserve identity and meta", "…re-attaches the same store (undo)"                                                   |
| Older row version re-attaches                        | `ArrayStore._sync`                                                                   | "an older version of a row re-attaches to its store", "both versions of a row present…"                                                           |
| Rule 4: an attachment change notifies                | `BaseStore._visit` (`attachChanged`)                                                 | "rule 4: removal fires all subscribers of the detached store once"                                                                                |
| Per-phase "last seen"                                | `BaseStore._seen[phase]`                                                             | "Rule 7 – behaviors, then listeners"                                                                                                              |
| Own-origin filter                                    | `BehaviorRuntime.onInput`                                                            | "a two-way link: own writes do not re-trigger it", "…siblings' writes do not re-trigger it"                                                       |
| Rank ordering                                        | `RunOrder.plan` (`order.ts`) / `runNext`                                             | "Ordering and init", "Ordering edges", "Run order across registration changes"                                                                    |
| Host filter of the run order                         | `HostIndex.near` / `readerOf` (`order.ts`)                                           | "Run order between scope hosts", the "one writer between" tests                                                                                   |
| Index and edge removal on dispose                    | `HostIndex.delete`, the commit of `RunOrder.plan` (`order.ts`)                       | the `test:memory` checks of rows whose behaviors were disposed                                                                                    |
| Buffered writes dropped on error                     | `BehaviorRuntime.execute`                                                            | "a throwing behavior: writes dropped…", "a rejected run or an undeclared access after await…"                                                     |
| Row totals shifted on detach                         | `ArrayStore.shiftTotals`                                                             | the "moves their counts" tests, "count subscriptions fire on changes and row removal"                                                             |
| Reset re-runs init                                   | `BehaviorRuntime.reinit`                                                             | "Reset re-runs behaviors and keeps limits"                                                                                                        |
| Reuse of a checked async result                      | the `error` key's owner in `recipes/validation.ts` (`ctx.state.checked`, `ctx.keep`) | "adding another rule keeps a checked result", "…identical inputs reuse the result", "Async: an unrelated trigger keeps the check in flight (#28)" |
| Default contribution registered                      | `defaultBehaviors` (`runtime.ts`)                                                    | "Default contributions", "`defined`: the Required backstop"                                                                                       |
| A key with `.behavior()` written only by its default | the write check (`runtime.ts`)                                                       | "a key's default behavior is its one writer…", "another key's default behavior may not write…"                                                    |
| Latest-props slots                                   | `delegate` in `react/behaviors.ts`                                                   | "latest props reach run…", "latest props reach rule checks…"                                                                                      |

## Benchmarks and memory

- **Benchmarks** (`bun run bench`, `bench/store.bench.ts`): a keystroke in a flat form of 500 fields, an edit in one of 200 rows, appending and removing in a 200-row array, `collect` over 200 rows with one error, row-by-row mounts (contributions, plain behaviors, chained behaviors with disposal), and the development diagnostics overhead on a keystroke and a row edit. The benches create production stores, so they measure the library and not the development tooling; only the diagnostics-overhead group runs in development, on purpose ([PR #60](https://github.com/TheAsda/anyshape/pull/60)). Timings are tracked over time, not asserted, because they are too noisy to fail a build on. A bench asserts the amount of work instead, such as one owner run per row mounted. CI runs the benches on pull requests as an informational job.
- **Memory** (`bun run test:memory`, `bench/rows.memory.ts`): removed rows, their stores and their meta become collectable; so do removed nested rows, a row whose disposed behavior read the whole list, rows whose disposed behaviors were linked to a root behavior that stays, and a dropped store with its rows and behaviors. The heap a store keeps per row with row-by-row chained behaviors is recorded, not asserted: it should stay flat as the rows double. The check uses `WeakRef`s and is too sensitive to the garbage collector for CI, so it runs by hand.
