---
status: proposed
---

# Keys are declared through meta groups; a key definition carries a `Key` suffix

In the default recipes, every meta key goes on a node by calling a meta group inside `.meta()`: `field<string>().meta(control(), defined())`. A meta group that declares one key takes the key's name (`edited()`, `dirty()`, `visible()`, `disabled()`, `defined()`, `submitting()`, `revealed()`), and one that declares several is named after what it gives (`validation()`, `control()`). The key definition itself, which sweeps and tallies take, carries a `Key` suffix: `countIn(shape, errorKey)`, `store.collect(node, revealedKey)`. Keys that mean nothing on their own (`checkForced`, `requiredNow`) come only through `validation()`; their definitions are still exported, as `checkForcedKey` and `requiredNowKey` ([#160](https://github.com/TheAsda/anyshape/issues/160)).

We chose this because one way of writing `.meta()` reads better than a mix of calls and bare keys (`.meta(control(), { visible })`), and a meta group can't share its name with the definition it declares. The `.meta()` call is the code a form author writes most, so it keeps the plain name. The sweeps are rarer, and there the suffix says that `errorKey` is a definition, not a value.

## Considered options

- **Bare keys, with a meta group only for several keys** (`.meta(control(), { visible })`). Rejected: two ways of writing the same declaration, and one-key wrappers such as `submission()` beside bare keys such as `visible` made the set look arbitrary.
- **The definitions in one namespace object** (`countIn(shape, keys.error)`). Rejected: it would be the only namespace object in the API, for no gain over a suffix.
- **A prefix on the meta group** (`.meta(withControl(), withDefined())`, `countIn(shape, error)`). Rejected: it puts the cost on the most frequent code, and a bare `error` reads like a value.

## Consequences

- A team's copied recipes and its own keys can follow the same convention, but the core doesn't require it: `.meta()` still takes plain objects of key definitions.
- Renaming a default key, its meta group or its definition is a breaking change once the default recipes ship ([ADR 0006](0006-recipes-ship-as-a-subpath-and-copying-is-for-customizing.md)).
