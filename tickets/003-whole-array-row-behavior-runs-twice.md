# 003 · A row behavior triggered by its whole array runs twice per flush

**Type:** Optimization · **Priority:** Low · **Area:** `src/behaviors.ts`

## Behavior
A behavior on a row template that triggers on the enclosing array and writes inside its row (e.g. each line's share of the total):

```ts
defineBehavior({ triggers: [f.lines], reads: [L.price], writes: [L.share], run: … })
```
runs **2 × rows** per flush (on init and on every edit). Origins are per instance, so row 0's write re-triggers rows 1 and 2 and so on; the second pass writes equal values and the flush settles. With N rows the cost is 2N runs, each reading the whole array (O(N²) work).

## Idea
Treat writes by *sibling instances of the same registration* as own writes for this trigger (they cannot change what the behavior computed from the array, only its own outputs), or run all instances of one registration as one step before re-checking triggers. Either must keep the "each instance sees final values" guarantee.

## Tests
`src/behaviors.test.ts`: "constraint: a row behavior reading the whole array runs twice per flush …" pins the current count (6 for 3 rows). Update the expected count when this lands.
