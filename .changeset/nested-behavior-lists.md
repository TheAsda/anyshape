---
"anyshape": patch
---

`createStore({ behaviors })`, `addBehavior` and `replaceBehavior` flatten nested arrays at any depth, as the builder's `add` already did. A helper that returns several behaviors or contributions can go straight into the list:

```ts
createStore(shape, initial, { behaviors: [required(shape.name), exclusive([shape.a, shape.b])] });
```
