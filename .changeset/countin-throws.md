---
"anyshape": minor
---

**Breaking:** `countIn` throws, in development and production alike, where it used to log a warning: when the key has no `aggregate`, or when no node under the given node declares it. The message names the node and the key. A key without `aggregate` is also a type error now: `.aggregate()` marks the definition's type `Countable`, and `countIn` takes only a `Countable` key. `.behavior()` and `.combine()` likewise mark it `Owned`, and the steps check the marks, so a step out of order (`.aggregate()` twice, `.uses()` after `.behavior()` or `.combine()`, both `.behavior()` and `.combine()`) is a type error as well as a run-time error.

```ts
const flag = metaKey(false);
countIn(shape, flag);
// before: a warning, and the count is always 0
// now: a type error, and at run time
// Error: countIn on "<root>": key "flag" on "b" has no aggregate – its count would always be 0. …

const counted = metaKey(false).aggregate((v) => v); // MetaKeyDef<boolean, NoPayload, []> & Countable
countIn(shape.other, counted);
// now: Error: countIn on "other": no node in the subtree declares the key – its count would always be 0. …

metaKey(false)
  .behavior(() => ({ triggers: [], run() {} }))
  .uses(counted);
// now: a type error, as well as the run-time Error: call .uses() before .combine() or .behavior()
```
