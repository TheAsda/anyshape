---
"anyshape": minor
---

**Breaking:** `countIn` throws, in development and production alike, where it used to log a warning: when the key has no `aggregate`, or when no node under the given node declares it. The message names the node and the key. A key without `aggregate` is also a type error now: `MetaKeyDef` has a fourth type parameter, `true` once `.aggregate()` was called, and `countIn` takes only such a key.

```ts
const flag = metaKey(false);
countIn(shape, flag);
// before: a warning, and the count is always 0
// now: a type error, and at run time
// Error: countIn on "<root>": key "flag" on "b" has no aggregate – its count would always be 0. …

const counted = metaKey(false).aggregate((v) => v); // MetaKeyDef<boolean, NoPayload, [], true>
countIn(shape.other, counted);
// now: Error: countIn on "other": no node in the subtree declares the key – its count would always be 0. …
```
