# Behaviors declare their dependencies

A behavior lists every ref it touches: `triggers` start a run, `reads` are read without starting one, `writes` are the only targets `ctx.set` accepts, and the refs of its guards (`when`) become triggers. A contribution declares the same lists for the owner of its key. `ctx.get` and `ctx.set` throw on any ref outside these lists, in development and in production alike ([#15](https://github.com/TheAsda/anyshape/issues/15)).

The runtime builds its dependency graph from these lists when a behavior is registered, before it ever runs. From that graph it computes the run order ([ADR 0004](0004-one-ordered-pass-per-flush.md)), checks that each target has one writer ([ADR 0005](0005-one-writer-per-target.md)), that writes stay in the behavior's scope and that there is no cycle, and it rejects the registration when a check fails. The declared refs also type the run: `ctx.get(ref)` returns the ref's value type, with nothing to annotate.

## Considered options

- **Track reads automatically, as signal libraries do.** Each run would record what it read, and the next change to any of those refs would rerun it. Rejected. Under a branch (`if (ctx.get(a)) ctx.get(b)`) the reads differ from one run to the next, so the graph only exists after the runs, and changes with them. The order can't be computed, and a cycle or a second writer can't be found, at registration. A read that one run happened to skip is missing from the graph, so the behavior can run before the value it depends on is final, and nothing reports it. With declared lists, the graph is fixed and checked before any state changes.

## Consequences

- An undeclared read is an error, not a missed dependency. It throws on the run that makes it, which in practice is the first test that reaches the branch.
- Production keeps the throw. Warning and carrying on would leave the read invisible to cancellation and ordering, so values would go stale only in production.
- Declarations are longer than a run that tracks itself. A recipe keeps them short for its users: `rule(node, check)` declares the field as its trigger, and `.uses(…)` hands a key's step the refs of its sibling keys.
- Reads that are not triggers (`reads`) are watched only while a run is in flight: a change to one restarts that run, and starts nothing when no run is in flight.
