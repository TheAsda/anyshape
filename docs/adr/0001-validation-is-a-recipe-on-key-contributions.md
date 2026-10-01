# Validation is a recipe on key contributions

The core names no meta key, not even `error`. It provides one mechanism with no knowledge of validation: a meta key can declare `combine`, which makes it written by a single owner behavior per node instance. Other declarations then feed that owner through **Contributions**: `contribute(ref, payload, decl)`, read by the owner as `ctx.parts`. Validation (the error type, rule order, sync before async, reuse of checked results, the hidden/disabled skip, `validate()`) is a **Recipe** built on that mechanism.

We chose this to keep the founding principle that the library does not hard-code which meta keys exist. Every design for this needs one operation: reconfiguring a single writer as declarations arrive and leave, without losing its state. The core already had that operation, privately, for validation (`QueueChange`). Making it generic and key-driven costs about as much as keeping it private, and the core no longer carries one team's validation policy.

Confirmed by a prototype ([#23](https://github.com/TheAsda/form-lib/issues/23), branch `prototype/key-contributions`):
- The owner is updated in place, keeping `ctx.state`.
- `E` and payload types infer through `metaKey<V, P>` and `rule(n, check)`.
- A second user that isn't validation works: `disabled` as an OR of contributions, so `disableWhen` and `exclusive` stop conflicting on one field.

## Considered options

- **Reserve `error` in the core (a).** Rejected. It still needs the same in-place update once async state moves into `ctx.state` ([#15](https://github.com/TheAsda/form-lib/issues/15)), so it saves little. It also keeps `Rule` as a second declaration class and leaves one team's queue policy in the core forever. The author accepts it only as a last resort.
- **A core queue with a key named by the recipe (b′).** This was the fallback if the prototype failed, and it wasn't needed. It keeps every call site, but leaves the queue policy in the core.
- **Recipes without a core mechanism.** Every variant loses a capability:
  - grouping rules before `createStore` breaks adding a rule to a field that already has rules (components, single rows)
  - rules declared on the key can't reference other fields
  - multiple writers merged by a reducer lose "sync before async" and "a guarded rule is absent"
- **Reconfigurable handles** (`addRule(store, …)` / `useRules`). Rejected: they push an imperative registry onto consumers. Rules must stay declarative: plain lists built before React.

## Consequences

- A guard means different things on a contribution and on a behavior, on purpose. On a contribution, a false guard makes it **absent**, and the owner recomputes without it. On a behavior, `when` skips the run and keeps its last writes.
- Contributions are grouped per root store, never per shape node: shapes are shared across stores, rows and tests. Each contribution applies only to instances inside the store it was added on.
- When contributions change while an owner run is in flight, the run is cancelled and rerun with **the cancelled run's origins**, and `ctx.state` is kept. Mounting an unrelated rule mid-flight therefore restarts an async check.
- Recipes are copied and adapted, not depended on, so a fix to the validation queue no longer reaches every form automatically.
- Recipe signatures must infer the error type from the key's ref with `const E` (`rule<V, const E>(node: { _type: V; error: MetaRef<E | undefined, RulePart<E>> }, …)`). Otherwise literal-union errors widen and are rejected.
