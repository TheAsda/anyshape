# One writer per target

Each target, a node's value or one meta key of one node instance, has at most one behavior that writes it. A value write covers the node's subtree, so writing an object and writing one of its fields conflict. Registration throws when a second behavior declares a write to a target that already has a writer, and the message names the first writer. A meta key that needs input from several declarations declares `combine`: its one writer is the key's owner, and the other declarations feed it through contributions instead of writing the key ([ADR 0001](0001-validation-is-a-recipe-on-key-contributions.md)). Application code may still write any target with `set`; the rule is about behaviors.

We chose this because it makes every edge in the dependency graph unambiguous: whoever reads a target depends on exactly one behavior. The graph is checked at registration ([ADR 0003](0003-behaviors-declare-their-dependencies.md)), tools can say who writes what, and a target's value never depends on which of several writes happened to land last.

## Considered options

- **Last write wins.** Rejected. The result depends on the order of the writes, which changes with registration order and with when async runs complete. One writer silently undoes another, and nothing reports it.
- **Merging the writes**, with a merge function per key. Rejected. A merge sees only results, so it can't express "the async check runs only after the sync rules pass" or "a guarded rule is absent", and a writer whose guard turns false leaves its last write in the merge.
- **Precedence between writers.** Rejected. It is the same silent choice with a rule attached, and someone has to own the order of precedence across declarations written in different places.

## Prior art

When several writers share one slot, keeping track of who wrote what becomes a source of bugs. In TanStack Form, form-level and field-level validators write the same error slot, and the bookkeeping that tracks which one wrote it can fall out of step with the slot ([TanStack/form#2294](https://github.com/TanStack/form/issues/2294)). A shared slot also makes stale writes easy: a result that lands after the condition behind it is gone, or after a reset, overwrites a newer state unless every writer guards against it. Systems that do allow several writers need machinery to cope: Kubernetes [server-side apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/) records a manager for each field and reports conflicts, with a force option to override them, and the Bevy game engine's scheduler [can report](https://docs.rs/bevy/latest/bevy/ecs/schedule/struct.ScheduleBuildSettings.html) systems whose data access conflicts without an order between them. One writer per target rules that class of bug out, and needs none of that machinery.

## Consequences

- Two declarations that want to write one key are a design question, answered by making the key combined. `disabled` is the example: `disableWhen` and `exclusive` both contribute to it, and its owner ORs the contributions.
- Between rows, the rule applies within a row's scope: sibling rows have their own targets, so a row behavior never conflicts with the same behavior in another row ([#61](https://github.com/TheAsda/anyshape/issues/61)).
- A behavior's disposal frees its targets; another behavior can then register as their writer.
