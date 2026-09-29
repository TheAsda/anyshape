# 002 · `metaKey(false, { aggregate })` infers the literal type `false`

**Type:** Improvement (types) · **Priority:** Low · **Area:** `src/meta.ts`

## Problem
```ts
flagged: metaKey(false, { aggregate: (v: boolean) => v })
s.set(f.a.flagged, true); // error: 'true' is not assignable to 'false'
```
With an `aggregate` callback, `V` is inferred from both the default and the callback parameter, and TypeScript picks the literal `false`. Users have to write `metaKey<boolean>(false, …)`.

## Expected
`metaKey(false, …)` gives a `boolean` key (likewise `0` → `number`, `""` → `string`), matching how plain meta values widen.

## Suggested fix
Infer from the default only, e.g. `options?: MetaKeyOptions<NoInfer<V>>`, and/or widen literal primitives in the return type. Add a type test in `src/types.test.ts` (and change the `metaKey<boolean>` in `extensions.test.ts` back to the plain form).
