# Design principles

What anyshape promises, and what it refuses. Read this to judge whether the library fits your forms, or before you propose a change to it. Each principle says what holds, why, and where it was argued. A **Not in anyshape:** line names an idea that was considered and turned down, so you know not to look for it.

The words in bold (**Shape**, **Node**, **Behavior**, **Guard**, …) are defined in [`GLOSSARY.md`](../GLOSSARY.md). The runtime choices that are hard to reverse have their own decision records in [`docs/adr/`][adr].

## Foundations

### 1. The shape is the single source of truth

Value types, meta types, node identity and lenses all come from the shape. Stores, behaviors and hooks are keyed by the shape's nodes.

**Why:** you declare a form once and the types follow everywhere. A node is both the key and the accessor, so there is no second registry that can drift out of step with the shape.

### 2. Strict inference comes first: the API changes before inference gives way

When a call shape leaves a hole in type inference, the call shape changes. [ADR 0002][adr-0002] is one instance: calls that mix explicit and inferred type arguments became pipelines.

**Why:** a hole in inference quietly accepts wrong code. A call that looks a little unusual but infers fully is the better trade.

**Not in anyshape:** a separate meta registry keyed by path.

Argued in [#2], [#45].

### 3. Rule out a bug by construction, in the types

Prefer an API where the bug can't type-check over a patch that suppresses one case. A recipe states the keys it needs as ref properties of the node it takes (`AnyNode & { readonly error: MetaRef<…> }`), so passing a node without them is a compile error. A key without a payload gets the `NoPayload` brand rather than `never`, because `never` satisfies every constraint.

**Why:** a type that makes the mistake impossible covers every caller; a patch covers the one case someone noticed.

Argued in [#2], [#23], [#27].

### 4. Reusable logic is plain functions with explicit parameters

Rules, behaviors and recipe helpers take what they work on as arguments (`rule(node, check)`, `handleSubmit(store, fn)`). Nothing reads an ambient context or a custom `this`.

**Why:** plain functions type easily, show their data flow at the call site, test without setup, and tree-shake.

**Not in anyshape:** `this`-bound fragments.

### 5. The core depends on neither React nor the DOM

`anyshape` runs anywhere JavaScript runs; `anyshape/react` adds the bindings. Where the DOM would be the obvious tool, the library asks for an interface instead: the focus recipe accepts anything with a `focus()` method, which a DOM input, a custom component's handle or a React Native ref can all provide.

**Why:** a radio group, a date picker or a React Native screen has no single element to hand over.

## Core and recipes

### 6. The core is mechanism and names no meta key

The core holds only what every form needs. It never names a meta key or decides what one means, not even `error`. Validation, submit, focus, `touched`, `dirty` and `disabled` are recipes.

**Why:** one team's validation, submit or disabled policy must not be baked in for everyone else.

Argued in [#18], [#20], [#26], [#50]. See [ADR 0001][adr-0001].

### 7. Recipes build only on the public entries; the core never imports a recipe

Recipes, the React recipes and the examples import only `anyshape` and `anyshape/react`. The core, its tests included, imports nothing from `recipes/`. The lint's boundary rules (`.oxlintrc.json`) enforce both directions. Test fixtures that both sides need are copied across the boundary on purpose, and those copies stay.

**Why:** a copied recipe has to work against the published package unchanged. A core test that leans on a recipe hides a capability the core is missing.

Argued in [#27], [#30], [#31].

### 8. The core grows only for what no recipe can do

A core addition must be generic, carry no meaning, and serve more than one recipe. A new mechanism needs a second user unrelated to the first. When a recipe can do the job with what exists, the job stays in the recipe. When a recipe needs a ref, the core hands it over rather than adding a way to look it up.

**Why:** every core seam is permanent surface, and every user pays for it. A mechanism with one user is a feature in disguise. Key contributions went into the core only after a prototype showed a second user (`disabled` as an OR) beside validation.

**Not in anyshape:** `refOf`, `ctx.reportError`, a core debounce, `skipWhen`.

Argued in [#14], [#21], [#23], [#24], [#37].

### 9. A recipe has no policy options: a team edits its copy

A shipped recipe hard-codes one sensible policy. It has no `on…` callbacks, no option bags and no type parameters for variants. A team that wants another policy changes its copy of the file. Per-call data, such as an async rule's debounce, is not policy and stays.

**Why:** recipes are copied, not depended on. An option only multiplies the code paths that every copy carries.

**Not in anyshape:** `onInvalid`, `validateHidden`, option bags.

Argued in [#12], [#19], [#21], [#24], [#26].

### 10. Recipes don't ship in the package

The package holds `anyshape` and `anyshape/react`. Recipes are copied from `recipes/` at a release tag.

**Why:** they are code you own. A published recipe entry would invite you to depend on it, and then a fix to your copy would mean forking the package. Every recipe imports only the public entries, so a copy works as it is.

Argued in [#4], [#18].

### 11. You own presentation and I/O

The library computes state and gives you the tools to write it. These are yours:

- when an error shows;
- how hidden or disabled fields render;
- parsing and formatting values;
- mapping server errors onto fields, with `store.resolvePath(path)` to find the field and `set` to write its error.

**Why:** these are the decisions that differ most between applications, and a built-in answer is one you would have to work around.

**Not in anyshape:** built-in error display, parse and format helpers, text-input helpers.

## Explicit over implicit

### 12. Nothing implicit: the form submits what the store holds

Neither the core nor a recipe clears, omits, skips or transforms values or fields on its own. Every consequence is a behavior or a guard that someone declared. A team that wants a hidden value cleared declares a behavior that clears it (`clearWhen`); a team that wants a hidden field left unchecked guards its rules (`b.when([s.car.visible], …)`).

**Why:** hiding a section and showing it again keeps what the user typed. Whether a hidden value is submitted is the form author's decision. And a team for which "disabled" means "read-only but submitted" can't be overruled by a policy keyed on the name `disabled`.

Argued in [#21], [#22], [#25], [#28].

### 13. No silent precedence, merging, shadowing or replacing: ambiguity throws

When two declarations could collide, the library throws instead of choosing. It doesn't pick a winner, merge them, or let a later call replace an earlier one. A child named like a meta key throws; the same contribution reaching an instance twice throws; a second `.uses()` or `.aggregate()` throws.

**Why:** a silent choice hides a bug. A shadowed ref would hand a recipe the wrong thing without a word.

Argued in [#13], [#25], [#27], [#45], [PR #47][#47], [PR #55][#55].

### 14. Origin is information, not a bypass

Every write runs the behaviors it affects, whatever its origin. A behavior that should ignore some writes filters them by origin.

**Why:** a write that skipped behaviors would leave derived values stale. The same rule is what lets `touched` and `dirty` be ordinary behaviors: `touched` simply listens to `"user"` writes only.

**Not in anyshape:** silent writes.

### 15. Everything is state, including events

A blur or a submit writes a meta key (`revealed`, `submitting`). Behaviors that react to it depend on that key like on any other.

**Why:** one mechanism covers both, and all of it is visible in meta, where you can read it, test it and subscribe to it.

**Not in anyshape:** an event channel.

### 16. Fail early and loudly, with the fix in the message

A compile error beats a throw at declaration or registration, and that beats a silent no-op. A missing used key, a contribution to a key without `combine`, a second writer or a cycle throws in `createStore` or `addBehavior`, before anything changes, and the message says what to do.

**Why:** a mistake found at the call that made it is cheap; one found in production through a stale value is not.

Argued in [#23], [#25], [#26], [#43], [#45].

### 17. Same semantics in development and production; development only adds diagnostics

A rule that throws in development throws in production too. What development mode adds never changes a result: an error thrown by a behavior points at the place where the behavior was defined, a slow flush logs a warning and shows on a DevTools track, and a few likely mistakes in the React bindings log a warning. The [store page](guide/store.md#development-checks) lists them.

**Why:** if production warned and carried on, an undeclared read would be invisible to cancellation and ordering, and data would go stale only in production, where nobody is looking.

Argued in [#15], [#17].

### 18. Errors are never swallowed or replaced; checks fail closed

A thrown value is passed on and never mutated. Cleanup never replaces your error with its own. A check that throws makes its field invalid, so `validate()` and submit fail, and the bug is logged.

**Why:** a swallowed error is a bug you can't find, and a check that fails open lets bad data through.

Argued in [#15], [#19], [#24], [#26], [#38].

### 19. A surprising but consistent outcome is documented, not special-cased

When the general rule gives an odd-looking result, the docs explain it and the code doesn't grow a branch for it. For example, a guard on a field's `visible` key leaves a value loaded into a hidden field unchecked until it is shown, while a guard on the value that controls visibility starts the check at once.

**Why:** each special case makes the whole model harder to predict.

Argued in [#15], [#21], [#28].

## Keys and references

### 20. No code finds a meta key by a string

A key is reached through a node's ref (`node.error`) or, for a sweep, through its definition (`collect(node, revealed)`). A key never assumes the name it is declared under: its default behavior and its `combine` step receive their own ref and the refs of the keys they use, and keys are matched by definition, so a key works under any name. There is no introspection: code can't list a node's children or ask what keys it declares. Code that needs a ref is handed it, or already holds it.

**Why:** a lookup by name breaks when a key is declared under another name and accepts a foreign key that happens to share the name. An introspection API would bring lookup by name back, and recipes would start walking the shape to apply policy, which is the implicit behavior principle 12 rules out.

**Not in anyshape:** `refOf`, listing a node's children or keys.

Argued in [#27], [#32], [#37], [#40], [#45].

### 21. The same arguments always return the same ref

`node.key`, `countIn`, `initialOf`, `pendingIn`, `pendingOf`, and the refs from `resolvePath` and `collect` return one instance per set of arguments.

**Why:** refs are hook dependencies and subscription keys. A fresh ref on every call would make `useValue` resubscribe on every render.

Argued in [#10], [#14].

### 22. One copy of the core

`anyshape/react` imports the core and never carries its own copy, and the type declarations of both entries share one set of classes. The package check verifies both on the packed tarball.

**Why:** node internals are keyed by unique symbols and the ref classes are nominal. A second copy of the core would have its own symbols and classes, so `instanceof` checks and internal lookups would fail between the copies, and the core's types would not fit the React hooks.

Argued in [#4], [#13], [#31].

### 23. A key's default behavior is confined to its own node

The behavior a key definition declares (`.behavior()`) reads and writes only the node that declares the key, plus the keys it uses there.

**Why:** a key definition is written before any node exists, and a reusable shape appears in several places, so its own node is the only target it can name. It also rules out action at a distance: declaring a key never changes some other node.

## A small surface

### 24. Start minimal, and remove what has no practical use

An option or feature without a concrete use case is removed rather than kept or extended. A mechanism is added only when a real case needs it, and a removed one can come back when something does.

**Why:** in a library, every option is permanent surface that every reader has to understand.

Argued in [#19], [#24], [#25], [#26], [#43], [#50].

### 25. One mechanism, no modes

The latest run wins, with no queueing modes. Sync and async runs follow the same rules. `settle()` only waits: it takes no options, starts nothing and reports nothing. Each thing has one way to be declared.

**Why:** a mode doubles what every reader has to keep in mind, and every combination of modes needs its own tests.

Argued in [#15], [#24].

### 26. Debug aids stay out of the public API, and production pays nothing for them

Diagnostics run in development only, have no options, and use a fixed budget. A production build measures nothing and holds no diagnostics code. Debugging needs are met by the DevTools tracks, not by an API.

**Why:** an inspection API would be permanent public surface for a need that only arises while debugging.

**Not in anyshape:** `store.inspect`, listings of who writes a key.

Argued in [#17], [#25].

### 27. Rules are declarative; derived state is derived; reference kinds are closed

Behaviors and contributions are plain lists, built before React, with no imperative registries or reconfigurable handles. A state the core can compute, such as **Pending**, is never a key someone declares and writes. The kinds of reference (value, meta, count, initial, pending) are a closed set; you get other derived values from a behavior that writes a meta key, or from a key's `aggregate`.

**Why:** a list can be checked as a whole at registration. A declared copy of derived state can disagree with the real thing. A new reference kind needs hooks deep in the flush and change detection.

Argued in [#14], [#15], [#26].

## Runtime

### 28. The runtime's invariants

These hold for every behavior and every owner of a combined key, sync or async, and every registration is checked against them:

- **Declared access.** A run reads and writes only the refs its behavior declares; anything else throws. See [ADR 0003][adr-0003].
- **One writer per target.** Each value and each meta key has at most one behavior writing it. See [ADR 0005][adr-0005].
- **Own scope.** A behavior writes only inside its own scope: the form root, or its own row.
- **Static order.** The run order comes from the declarations alone. See [ADR 0004][adr-0004].
- **Cycles rejected first.** A cycle is rejected before any state changes.
- **Once per flush.** Each instance runs at most once per flush and sees final values. The one exception, a reader of a pending tally, is explained in [ADR 0004][adr-0004].
- **Own writes never retrigger.** A behavior's writes never trigger it again, in any of its instances.
- **Atomic registration.** Every check runs before anything changes, so a registration that fails changes nothing.

**Why:** they make behaviors composable and their order predictable. A proposal for a new mechanism can be checked against this list.

Argued in [#3], [#6], [#15], [#23], [#28], [#43].

### 29. Consistency by cancellation, transactional state, no early writes

`ctx` is a plain object. A run sees consistent values because any change to its inputs cancels it, not because the form is copied. Its writes apply only when it completes, and `ctx.state` is saved only then. Kept work (`ctx.keep`) depends only on its key and never sees `ctx`.

**Why:** consistent reads without copying the form or wrapping it in a Proxy. Writes that appear before a run completes would show other behaviors a state the run might still abandon.

**Not in anyshape:** publishing writes early, Proxy snapshots.

Argued in [#15], [#24], [#28].

### 30. Sibling rows are independent

A row never orders, conflicts with or pays for its sibling rows. Only a store and the stores that enclose it can affect each other.

**Why:** sibling rows can't change each other's fields, so any ordering edge between them is spurious, and with many rows those edges cost time that grows with the square of the row count.

Argued in [#3], [#61], [#63].

## Performance

### 31. The cost of a change scales with what it affects

A change costs time in proportion to what it affects, not to the size of the form or the number of rows. Mounting, editing and registering row by row is linear in rows and registrations; the hot path allocates nothing; removed rows, their stores and their behaviors can be garbage-collected.

**Why:** row components mount one at a time, so any step that is linear per mount becomes quadratic over a list.

Argued in [#14], [#45], [#58], [#61], [#63].

[adr]: https://github.com/TheAsda/anyshape/tree/master/docs/adr
[adr-0001]: https://github.com/TheAsda/anyshape/blob/master/docs/adr/0001-validation-is-a-recipe-on-key-contributions.md
[adr-0002]: https://github.com/TheAsda/anyshape/blob/master/docs/adr/0002-pipelines-type-calls-with-explicit-type-arguments.md
[adr-0003]: https://github.com/TheAsda/anyshape/blob/master/docs/adr/0003-behaviors-declare-their-dependencies.md
[adr-0004]: https://github.com/TheAsda/anyshape/blob/master/docs/adr/0004-one-ordered-pass-per-flush.md
[adr-0005]: https://github.com/TheAsda/anyshape/blob/master/docs/adr/0005-one-writer-per-target.md
[#2]: https://github.com/TheAsda/anyshape/issues/2
[#3]: https://github.com/TheAsda/anyshape/issues/3
[#4]: https://github.com/TheAsda/anyshape/issues/4
[#6]: https://github.com/TheAsda/anyshape/issues/6
[#10]: https://github.com/TheAsda/anyshape/issues/10
[#12]: https://github.com/TheAsda/anyshape/issues/12
[#13]: https://github.com/TheAsda/anyshape/issues/13
[#14]: https://github.com/TheAsda/anyshape/issues/14
[#15]: https://github.com/TheAsda/anyshape/issues/15
[#17]: https://github.com/TheAsda/anyshape/issues/17
[#18]: https://github.com/TheAsda/anyshape/issues/18
[#19]: https://github.com/TheAsda/anyshape/issues/19
[#20]: https://github.com/TheAsda/anyshape/issues/20
[#21]: https://github.com/TheAsda/anyshape/issues/21
[#22]: https://github.com/TheAsda/anyshape/issues/22
[#23]: https://github.com/TheAsda/anyshape/issues/23
[#24]: https://github.com/TheAsda/anyshape/issues/24
[#25]: https://github.com/TheAsda/anyshape/issues/25
[#26]: https://github.com/TheAsda/anyshape/issues/26
[#27]: https://github.com/TheAsda/anyshape/issues/27
[#28]: https://github.com/TheAsda/anyshape/issues/28
[#30]: https://github.com/TheAsda/anyshape/issues/30
[#31]: https://github.com/TheAsda/anyshape/issues/31
[#32]: https://github.com/TheAsda/anyshape/issues/32
[#37]: https://github.com/TheAsda/anyshape/issues/37
[#38]: https://github.com/TheAsda/anyshape/issues/38
[#40]: https://github.com/TheAsda/anyshape/issues/40
[#43]: https://github.com/TheAsda/anyshape/issues/43
[#45]: https://github.com/TheAsda/anyshape/issues/45
[#47]: https://github.com/TheAsda/anyshape/pull/47
[#50]: https://github.com/TheAsda/anyshape/issues/50
[#55]: https://github.com/TheAsda/anyshape/pull/55
[#58]: https://github.com/TheAsda/anyshape/issues/58
[#61]: https://github.com/TheAsda/anyshape/issues/61
[#63]: https://github.com/TheAsda/anyshape/issues/63
