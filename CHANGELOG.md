# anyshape

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
