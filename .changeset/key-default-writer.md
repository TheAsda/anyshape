---
"anyshape": minor
---

**Breaking:** a key declared with `.behavior()` is written only by its own default behavior. Registration rejects any other behavior that writes it. A key whose default is a contribution has no writer at all, and a key whose default behavior doesn't write it can no longer be written by another behavior, which used to be accepted. A second writer of a key like `dirty` now gets this message instead of `… is already written by "x#dirty" – one writer per target`.

```ts
const dirty = metaKey(false).behavior((self, key) => ({
  triggers: [self, initialOf(self)],
  writes: [key],
  run: (ctx) => ctx.set(key, !Object.is(ctx.get(self), ctx.get(initialOf(self)))),
}));
const shape = form(object({ x: field<string>().meta({ dirty }) }));

createStore(
  shape,
  { x: "" },
  {
    behaviors: defineBehavior({ name: "b", triggers: [shape.x], writes: [shape.x.dirty], run() {} }),
  },
);
// now: Error: Behavior "b": "x#dirty" is written only by its key's default behavior
```

A key's `.behavior()` factory may now return one contribution instead of a behavior config, to a combined key it uses. Every node that declares the key adds it, named `<path>#<key>`, limited to its own node like a default behavior:

```ts
const reasons = metaKey<boolean, string>(false).combine((self, key) => ({
  writes: [key],
  run: (ctx) => ctx.set(key, ctx.parts.length > 0),
}));
const locked = metaKey(true)
  .uses(reasons)
  .behavior((self, key, [disabled]) => contribute(disabled, "Set by your administrator"));
```
