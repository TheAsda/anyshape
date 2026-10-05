# Validation is a recipe on key contributions

The core names no meta key, not even `error`. It provides one mechanism with no knowledge of validation: a meta key can declare `combine`, which makes it written by a single owner behavior per node instance. Other declarations then feed that owner through **Contributions**: `contribute(ref, payload, decl)`, read by the owner as `ctx.parts`. Validation (the error type, rule order, sync before async, reuse of checked results, `validate()`) is a **Recipe** built on that mechanism.

We chose this to keep the founding principle that the library does not hard-code which meta keys exist. Every design for this needs one operation: reconfiguring a single writer as declarations arrive and leave, without losing its state. The core already had that operation, privately, for validation (`QueueChange`). Making it generic and key-driven costs about as much as keeping it private, and the core no longer carries one team's validation policy.

Confirmed by a prototype ([#23](https://github.com/TheAsda/anyshape/issues/23), branch `prototype/key-contributions`):
- The owner is updated in place, keeping `ctx.state`.
- `E` and payload types infer through `metaKey<V, P>` and `rule(n, check)`.
- A second user that isn't validation works: `disabled` as an OR of contributions, so `disableWhen` and `exclusive` stop conflicting on one field.

## Considered options

- **Reserve `error` in the core (a).** Rejected. It still needs the same in-place update once async state moves into `ctx.state` ([#15](https://github.com/TheAsda/anyshape/issues/15)), so it saves little. It also keeps `Rule` as a second declaration class and leaves one team's queue policy in the core forever. The author accepts it only as a last resort.
- **A core queue with a key named by the recipe (b′).** This was the fallback if the prototype failed, and it wasn't needed. It keeps every call site, but leaves the queue policy in the core.
- **Recipes without a core mechanism.** Every variant loses a capability:
  - grouping rules before `createStore` breaks adding a rule to a field that already has rules (components, single rows)
  - rules declared on the key can't reference other fields
  - multiple writers merged by a reducer lose "sync before async" and "a guarded rule is absent"
- **Reconfigurable handles** (`addRule(store, …)` / `useRules`). Rejected: they push an imperative registry onto consumers. Rules must stay declarative: plain lists built before React.
- **A fold over part slots**, reviewed on 2026-10-02 ([research](https://github.com/TheAsda/anyshape/blob/research/lazy-fold/docs/research/lazy-fold.md)). Each rule is its own behavior writing a private slot, and the key's definition folds the slots into the key's value. A plain fold only sees results, so every rule runs and async requests start after a sync rule has failed. There are two lazy versions:
  - **gated slots:** each rule reads the prefix of the slots before it;
  - **demand-scheduled slots:** the runtime parks the writers the fold didn't reach.

  Both stop at the first error and rerun less than `combine`. But they lose the shared debounce, turn forcing into a token nobody resets, need incremental ranking, and add more core than they remove. Every version that keeps the policies spanning several rules (one debounce, one force flag, a start decision from the run's cause) needs one evaluator per instance with a `ctx`, which is the owner, so it turns back into `combine`. A fold suits order-free keys like `disabled`, but that isn't worth a second mechanism. Rejected.

## Prior art

Every form library we surveyed reserves errors in its core: TanStack Form, React Hook Form, Final Form, Formik and Angular's forms each have a built-in error slot that their validation writes. None of them keeps validation out of the core, so on this point anyshape departs from its peers on purpose. Those libraries have no core/recipe boundary to protect.

The combining model has precedents outside form state, where a mechanism is kept separate from the policy built on it:

- **CodeMirror 6 facets** ([reference](https://codemirror.net/docs/ref/#state.Facet)). A facet is an extension point: any number of extensions provide inputs, and the facet's `combine` function turns them into one output. The facet object is the typed identity that inputs are attached to. A key definition plays the facet's part here, and `contribute()` plays `facet.of()`. One difference is deliberate: CodeMirror orders inputs by precedence, while anyshape has no precedence between contributions and throws on ambiguity ([#25](https://github.com/TheAsda/anyshape/issues/25)).
- **Angular Signal Forms' metadata keys.** Schema rules contribute values to a metadata key, and the key's reducer combines them. Constraint validators such as `required()` are built on this generic system. Errors themselves still travel on a dedicated channel there, so the precedent covers the mechanism, not the step of moving errors out of the core.

## Consequences

- A guard means different things on a contribution and on a behavior, on purpose. On a contribution, a false guard makes it **absent**, and the owner recomputes without it. On a behavior, `when` skips the run and keeps its last writes.
- Neither the core nor the validation recipe skips hidden or disabled fields. A team writes that as guarded rules (`b.when([s.car.visible], …)`), and absent rules clear the error ([#21](https://github.com/TheAsda/anyshape/issues/21)).
- Contributions are grouped per root store, never per shape node: shapes are shared across stores, rows and tests. Each contribution applies only to instances inside the store it was added on.
- When contributions change while an owner run is in flight, the run is cancelled and rerun with **the cancelled run's cause** (its origins and changed inputs), and `ctx.state` is kept. The async check runs in kept work (`ctx.keep`), so mounting an unrelated rule mid-flight, or an edit to a field only a sync rule reads, re-checks the sync rules and leaves the request in flight running ([#28](https://github.com/TheAsda/anyshape/issues/28)).
- An owner's triggers are the union of its contributions' inputs, so any input change reruns the whole owner. Each combined key's recipe pays for that by making a rerun cheap (`ctx.changed`, results in `ctx.state` keyed on `Part.inputs`, `ctx.keep`).
- An owner that needs other keys of its node declares them by definition with `.uses(…)`, a pipeline step before `.combine(…)` or `.behavior(…)` ([ADR 0002](0002-pipelines-type-calls-with-explicit-type-arguments.md)). The core resolves them under whatever names the node declares them with, and hands their refs to the step as a typed tuple. `createStore` throws when one is missing or declared twice. No code finds a sibling key by name ([#45](https://github.com/TheAsda/anyshape/issues/45)).
- Recipes are copied and adapted, not depended on, so a fix to the validation queue no longer reaches every form automatically.
- The shipped validation recipe hardcodes `string` errors ([#24](https://github.com/TheAsda/anyshape/issues/24)). A team that adapts it to typed errors must infer the error type from the key's ref with `const E` (`rule<V, const E>(node: { _type: V; error: MetaRef<E | undefined, RulePart<E>> }, …)`). Otherwise literal-union errors widen and are rejected.
