---
"anyshape": minor
---

**Breaking:** `.meta()` now takes key definitions only — each entry must be made with `metaKey`. A plain value (`label: "Name"`, `visible: true`) is a compile error; the same key declares as `label: metaKey("Name")`. `metaKey(default, options?)` is unchanged and is now the only way to declare a key, so every key can carry the definition-only capabilities (`countIn`, a default behavior, contributions) and be swept by definition, whatever name a node declares it under. The `Meta` type now describes one `.meta()` input — a bag of key definitions — instead of the live values per node. Meta groups are unchanged.

```ts
// before
field<string>().meta({ label: "Name", visible });
// after
field<string>().meta({ label: metaKey("Name"), visible: visibleKey });
```
