---
status: accepted
---

# Per-call message overrides, `defined({ message })`, and `emptyToUndefined`

The default recipes keep fixed English fallbacks, and every shipped error message can now be overridden per call with a string or a lazy getter that runs only when a check fails:

- `required`, `pattern`, `email`: `message` (`string | ((value) => string)`)
- `minLength`, `maxLength`, `min`, `max`: `message` (`string | ((value, { limit }) => string)`), passing the resolved limit (including for `Ref` and `CountRef` limits)
- `exclusive`: `message.tooMany` and `message.missing` (`string | (({ labels }) => string)`), passing the fields' last path segments as `readonly string[]`
- `rule`, `asyncRule`: `failure` (`string | (() => string)`) for the message written when a check throws
- `defined`: `defined({ message })` (`string | (() => string)`) for the backstop message

The rule node types (`Lengthy`, `Numeric`, `Textual`) and `DefinedOptions` are exported so a project that only needs localized messages can wrap the rules once in a small local module without copying the recipes.

`defined()` also turns on `requiredNow` (via a private shared helper key declared alongside `defined`), so a `defined()` field shows as required on its own without duplicating `required()`. Because `defined({ message })` creates a key definition per call when a custom message is given, `definedKey` is no longer exported, and the meta-group guidance in [`docs/guide/meta-keys.md`](../guide/meta-keys.md) is narrowed: a meta group declares a shared definition once for every key reached by definition (a count, a sweep, or another key's `.uses()`), while a key reached only through its node's ref (or only read via its branded type, like `InferChecked`) may be defined per call.

To let text and array fields that start `undefined` pair cleanly with `defined()`, `values.ts` adds `emptyToUndefined(node)`, a behavior that converts `""` and `[]` written by `"user"` or `"program"` origins into `undefined`, leaving whitespace-only strings and initial/loaded values alone.

## Considered options

- **A shipped message-catalog factory (`rulesWith(messages)`).** Rejected: it adds permanent surface and an option bag that grows with every new rule (principle 9, [ADR 0006](0006-recipes-ship-as-a-subpath-and-copying-is-for-customizing.md)), when a ten-line wrappers file in user code does the same job with plain functions (principle 4).
- **A global `setMessages(...)` setter.** Rejected: ambient mutable state (principle 4) and silent replacement (principle 13) that leaks across SSR requests and tests.
- **Error codes translated at render.** Left to copied recipes: it changes `errorKey`'s type from `string | undefined` to structured codes, which is only needed when errors already on screen must re-translate live on a language switch.
- **A `createDefined(getter)` factory instead of `defined({ message })`.** Rejected: `definedKey` had no callers counting, sweeping or `.uses()`-ing it (principle 24), `InferChecked` matches by the `Defined` brand rather than definition identity, and `defined({ message })` matches `required(node, { message })` directly in user wrappers.
- **A `fromOptionalInput` React adapter instead of `emptyToUndefined(node)`.** Rejected: a value behavior lives alongside the field's other behaviors, works with any input (not only DOM inputs), and lets `fromInput` stay unchanged on `field<string | undefined>()`.

## Consequences

- **Breaking:** `definedKey` is removed from `anyshape/recipes`, and `defined()` now sets `requiredNow` to `true` (a policy change in [`recipes/POLICIES.md`](../../recipes/POLICIES.md)).
- `defined()` declares two keys on the node (`defined` and `definedRequired`). Neither is swept; `requiredNow` continues to be reached through `requiredNowKey` and `node.requiredNow`.
- Narrowing the meta-group rule sets a precedent: recipe authors must ask "does anything reach this key by definition?" before defining a key per call.
- A project needing live language switching or non-message policy changes still copies the whole recipe set ([ADR 0006](0006-recipes-ship-as-a-subpath-and-copying-is-for-customizing.md)).
