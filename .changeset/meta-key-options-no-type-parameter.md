---
"anyshape": minor
---

**Breaking:** `MetaKeyOptions` takes no type parameter; it never used one.

```ts
// before
const options: MetaKeyOptions<string> = { keepOnReset: true };
// after
const options: MetaKeyOptions = { keepOnReset: true };
```
