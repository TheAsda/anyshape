# form-lib testing plan

A plan to cover every behavior the library promises, organised by layer, bottom-up (shape → store → logic → React), plus integration, type-level and non-functional tests.

- **Current state:** 447 tests in 29 files, all passing (`npm test`), and a clean typecheck (`npm run typecheck`). The P1 unit, type and integration cases are done (ticked below); `src/lens.test.ts`, `src/types.test.ts` and `src/integration.test.ts` were added for them.
- **This document:** what is already covered, what is missing (a checklist of concrete cases with priorities), and how to write the new tests.

**Priorities**
- **P1**: a core guarantee without a test, or a regression-prone mechanism. Do these first.
- **P2**: a documented behavior or error path without a test.
- **P3**: pinning a known constraint, an edge case, or a non-functional check.

Each case says what to set up, what to assert, and the target test file. IDs (`E2`, `M1`, …) are for tracking in issues and PRs.

---

## 1. How the tests are organised

| File | Layer | Area | Tests |
|---|---|---|---|
| `src/shape.test.ts` | A | node instantiation, identity, parents, templates, structural checks | 7 |
| `src/lens.test.ts` | B | lens unit tests | 8 |
| `src/meta.test.ts` | C | `.meta()`, key definitions, meta refs, closed meta | 21 |
| `src/store.test.ts` | D, E, I | stores, scopes, `scopeStore`, `assertInScope`, reference API, own-node meta keys, row identity, array helpers | 32 |
| `src/notifications.test.ts` | F | the notification rules, flush | 33 |
| `src/origins.test.ts` | G | origins, baselines, reset (incl. recompute and `keepOnReset`) | 21 |
| `src/counts.test.ts` | H | `countIn`, `collect` by definition, aggregate keys | 10 |
| `src/behaviors.test.ts` | J–L | behavior runtime, scopes, ordering, ownership, replacement, touched/dirty | 66 |
| `src/contributions.test.ts` | L′ | key contributions: `combine`, `contribute`, parts, in-place update, rows, order and dedup | 42 |
| `src/async.test.ts` | J | async runs: cancellation, reruns with cause, transactional `ctx.state`, kept work, `settle()`, definition traces | 26 |
| `src/pending.test.ts` | H | `pendingIn` / `pendingOf` for sync and async runs | 6 |
| `src/diagnostics.test.ts` | T | dev diagnostics: the probe's events, the flush budget warning, the DevTools tracks, nothing in production | 19 |
| `recipes/validation.test.ts` | M | rules, queues, async, `validate()` | 36 |
| `recipes/rules.test.ts` | N | ready-made rules, messages, reference limits, guarded by a builder block | 10 |
| `recipes/behaviors.test.ts` | N | ready-made behaviors, `exclusive`, builder | 17 |
| `recipes/features.test.ts` | N | the default behaviors of `touched` and `dirty` | 1 |
| `src/paths.test.ts` | O | `resolvePath`, server errors | 4 |
| `recipes/submit.test.ts` | O | the submit recipe: `handleSubmit`, guard, `submitting`, reveal, submittable nodes matched by definition | 10 |
| `recipes/focus.test.ts` | O | the focus recipe: `registerFocus` (scope, reset, unregister), out-of-scope nodes rejected, `focusFirst` order and skips | 8 |
| `src/types.test.ts` | S | the public type contract (asserted by `tsc`) | 1 |
| `recipes/types.test.ts` | S | the recipes' type contract (asserted by `tsc`) | 1 |
| `recipes/imports.test.ts` | — | recipes import only the core entries; the core imports no recipe | 2 |
| `src/integration.test.ts` | INT | trip-booking scenarios across all layers | 8 |
| `src/react/react.test.tsx` | P | provider, resolution, `useValue`, `useField`, `useArray` | 12 |
| `src/react/form.test.tsx` | Q | `useForm`, `useSync` | 10 |
| `src/react/behaviors.test.tsx` | R | `useBehaviors` | 13 |
| `src/react/integration.test.tsx` | INT | the trip booking rendered | 1 |
| `recipes/react/control.test.tsx` | P | `useControl`, `showError`, `focusRef`, adapters | 7 |
| `recipes/react/submit.test.tsx` | O | DOM focus order, `handleSubmit` on a real `<form>`, DOM elements beside custom focus handles | 3 |

Shared fixtures live in `src/test/fixtures/` (`user`, `limits`, `company`, `account`) and `src/test/trip.ts`. The core tests declare their meta keys with the test-local features in `src/test/features.ts` and rules in `src/test/rules.ts`, never with the recipes. The recipe tests have their own copies of the fixtures they share with the core, in `recipes/test/`.

**Conventions (keep them):**
- **Projects** (`vitest.config.ts`):
  - `unit`: the core, in Node, with no DOM.
  - `recipes`: `recipes/`, in Node, importing the core entry as `form-lib`.
  - `react`: the bindings in real Chromium, through Vitest browser mode (Playwright provider) and `vitest-browser-react`.
  - `recipes-react`: `recipes/react/`, in real Chromium like `react`, importing the core entries as `form-lib` and `form-lib/react` (both aliased to `src/`, so recipes and core hooks share one core copy).
  - Commands: `bun run test` runs all four; also `test:unit`, `test:react`, `test:recipes`, `test:recipes-react`, `bench` (NF3), `test:memory` (NF4).
  - First run on a machine: `bunx playwright install chromium`.
- **Structure:** one file per layer (table above). Inside a file, a `describe` per section, named with the layer ID (`"F · Rule 3 – array structure channel"`). Test titles state the guarantee ("a removed row drops its async result"), not the function.
- **Fixtures:**
  - A file's form and `initial()` stay local unless several files need them; then they live in `src/test/fixtures/`.
  - Repeated setup comes from `test.extend` builder fixtures: `store`, `lines`, `recorder`, `lookup`, e.g. `test("…", ({ store: s, lines }) => …)`.
  - Use a fixture only where it removes repetition without hiding the setup the test is about. A test with its own store options creates its store explicitly.
  - A `describe` that uses another file's fixture binds it at the top (`const { shape, L, initial } = company;`) and defines its own `test`.
- **React tests** (`src/react/*.test.tsx` and `recipes/react/*.test.tsx`, each with its own copy of `test-utils.tsx`). The core React tests use only the core hooks; a field binding there is `useField` with inline handlers:
  - Render with `render()` from `vitest-browser-react`; it's async and cleaned up before each test.
  - Drive inputs through locators and `userEvent` (`fill`, `click`, `keyboard`); these are real browser events, so focus moves and blur fires as with a user.
  - Assert DOM with retrying `await expect.element(locator)`. `toHaveTextContent("…")` is an exact match in Vitest 5; `toMatchTextContent` is the substring/regex form.
  - Wrap writes from outside React in `settle(fn)` (act) before render-count assertions, especially "nothing re-rendered", where there is no DOM change to wait for.
- **Async and timers:**
  - Control async rules with `deferred()` / the `lookup` fixture.
  - Let results land with `flush()` (`src/test/harness.ts`).
  - Test debounce and other delays with `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`, restoring with `onTestFinished(() => vi.useRealTimers())`.
- **Type-level assertions:** `Expect<Equal<A, B>>` and `// @ts-expect-error` inside the test files. They run under `bun run typecheck`, not under vitest, so **CI must run both**.
- **Known bugs** are pinned with `test.fails` and a comment naming the GitHub issue (`#N`). Switch the test to `test` when the fix lands.
- **Mutation check.** After writing tests for a mechanism, break the mechanism on purpose and confirm that a test fails. The mechanisms to check this way are listed in §5.

---

## 2. Coverage by layer

Each area lists what's covered (briefly, so you know where to look) and the cases to add.

### A. Shape & instantiation (`shape.ts`)
**Covered:** parent links, reused shapes get distinct nodes, item template lenses, reserved field names, primitive arrays rejected, `.meta()` after `form()` rejected, `create` kept and must be a function.

- [x] **A1 · P2** Reused shape *containing an array*, used twice: each copy has its own `item` template, unique ids at every level, and paths like `a.items[].x` and `b.items[].x`. → `shape.test.ts`
- [x] **A2 · P2** Table-driven: `object()` rejects every name in `NODE_INTERNALS` (`id`, `lens`, `path`, `parent`, `meta`, `constructor`, `_type`, `_hasCreate`). Same for meta keys, plus `item`. Node internals are symbol-keyed, so `_fields`, `_meta` and `_metaDefs` are ordinary names; a meta key that matches a child throws. → `meta.test.ts`
- [x] **A3 · P2** A `create` factory that returns the same object every time still gives distinct rows: `append` copies the factory result (`{ ...create(), ...partial }`) and never writes the factory's object. → `store.test.ts`
- [x] **A4 · P3** Paths through nested arrays: `outer[].inner[].field`, and `MetaRef.path` for root keys (`#submitting`) and row keys (`travelers[].passport#error`). → `meta.test.ts`

### B. Lenses (`lens.ts`)
**Covered:** only indirectly, through stores (structural sharing, no-op writes).

- [x] **B1 · P1** Direct unit tests in a new `src/lens.test.ts`:
  - `propLens.get` on a `null`/`undefined` parent returns `undefined`;
  - `set` uses `Object.is` (`NaN` → `NaN` returns the source; `+0` → `-0` does not);
  - `composeLens` returns the *outer source* when the inner write is a no-op, at every depth;
  - `identityLens` short-circuits composition;
  - a changed write copies only the path to the leaf (siblings keep their references).

### C. Meta declarations & references (`meta.ts`, `shape.ts`)
**Covered:** defaults, capabilities kept, variadic and chained `.meta()`, `MetaBuilder`, override rules, reserved keys, refs on instantiated / reused / row / container / root nodes, child field wins, only declared keys have refs.

- [x] **C1 · P2** `MetaBuilder.custom(key, value)`: types and `build()` output; chaining several builder calls. → `meta.test.ts`
- [x] **C2 · P2** A meta write with `{ as: "initial" }` throws "applies to values only". → `origins.test.ts`
- [x] **C3 · P2** `store.set(initialOf(node), v)` throws "Initial values are written with { as: \"initial\" }"; confirm that `set(countIn(…))` throws "Counts are read-only" (assert the message, not only that it throws). → `origins.test.ts`

### D. Store structure & scopes (`store.ts`)
**Covered:** get/set through root, structural sharing, same-value no-op, cached substores, focus checks, root can't reach rows, meta owner seeding, object substore inside an item.

- [x] **D1 · P2** Meta delegation: a deep node's key read through `root` and through `root.substore(section)` is one value; a write through one is visible through the other. → `store.test.ts`
- [x] **D2 · P2** `substore(fieldNode)` throws "needs an object or array node". → `store.test.ts`
- [x] **D3 · P3** A node from another form, or an uninstantiated description, is rejected by `get`/`set`/`substore` with "is not part of the store". → `store.test.ts`
- [x] **D4 · P2** `assertInScope(node)` is public, with the messages `get` uses: another form's node, a row node through the root store, a node outside a substore throw; in-scope nodes and a node inside a row, through the row's store, pass. → `store.test.ts`

### E. Row identity & array helpers (`ArrayStore`, `ItemStore`)
**Covered:** stable ids, identity preserved through row writes, isolated per-row meta, reorder, outside replace = new store, detached reads/writes, nested arrays, `append`/`insert`/`remove`/`move`, complete items without `create`, origins passed through, undo re-attach, both versions present.

- [x] **E1 · P1** Error paths:
  - `item(ref)` with an object not in the array throws;
  - `itemAt(-1)` and `itemAt(length)` throw `RangeError`;
  - `insert(length + 1, …)` throws;
  - `move(row, outOfRange)` throws;
  - `remove`/`move` with a row from *another* array throws "does not belong";
  - `remove` of a detached row throws "is detached".

  → `store.test.ts`
- [x] **E2 · P1** Regression: `append()`/`insert()` return the right row store **when a behavior edits the new row in the same flush** (e.g. a row-scoped `calculate` with `runOn.init`). → `behaviors.test.ts`
- [x] **E3 · P3** A write through a row store that would make the array contain the same object twice is rejected by `_replaceItem`. → `store.test.ts`

### F. Notifications & flush (the 8 rules)
**Covered:** every rule has at least one test; cycles hit the 100-round limit; listeners can't write; unsubscribe mid-flush.

- [x] **F1 · P1** A **listener that throws**: the other listeners of the same flush are still called, the first error is rethrown from the write, and the next flush is consistent. → `notifications.test.ts`
- [x] **F2 · P1** A **reaction that throws**: the error propagates out of `set()`, listeners are not called for that flush, and the next write notifies the listeners with the settled state (subscriptions caught up). → `notifications.test.ts`
- ~~**F3 · P2** Store-wide `subscribe(l)` on views~~: the store-wide subscription was removed (#93); code that wants every value change subscribes to the root node.
- [x] **F4 · P3** `subscribeItems` fires when the array is replaced from outside with the *same length but new objects*. → `notifications.test.ts`
- [x] **F5 · P3** Flat-form constraint: with 300 fields on the root, one write calls only the changed field's listener (pin the "no extra listener calls" guarantee; cost is covered in §4). → `notifications.test.ts`

### G. Origins, baselines & reset
**Covered:** origins in reactions, per target, across scopes, per row; `initialOf` and `{ as: "initial" }`; per-row baselines, new rows `{}`, a baseline write on the array; reset of root and of one row; `keepOnReset`; reset re-validation and recompute.

- [x] **G1 · P2** `reset(sectionNode)` on an object subtree (not root, not row): only that subtree's values and meta are reset; `reinit` re-runs only instances that write inside it; a behavior writing outside the section is not re-run. → `origins.test.ts`
- [x] **G2 · P2** `set(root, values, { as: "initial" })` while rows exist: rows whose objects are in the new baseline take them as their initial value; rows added before that and not present keep `{}`. → `origins.test.ts`
- [x] **G3 · P3** Reset uses origin `"initial"`: a behavior sees `{"initial"}`, and `touched` does not flip. → `origins.test.ts`

### H. Counts & collect
**Covered:** counts across fields/objects/rows, rows removed and restored, count subscriptions, `collect` with row indexes, warning for non-countable keys, `aggregate(default)` must be false, stable `countIn` refs.

- [x] **H1 · P2** A `CountRef` as a **behavior trigger** (re-runs when the count changes, including on row removal) and as a **rule limit** (`max(node, countIn(…))`). → `behaviors.test.ts`, `recipes/rules.test.ts`
- [x] **H2 · P3** `collect` called on a row store (paths still from the root, only that row's entries); nested rows `a[1].b[0].c`. → `counts.test.ts`
- [x] **H3 · P3** A custom counted key (`metaKey(…, { aggregate })`) written by application code updates counts like built-in keys. → `counts.test.ts`

### I. Own-node meta keys
**Covered:** a key belongs to the node that declares it; the core computes no value from ancestors (#90). A hidden or disabled group is handled explicitly: rules guarded on its ref, `<fieldset disabled>`, or a behavior that writes the child's key.

- [x] **I1 · P2** A meta key that an ancestor also declares (`visible`, `disabled`) reads and notifies on its own node only: an ancestor's write changes neither its value nor its subscribers, across a row boundary too. → `store.test.ts`

### J. Behavior registration checks
**Covered:** undeclared reads and writes, async reported, one writer (a default behavior included; a key without one is free for a behavior), cycles (nothing registered), scope rules, template vs row writers, root registration applies to future rows, "not part of this form".

- [x] **J1 · P1** A custom feature whose default `behavior` references another node is rejected: "default behaviors may only use their own node". → `behaviors.test.ts`
- [x] **J2 · P2** Writing a `CountRef` or `InitialRef` is rejected: "only values and meta keys are writable". → `behaviors.test.ts`
- [x] **J3 · P2** `addBehavior` on a detached row throws "Cannot add behaviors to a detached row". → `behaviors.test.ts`
- [x] **J4 · P3** `replaceBehavior` with a handle from another store / runtime throws; with an already-disposed handle throws. → `behaviors.test.ts`

### K. Ordering & ownership
**Covered:** dependency order on init and on change, an enclosing-scope trigger re-runs every row, own writes don't re-trigger (`link`), nor do siblings' writes of the same behavior, one writer, opposite `when/otherwise` branches may share a target.

- [x] **K1 · P2** **Container edge:** a row behavior writing a row field runs before a root behavior that triggers on the whole array (assert run order with a log, not only final values). → `behaviors.test.ts`
- [x] **K3 · P2** Ranks are recomputed after dispose: removing a middle behavior of a chain keeps the remaining order correct. → `behaviors.test.ts`
- [x] **K4 · P3** A row behavior triggered by its whole array runs once per row: siblings' writes don't re-trigger it (sync) or cancel its runs in flight (async, one `settle()` round), and a change that mixes them with another origin still runs it (#3). → `behaviors.test.ts`, `async.test.ts`
- [x] **K5 · P3** Sibling rows don't order each other through their own scopes (#63): two component behaviors on different rows that would form a cycle only through each row's own fields both register, each row running its own, and the same for nested rows. A row's read of an enclosing scope (the whole list) is still ordered after a sibling row's writer, and sibling rows that each write from the whole list form a cycle; a row and the hosts enclosing or inside it are ordered both ways, through nested rows, and a cycle through them is rejected with the same message. → `behaviors.test.ts`
- [x] **K6 · P2** Ranks follow each registration change, reranking only what it reaches (#6): a behavior added upstream raises the whole chain; disposing one lowers its dependents, to their next longest chain; a replacement is checked for cycles without the registration it replaces, and a rejected one keeps the previous place; a contribution's trigger moves its owner after the trigger's writer, and its removal moves it back. → `behaviors.test.ts`

### L. Runtime lifecycle
**Covered:** init runs, `runOn.init`, `ctx.state`, `ctx.origins`, `when` skip, throwing behaviors isolated (writes dropped, concrete scope), row instances pause/resume, nested rows, row-level `addBehavior`/dispose.

- [x] **L1 · P2** `ctx.changed(ref)` is `false` on the init run and `true` only for triggers that changed since the last run. → `behaviors.test.ts`
- [x] **L2 · P2** Within one run: two `ctx.set` calls to the same target → the last one wins; `ctx.get` sees the pending write. → `behaviors.test.ts`
- [x] **L3 · P2** `ctx.initial(node)` without `initialOf(node)` declared throws the undeclared-read error. → `behaviors.test.ts`
- [x] **L4 · P3** The default `onError` logs `[form] "<name>" failed at "<scope>"` via `console.error` (spy). → `behaviors.test.ts`

### L′. Key contributions (`combine`, `contribute`)
**Covered** in `contributions.test.ts` on test-local keys: registration checks (no `combine`, `combine`/`behavior` exclusive, owner-only writes even before an owner exists, refs in the target's scope chain, same form, target inside the store), `combine` once per node, parts (order, absent when the guard fails, triggers vs reads, `inputs`), in-place update (keeps `ctx.state`, rewires triggers, the last removal resets the key), atomic calls (a failing check changes nothing, one flush, `replaceBehavior` in one update), rows (row-local contributions, the default without running the owner, new rows get merged declarations), order by call and position (#25), dedup in both orders, builder guards, and async (rerun with the cancelled run's cause, kept work survives the update). Types in `types.test.ts`; `useBehaviors` in `react/behaviors.test.tsx` (R1).

### M. Validation
**Covered:** queue order, feature required, guards, cross-field, rows, whole-array reads, runs after computing behaviors, hidden/disabled, row-scoped rules, removing the last rule, async (user start, unchecked, not while sync fails, debounce, abort, removed row, hidden abort, `origins: "any"`, throwing, result reuse), `validate()` errors.

- [x] **M1 · P1** **Array-level rules** (works today, untested): `array(…).meta(validation())` with `rule(arrayNode, (rows) => rows.length === 0 ? "…" : undefined)`. Assert:
  - the error appears and clears as rows are added and removed;
  - it counts in `countIn(root, "error")`;
  - `validate()` lists it with path `"travelers"`;
  - it's skipped when the array is hidden.

  If `minItems`/`maxItems` rules are added, test them here. → `validation.test.ts`
- [x] **M2 · P2** An async rule with `triggers`/`reads`: a change of a read value makes `validate()` re-check (no stale reuse); identical inputs reuse the result. Guards on async rules: a false guard clears the error and aborts. → `validation.test.ts`
- [x] **M3 · P2** A server error written by application code (`resolvePath(…#error)` + `set`) stays until the field's next validation run, and is replaced by it on a user edit. → `validation.test.ts`
- [x] **M4 · P2** `validate()` called on a row store and on an object substore: only that part's queues and errors. → `validation.test.ts`
- [x] **M5 · P3** `validate()` while a debounced check is pending on a row that is then removed resolves (doesn't hang) and doesn't list the row. → `validation.test.ts`

### N. Ready-made rules, behaviors & builder
**Covered:** `isEmpty`, `labelOf`, `required` (switchable through a guard on a `required` key), format rules on empty values, `calculate` (a user edit is overwritten, rows), `link`, `visibleWhen`/`disableWhen`, `clearWhen` (to the initial value, edits reset while the test holds), `exclusive` (incl. several filled, required, omitted values), builder `when/otherwise`, shared targets, nested guards, `each`, fragments, output to `addBehavior`.

- [x] **N1 · P2** Messages as functions (`message: (v) => …`), and `exclusive`'s custom `message.tooMany` / `message.missing`; `exclusive`'s default text uses `labelOf` (the last path segment). → `recipes/rules.test.ts`
- [x] **N2 · P2** `exclusive([one])` throws "needs at least two fields"; `clearWhen` takes its condition as explicit refs (`[s.car.visible]`). → `recipes/behaviors.test.ts`
- [x] **N3 · P2** `link`: when both sides change in the same batch (loading data), nothing is written. → `recipes/behaviors.test.ts`
- [x] **N4 · P2** A builder block guards a rule and a behavior (`b.when([...], test, (b) => b.add(required(…), calculate(…)))`): absent while false, run when it turns true. → `recipes/rules.test.ts`
- [x] **N5 · P3** Type-level: `pattern`/`email` reject non-string nodes, `min`/`max` reject non-number nodes, `minLength` accepts arrays. → see §S

### O. Submit, focus, paths
**Covered:** `resolvePath` (fields, rows, nested, meta, unknown, from a row store), server errors. The recipes: `handleSubmit` (`preventDefault`, no event, `formData` is the store's value, `submitting` and its reset when `fn` throws, reveal scope, focus on invalid, the per-store guard, independent submittable nodes, a non-submittable store rejected), `registerFocus` (found from any store in the scope, kept by reset, per row, unregistering only its own target), `focusFirst` order (DOM order, ties in the entries' order), skipped entries, `focus()` then `scrollIntoView()`, DOM order in a real browser.

- [x] **O1 · P2** `focusFirst` returns `undefined` without a target, and calls `focus()` then `scrollIntoView()` when present. → `recipes/focus.test.ts`
- [x] **O2 · P2** `focusFirst` skips entries whose row store is detached. → `recipes/focus.test.ts`
- [x] **O3 · P2** `handleSubmit` rejects a store whose own node doesn't declare `submission()`, at compile time and at run time. → `recipes/submit.test.ts`
- [x] **O4 · P3** `handleSubmit(store, fn)()` called without an event. → `recipes/submit.test.ts`
- [x] **O5 · P2** `registerFocus` throws for a node the store does not address: a row node through the root store, a node of another form. → `recipes/focus.test.ts`

### P. React bindings (`react/hooks.ts`, `recipes/react/`)
**Covered:** `useValue` (values, meta, counts; re-render isolation; selector), per-reference subscriptions, row/object/explicit-store resolution, resolution errors, `useField`, `useArray` (re-render on structure only, nested arrays). In the recipes: `useControl` (state, user writes, `onBlur` reveal, `showError` once revealed and not pending), `focusRef`, adapters (real events, caching).

- [x] **P1 · P1** `useControl().onBlur` fired **after its row was removed** (blur during unmount) doesn't throw and writes nothing. → `recipes/react/control.test.tsx`
- [x] **P2 · P2** Two inputs registered through `focusRef` for the same field: unmounting one does not clear the other's registration. → `recipes/react/control.test.tsx`
- [x] **P3 · P2** `useValue(ref, select, { equals })` with a custom `equals`; `useValue` with `{ store }` plus a selector. → `react/react.test.tsx`
- [x] **P4 · P2** `useArray` helpers write with origin `"user"` by default (assert via a behavior's `ctx.origins`) and respect an explicit `{ origin }`; `insert` and `move` through the hook. → `react/react.test.tsx`
- [x] **P5 · P3** `useField` on a node with no meta: `meta` is `{}`, `onChange` writes as the user. → `react/react.test.tsx`

### Q. Lifetime & outside data (`react/form.ts`)
**Covered:** `useForm` once, behaviors passed, shape warning, `values` as baseline (same object keeps edits, a new object reloads, first-render values), `useSync` (limit from React, survives reset, writes on change only, warning, kept after unmount, StrictMode). (DOM focus order and `handleSubmit` on a real form moved to `recipes/react/submit.test.tsx`.)

- [x] **Q1 · P2** `useSync` on a **value node** writes it, and the value stays after unmount. → `react/form.test.tsx`
- [x] **Q2 · P2** `useSync` under a row provider writes that row's key; after the row is removed, it neither writes nor throws. → `react/form.test.tsx`
- [x] **Q3 · P3** Pin the documented caveat: a new `values` object with identical data replaces the user's edits. → `react/form.test.tsx`

### R. Behaviors in components (`react/behaviors.ts`)
**Covered:** mount/unmount timing, row scoping, deps-driven atomic swap, latest props in `run`/checks/guards/contribution payloads, declarations changing without deps (warning), builder features, StrictMode, duplicates with the "declare it once" hint, store change moves the registration, explicit `{ store }`.

- [x] **R1 · P2** Contributions from a component keep their place in `ctx.parts` across a deps change, and the latest payload is used without re-registering. → `react/behaviors.test.tsx`
- [x] **R2 · P2** A deps change whose new registration fails a check (e.g. a new writer conflict) keeps the old registration active and surfaces the error with the hint. → `react/behaviors.test.tsx`

### S. Type-level tests
Type assertions are spread across the files today. Collect the public-API type contract in one place: **new `src/types.test.ts`** (checked by `npm run typecheck`).

- [x] **S1 · P1** `InferValue` for nested objects, reused shapes and arrays of arrays; `InferMeta` merging variadic `.meta()`, features and `metaKey`.
- [x] **S1 (cont.)** `RefValue` for each reference kind: node, `MetaRef`, `CountRef` → `number`, `InitialRef`.
- [x] **S1 (cont.)** `MetaPatch` on a node without meta accepts nothing.
- [x] **S1 (cont.)** `NewItemArgs`: partial with `create`, complete without.
- [x] **S1 (cont.)** `SubmitValue`: exactly the nodes declaring `visible`/`disabled` are optional.
- [x] **S2 · P1** Negative cases (`@ts-expect-error`):
  - `required`/`rule` on a node without `validation()`;
  - `min` on a string;
  - `pattern` on a number;
  - `visibleWhen` without `visible`;
  - `exclusive` without `disabled`;
  - `fromInput` with a number `onChange`;
  - `useControl` on a node without `control()`;
  - a ref to an undeclared key (`node.nope`), or `new MetaRef(…)`;
  - `handleSubmit` on a store whose node has no `submission()`;
  - `set` on a `CountRef`.

### T. Diagnostics, dev only (`diagnostics.ts`, the probe in `store.ts`)
Time comes from a stubbed `performance.now` that the test's reactions, listeners and behaviors advance; `console.timeStamp` and `performance.measure` are stubbed. **`src/diagnostics.test.ts`**.

- [x] **T1 · P2** The probe reports the flush phases, each synchronous run part (sync, async until `run()` returns, applying an async run's writes), the end of each run in flight (completed or cancelled), and each registration change before the flush that runs it, with the owners it changed; disposing a handle that registered nothing is none.
- [x] **T2 · P2** A flush over `1000 / 30` ms warns once: total, behaviors vs listeners, the three slowest behaviors over their instances, added up by name (a behavior registered row by row counts once), each with an error located where it was defined. An async run counts its synchronous part and applying its writes, not its time in flight.
- [x] **T3 · P2** DevTools tracks in the `form-lib` group: `flush` (each flush, its behavior runs and listeners nested in it), `behaviors`, `async` (cancelled runs marked; `settle()` while it waits), `registration` (owner listing, at most 20 contributions). An over-budget flush is an `error` entry. Without either API nothing breaks.
- [x] **T4 · P2** In production nothing is measured: no clock reads, no warning, no entries. Checked once by hand, not in CI: `cd examples/basic && bunx vite build`, then the bundle contains none of `diagnostics.ts` (no `track-entry`, `over budget` or `A flush took`), only the `_probe == null` call sites.

---

## 3. Integration scenarios

The unit suites test each mechanism in isolation. Add **`src/integration.test.ts`** with one realistic form exercising the layers together: a trip booking with contact, reused `person`, travelers rows with a per-row computed `isAdult`, dates → nights → price → total with a budget rule, `seats` limited by a synced `seatsLeft`, a visa section shown for some destinations with `clearWhen`, and promo/voucher `exclusive`. (A verified version of this form exists from the architecture deck work; it can seed the file.)

- [x] **INT1 · P1** Load a saved booking with `{ as: "initial" }`: nothing dirty or touched, sync errors present, async rules unchecked, `validate()` runs them.
- [x] **INT2 · P1** A user edit of `returnDate` updates nights → price → total → budget error, **each behavior running exactly once** (count runs with named behaviors).
- [x] **INT3 · P1** Switching the destination shows the visa section (required errors appear); switching back hides it, and clears its values and errors.
- [x] **INT4 · P1** Travelers: append (new row dirty, `isAdult` computed before any UI notification), edit a middle row, remove the first, undo. Assert row identity, per-row meta, counts and `stableId`s throughout.
- [x] **INT5 · P1** `seatsLeft` below the number of travelers: an error appears; `reset()` keeps `seatsLeft` (`keepOnReset`) and recomputes the error.
- [x] **INT6 · P2** Loaded data with both promo and voucher: both enabled, both in error; clearing one disables the other and clears both errors.
- [x] **INT7 · P2** `validate()` on the whole form waits for pending passport checks; a server rejection maps `travelers[1].passport` via `resolvePath` onto the right row.
- [x] **INT8 · P2** `validate()` on a step section lists only that section's errors, each with the error's `MetaRef`.
- [x] **INT9 · P2** React: render the whole booking (provider, traveler rows, a field with `useBehaviors` under a row provider); a keystroke in one traveler re-renders only that traveler's field and any counter whose value changed.

---

## 4. Non-functional checks

| ID | Pri | Check | How |
|---|---|---|---|
| **NF1** | P1 | **Packaging:** the build emits both entries (`form-lib`, `form-lib/react`) with `.d.ts`; `package.json` `exports` resolve both; the core bundle contains no `react` import. | After fixing `vite.config.ts` (it builds only `src/index.ts`) and adding `exports`/`types`: a script that runs `vite build`, then imports `dist/` from a temp project and type-checks a small consumer. |
| **NF2** | P2 | **CI gates:** `npm test`, `npm run typecheck`, and `cd examples/basic && npm run typecheck`. | CI workflow. The type-level tests only run under `tsc`. |
| **NF3** ✅ | P3 | **Performance baselines:** keystroke in a flat form (500 fields); an edit in one of 200 rows; append/remove in a 200-row array; `collect` over 200 rows with 1 error; mounts row by row (contributions, plain behaviors, chained behaviors with disposal); the dev diagnostics overhead on a keystroke and a row edit (#17). The benches run in dev, so they include the diagnostics. | `vitest bench` in `src/bench/*.bench.ts`; track numbers over time rather than asserting hard limits. **Done:** `npm run bench` (`src/bench/store.bench.ts`); found #6. |
| **NF4** ✅ | P3 | **Memory:** removed rows (and their stores/meta) become collectable; so do removed nested rows, a row whose disposed behavior read the whole list, rows whose disposed behaviors were linked to a root behavior that stays, and a dropped store with its rows and behaviors (#63). The heap a store keeps per row with row-by-row chained behaviors is recorded, not asserted: it should stay flat as the rows double (before #63 it grew 27 → 37 → 58 KB per row at 200/400/800 rows). | Optional script with `node --expose-gc` and a `FinalizationRegistry`; run manually, since it's too flaky for CI. **Done:** `npm run test:memory` (`src/bench/rows.memory.ts`, `vitest.memory.config.ts`), WeakRef-based. |
| **NF5** | P3 | **Mutation testing:** automate the "break it on purpose" habit (§5). | Try Stryker on `src/` (excluding `react/`); start with `lens.ts`, `store.ts`, `behaviors.ts`. |

---

## 5. Mechanisms to mutation-check

When touching any of these, break it deliberately and confirm that at least one test fails. A change to the run order's indexes (`order.ts`), registration and disposal (`behaviors.ts`) or the row lifecycle (`store.ts`) also runs `bun run test:memory` by hand: a missed delete there shows only as a leak.

| Mechanism | Where | Expected to fail |
|---|---|---|
| Unchanged lens write returns the source | `lens.ts` `propLens`/`composeLens` | structural sharing, no-op write, B1 |
| New row object re-mapped to the same store | `ArrayStore._replaceItem` | identity through row writes |
| Older row version re-attaches | `ArrayStore._sync` | undo / both-versions tests |
| Rule 4: attachment change notifies | `BaseStore._visit` (`attachChanged`) | rule 4 tests |
| Per-phase "last seen" | `_seen[phase]` | behaviors-then-listeners tests |
| Own-origin filter | `BehaviorRuntime.onTrigger` | `link` tests |
| Rank ordering | `RunOrder.plan` (`order.ts`) / `runNext` | dependency order, K1–K3, K6 |
| Host filter of the run order | `HostIndex.near` / `readerOf` (`order.ts`) | K5, "Run order between scope hosts", one writer between rows |
| Index and edge removal on dispose | `HostIndex.delete`, `RunOrder.plan`'s commit (`order.ts`) | NF4 collectability (`test:memory`) |
| Buffered writes dropped on error | `BehaviorRuntime.execute` | throwing behavior test |
| Row totals shifted on detach | `ArrayStore.shiftTotals` | count removal tests |
| Reset re-runs init | `BehaviorRuntime.reinit` | reset recompute tests |
| Async result reuse and generations | `ValidationLayer.evaluate` / `startAsync` | reuse and late-result tests |
| Latest-props slots | `react/behaviors.ts` effect 3 | latest-props tests |

---

## 6. Suggested order of work

1. **P1 unit gaps:** B1, E1, E2, F1, F2, J1, M1, P1. These are small, local, and protect core guarantees.
2. **Type contract:** S1, S2 in `src/types.test.ts`, and add CI (NF2) so type tests actually gate merges.
3. **Integration suite:** INT1–INT5 first, then INT6–INT9.
4. **Packaging:** fix the build and add NF1, since a release depends on it.
5. **P2 gaps,** layer by layer (A → R).
6. **P3 items and non-functional baselines** (NF3–NF5).

Tick the boxes in this file as cases land, and reference IDs in PR titles (e.g. "test: E1 array helper error paths").
