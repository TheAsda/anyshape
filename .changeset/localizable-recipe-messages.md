---
"anyshape": minor
---

**Breaking:** `defined()` now sets `requiredNow` to `true` and accepts `{ message }`, and `definedKey` is no longer exported from `anyshape/recipes`.

```ts
// Before: defined() had a fixed "Required" message and left requiredNow false
deliveryType: field<DeliveryType | undefined>().meta(control(), defined()),

// After: defined() turns on requiredNow on its own and accepts a string or lazy getter
deliveryType: field<DeliveryType | undefined>().meta(control(), defined({ message: () => t("required") })),
```

Every shipped validation message in `anyshape/recipes` can now be overridden per call with a string or lazy getter called only when a check fails:

- `minLength`, `maxLength`, `min`, `max` pass `{ limit }` to message getters (including resolved `Ref` and `CountRef` limits).
- `exclusive` accepts lazy getters for `message.tooMany` and `message.missing`, receiving `{ labels }` (`readonly string[]`).
- `rule` and `asyncRule` accept a `failure` option (`string | (() => string)`) to override `"Validation failed"` when a check throws.
- `defined` accepts `{ message }` (`string | (() => string)`) and feeds `requiredNow`.
- Added `emptyToUndefined(target)` to `anyshape/recipes` to convert `""` and `[]` written by user or program origins into `undefined` (ignoring whitespace and initial/loaded values).
- Exported `Lengthy`, `Numeric`, `Textual`, and `DefinedOptions` from `anyshape/recipes` for typing local wrapper modules.
