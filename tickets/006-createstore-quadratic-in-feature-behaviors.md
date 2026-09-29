# 006 · `createStore` is quadratic in the number of registrations

**Type:** Optimization · **Priority:** Medium · **Area:** `src/behaviors.ts`

## Measurement
`control()` registers two feature behaviors per field (touched, dirty). Creating a flat form (one `createStore`, no user behaviors):

| fields | registrations | createStore |
|---|---|---|
| 125 | 250 | 15 ms |
| 250 | 500 | 34 ms |
| 500 | 1000 | 145 ms |
| 1000 | 2000 | 490 ms |

The same forms without `control()` take ~0.1–0.3 ms. 200 rows with behaviors take ~5 ms (row instances are not registrations). Tracked by `npm run bench` ("flat form, 500 fields → createStore").

## Likely cause (not yet profiled)
Pairwise loops over all registrations at registration time: `BehaviorRuntime.rank()` builds the dependency graph with `for a of regs, for b of regs` (and `affects()` per write × input), and `checkWriters()` compares every added registration with every existing one. If `addBehavior` re-ranks everything, each component registration (`useBehaviors`) also pays O(R²).

## Ideas
- Index registrations by the nodes/keys they write, and look up readers of those targets instead of scanning all pairs.
- Feature behaviors limited to `self` (touched/dirty) cannot conflict or form edges with other nodes' feature behaviors; skip them in the pairwise checks, or rank them by construction.
- Rank incrementally on `addBehavior`.

## Done when
Profile confirms the hotspot; the flat 1000-field `createStore` is roughly linear (target: < 20 ms), with the bench numbers recorded before/after.
