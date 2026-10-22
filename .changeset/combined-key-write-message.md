---
"anyshape": patch
---

The registration error for a behavior that writes a key it may not write now says why the key refuses behaviors and what to do instead, instead of `… is written only by …`. For a combined key (`combine`), the message shows the exact `contribute()` call to register, with a `when` built from the behavior's own triggers, and says that no "else" write is needed: the contribution applies while `when` holds, and the owner recomputes the key once it stops. For a key declared with `.behavior()`, the message points to declaring another key (which the key's default behavior can follow through `.uses(...)`) or changing the key's own behavior. When the behavior has other writes, the message says those can stay as they are.

```ts
const shape = form(object({ mode: field<string>(), a: field<string>().meta({ tags }) }));

createStore(shape, initial, {
  behaviors: [defineBehavior({ triggers: [shape.mode], writes: [shape.a.tags], run() {} })],
});
// Error: Behavior "b1": lists "a#tags" in `writes`, but that key is combined
// (declared with `combine`): its owner behavior computes the key from the
// contributions registered for it, so no other behavior can write it.
// Fix: remove it from `writes` and register a contribution instead:
//   contribute("a#tags", <payload>, { name: "…", when: when([mode], (…) => …) })
// The contribution applies while `when` holds; the owner recomputes the key
// once it stops holding, so there is no "else" write to make.
// See docs/guide/contributions.md.
```

The `disabled` feature's docs no longer read as if a behavior may write the key: behaviors contribute a reason, and only application code writes the key with `store.set`.
