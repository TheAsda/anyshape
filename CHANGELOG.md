# anyshape

## 0.2.0

### Minor Changes

- c681eb6: **Breaking:** a key declared with `.behavior()` is written only by its own default behavior. Registration rejects any other behavior that writes it. A key whose default is a contribution has no writer at all, and a key whose default behavior doesn't write it can no longer be written by another behavior, which used to be accepted. A second writer of a key like `dirty` now gets this message instead of `… is already written by "x#dirty" – one writer per target`.

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

### Patch Changes

- 9b080c2: Docs: the combined-keys guide said that removing a key's last contribution leaves whatever the owner computes from none. The key returns to its default instead: an owner runs in a scope only while a contribution is registered for it, on that scope's store or an enclosing one. A contribution whose guard fails is still absent, and when none applies the owner runs with an empty `ctx.parts`.

## 0.1.0

### Minor Changes

- e8de1df: **Breaking:** `countIn` throws, in development and production alike, where it used to log a warning: when the key has no `aggregate`, or when no node under the given node declares it. The message names the node and the key. A key without `aggregate` is also a type error now: `.aggregate()` marks the definition's type `Countable`, and `countIn` takes only a `Countable` key. `.behavior()` and `.combine()` likewise mark it `Owned`, and the steps check the marks, so a step out of order (`.aggregate()` twice, `.uses()` after `.behavior()` or `.combine()`, both `.behavior()` and `.combine()`) is a type error as well as a run-time error.

  ```ts
  const checked = metaKey(false);
  countIn(shape, checked);
  // before: a warning, and the count is always 0
  // now: a type error, and at run time
  // Error: countIn on "<root>": key "checked" on "b" has no aggregate – its count would always be 0. …

  const counted = metaKey(false).aggregate((v) => v); // MetaKeyDef<boolean, NoPayload, []> & Countable
  countIn(shape.other, counted);
  // now: Error: countIn on "other": no node in the subtree declares the key – its count would always be 0. …

  metaKey(false)
    .behavior(() => ({ triggers: [], run() {} }))
    .uses(counted);
  // now: a type error, as well as the run-time Error: call .uses() before .combine() or .behavior()
  ```

- 0e30bd9: Initial release.
- 12339de: **Breaking:** `MetaKeyOptions` takes no type parameter; it never used one.

  ```ts
  // before
  const options: MetaKeyOptions<string> = { keepOnReset: true };
  // after
  const options: MetaKeyOptions = { keepOnReset: true };
  ```

### Patch Changes

- 02b87e1: The package ships its docs: the guide in `docs/guide/` (with `agents.md`, the page for coding agents), the design principles in `docs/principles.md`, and `GLOSSARY.md`. The TSDoc of `form`, `createStore`, `defineBehaviors` and `useForm` links the guide.
