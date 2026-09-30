# Combination patterns: many declarative contributions -> one owned value (prior art for form-lib)

Scope: prior art for how a small core can let independent, declaratively registered contributions (e.g. validation rules from a list, `when`-guarded rules, array row templates) combine into one writer of one target (e.g. the `error` key on a node), without the core naming the key. The five candidates:

- **C1**: the key declares `combine(self, contributions) => behavior`; code elsewhere calls `contribute(ref, payload)`.
- **C2**: multiple writers per target plus a reducer/merge function on the key.
- **C3**: the recipe groups declarations itself, then hands plain behaviors to the core (one writer).
- **C4**: reconfigurable behavior handles (add/remove/replace a registered behavior's config at runtime).
- **C5**: the core reserves one well-known key name.

Each section says which candidate a precedent supports or argues against.

## Q1. Which precedents follow the "extension point with a combine function" pattern (C1), and how do they handle ordering, identity, dynamic change, typing and ownership?

### Takeaway
CodeMirror 6 Facets are almost exactly C1. A facet is an extension point that takes any number of inputs and has a `combine` function producing one output. Inputs are ordered by explicit precedence category and then by position in the flattened config. The facet object itself is the identity/type token. Angular `multi: true` providers (including `NG_VALIDATORS`) are a simpler version of the same idea: the combine step is fixed to "collect into an array" and the consumer does the rest. Both show that the "extension point" object, not a string, should carry the type and the combine policy.

### Cited Findings
**CodeMirror 6 Facets**
- "A _facet_ is an extension point. Different extension values can provide values for the facet." Depending on the facet, the output "may just be an array of provided values, or some value computed from those." — [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- Examples of combine policies in core: single-value facets such as tab size take "the value with the highest precedence"; handler facets are "sorted by precedence, so that you can try them one at a time"; others "compute the logical _or_ of the input values." — [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- `Facet.define({ combine })`: "How to combine the input values into a single output value. When not given, the array of input values becomes the output. This function will immediately be called on creating the facet, with an empty array, to compute the facet's default value when no inputs are present." — [CodeMirror reference, Facet](https://codemirror.net/docs/ref/#state.Facet%5Edefine)
- Other `Facet.define` options: `compare` (output equality, used to decide whether the facet changed), `compareInput` (input equality, avoids recomputation), `static` (forbids dynamic inputs), `enables` (extensions automatically added to any state where this facet is provided). — [CodeMirror reference, Facet](https://codemirror.net/docs/ref/#state.Facet%5Edefine)
- Contributions: `facet.of(value)` adds a static input. `facet.compute(deps, get)` computes an input from state with declared dependencies, and it re-runs only when those change. `facet.computeN` yields zero or more inputs. `facet.from(field)` sources an input from a state field. — [CodeMirror reference, Facet](https://codemirror.net/docs/ref/#state.Facet)
- Ordering: "the precedence of extensions is determined first by explicitly set precedence category, and within that, by the position the extension has in the (flattened) collection." — [CodeMirror System Guide](https://codemirror.net/docs/guide/). `Prec.highest/high/default/low/lowest` set that category. Extensions without explicit precedence inherit it from their nearest parent. — [CodeMirror reference, Prec](https://codemirror.net/docs/ref/#state.Prec)
- Identity/dedup: extensions "are deduplicated during the configuration process… if the same one gets included multiple times, it'll only take effect once." — [CodeMirror System Guide](https://codemirror.net/docs/guide/). The design post adds that deduplication is "by identity—if the same extension value occurs multiple times in a configuration, only the one in the highest-precedence position is used." — [Marijn Haverbeke, "Facets" design post](https://marijnhaverbeke.nl/blog/facets.html)
- Design rationale: facets exist so that "multiple extensions that don't know anything about each other can be combined, and compose in ways that don't cause problems." A facet "defines an extension point. It takes any number of input values and produces an output value." — [Marijn Haverbeke, "Facets"](https://marijnhaverbeke.nl/blog/facets.html)
- Reading: "anyone with access to the state and the facet can read its output value" (`state.facet(f)`). The facet may be exported or kept module-private. — [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- Separately, the single-owner value primitive is the **StateField**. Its `update(value, transaction)` works "something like a reducer", and `provide(field)` lets a field feed facets (typically via `Facet.from`). — [CodeMirror System Guide](https://codemirror.net/docs/guide/); [CodeMirror reference, StateField](https://codemirror.net/docs/ref/#state.StateField)

**Angular multi providers / NG_VALIDATORS**
- "Use the `multi: true` flag when multiple providers contribute values to the same token". Injecting the token gives "an array containing instances of all three interceptors." — [Angular: Defining dependency providers](https://angular.dev/guide/di/defining-dependency-providers)
- `InjectionToken` is identified by object reference. The string argument is only a debugging description. — [Angular: Defining dependency providers](https://angular.dev/guide/di/defining-dependency-providers)
- `NG_VALIDATORS`: "An InjectionToken for registering additional synchronous validators used with AbstractControls", typed `InjectionToken<readonly (Function | Validator)[]>`. Validator directives register with `{provide: NG_VALIDATORS, useExisting: forwardRef(() => Dir), multi: true}`. — [Angular API: NG_VALIDATORS](https://angular.dev/api/forms/NG_VALIDATORS)
- Angular forms run async validators after sync ones: "Asynchronous validation happens after the synchronous validation, and is performed only if the synchronous validation is successful". The control is `pending` meanwhile. Async validators register via `NG_ASYNC_VALIDATORS`. — [Angular: Form validation](https://angular.dev/guide/forms/form-validation)
- Errors from multiple validators are merged into one errors object keyed by error name (e.g. `{required: true, minlength: {...}}`). — [Angular: Form validation](https://angular.dev/guide/forms/form-validation)
- Mixing `multi: true` and non-multi providers for the same token is an error, because a provider either extends or overrides a token. — [thoughtram (Pascal Precht), "Multi Providers in Angular"](https://blog.thoughtram.io/angular2/2015/11/23/multi-providers-in-angular-2.html) (secondary source. I did not find the exact error text in angular.dev docs.)

**VS Code contribution points**
- "Contribution Points are a set of JSON declarations that you make in the `contributes` field of the `package.json` Extension Manifest". They are static and declarative. — [VS Code: Contribution Points](https://code.visualstudio.com/api/references/contribution-points)
- Ordering is explicit, not implicit. Menu items are sorted by group (lexicographic), and "The group-local order of a menu item is specified by appending `@<number>` to the group identifier". Settings without an explicit `order` appear "in lexicographical order… (not the order in which they're listed in the manifest)". — [VS Code: Contribution Points](https://code.visualstudio.com/api/references/contribution-points)

**Salsa accumulators**
- Salsa accumulators are a side channel for reports such as diagnostics. Tracked functions push values, and callers later "ask for the set of diagnostics that were accumulated by some particular tracked function." — [Salsa book: Overview](https://salsa-rs.github.io/salsa/overview.html)

### Inferences
- CodeMirror is the strongest support for **C1**. Its API splits into three parts that match form-lib's: the extension point, which is a typed object and not a string (`Facet<Input, Output>`); contributions (`of`, `compute` with declared deps); and a combine policy owned by whoever defines the facet. The core never interprets the output. It only orders inputs, dedups them, and recomputes when deps change. That is the "mechanism, not policy" split the team wants.
- CodeMirror's `enables` option is the missing piece for form-lib's "combine returns a behavior". A facet can pull in the one consumer (a StateField or view plugin) that turns the combined value into effects. So one owner per output is guaranteed by construction: the facet definer, not the contributors. For form-lib, `combine(self, contributions) => behavior` merges `combine` and `enables` into one step. The core's one-writer rule then holds automatically, because only the key definer produces the writer.
- CodeMirror's ordering rule ("precedence category, then flattened declaration order") fits "declaration order, sync until first error, then async" well. Form-lib probably needs only declaration order. A `Prec`-like category is an optional add-on, and a small library can defer it.
- Angular's plain `multi: true` (combine is "make an array") shows that a C1 core can hard-code "array in declaration order" and push all semantics into the consumer. Angular forms then encode "sync first, async only if sync passes", which is exactly the validation recipe wanted here. That is evidence the policy belongs in recipe code, since it sits in the forms package rather than in DI.
- The Angular "no mixing multi and single providers" rule is a useful guardrail for form-lib. A target is either contributed-to (C1) or directly written (single writer), never both. The core should reject the mixed case at registration.
- VS Code shows the risk of relying on implicit order. Its static declarations need explicit `order` / `@n` because manifest order is not preserved across extensions. For form-lib, contributions from separate places (a list, `when`, row templates) need a defined flattening order. Otherwise "declaration order" is ambiguous.

### Gaps
- I did not find an official Angular statement of the order in which multi-provider values appear, beyond the examples. Order is probably registration order, but I could not verify that from angular.dev.
- I did not verify how CodeMirror orders dynamic `compute` inputs relative to static `of` inputs within one precedence level beyond "position in the flattened collection".
- The Salsa accumulator ordering guarantees were not stated on the overview page.

## Q2. What do multi-writer systems with merge/conflict rules (C2) teach about ownership and precedence?

### Takeaway
Real multi-writer systems do not usually "just reduce". They either track per-field ownership and treat disagreement as a conflict (Kubernetes server-side apply), or they need explicit ordering to avoid nondeterminism (Bevy ambiguity detection, Redux `reduceReducers`). C2 moves the hard question ("which writer wins, in what order") into the core. That argues against C2 for a small core that already enforces one writer per target.

### Cited Findings
**Kubernetes server-side apply (SSA)**
- To manage a field "means that the user relies on and expects the value of the field not to change. The user who last made an assertion about the value of a field will be recorded as the current field manager." Ownership is recorded in `metadata.managedFields`. — [Kubernetes: Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- "When two or more appliers set a field to the same value, they share ownership of that field. Any subsequent attempt to change the value of the shared field, by any of the appliers, results in a conflict." — [Kubernetes: Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- "A conflict is a special status error that occurs when an Apply operation tries to change a field that another manager also claims to manage." The resolutions are: force (becomes sole manager, "removes the field from all other managers' entries"), drop the field from your manifest, or match the value to share ownership. Force is recommended "if the applier is an automated process like a controller". — [Kubernetes: Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- Declarative removal: if a field is removed from a manifest and no other manager owns it, it "is either deleted from the live object or reset to its default value". — [Kubernetes: Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- Merge granularity is declared on the schema. `listType: atomic` makes one manager own the whole list. `listType: set` / `map` lets different managers own different items, identified by value or by `x-kubernetes-list-map-keys`. `mapType: granular` vs `atomic` works the same way for maps. — [Kubernetes: Server-Side Apply, merge strategy](https://kubernetes.io/docs/reference/using-api/server-side-apply/#merge-strategy)
- The stated goal: "This prevents an applier from unintentionally overwriting the value set by another user." — [Kubernetes: Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)

**Bevy ECS**
- Systems run in parallel. When access does not force serialization, "the order is nondeterministic by default… the order could even change every frame!" Explicit ordering uses `.before()`, `.after()`, `.chain()` and system sets. — [Unofficial Bevy Cheat Book: System Order](https://bevy-cheatbook.github.io/programming/system-order.html) (community book, marked outdated for Bevy 0.13)
- `ScheduleBuildSettings.ambiguity_detection`: "Determines whether the presence of ambiguities (systems with conflicting access but indeterminate order) is only logged or also results in an Ambiguity warning or error." It defaults to `LogLevel::Ignore`. — [docs.rs: bevy ScheduleBuildSettings](https://docs.rs/bevy/latest/bevy/ecs/schedule/struct.ScheduleBuildSettings.html)

**Redux**
- `combineReducers` delegates "the work of updating each slice of state to a specific slice reducer". It is "deliberately limited to handle a single common use case" and does not order slice reducer calls or share data across slices. — [Redux: Beyond combineReducers](https://redux.js.org/usage/structuring-reducers/beyond-combinereducers)
- `reduceReducers` "takes multiple reducers and runs `reduce()` on them, passing the intermediate state values to the next reducer in line". The order matters: the first reducer must define initial state. — [Redux: Beyond combineReducers](https://redux.js.org/usage/structuring-reducers/beyond-combinereducers)

**ProseMirror props (first-wins multi-writer)**
- `someProp` "Goes over the values of a prop, first those provided directly, then those from plugins given to the view, then from plugins in the state (in order)". Handler functions "are called one at a time… until one of them returns true". For other props, "the first plugin that yields a value gets precedence." — [ProseMirror reference](https://prosemirror.net/docs/ref/#view.EditorView.someProp)
- A plugin's own state is a single-owner StateField (`init`/`apply`). `PluginKey` allows only one plugin per key in a state. — [ProseMirror reference](https://prosemirror.net/docs/ref/#state.PluginKey)

### Inferences
- SSA is the best-documented multi-writer design. Its lesson for form-lib: once several writers touch one target, you need per-writer identity (a "manager"), recorded ownership, a conflict rule and a force/escape hatch. That is a lot of conceptual weight. SSA argues against **C2** as the general mechanism, and it indirectly supports the existing "exactly one writer per target" rule.
- SSA's `listType: map` with keys is relevant if contributions come from array row templates. Contributions need stable identities (keys) so that adding or removing a row removes only that row's contributions. That applies under C1 as well.
- Bevy's ambiguity detection is the ECS view of the same problem: two writers of one component without an ordering is a detectable schedule error. It defaults to ignored, and several writers are allowed. Form-lib's one-writer rule is stricter and simpler. If C2 were adopted, form-lib would need an ordering constraint language like `.before()/.after()`, which is further evidence against C2.
- Redux's `reduceReducers` is C2 in miniature: several writers of one state, with order-dependent results. Redux docs present it as an escape hatch beyond the simple "one reducer owns one slice" model.
- ProseMirror's "first-wins, in plugin order" is a C2 variant with a fixed merge policy in the core. It is simple, but the core then owns a policy, which is what form-lib wants to avoid.

### Gaps
- I did not find primary documentation for Adapton, Recoil selectors, or Elm and event-sourcing projections within this session's budget. Their positions (derived values are single-owner functions of inputs, and projections fold one event stream) are consistent with Q3 below but uncited here.
- The fetched Bevy ordering guidance comes from the community cheat book, not the official Bevy book.

## Q3. How do derived-value systems model "one value from many inputs", and does that support recipe-side grouping (C3)?

### Takeaway
Reactive and derived-value systems (MobX computed, Jotai derived atoms, Salsa tracked functions, CodeMirror StateField, Datalog aggregates) model "one value from many inputs" as a single pure function that reads its inputs. Many-to-one is solved by one owner that pulls inputs, not by many writers that push. C3 is exactly this pattern with the grouping done in userland. It is simple and type-safe, but it only works when all contributions are visible at one site. Scattered declarations (`when` guards, row templates) are where C3 hurts and where C1 exists to help.

### Cited Findings
- MobX computeds "should not have side effects or update other observables". They are cached and recompute only when their observables change, "similar to spreadsheet formulas". Reactions and autorun are the side-effect counterpart. — [MobX: Computeds](https://mobx.js.org/computeds.html)
- Jotai: a read-only derived atom computes its value from other atoms via `get()`. Write functions can update source atoms. "atom() creates an atom config", and atoms are identified by object reference. — [Jotai: Composing atoms](https://jotai.org/docs/guides/composing-atoms)
- Salsa: "Everything else in your program is ultimately a deterministic function of these inputs". Tracked functions memoize, and Salsa records which inputs each one reads. — [Salsa book: Overview](https://salsa-rs.github.io/salsa/overview.html)
- Soufflé Datalog aggregates (`min`, `max`, `sum`, `count`) fold all matching tuples into one value, e.g. `n = sum y : Prime(y)`. — [Soufflé: Aggregates](https://souffle-lang.github.io/aggregates)
- Redux `combineReducers` composition is userland code: reducers are plain functions composed with helpers (e.g. `compose(undoReducer, filterReducer(...), sliceReducerA)`), and the store only sees one root reducer. — [Redux: Beyond combineReducers](https://redux.js.org/usage/structuring-reducers/beyond-combinereducers)
- unified presets are "sharable configuration" bundling `plugins` and `settings`. A preset is userland grouping that expands into plain plugin registrations. — [unified README](https://github.com/unifiedjs/unified)
- unified: "If the processor is already using a plugin, the previous plugin configuration is changed based on the options that are passed in… the plugin is not added a second time." — [unified README](https://github.com/unifiedjs/unified)

### Inferences
- These sources support **C3** as the baseline. The core stays "one writer per target". A recipe function like `validate(field, rules[])` sorts rules, splits sync from async, and returns one behavior. Typing is ordinary function typing, and debugging is trivial because the writer is ordinary code. Redux and unified presets show that ecosystems thrive with userland composition on top of a minimal core.
- C3 breaks down when contributions are declared in places the grouping call cannot see: a rule added by a `when` elsewhere, or a rule declared on a row template that must apply to every row. The recipe then has to rebuild a registry (collect, order, dedup, dispose), which is C1 in userland. If that registry needs core hooks anyway (row lifecycle, reactivity of `when`), it is a signal to move the mechanism into the core as C1.
- The "pull, don't push" lesson also applies inside C1. The combined behavior should read contributions as inputs and own the output, as CodeMirror's facet-to-StateField flow does. Contributors should never write the target.
- Datalog aggregates have a caveat: they are order-insensitive folds (sum/min/count). Validation's "first error in declaration order" is an ordered fold, so the combine function must receive an ordered list, as CodeMirror guarantees, not a set.

### Gaps
- Soufflé's docs page did not state stratification rules or determinism for aggregates in the fetched excerpt. Do not cite it for those points.
- I found no primary source for Excel/spreadsheet "one formula per cell" ownership. The analogy is stated here only as inference, via MobX's own "spreadsheet formulas" comparison.

## Q4. What precedents exist for dynamic add/remove of contributions and reconfigurable handles (C4)?

### Takeaway
Two families exist. The CodeMirror style declares a replaceable slot (a Compartment) whose contents are swapped through the normal state update, and all facets recompute. The Angular forms style keeps an imperative handle (`addValidators`/`removeValidators`) plus a manual "recompute now" call (`updateValueAndValidity`). CodeMirror's style keeps declarativeness and works with C1. Angular's style is easy to explain but easy to forget to trigger.

### Cited Findings
- CodeMirror `Compartment.of(ext)` wraps part of the configuration so it can be replaced dynamically. `compartment.reconfigure(content)` returns a state effect that swaps the contents inside a transaction. — [CodeMirror reference, Compartment](https://codemirror.net/docs/ref/#state.Compartment); [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- From the design post: "you tag part of your initial extension tree as a compartment, and then later replace only that part of the tree", and reconfiguration does not lose state such as undo history. — [Marijn Haverbeke, "Facets"](https://marijnhaverbeke.nl/blog/facets.html)
- CodeMirror `facet.compute(deps, get)` provides dynamic inputs whose value (not presence) changes with state. `static: true` on a facet forbids such dynamic inputs. — [CodeMirror reference, Facet](https://codemirror.net/docs/ref/#state.Facet)
- Angular reactive forms: `addValidators()`, `removeValidators()`, `setValidators()`, `clearAsyncValidators()` change validators at runtime. After changing them, `updateValueAndValidity()` recalculates status. — [Angular: Form validation](https://angular.dev/guide/forms/form-validation)
- Kubernetes SSA shows declarative removal: omit the field from your next apply, and ownership is released and the value is reset if no one else owns it. — [Kubernetes: Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- unified freezes a processor on first use: "When a processor is frozen it cannot be unfrozen", which prevents further `.use()`. — [unified README](https://github.com/unifiedjs/unified)

### Inferences
- **C4** (mutable behavior handles) is closest to Angular's `add/removeValidators` model. It works, but it is imperative, needs an explicit recompute trigger, and makes "what is the current config?" a runtime question. That hurts declarativeness and debuggability.
- A cleaner fit for form-lib is to express dynamics as data, not handle mutation. A `when` guard is like CodeMirror's `compute`: the contribution is always registered, but its payload or activity depends on state. Row templates are like compartments: a scoped group of contributions created and disposed with the row. This makes C4 unnecessary if C1 contributions can be conditional and scoped.
- SSA's "omit to release" and CodeMirror's "reconfigure a compartment" both treat removal as producing a new declaration set, not deleting a handle. That fits form-lib's identity needs: each contribution's identity is its position in a scoped declaration, and it disappears with its scope.
- unified's freeze-after-use is the opposite extreme (no dynamics). It is not a fit for rows, but it shows that "configure, then freeze" greatly simplifies reasoning.

### Gaps
- I did not check how Angular orders validators after `addValidators` (appended vs deduped), or whether it cancels in-flight async validators when validators change. The fetched docs page did not address cancellation.

## Q5. Well-known string key vs typed token (C5): what do precedents do?

### Takeaway
Mature extensible systems avoid reserving plain string names in the core. They use unique object or symbol tokens that carry a type and optionally a description string for debugging (Angular `InjectionToken`, CodeMirror `Facet`, ProseMirror `PluginKey`, Jotai atoms, JS well-known Symbols). A reserved token is acceptable only for a protocol the core itself must execute. This argues against C5 as a string, and suggests that if anything is reserved, it should be a token the recipe can create.

### Cited Findings
- Well-known Symbols "serve as 'protocols' for certain built-in JavaScript operations, allowing users to customize the language's behavior" (e.g. `Symbol.hasInstance` for `instanceof`). "Every `Symbol()` call is guaranteed to return a unique Symbol". `Symbol.for(key)` symbols are shared in a global registry and "not guaranteed to be unique". — [MDN: Symbol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol)
- Angular `InjectionToken` is identified by object reference. The string passed to the constructor is only a description for debugging. — [Angular: Defining dependency providers](https://angular.dev/guide/di/defining-dependency-providers)
- CodeMirror facets are values created by `Facet.define`, which may be exported publicly or kept module-private. Only holders of the facet object can read it. — [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- ProseMirror `PluginKey` gives keyed access to a plugin and its state without holding the plugin instance. Only one plugin per key can exist in a state. — [ProseMirror reference, PluginKey](https://prosemirror.net/docs/ref/#state.PluginKey)
- Jotai atoms are config objects identified by reference. — [Jotai: Composing atoms](https://jotai.org/docs/guides/composing-atoms)
- Angular forms reserve a token for validators (`NG_VALIDATORS`), but it lives in the forms package, not in DI core. DI core only provides the general `multi` mechanism. — [Angular API: NG_VALIDATORS](https://angular.dev/api/forms/NG_VALIDATORS); [Angular: Defining dependency providers](https://angular.dev/guide/di/defining-dependency-providers)

### Inferences
- **C5** in string form ("the core knows `error`") conflicts with the goal that the core names no metadata keys. The precedents show the policy token belongs to the layer that owns the policy. Angular put `NG_VALIDATORS` in `@angular/forms`, not `@angular/core` DI, and CodeMirror's core never names language features.
- If form-lib keys are already typed objects (key refs), C1's "key declares combine" matches the InjectionToken/Facet pattern: the key is the token, carries its type, and owns its combine policy. The recipe creates the `error` key, and the core never sees a string.
- ProseMirror's "one plugin per key" is the same invariant as form-lib's "one writer per target". With C1, the invariant becomes "one combine per key", and contributions are unlimited.

### Gaps
- None critical. The specific claims about React context as a token were not fetched, but React context objects play the same role (`createContext` returns an identity object).

## Q6. Cross-cutting trade-offs for a small TypeScript library: what does the prior art imply for each candidate?

### Takeaway
The evidence points to **C1 (facet-style combine + contribute), with the grouping function owned by the recipe** as the most precedented design for scattered declarative contributions. **C3** is a good baseline and a fallback when all rules are colocated. **C2** has the most conceptual weight (it needs SSA-style ownership and conflict machinery or Bevy-style ordering constraints). **C4** is precedented (Angular) but imperative. **C5** as a string is argued against by every token-based precedent.

### Cited Findings
- Ordering in C1 can be fully defined by "precedence category, then flattened declaration position". — [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- A combine function called with `[]` gives a well-defined default when there are no contributions. — [CodeMirror reference, Facet](https://codemirror.net/docs/ref/#state.Facet%5Edefine)
- Deduplication by identity lets shared contributions be included many times safely. — [Marijn Haverbeke, "Facets"](https://marijnhaverbeke.nl/blog/facets.html)
- Multi-writer designs need recorded ownership and conflict errors ([Kubernetes SSA](https://kubernetes.io/docs/reference/using-api/server-side-apply/)) or explicit ordering with ambiguity detection ([docs.rs Bevy ScheduleBuildSettings](https://docs.rs/bevy/latest/bevy/ecs/schedule/struct.ScheduleBuildSettings.html)).
- Validation-specific precedent: sync validators first, and async validators only if sync passes, with a `pending` status. Rules are registered as multi-provider contributions. — [Angular: Form validation](https://angular.dev/guide/forms/form-validation); [Angular API: NG_VALIDATORS](https://angular.dev/api/forms/NG_VALIDATORS)
- Mixing "contributed" and "directly provided" on one token is rejected. — [thoughtram, Multi Providers in Angular](https://blog.thoughtram.io/angular2/2015/11/23/multi-providers-in-angular-2.html)

### Inferences
Candidate-by-candidate summary (all rows are inferences from the findings above):

| Candidate | Supported by | Argued against by | Conceptual weight | Type-safety | Debuggability | Declarative-ness |
|---|---|---|---|---|---|---|
| C1 combine + contribute | CodeMirror Facets (`combine`, `of`/`compute`, `enables`, `Prec`); Angular `multi` + NG_VALIDATORS; VS Code contribution points; Salsa accumulators | (none directly). The main cost is one new concept (extension point) | Medium: one new primitive, but it replaces ad hoc registries | High: key is a generic token `Key<Contribution, Output>` like `Facet<I,O>` | Good if the core can list contributions per key in order (CodeMirror exposes inputs via config, Angular via injected array) | High |
| C2 multi-writer + reducer | Redux `reduceReducers`; ProseMirror first-wins props | Kubernetes SSA (needs managers, conflicts, force); Bevy ambiguity detection (needs ordering constraints); Redux docs treat it as an escape hatch | High: ownership, ordering and conflict semantics in the core | Medium: the reducer's type must fit all writers | Poor: "who wrote this?" needs SSA-style `managedFields` | Medium |
| C3 recipe groups first | Redux `combineReducers`/compose; unified presets; MobX computed; Jotai derived atoms | Breaks when declarations are scattered (`when`, row templates), because the recipe ends up re-implementing C1 | Lowest in the core | High (plain functions) | Best (writer is plain code) | High where rules are colocated, lower otherwise |
| C4 reconfigurable handles | Angular `add/removeValidators` + `updateValueAndValidity`; CodeMirror Compartments (declarative variant) | unified's freeze-after-use shows the simplicity of avoiding it; Angular needs a manual recompute | Medium | Medium | Medium to poor (runtime-mutated config) | Low (imperative) unless done compartment-style |
| C5 reserved key name | JS well-known symbols (only for language-executed protocols); ProseMirror one-plugin-per-key invariant | InjectionToken, Facet, PluginKey, Jotai atom identity all prefer object tokens; Angular keeps NG_VALIDATORS out of DI core | Low | Low if a string, OK if a symbol/token | OK | N/A |

- Suggested synthesis for form-lib: key refs act as tokens (as with `InjectionToken`/`Facet`). A key may declare `combine(self, contributions) => behavior`, which also acts as `enables`. Contributions are ordered by flattened declaration position, with an optional precedence category later. They are deduplicated by identity and scoped to their declaring context, e.g. a row, so they disappear with it (as with a compartment or SSA's "omit to release"). The core enforces "a key is either combined or directly written, never both" (as Angular does for multi and non-multi providers). The error recipe then implements Angular's "sync in order until first error, then async" inside its own `combine`.
- For debuggability, C1 should expose "list contributions for key K on node N, in order, with source". This is the lightweight version of SSA `managedFields`, and it is the main defense against the "spooky action at a distance" risk of any contribution system.

### Gaps
- I found no published criticism or post-mortem of CodeMirror facets (for example about learning curve or debugging difficulty). The design post does not discuss rejected alternatives, so C1's downsides above are inferred, not sourced.
- I did not find how CodeMirror or Angular surface "which contribution came from where" for debugging. Treat that recommendation as a design suggestion, not precedent.
