# Validation as recipe: design options against the form-lib codebase

Scope: where validation lives after the core/recipes split (issue #20), checked against the code at commit `c3246c2` (branch `test/coverage`). Sources are repo file:line references (paths relative to `/home/andrey/projects/form-lib`) and GitHub issues on TheAsda/form-lib. No files other than this one were modified.

Issue links: [#12](https://github.com/TheAsda/form-lib/issues/12) error type · [#14](https://github.com/TheAsda/form-lib/issues/14) ref kinds + pendingOf/pendingIn · [#15](https://github.com/TheAsda/form-lib/issues/15) async behaviors · [#16](https://github.com/TheAsda/form-lib/issues/16) shared declaration parts · [#18](https://github.com/TheAsda/form-lib/issues/18) map · [#19](https://github.com/TheAsda/form-lib/issues/19) submit/focus recipe · [#20](https://github.com/TheAsda/form-lib/issues/20) this question · [#21](https://github.com/TheAsda/form-lib/issues/21) skip seam · [#22](https://github.com/TheAsda/form-lib/issues/22) omission.

All issues listed above had **no comments** when read (checked with `gh issue view <n> --json comments`). The only agreed decisions are in the issue bodies (#15 "Decisions (agreed 2026-09-30)", #18 "Settled while charting") plus the brief's note that any rule registry must be keyed per root store.

---

## Q1. For each option: what has to exist in the core, what the recipe code looks like, and which current tests and examples change?

### Takeaway
Any option that lets rules be added after creation needs an operation that **reconfigures a registration's declared triggers and reads while keeping its per-instance state**. Today that operation exists only for validation (`RuleLike`/`RuleHooks`/`QueueChange` plus the layer's own async state). The options differ mainly in *who owns that operation*:
- **(a)/(b):** the core keeps it, private to validation.
- **(c-contrib):** the core makes it generic.
- **(c-handle):** the core exposes it on handles, and the recipe owns a per-store registry.
- **(c-static)/(c-keydef):** nobody owns it, so they lose "add a rule to a field that already has rules", or they re-register and lose the in-flight async state.

**(c-reducer)** removes the need for that operation but breaks ordering, sync-until-first-error, async-after-sync and rule-level `when`, which is exactly what #16's "Not doing" predicts.

### Cited Findings

#### Baseline: how validation works today
- **What a rule is.** A rule is not a behavior. `Rule` is its own class (target, kind, check, options with `name/triggers/reads/when/debounce/origins`) and implements the marker `RuleLike { _rule: true }` — src/validation.ts:53-95, src/behaviors.ts:127-134.
- **Where rules are accepted.** `AnyBehavior = Behavior | RuleLike`, and `StoreOptions.behaviors`, `addBehavior` and `replaceBehavior` all accept it — src/behaviors.ts:124-125, 162-163; src/store.ts:661-672.
- **The seam into the runtime.** The runtime splits rules from plain behaviors in `swap()` and hands the rules to `this.rules.change(host, added, removed)`, which returns a `QueueChange`. `apply()` then applies the plain registrations, the queue removals and the queue additions as one transaction: all checks run first (`checkWriters`, `rank`), then everything is applied inside one `_batch` — src/behaviors.ts:136-149, 284-285, 323-351, 357-381.
- **Wiring.** `createStore` builds the `ValidationLayer`, installs it as `runtime.rules`, sets `store._validation`, then registers the default behaviors and `options.behaviors` — src/create.ts:20-28.
- **The registry is already per root store.** One `ValidationLayer` exists per `createStore`, with `queues: Map<AnyNode, Queue>` and per-instance async `states: WeakMap<BaseStore, Map<AnyNode, FieldState>>` — src/validation.ts:221-225; src/create.ts:20.
- **Rules on a row store.** A queue `Entry` remembers the host store the rule was added on. The queue behavior itself is always registered on the root store (`this.prepare(this.store, a.behavior, true)`, `this.register(reg, this.store)`) — src/validation.ts:163-167; src/behaviors.ts:364, 376. At evaluation, entries are filtered per instance with `storeWithin(host, e.host)`, which is how "a rule added on a row applies to that row only" works — src/validation.ts:365; test src/validation.test.ts:150-161.
- **How a rule change re-registers the queue.** `change()` groups rules by target node, computes the new entry list, and emits a remove of the old queue registration plus an add of a newly built queue behavior. `resetMeta` is true only when the last rule goes, so no error flicker — src/validation.ts:231-268.
- **Queue behavior declarations.**
  - Name: `<path>#validation`.
  - Triggers: the node, each rule's `triggers`, each rule's guard refs, and effective `visible`/`disabled` unless opted out.
  - Reads: the union of rule `reads`.
  - Writes: `error` and `validating`.
  - Source: src/validation.ts:303-331.
- **Evaluation order** (src/validation.ts:364-424):
  1. Skip if hidden or disabled: abort async, clear the error (369-375).
  2. Filter rules by guards (378).
  3. Run sync rules in registration order until the first error (380-388).
  4. Run async rules only if all sync rules pass (390-395).
  5. Keep a running check whose inputs are unchanged (402-406), reuse a checked result for identical inputs (407-411), or start a new check only on user origin or `origins: "any"`, never on init. Otherwise write "unchecked" (414-421).
- **Async execution.** Async rules run sequentially until the first error; results are written back via `writeFromOutside` in a new batch with origin `behavior:<path>#validation`. A throw calls `runtime.onError` and records `state.failed` — src/validation.ts:426-487.
- **validate()** (src/validation.ts:492-524):
  1. Force-evaluates every queue instance in the subtree (`mode: "force"`, which skips the debounce and starts unchecked async).
  2. Loops until nothing is running.
  3. Collects `"error"` with `store.collect`.
  4. Reports `failures` from `state.failed`.
  5. Returns `values: submitValues(...)`.

  `store.validate()` just delegates to `root._validation` — src/store.ts:688-694.
- **Where the core names keys by string.**
  - `error`: src/validation.ts:282, 299, 313, 484, 514-516; src/features.ts:30.
  - `validating`: src/validation.ts:41, 314, 485; src/features.ts:35.
  - `visible` and `disabled`: src/validation.ts:133, 297-298, 550-551.
- **How the core recognises a validatable node.** `check()` looks for `_metaDefs.error.options.data.validation`, which the `validation()` feature sets — src/validation.ts:282-284; src/features.ts:29-36.
- **The builder and `when`.** The builder's `when` adds guards to both behaviors and rules. For a Rule it rebuilds `new Rule(..., { when: [...] })`; for a Behavior it adds `when` plus the when/otherwise branch markers (`_branches`). Any other item throws "Expected a behavior or a rule" — src/builder.ts:77-91. `each` just passes the row template — src/builder.ts:72-75. The header states the two meanings of `when`: a skipped behavior keeps its writes, a skipped rule stops contributing — src/builder.ts:14-21.
- **Behavior-level guards.** A guard that is false returns before `run`, so previous writes stay — src/behaviors.ts:635-637.
- **useBehaviors branches on `instanceof Rule`** in three places, to copy guards, compute a signature and delegate to the latest render's functions — src/react/behaviors.ts:61-63, 66-79, 82-101. #16 lists these, plus `BehaviorBuilder.wrap`, as the places to unify.
- **One writer per target.** `checkWriters` rejects two registrations whose hosts overlap (`storeWithin` in either direction) and whose write targets overlap, unless they sit in opposite branches of one when/otherwise split — src/behaviors.ts:120-122, 477-495. Tests: src/behaviors.test.ts:301-305, 399-400, 749; src/react/behaviors.test.tsx:261, 392.
- **Feature-owned keys.** A key declared with `owner: "feature"` can only be written by registrations with `feature = true` — src/behaviors.ts:430-436; src/meta.ts:15-19. Only two kinds of registration get that flag:
  - default (`_self`) behaviors — src/behaviors.ts:334, 689-703;
  - queue registrations — src/behaviors.ts:364.

  Public `addBehavior` never passes it — src/store.ts:661-662.
- **Default behaviors from key definitions** (`metaKey({ behavior: (self) => config })`):
  - The factory gets only `self`, typed `any` — src/meta.ts:20-26.
  - They are built once per store at `createStore` by walking the shape — src/create.ts:26-27; src/behaviors.ts:689-703.
  - They may only reference their own node, and never a `CountRef` — src/behaviors.ts:438-444.
- **Declared access.** A run that reads an undeclared ref throws — src/behaviors.ts:609-613. Runtime ranking is computed from declared triggers, reads and writes — src/behaviors.ts:497-526. Test "validation runs after the behavior that computes the value" relies on it — src/validation.test.ts:107.
- **Per-instance state.** `ctx.state` lives on the leaf `Binding` object — src/behaviors.ts:239-260, 630. Unregistering a registration drops its bindings — src/behaviors.ts:659-682.
- **Meta is closed.** Only keys declared with `.meta()` exist — src/store.ts:12-13.
- **Key definitions are shared.** A `MetaKeyDef` is frozen — src/meta.ts:60. It is shared by every instance of a node: `_createInstance` copies `_metaDefs` by reference — src/shape.ts:148-152. `node.error` is a `MetaRef` attached for every declared key string — src/shape.ts:139-144.
- **Internals a recipe cannot reach.** `index.ts` does not export `internal.ts`, so a recipe has no `storeWithin`, `hostFor`, `scopeOf`, `chainTo` or `refKey` — src/index.ts:1-10. The public surface does include `store.batch` (src/store.ts:366), `store.root` (src/store.ts:358), `collect` (src/store.ts:621-627) and `countIn` (src/store.ts:112-127).
- **Rules in practice** (examples/basic/src/form.ts:241-346):
  - Rules and plain behaviors are mixed in one `defineBehaviors` list: `calculate`, `visibleWhen`, `clearWhenHidden` and a custom `defineBehavior` sit beside `required`, `rule` and `asyncRule`.
  - Several rules target the same field: `required`, `email` and `asyncRule` on `requester.email` (245-249); `required` plus a custom `rule` on `department` (250-259).
  - Some rules are cross-field: `total` vs `requester.budget` via `triggers` (303-314); `neededBy` vs `orderedOn` (318-329).
  - There are rules under `b.when` inside `b.each` (262-287).
  - The evolution example uses the same patterns: examples/evolution/src/stages/stage13/index.tsx:112-116; examples/evolution/src/stages/stage12/meta.ts:8-9.
- **`exclusive()`** returns a behavior that owns several fields' `disabled` keys plus one rule per field, as one mixed `AnyBehavior[]` — src/utilities.ts:275-306. `disableWhen` / `visibleWhen` are single-writer behaviors on `disabled` / `visible` — src/utilities.ts:200-231. So `exclusive()` and `disableWhen()` on the same field conflict today (inference from the one-writer check above).
- **Tests that pin current capabilities:**
  - rules in order, first error wins, runs on creation — src/validation.test.ts:35-42;
  - guard turning false clears the error — 48-57;
  - rows — 77-105;
  - row-only rule "after the form's rules" — 150-161;
  - removing the last rule clears — 163-168;
  - program write leaves async unchecked until `validate()` — 188-202;
  - debounce skipped by `validate()` — 216-238;
  - adding another rule keeps a checked result — 294-303;
  - a throwing async check fails `validate()` — 278-292;
  - server error stays until the field's next validation run — 520-529.
- **Where tests read `validating`:** src/validation.test.ts (12 occurrences), src/meta.test.ts (2), src/integration.test.ts (1).
- **Test files using rules or rule utilities:** 11 — submit, types, meta, origins, notifications, react/form, utilities, react/behaviors, react/react, validation, behaviors.
- **Test and fixture files using `control()`** (per grep): types, submit, origins, utilities, behaviors, meta, counts, validation, react/form, react/react, react/behaviors test files, plus the fixtures src/test/fixtures/{account,company,limits}.ts and src/test/trip.ts. #18 lists "Core tests without `control()`" as unresolved.

#### Settled constraints from the issues
- **#15's decisions:**
  1. Snapshot by cancellation, with a per-run write buffer.
  2. One `AbortController` per run. Runs are cancelled on a trigger or read change, on a write to the target from another origin (no rerun), on a guard turning false (no rerun, previous writes stay), and on row removal, dispose or reset.
  3. After cancellation, `ctx.get`/`ctx.set` throw.
  4. Undeclared access always throws.
  5. Runs must be idempotent (a documented contract).
  6. `ctx.state` is transactional.
  7. A `reads` change cancels and reruns a run in progress.
  8. The last write per target is applied only if the run wasn't cancelled; a rejected promise goes to `onError` and its writes are dropped.
  9. Definition stack traces.
  10. Latest run wins.
  11. Async runs don't start on init unless `runOn.init` opts in.
- **#15 changes the interface:** `run(ctx): void | Promise<void>`, `ctx.signal`, `debounce` on `BehaviorConfig`, `pendingOf`/`pendingIn`, and `store.settle(node?)`, with "`validate()` = settle, then collect".
- **What stays in validation after #15:** rule order, sync-until-first-error, result reuse in `ctx.state`, and "don't start on init; `validate()` forces it". `validating` becomes `pendingOf(node.error)` / `pendingIn(shape, "error")`.
- **#14:** pending tallies live under a reserved key namespace on the count channel; `pendingIn(node, key?)` can narrow to writes of one meta key.
- **#16:** "Rule extends Behavior (or the reverse)" is explicitly *not doing*, because it "breaks one writer per target, queue ordering, async ownership, and the different meaning of `when`".
- **#18 settled:**
  - Recipes live in `recipes/` (never published).
  - `useControl`, the error display policy, `domOrder` etc. are recipes.
  - All of `features.ts` and `utilities.ts` become recipes, "except whatever the validation queue ticket keeps in the core".
- **#12:** proposes `validation<E>()` → `error: metaKey<E | undefined>`, with the queue needing only "undefined means valid".
- **#21:** options for the skip seam are `validation({ skip: (self) => guards })` or a rule-level `when`. It also asks what "skipped" does.
- **#22:** either a metaKey `omit` capability plus a type brand, or omission moves into the submit recipe.
- **#19:** submit = reveal, then `validate()` (= settle + collect).

### Inferences

#### Cross-cutting facts every option must answer
These follow from the findings above.

**F1. Late rules force reconfiguration.** Adding a rule to a field whose queue already exists changes the queue's triggers and reads:
- undeclared reads throw (#15 decision 4; src/behaviors.ts:609-613);
- ordering comes from declarations (src/behaviors.ts:497-526).

So some operation must replace or update a registration's declarations. It exists today only as `QueueChange` (src/behaviors.ts:136-149, 357-381).

**F2. Continuity across reconfiguration needs state transfer.** Today "per-field async state survives" re-registration (src/validation.ts:12-13), because that state lives in the layer's `WeakMap`, not in the registration (src/validation.ts:223). The test "adding another rule keeps a checked result" relies on this (src/validation.test.ts:294-303). The code also keeps a *running* check when the async key is unchanged (src/validation.ts:402-406).

After #15:
- the result cache lives in `ctx.state` on a `Binding` (src/behaviors.ts:243);
- in-flight runs are cancelled when the instance is disposed (#15 decision 2).

So re-registering loses both unless the core transfers bindings and state (an in-place update), or the recipe keeps its own cache outside `ctx.state`. A recipe cache can keep checked results but **cannot** keep an in-flight run alive.

**F3. Owner flag.** A recipe queue registered through public `addBehavior` is `feature = false` and so cannot write an `owner: "feature"` key (src/behaviors.ts:433-435; src/store.ts:661-662). Options where the recipe registers its own queue must either:
- drop `owner` from the error key, relying on one-writer to keep others out, but letting a user behavior claim `error` first; or
- have the core generalise `owner` into a token that behaviors can present.

**F4. Filtering row-store rules.** The recipe needs a public way to tell whether a rule's host store contains the current instance (today `storeWithin`, internal: src/validation.ts:365; src/index.ts:1-10). It also needs to redo the check "rule target outside the store it was added to" (src/validation.ts:285-286), which `prepare` does not do for a queue registered on the root. Candidate APIs: `ctx.store` plus a public `store.contains(other)`, or the core filtering parts per instance.

**F5. Forcing unchecked async.** `settle()` only starts *debounced* runs and waits for runs in flight (#15). A queue that decided "unchecked, don't start" (src/validation.ts:414-421) has no run in flight, so `settle()` alone never checks it. Two public-only routes exist:
- **Force key:** the recipe declares a trigger key per validatable node (e.g. `checkRequest: metaKey(0)`). The recipe's `validate()` bumps it in the subtree in one `store.batch`, and the queue treats `ctx.changed(self.checkRequest)` as force mode.
- **Core flag:** the core adds a generic `settle(node, { rerun: true })`, or a `ctx` flag telling the run it was forced.

Either works for every recipe option. For (a) and (b) the core can keep a private force mode.

**F6. Failures.** Under #15 decision 8, a rejected run goes to `onError` and its writes are dropped. `validate().failures` (src/validation.ts:125-130, 518-522) then needs one of:
- the run catches the throw itself, records the failure (in `ctx.state`, or a recipe meta key such as an aggregated `failed`), calls a reporter, and resolves normally so its writes apply; or
- the core's `settle()` returns the list of runs that failed in the subtree.

**F7. Per-rule debounce vs per-behavior debounce.** #15 puts `debounce` on `BehaviorConfig`, but today debounce is per async rule and applies only when async rules start (src/validation.ts:463-469). A config-level debounce on the queue would also delay sync errors. A debounce inside `run` (await a timer with `ctx.signal`) is not skipped by `settle()`'s "start debounced runs now". This applies to every option, including (a).

**F8. Two meanings of `when`.** A rule's `when` means "stop contributing" (error recomputed without it; src/validation.ts:378). A behavior's `when` means "skip the run, keep previous writes" (src/behaviors.ts:635-637; #15 decision 2). So builder guards on rules must reach *inside* the queue as per-rule guards, never as the queue behavior's own `when`. The same applies to the hidden/disabled skip (#21): it must clear the error, so it is evaluated inside `run` with its refs as triggers. A trigger change then cancels and reruns (#15 decision 7), and the rerun writes `undefined`.

**F9. Pending needs no special handling.** With #14/#15, `pendingOf(node.error)` counts any run writing `error`, so the "validating" state falls out of the runtime in every option where the queue is a behavior writing `error`.

#### Option (a): the core keeps validation and reserves `error`

- **Core:**
  - `validation<E = string>(opts)` declaring only `error` (no `validating`, #15).
  - `Rule`, `rule`/`asyncRule`, the queue builder, `validate()` on the store, `ValidationResult` / `ValidationError<E>`.
  - The private `RuleLike`/`RuleHooks`/`QueueChange` seam.
  - Private force mode and failure tracking.
- **Recipe:** `required`, `minLength`, `email`, …; the error display policy; the skip policy; omission.

```ts
// core
export const validation = <E = string>(o: { skip?: (self: any) => Guard[] } = {}) => ({
  error: metaKey<E | undefined>(undefined, { owner: "feature", aggregate: (e) => e !== undefined, data: { validation: o } }),
});
export function rule<N extends Validatable<any>>(node: N, check: (v: InferValue<N>, ctx: RuleContext) => ErrorOf<N> | undefined, o?: RuleOptions): Rule<N>;
// recipe
const skipHiddenDisabled = (self: any) => [when([effective(self, "visible")], (v) => v !== false), /* disabled */];
export const control = () => ({ ...validation({ skip: skipHiddenDisabled }), ...touched(), ...dirty(), ...reveal(), ...focusable() });
```

- **Ordering, sync-first, async, unchecked, `when`, `each`, late rules, one-writer:** unchanged from today. Continuity (F2) needs a core-internal "update registration in place" once #15 moves state to bindings.
- **#12:** `validation<E>()` in the core, with `E` inferred from `node._meta.error`.
- **#21:** `validation({ skip })` (F8).
- **#22:** omission leaves `validate().values`, or goes behind an `omit` capability.
- **#16:** unchanged scope. `Rule` and `Behavior` are both core classes, and #16's shared interface is a core-internal refactor.
- **Tests and examples:** `validating` assertions (15 occurrences) become pending refs. Hidden/disabled tests (src/validation.test.ts:123-147, 395-421) switch to the skip seam, which a test-local skip fixture can supply. Example code barely changes; the `validating` mention in examples/evolution/src/stages/stage2/meta.ts:8 is doc text.

#### Option (b): the core keeps the queue, the recipe names the key

- **Core:** a key capability marking a key as a queue output, and `rule`/`asyncRule` targeting that key's ref. Everything else is as in (a), minus `validation()`.

```ts
// core (meta.ts)
interface MetaKeyOptions<V> { /* ... */ queue?: { skip?: (self: any) => Guard[] } } // "undefined means valid"
// core (validation.ts)
export function rule<R extends MetaRef<any>>(key: R, check: (v: InferValue<NodeOf<R>>, ctx: RuleContext) => Exclude<InferValue<R>, undefined> | undefined, o?: RuleOptions): Rule<R>;
// store.validate(node) → { valid, entries: { path, ref, key, error }[], failures }  // over every queue key in the subtree
// recipe
export const validation = <E = string>() => ({ error: metaKey<E | undefined>(undefined, { owner: "feature", aggregate: (e) => e !== undefined, queue: { skip: hiddenOrDisabled } }) });
export const required = (n: WithKey<"error", string | undefined>) => rule(n.error, (v) => (isEmpty(v) ? "Required" : undefined));
```

- **Variant (b′):** keep `rule(node, …)`. The core finds the one key on the node marked `queue` and throws if there are zero or more than one. This avoids changing any call site in examples or tests.
- **Core change vs today:** `check()` tests `ref.def.options.queue` instead of `_metaDefs.error.options.data.validation` (src/validation.ts:282). `queueBehavior` writes the marked key instead of `new MetaRef(node, "error")` (src/validation.ts:313). `validate()` collects every queue key instead of `"error"` (src/validation.ts:514).
- **Bonus:** a node can carry two queues, e.g. `error` and `warning`, and `valid` can consider only keys flagged as blocking. Today one node can have only one queue (keyed by node: src/validation.ts:222).
- **Ordering, sync-first, async, unchecked, `when`, `each`, late rules, one-writer:** as in (a).
- **#12:** best-typed of all options. `E` comes from the key ref's value type, so no `Validatable` / `error: string` constant is needed (src/validation.ts:41, 122).
- **#21:** skip lives on the key capability.
- **#16:** as in (a).
- **Tests and examples:** under (b), `rule(s.x, …)` becomes `rule(s.x.error, …)` in examples/basic/src/form.ts:252, 304, 319, in evolution stages 12/13, and in tests. Under (b′) nothing changes except imports. `validation()`/`control()` move to recipes, so core tests need a test-local error key declaration.

#### Option (c-static): a recipe groups a declarative rule list into one queue behavior per field before `createStore`; no new core mechanism

```ts
// recipe
export const rule = (node, check, o = {}) => ({ kind: "rule", target: node, sync: true, check, ...o }) as RuleSpec;
export function validated(list: readonly (Behavior | RuleSpec)[]): Behavior[] {
  const byTarget = groupBy(list.filter(isRuleSpec), (r) => r.target);
  return [...list.filter(isBehavior), ...[...byTarget].map(([node, rules]) => queueBehavior(node, rules))];
}
// usage
createStore(shape, init, { behaviors: validated(defineBehaviors(shape, (b) => { /* ... */ })) });
```

- **Core:** nothing new, as long as the builder can carry recipe rule specs. Today `wrap` throws on anything that isn't a `Behavior` or `Rule` (src/builder.ts:77-91). So one of these is needed:
  - #16's shared interface becomes a *public* protocol (e.g. an item implements `withGuards(guards, branches)`, `signature()`, `delegateTo(slot)`); or
  - rules are behaviors-in-disguise; or
  - the recipe ships its own `defineRules` builder, duplicating `when`/`otherwise`/`each`.
- **Owner:** the error key cannot be `owner: "feature"` (F3).
- **What works:** ordering (list order), sync-first, async (in the queue `run`), `when` (the spec carries guards, evaluated per rule inside `run`), and `each` (the queue on the template node gets per-row instances, src/behaviors.ts:7-9).
- **Rules added later:**
  - A rule on a field that has **no** queue yet works: `addBehavior(validated([...]))`.
  - A rule on a field that **already** has rules fails with "already written by … – one writer per target" (src/behaviors.ts:483-490), for root and row hosts alike (src/behaviors.ts:481).
  - This breaks the row-local rule test (src/validation.test.ts:150-161) and component rules through `useBehaviors` that add to a form-level field.
- **Row-local rules:** the per-row add in that test would have to register a second writer on the row store, which one-writer rejects (host overlap is checked with `storeWithin` both ways, src/behaviors.ts:481).
- **validate():** a recipe function (force key, `settle`, `collect`) (F5, F6).
- **#16:** turns into a public extension protocol, or the recipe forks the builder.
- **Verdict:** loses a current capability unless paired with a registry; that pairing is c-static+R.

**Variant (c-static+R): static grouping plus a per-root-store registry on today's `replaceBehavior`**

- The recipe keeps a `WeakMap<RootStore, Map<AnyNode, { handle; entries }>>`. Adding rules updates the entries and calls `store.replaceBehavior(handle, queueBehavior(entries))` for each affected field (src/store.ts:670-672; src/behaviors.ts:316-321). No new core mechanism.
- **Costs:**
  - Each `replaceBehavior` is its own transaction, so a multi-field addition is not atomic: a failure on field 3 leaves fields 1-2 swapped. Registering *all* queues under one handle and replacing it wholesale fixes atomicity, but churns every field.
  - `replace` unregisters with `resetMeta = true` (src/behaviors.ts:371), so the error resets and is recomputed by the new init run. That happens inside one batch, so there is no UI flicker, but it loses the async result and cancels in-flight runs (F2). The recipe must cache results outside `ctx.state`, and the in-flight-continuity test pattern (src/validation.ts:402-406) is lost.
  - Rules added on a row store must still go to the root queue with host filtering (F4).
  - Users must route rules through recipe entry points (`addRules(store, list)`, `useRules`) instead of `addBehavior`/`useBehaviors`, unless the core adds an install protocol (option e).

#### Option (c-contrib): the core gets a generic "contributions → one owning behavior" mechanism

This generalises today's `RuleLike`/`RuleHooks`/`QueueChange` (src/behaviors.ts:124-149, 323-381). The key declares how its contributions combine.

```ts
// core (meta.ts)
interface MetaKeyOptions<V> { /* ... */ combine?: (self: any, parts: readonly Part<any>[]) => BehaviorConfig }
// core (behaviors.ts)
export interface Declaration { name?: string; triggers?: readonly AnyRef[]; reads?: readonly AnyRef[]; when?: Guard | readonly Guard[] }
export class Contribution<P = unknown> { constructor(readonly target: MetaRef<any>, readonly payload: P, readonly decl: Declaration) {} }
export function contribute<P>(target: MetaRef<any>, payload: P, decl?: Declaration): Contribution<P>;
export interface Part<P> { readonly payload: P; readonly name: string; readonly guards: readonly Guard[];
  readonly triggers: readonly AnyRef[]; readonly reads: readonly AnyRef[] }
// BehaviorContext (for a combined behavior): readonly parts: readonly Part<any>[]  // only parts whose host contains ctx.store
export type AnyBehavior = Behavior | Contribution;

// recipe (recipes/validation.ts)
type Check<E> = { kind: "sync"; check: (v: any, ctx: RuleContext) => E | undefined }
             | { kind: "async"; check: (v: any, ctx: AsyncRuleContext) => Promise<E | undefined>; debounce?: number; origins?: "user" | "any" };
export const rule = <N extends Validatable>(n: N, check, o: RuleOptions = {}) => contribute(n.error, { kind: "sync", check }, o);
export const validation = <E = string>(o: { skip?: (self: any) => Guard[] } = {}) => ({
  error: metaKey<E | undefined>(undefined, { owner: "feature", aggregate: (e) => e !== undefined,
    combine: (self, parts) => queue(self, parts, o.skip?.(self) ?? []) }),
  checkRequest: metaKey(0),                       // F5: bumped by validate()
});
function queue(self, parts, skip): BehaviorConfig {
  return { name: `${self.path}#validation`, triggers: [self, self.checkRequest, ...skip.flatMap((g) => g.refs)],
    writes: [self.error], run(ctx) { /* skip → set undefined; ctx.parts filtered by guards; sync until first error;
      async only if forced (ctx.changed(self.checkRequest)) or user origin; reuse ctx.state.checked */ } };
}
export async function validate(store, node = store.node) { bumpCheckRequests(store, node); await store.settle(node);
  return { errors: store.collect(node, "error").map(/* ... */), failures: /* F6 */ }; }
```

- **Core behaviour:**
  - Groups contributions per (root store, target `MetaRef`). This matches the agreed per-root-store keying, and today's layer already does it (src/validation.ts:222).
  - Adds the parts' triggers, reads and guard refs to the combined config automatically, so the recipe can't forget them.
  - Registers the result as a feature behavior on the root, so `owner` keeps working (F3).
  - Filters parts per instance by host (F4).
  - Re-combines on every add or remove as one transaction. This is today's `apply` with a `QueueChange`, and needs an in-place update that preserves bindings, `ctx.state` and ideally an in-flight run (F2).
- **Ordering:** parts are passed in registration order (entries are appended: src/validation.ts:252). Sync-until-first-error, async-after-sync, result reuse and unchecked stay recipe code inside `run`, as #15 already assigns ("Stays in validation").
- **`when`:** the core builder adds guards to `Contribution.decl.when`, generically. `combine` receives them per part. The recipe decides whether a false guard means "stop contributing" (validation) or something else. This resolves F8 without the core knowing rules.
- **`each`:** unchanged; the template node's key gets per-row instances.
- **Late rules:** accepted by `addBehavior`, `replaceBehavior`, `createStore({ behaviors })` and `useBehaviors` exactly as today. Adding to a field that already has rules re-combines that key.
- **One-writer:** holds. The combined behavior is the only writer, and other behaviors writing the key are rejected as today.
- **validate():** a recipe function (F5, F6). `store.validate` and `_validation` leave the store (src/store.ts:688-694, 1098).
- **#12:** fully a recipe concern.
- **#21:** recipe skip (F8).
- **#22:** recipe.
- **#16:** the core has exactly two declaration classes, `Behavior` and `Contribution`, which share `Declaration`. The `instanceof Rule` branches in src/builder.ts:79-81 and src/react/behaviors.ts:61-101 become `instanceof Contribution` (or go through a shared interface), and no recipe class leaks into the core. #16 shrinks to "Behavior and Contribution share Declaration".
- **Other possible users:** OR-combining `disabled` from several sources (`exclusive()` plus `disableWhen` on the same field conflict today, src/utilities.ts:217-231, 283-292) and a `warnings` queue.
- **Tests and examples:**
  - src/validation.test.ts moves to the recipes vitest project (per #18). Its `validating` assertions become `pendingOf`.
  - Core tests get a small test-local `combine` key to test contributions.
  - Example call sites are unchanged apart from imports (`rule`, `required`, etc. from the recipes alias); mixed lists keep working.

#### Option (c-reducer): multiple writers to a key declared with a merge; each rule is an ordinary behavior

```ts
metaKey<string | undefined>(undefined, { merge: (writes: readonly { value: string | undefined; seq: number }[]) => writes.find((w) => w.value !== undefined)?.value })
const required = (n) => defineBehavior({ triggers: [n], writes: [n.error], run: (ctx) => ctx.set(n.error, isEmpty(ctx.get(n)) ? "Required" : undefined) });
```

- **Core:**
  - `checkWriters` exempts merge keys (src/behaviors.ts:477-495).
  - The store keeps one contribution slot per writer instance and exposes the merged value.
  - `unbind`'s `resetMeta` must retract that writer's slot instead of writing the default (src/behaviors.ts:671-675).
  - #15 decision 2 ("write target written by another origin cancels") must be exempted for merge keys, or a sync rule's write cancels a sibling async rule.
  - Read-your-own-writes on a merged key becomes ambiguous (decision 1).
- **Ordering / first-error-wins:** expressible in `merge` by writer `seq`. Registration order is available (src/behaviors.ts:302, 410).
- **Sync-until-first-error:** not expressible. Every rule runs every time. That is harmless for sync rules, but async rules can't be skipped when a sync rule fails, unless each async rule also declares a new read on "the merged value of lower-seq writers", which is a new ref kind (#14 says ref kinds are internal only).
- **Async-after-sync:** same problem.
- **Unchecked-until-validate:** each async behavior needs the force key (F5).
- **Rule `when`:** broken semantics. A guard-false behavior keeps its last write (src/behaviors.ts:635-637; #15 decision 2), so a stale error persists. That contradicts src/validation.test.ts:48-57. The fix needs a new "on skip: retract" behavior option.
- **Server errors:** the test src/validation.test.ts:520-529 expects a program-written error to stay until the field's next validation run. With per-writer slots, a non-behavior write needs a defined place in the merge.
- **Row-local rules:** work, since multiple writers are allowed.
- **#16:** disappears as a question, but this is exactly the design #16 rejected. It breaks one writer, queue ordering, async ownership and the meaning of `when`.
- **Verdict:** loses sync-first, async-after-sync and rule-`when` semantics, and bends two #15 decisions.

#### Option (c-handle): the core adds in-place reconfiguration on handles; the recipe keeps a mutable per-store queue registry

```ts
// core
export interface BehaviorHandle { (): void; update(next: Behavior): void }   // same registration: bindings, ctx.state, origin id kept
// recipe
const registries = new WeakMap<RootStore<any>, Map<AnyNode, { handle: BehaviorHandle; entries: Entry[] }>>();
export function addRules(store: BaseStore<any>, rules: RuleSpec[]): () => void { /* group by target; for each: entries.push({ rule, host: store });
  existing ? existing.handle.update(queueBehavior(node, entries)) : root.addBehavior(queueBehavior(...)) */ }
export function useRules(build, deps) { /* like useBehaviors, calling addRules / dispose */ }
```

- **Core:**
  - `update()` on a handle (or `replaceBehavior(prev, next, { keep: "state" })`) that rebinds trigger subscriptions and re-ranks while keeping `Binding` objects (`ctx.state`, instance origin id; src/behaviors.ts:239-255).
  - A policy for an in-flight run whose declarations changed: cancel and rerun, or keep it.
  - A way to update several handles atomically (`store.batch` defers notifications, but each `update` runs its checks separately).
  - Probably a public `store.contains()` (F4).
- **Recipe:** the registry and its entry points, the queue `run`, the force key, and failure capture.
- **Owner:** the key must drop `owner`, or `owner` is generalised (F3).
- **Ordering, sync-first, async, unchecked:** recipe code, as in c-contrib.
- **`when`:** requires #16's shared interface as a public protocol so the core builder can wrap recipe rule specs, or a recipe builder.
- **`each`:** fine.
- **Late rules:** yes, including on a field that already has rules. But only through recipe entry points: rules are not accepted by `createStore({ behaviors })`, `addBehavior` or `useBehaviors` unless option (e) also exists. Mixed lists like examples/basic/src/form.ts:241-346 must be split, or routed through a recipe wrapper that separates rules.
- **One-writer:** holds, since the recipe keeps one registration per field.
- **validate():** recipe (F5, F6).
- **#16:** becomes a public protocol, or the recipe duplicates `defineBehaviors`/`useBehaviors`.
- **Code volume:** the most recipe code of the viable options (registry, host filtering, entry points, React hook).

#### Option (c-keydef): the queue is the key's own default behavior (`metaKey({ behavior: (self) => … })`)

```ts
export const validation = (rules: readonly FieldRule[] = []) => ({
  error: metaKey<string | undefined>(undefined, { aggregate: (e) => e !== undefined, behavior: (self) => queue(self, rules) }),
});
field<string>().meta(validation([required(), minLength(3)]));
```

- **Hard blockers in the current core:**
  - A default behavior may only reference its own node (src/behaviors.ts:438-444). That excludes cross-field rules (examples/basic/src/form.ts:303-314, 318-329; src/validation.test.ts:59-69), `when` guards on other fields (examples/basic/src/form.ts:262-277) and `exclusive()` (src/utilities.ts:293-305).
  - The factory receives only `self` and is called once at `createStore` (src/meta.ts:20-26; src/create.ts:26-27; src/behaviors.ts:689-703). It cannot see a per-store registry or rules added later.
  - Default behaviors are rejected by the builder (src/builder.ts:83).
- **Rules in `.meta()`:** static and per shape, which is acceptable because declarations are immutable. But they cannot name sibling nodes, which don't exist until `form()` instantiates the tree, so cross-field and `when` rules have no home.
- **Registry variant:** the factory would need `(self, store)` plus dynamic triggers, which reduces to c-handle or c-contrib anyway.
- **Verdict:** only viable as sugar for field-local intrinsic rules, contributing the *initial parts* of a c-contrib or c-handle queue (e.g. `combine` receives both declared and contributed parts). It cannot be the whole design.

#### Option (d): the core exports an identity token for the error key instead of a string name

- **Variants:**
  - `export const errorKey = <E>() => metaKey<E | undefined>(…, { [VALIDATION]: true })`, with the recipe choosing the name (`.meta({ problems: errorKey() })`).
  - A `Symbol` as the meta *key name* is not viable. Meta keys are strings used as node properties and in `MetaRef`/`refKey` (src/shape.ts:139-144; src/internal.ts:15). `.meta()` iterates `Object.entries` (src/shape.ts:112-113), which skips symbols.
- **Assessment:** this is option (b) with the marker as a core-exported def factory instead of an option. It has the same trade-offs, and the core still owns the queue semantics.

#### Option (e): a generic "install" protocol: `addBehavior` / `createStore` accept extension objects

```ts
export interface Installable { install(store: BaseStore<any>): () => void; withGuards?(g: Guard[], b: Branch[]): Installable; signature?(): string }
export type AnyBehavior = Behavior | Installable;
```

- **What it does:** lets recipe rules travel in the same lists as behaviors, through the builder and `useBehaviors`, without the core knowing about rules. The rule's `install` adds itself to the recipe's per-root registry.
- **Not enough alone:** it still needs c-handle's `update()`, or `replaceBehavior` with its F2 losses, to reconfigure queues.
- **Atomicity:** `install` calls happen inside the runtime's transaction only if the core defines a two-phase contract (prepare/commit, like `QueueChange.commit`, src/behaviors.ts:142-143). Carried to its end, this re-invents `RuleHooks`/`QueueChange` as a public API. Compared with c-contrib, it is more general and has a larger surface.

#### Option (f): a generic "group by target" hook in `defineBehaviors`

`defineBehaviors(shape, fn, { groupers: [validationGrouper] })` post-processes the flat list. This is static only; it is c-static with a hook and has the same late-rule gap.

#### Option (g): a validation-only core, with the recipe supplying the queue policy as data

The core keeps rule collection and an ordered, guarded, async-capable queue. The recipe supplies `skip`, the key and the error type through one declaration: `metaKey(undefined, { queue: { skip } })`. This is (b), plus #21's `skip` on the key. It is listed separately because it is the smallest step from today's code that stops naming `error`, `visible` and `disabled`.

#### Comparison matrix

| Capability | (a) | (b) | c-static | c-static+R | c-contrib | c-reducer | c-handle | c-keydef |
|---|---|---|---|---|---|---|---|---|
| Rule order + sync-until-first-error | yes | yes | yes | yes | yes (recipe) | **no** (all run) | yes (recipe) | yes, field-local only |
| Async after sync; latest wins (#15) | yes | yes | yes | yes | yes | **no** | yes | yes |
| Builder `when` on rules (stop contributing) | yes | yes | needs #16 protocol | needs #16 protocol | yes (core-generic) | **no** (keeps writes) | needs #16 protocol | **no** cross-field guards |
| `b.each` row rules | yes | yes | yes | yes | yes | yes | yes | yes |
| Late rule on a field with rules | yes | yes | **no** (one-writer throws) | yes, loses in-flight async | yes | yes | yes (recipe API only) | **no** |
| Row-store-only rule | yes | yes | **no** | yes (needs F4) | yes | yes | yes (needs F4) | **no** |
| One writer per target intact | yes | yes | yes | yes | yes | **relaxed** | yes | yes |
| `owner` on the error key | yes | yes | no (F3) | no (F3) | yes | n/a | no (F3) | yes |
| Unchecked until `validate()` | core-private | core-private | F5 | F5 | F5 | F5 per rule | F5 | F5 |
| Typed errors (#12) | core generic | from key ref (best) | recipe | recipe | recipe | recipe | recipe | recipe |
| New core mechanism | none | queue marker | none (+ #16 protocol) | none | contributions + in-place update | merge keys + retract + cancel exemptions | `handle.update` (+ multi-update) | lift `_self` limit + store in factory |
| Core names a key | `error` | none | none | none | none | none | none | none |

### Gaps
- **Per-rule debounce (F7).** #15 does not say how per-rule debounce maps onto a behavior-level `debounce`, or how `settle()` skips a debounce inside `run`. This is unresolved for every option.
- **Failures (F6).** #15 does not say how `validate().failures` is produced once rejected runs are routed to `onError` with writes dropped.
- **Registration update semantics.** No issue specifies what an in-place registration update (needed in some form by every option; F1, F2) does with an in-flight run whose declarations changed.
- **Size estimates.** No measurements were taken. Line counts of the moved code are rough (src/validation.ts is 575 lines; about 250 of them are async machinery that #15 moves to the runtime).
- **Type inference.** It was not checked whether TypeScript infers `E` well for `rule(node.error, …)` in (b) or for `validation<E>()` recipes. #22 asks for a similar type prototype; none exists yet.

---

## Q2. Which options keep the Core glossary definition intact?

### Takeaway
The recipe-side options keep the definition intact: c-static(+R), c-contrib, c-handle, c-keydef and c-reducer. (a) breaks it by naming `error`. (b), (d) and (g) keep its letter, since the core names no key, but the core still gives a marked key validation semantics. Whether that counts as "an opinion about what a key means" is a judgement call.

### Cited Findings
- Glossary: **Core** is "the mechanism every form needs, and no opinion about what any particular metadata key means". **Recipe** is "Consumer-owned code built only on the core's public interface that gives a metadata key or workflow one team's meaning (e.g. what `disabled` implies, when an error shows)". **Pending** is "Derived by the core, never declared or written" — GLOSSARY.md.
- The core names `error`, `validating`, `visible` and `disabled` by string today — src/validation.ts:133, 282, 297-298, 313-314, 484-485, 514, 550-551; src/features.ts:30, 35.
- It also names `focusTarget`, `submitCount`, `submitting` and `revealed` in the store (src/store.ts:697-700, 775-777), which #19 evicts.
- #20 option (a) says it is "leaning this way: the queue is mechanism and `error` is its output, not a policy".
- The brief says the author accepts reserving `error` only if that is clearly the most elegant.
- #15 lists what "stays in validation" as policy-like behaviour: rule order, sync-until-first-error, reuse, "don't start on init; `validate()` forces it".
- `aggregate`, `inherit`, `reactive` and `keepOnReset` are existing precedents for the core giving a key a *capability* without naming it — src/meta.ts:28-40.

### Inferences
- **(a)** needs a glossary amendment, e.g. "names no metadata key except `error`, the output of the validation queue". It also leaves `ValidationResult`, `SubmitValue` and `validate()` on the store.
- **(b)/(d)/(g)** fit the pattern of existing capabilities (`aggregate`, `inherit`): a key opts into a core behaviour by declaration. But the capability encodes validation-specific policy (ordering, sync before async, unchecked-until-forced, "undefined means valid"). If the author reads "when an error shows" (the Recipe example) as the only error policy, (b) is intact. If the queue's ordering and async policy count as meaning, it is not.
- **c-contrib** is intact. The core only knows "a key's contributions are combined by the key's own function into one behavior", which is meaning-free, like `behavior:` on `metaKey` (src/meta.ts:20-26).
- **c-handle** and **c-static(+R)** are intact and add no key-aware core code at all.
- **c-keydef** is intact, but only if the `_self` restriction is relaxed generically, not for `error` specifically.
- **Pending:** all options keep it intact. `validating` disappears in every option because #15 replaces it with `pendingOf`/`pendingIn`.

### Gaps
- The glossary does not say whether "mechanism" may include a key capability that carries policy. The author must decide whether (b) counts as intact.

---

## Q3. Where do the one-writer invariant and #15's decisions (declared access, cancellation, transactional `ctx.state`, latest-run-wins) constrain the options?

### Takeaway
- **One writer per target** forces every option that allows late rules to have exactly one registration per (root store, field key) that is *reconfigured*, not duplicated. c-static fails here; c-reducer abandons the invariant.
- **Declared access** makes reconfiguration unavoidable when a rule brings new triggers or reads.
- **Cancel-on-dispose plus binding-scoped, transactional `ctx.state`** means reconfiguration must happen in place, inside the core, or the "checked result survives a rule change" and "running check survives" behaviours are lost.
- **Latest-run-wins** and **cancel-on-trigger-change** fit a single queue behavior well. They fit badly with several writers to one key.

### Cited Findings
- **One writer.** `checkWriters` checks overlapping hosts in both directions (`storeWithin(reg.host, other.host) || storeWithin(other.host, reg.host)`) and only exempts opposite when/otherwise branches — src/behaviors.ts:477-495, 120-122. A row-store registration therefore conflicts with a root registration on the same template key (tests: src/behaviors.test.ts:399-400).
- **Declared access.** Undeclared reads throw (src/behaviors.ts:609-613). #15 decision 4 makes that apply to both reads and writes, in dev and prod. Ranking comes from declarations (src/behaviors.ts:497-526).
- **Cancellation.** #15 decision 2 cancels a run when:
  - a trigger or read changes (then reruns, decision 7);
  - another origin writes the target (no rerun);
  - a guard turns false (no rerun; writes stay);
  - the row is removed, the instance disposed, or `reset()` covers it.
- **Transactional state.** #15 decision 6 makes `ctx.state` transactional; it is stored on the `Binding` (src/behaviors.ts:243).
- **Latest run wins.** #15 decision 10.
- **Async on init.** #15 decision 11: async runs don't start on creation unless `runOn.init` opts in.
- **Continuity today.** Queue re-registration keeps async state because that state lives outside the registration (src/validation.ts:12-13, 223, 402-411). Test: src/validation.test.ts:294-303.
- **Server errors.** An error written by the program persists until the field's next validation run (src/validation.test.ts:520-529). This works because the queue only writes when it runs, and it is the only behavior writer.

### Inferences
- **One writer:**
  - It kills c-static for late rules.
  - It forces c-handle and c-static+R to register queues on the *root* and filter by host (F4), because a row-level queue would collide with the root one.
  - c-reducer has to relax it, which in turn needs exemptions from #15 decision 2 (a sibling rule's write would cancel an async rule) and redefines decision 1 (read-your-own-writes on a merged key).
- **Declared access + ranking:** because triggers must be declared up front, c-keydef cannot learn triggers from rules added later. Every design needs a reconfiguration primitive (F1). The cheapest place for it is where `QueueChange` already is.
- **Cancellation:**
  - It works *for* a single queue behavior. A trigger change cancels and reruns (the old `gen`/abort logic goes away). A skip ref (hidden/disabled) is a trigger, so turning hidden cancels, and the rerun clears the error. Row removal cancels.
  - "Guard false → cancel, keep writes" is the wrong semantics for rule guards and for the skip (F8). So in *every* option, rule guards and the skip must be evaluated inside `run`, not as the queue's behavior-level `when`.
  - "Write target written by another origin → cancel, no rerun" is compatible with server errors: a program write to `error` cancels an in-flight async check, and the error stays until the next trigger. That keeps today's server-error test semantics.
- **Transactional `ctx.state`:** the reuse cache ("checked result for identical inputs") belongs in `ctx.state` and is only saved on success, which fits. But it dies with the registration, so reconfiguration by replace (c-static+R, `replaceBehavior`) loses it. c-contrib and c-handle need an in-place update that keeps `Binding`s. For (a)/(b) the core needs the same internally once #15 moves the state into bindings.
- **Latest-run-wins:** covers today's `gen` counter and abort (src/validation.ts:347-357, 427-434). "Keep a running check when inputs are unchanged" (src/validation.ts:402-406) becomes "don't cancel if the declared inputs didn't change". The runtime already only cancels on changes to declared refs, so the recipe no longer needs `sameKey` for running checks, only for reusing completed checks.
- **Async on init:** matches "never on creation" for async rules, but the queue's *sync* part must run on init (src/validation.test.ts:35-42). So the queue behavior keeps `runOn.init` at its default (true) and decides inside `run` whether to go async. #15 decision 11 must therefore mean "don't *await* on init unless opted in", or the queue must go async only when not `ctx.isInit`. Whether decision 11 is keyed on the config or on the run's return value is ambiguous.
- **Pending (#14):** `pendingOf(node.error)` counts only while a run is running or debounced. "Unchecked" async (no run) is not pending, which matches today, where `validating` is false while unchecked (src/validation.test.ts:188-192).

### Gaps
- #15 does not state whether decision 11 ("async runs don't start on creation") is determined statically, by config, or dynamically, by `run` returning a promise. It matters for a queue that is sync on init and async later.
- #15 does not say whether an in-place registration update counts as "instance disposed" for cancellation.

---

## Q4. Which option minimises total code and concepts while preserving current capabilities?

### Takeaway
- **Least change overall:** (a). It preserves every capability with the fewest new concepts, at the price of the glossary exception.
- **Smallest fully glossary-clean option:** **c-contrib**. It is essentially a renaming and generalisation of the `RuleLike`/`RuleHooks`/`QueueChange` seam that already exists. It keeps "rules go anywhere behaviors go" (createStore, addBehavior, builder `when`/`each`, useBehaviors) with no consumer-facing change apart from imports, and it collapses #16 to two core classes sharing one `Declaration`.
- **Middle ground:** (b)/(b′). About the same core size as (a), no named key, the best #12 typing and optional multiple queues, but the queue's policy stays in the core.
- **The rest:** c-handle needs a smaller core primitive but the most recipe code and new consumer entry points. c-static, c-reducer and c-keydef each lose current capabilities.

### Cited Findings
- **What exists today:** a rule-specific contribution seam — `RuleLike`, `RuleHooks.change`, `QueueChange { remove, add, commit }`, and the transaction in `swap`/`apply` (src/behaviors.ts:124-149, 323-381). The grouping, registry and host filtering live in `ValidationLayer.change` / `evaluate` (src/validation.ts:231-268, 365).
- **Dual code paths #16 wants to unify:** src/builder.ts:77-91; src/react/behaviors.ts:61-101.
- **What #15 moves out of validation:** the generation counter, abort, timers, `startNow`, `running`, `writeFromOutside`, and the wait loop in `validate()`. What stays: rule order, sync-until-first-error, reuse, and forcing on `validate()`.
- **What #18 already moves to recipes:** all of `features.ts` and `utilities.ts` "except whatever the validation queue ticket keeps in the core"; `useControl` and the error display policy are recipes.
- **What the examples rely on:** mixed behavior/rule lists (examples/basic/src/form.ts:241-346) and several rules per field (245-259).
- **Tests that pin continuity and row-local rules:** src/validation.test.ts:150-161 and 294-303.

### Inferences
- **Concept count for consumers** (what a form author learns):
  - (a), (b′) and c-contrib: identical to today — `rule`, `asyncRule`, `validation()`, `validate()` (a recipe function in c-contrib).
  - c-handle and c-static+R: add `addRules` / `useRules` / a `validated(...)` wrapper next to `addBehavior` / `useBehaviors`, plus the rule that "rules don't go in `createStore({ behaviors })`".
  - c-reducer: removes the rule concept but changes semantics.
- **Concept count in the core:**
  - (a): `Rule` + queue + `validate` + `error` (today's set minus `validating`, `visible`, `disabled`).
  - (b): the same with a key marker instead of a name.
  - c-contrib: `Contribution` + `combine` + an in-place update (+ `ctx.parts`). The rule, queue and validate concepts leave the core.
  - c-handle: `handle.update` (+ multi-update atomicity, + probably `store.contains`), plus #16's protocol made public.
- **Code volume** (qualitative; not measured):
  - (a) and (b) leave the ~300 lines of post-#15 validation code in the core.
  - c-contrib moves them to `recipes/` and adds perhaps a few dozen lines of generic grouping to the core. Most of it is today's `change()` minus the rule-specific checks.
  - c-handle moves the same code and duplicates grouping and transaction logic in the recipe (registry, host filtering, atomic multi-field updates, React hook).
- **Why c-contrib is the smallest clean option:**
  - The generic mechanism already exists in the codebase, specialised for rules.
  - Generalising it answers F1 (reconfiguration), F2 (the in-place update the core needs anyway after #15), F3 (the owner flag via feature registration), F4 (host filtering in the core) and F8 (`when` carried generically).
  - It needs no new public extension protocol.
  - Its main risk is a generic mechanism with one initial user. OR-ing `disabled` (`exclusive()` + `disableWhen` on the same field, src/utilities.ts:217-231, 283-292) and a `warnings` key are plausible second users.
- **If the author accepts a core that owns queue policy but names no key,** (b′) — `rule(node, …)` finding the queue-marked key — is the smallest diff from today: roughly a one-line check change plus parameterising the written key and the collected key (src/validation.ts:282, 313, 514). It also delivers #12 by inference from the key type.
- **Needed whichever option wins:** F5 (force), F6 (failures) and F7 (debounce) need decisions. For recipe options F5 can be solved with public API only (a force-trigger key + `settle` + `collect`). F6 and F7 are probably cleaner as small generic `settle()` / runtime features: `settle` reporting failed runs, and `settle` flushing an in-run debounce via `ctx`.

### Gaps
- No prototype confirms that c-contrib's in-place update preserves `Binding` state and in-flight runs cleanly once #15 lands. It is inferred from the current `apply()` transaction and the `Binding` structure.
- No second real consumer of contributions was confirmed beyond the `disabled` conflict, which is inferred from the code: no test exercises `exclusive()` together with `disableWhen` on the same field.
