# 001 · Removing a row does not abort its async check; `validate()` waits for it

**Type:** Bug · **Priority:** High · **Area:** `src/validation.ts`

## Problem
The header of `validation.ts` (and the `signal` doc on `AsyncRuleContext`) says a running async check is aborted when "a newer run starts, the row is removed or the field is hidden". Row removal is not handled: nothing calls `abort()` for the removed row's `FieldState`.

Consequences:
- The check's `AbortSignal` never fires, so the request keeps running.
- `ValidationLayer.validate()` collects the instances *before* awaiting and then waits for every `running.promise`, including the removed row's. If that check never settles, `validate()` and `submit()` hang; otherwise submit is delayed by a request whose result is discarded.

## Repro
```ts
const s = createStore(shape, initial(), { behaviors: asyncRule(L.sku, check, { debounce: 1000 }) });
const lines = s.substore(shape.lines);
const row = lines.itemAt(1);
row.set(L.sku, "ZZ", { origin: "user" });
const pending = s.validate();          // starts the check
lines.remove(row);                     // signal.aborted stays false
await pending;                         // waits until the check settles – forever if it never does
```

## Expected
- Removing (or replacing) a row aborts the running checks of every queue inside it and clears their timers.
- `validate()` does not wait for checks of rows that are no longer attached.

## Suggested fix
- On row detach, abort the `FieldState`s held for that host (and nested row hosts). The states are in `ValidationLayer.states` (a `WeakMap` keyed by host), so a detach hook from `ArrayStore` (or the behavior runtime's binding teardown) can iterate them.
- In the wait loop of `validate()`, filter `instances` by `h.isAttached()` on every iteration.

## Tests
`src/validation.test.ts`: the `it.fails("validate(): removing a row aborts its pending check …")` test. Switch it to `it` when fixed. The passing companion test ("… the row is not listed") must stay green.
