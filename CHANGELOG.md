# anyshape

## 0.5.0

### Minor Changes

- ac6aa4c: **Breaking:** `ControlNode` and `ControlBinding` are parameterized by the node's value type, and `useControl` with them. A reusable component types its props by value now:

  ```tsx
  function NameField({ node }: { node: ControlNode<string> }) {
    const { value } = useControl(node); // value: string
  }

  // A binding's type argument is the value, not the node:
  let c!: ControlBinding<InferValue<typeof shape.name>>; // was ReturnType<typeof useControl<typeof shape.name>>
  ```

  The refs in `ControlNode<T>` keep the types the default `control()` declares (`error: MetaRef<string | undefined>`, the booleans as `MetaRef<boolean>`). A copied set that changes a key's type has already copied `control.ts` and edits it there ([#173](https://github.com/TheAsda/anyshape/issues/173)).

## 0.4.0

### Minor Changes

- 78db213: **Breaking:** `.meta()` now takes key definitions only — each entry must be made with `metaKey`. A plain value (`label: "Name"`, `visible: true`) is a compile error; the same key declares as `label: metaKey("Name")`. At run time, an entry that is not a key definition throws with the fix in the message; the old wrapping silently accepted it. `metaKey(default, options?)` is unchanged and is now the only way to declare a key, so every key can carry the definition-only capabilities (`countIn`, a default behavior, contributions) and be swept by definition, whatever name a node declares it under. The `Meta` type now describes one `.meta()` input — a bag of key definitions — instead of the live values per node. Meta groups are unchanged.

  ```ts
  // before
  field<string>().meta({ label: "Name", visible });
  // after
  field<string>().meta({ label: metaKey("Name"), visible: visibleKey });
  ```

### Patch Changes

- 453fd74: New value-behavior recipe: `startWith(ref, value)` gives a meta key its start — the value it holds when the store is created, in every row that is added, and again after `reset()`, in place of the key's default. A load (`{ as: "initial" }`) does not run it: the start is fixed at mount. Takes a meta key only (a value's start is its baseline) and a fixed value; a start computed from the row's own data, or one that also reacts, stays a hand-written behavior, as the guide's behaviors page shows. A key that is combined or has its own behavior is rejected at registration, like any second writer.

  ```ts
  import { startWith } from "anyshape/recipes";

  createStore(editor, values, {
    // A form opened over existing content starts in edit mode.
    behaviors: startWith(editor.mode, "edit"),
  });
  ```

## 0.3.1

### Patch Changes

- f0133d1: The default recipes ship in the package, as two entries: `anyshape/recipes` (validation, rules, input state, visibility, disabling, value behaviors, submit and focus) and `anyshape/recipes/react` (`useControl` and the input adapters). They share the core of `anyshape` and `anyshape/react`, and `anyshape/recipes` imports no React.

  ```ts
  import { form, object, field } from "anyshape";
  import { control, submitting, required, handleSubmit } from "anyshape/recipes";
  import { useControl } from "anyshape/recipes/react";
  ```

  Every policy they hold is listed in `recipes/POLICIES.md`, shipped beside their `.ts` sources. To change a policy, copy `node_modules/anyshape/recipes/` into your project and switch every recipe import to the copy.

## 0.3.0

### Minor Changes

- 71ae5f1: **Breaking:** a node's identity is no longer exposed as properties. `node.path`, `node.parent`, `node.id`, `node.lens`, `node._type` and `node._hasCreate` are gone, and so are the names they reserved: nearly every name is now free for a field or a meta key. `pathOf(node)` and `parentOf(node)` take their place, in the style of `initialOf` / `pendingOf`; there is no `idOf` or `lensOf`, because nothing outside the core needs them, and the public `FieldId` type goes with `node.id` for the same reason. `pathOf` also accepts a reference and labels the key it points at (`pathOf(node.error)` is `"name#error"`).

  ```ts
  // before
  object({ id: field<string>() }); // threw: "id" is a reserved name
  rule(node, ...); // took AnyNode & { readonly _type: V; readonly error: ... }
  `${node.path}#${key}`; // messages and behavior names

  // after
  object({ id: field<string>() }); // a field named "id" is fine
  rule(node, ...); // takes ShapeNode<V> & { readonly error: ... }
  `${pathOf(node)}#${key}`;
  ```

  A node that requires a value type is now `ShapeNode<V>` instead of `AnyNode & { readonly _type: V }`, and an array with a `create` factory is `ArrayNode<Item, true>` – internally the markers are `declare`d unique symbols, so nothing exists at run time.

  Only `meta`, `constructor` and `__proto__` stay reserved: `meta` is the declaration method, and the other two break the node if a field takes their name. All three are rejected for field names and meta keys at compile time, with the run-time check kept as a backstop. A meta key named `item` collides only with an array's item template, through the child/key rule; on fields and objects it is a normal key.

### Patch Changes

- da116e3: The registration error for a behavior that writes a key it may not write now says why the key refuses behaviors and what to do instead, instead of `… is written only by …`. For a combined key (`combine`), the message shows the `contribute()` call to register, with a `when` built from the behavior's own triggers, and says that no "else" write is needed: the contribution applies while `when` holds, and the owner recomputes the key once it stops. For a key declared with `.behavior()`, the message points to declaring another key (which the key's default behavior can follow through `.uses(...)`) or changing the key's own behavior. When the behavior has other writes, the message says those can stay as they are.

  ```ts
  const shape = form(object({ mode: field<string>(), a: field<string>().meta({ tags }) }));

  createStore(shape, initial, {
    behaviors: [defineBehavior({ triggers: [shape.mode], writes: [shape.a.tags], run() {} })],
  });
  // Error: Behavior "b1": lists "a#tags" in `writes`, but that key is combined
  // (declared with `combine`): its owner behavior computes the key from the
  // contributions registered for it, so no other behavior can write it.
  // Fix: remove it from `writes` and register a contribution instead:
  //   contribute(<ref to "a#tags">, <payload>, { name: "…", when: when([mode], (…) => …) })
  // The contribution applies while `when` holds; the owner recomputes the key
  // once it stops holding, so there is no "else" write to make.
  // See docs/guide/contributions.md.
  ```

- 7cfefb8: `useForm` survives a hot reload. A new `shape` (an edited shape module under React Fast Refresh) used to leave the store on the old shape, so the next hook threw `"…" is not part of this form`. Now it builds a new store that keeps every value and baseline whose path and kind are unchanged. A new `behaviors` object replaces the registered behaviors on the same store. A shape or behaviors created inside a component, a new object on every render, gets a dev warning.

## 0.2.1

### Patch Changes

- d1f702d: `createStore({ behaviors })`, `addBehavior` and `replaceBehavior` flatten nested arrays at any depth, as the builder's `add` already did. A helper that returns several behaviors or contributions can go straight into the list:

  ```ts
  createStore(shape, initial, { behaviors: [required(shape.name), exclusive([shape.a, shape.b])] });
  ```

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
