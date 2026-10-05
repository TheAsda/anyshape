# One ordered pass per flush

The runtime ranks behavior registrations by the graph their declarations form ([ADR 0003](0003-behaviors-declare-their-dependencies.md)): a behavior that writes what another triggers on or reads ranks before it. A flush then works through the triggered instances in rank order, lowest first, and registrations of equal rank in the order they were registered. Each instance runs at most once per flush, and when it runs, everything it depends on is already final. A change to registrations reranks only what it reaches ([#6](https://github.com/TheAsda/anyshape/issues/6)), and a cycle is rejected at registration, before any state changes.

## Considered options

- **Repeat until stable.** Run every triggered behavior, then run again whatever their writes triggered, until nothing changes. Rejected. One change can run a behavior several times: validation is wasted on values that are about to change again, an async check can start twice for a single edit, and the loop needs a guard against behaviors that never settle.
- **Lazily derived values.** Compute a derived value when someone reads it, as a cached pure function of its inputs. Rejected as the general mechanism. It fits only pure calculations, and most behaviors are actions taken at a moment: a reset, an async check, a default filled in when a field appears. Those need to run when their trigger changes, whether or not anyone reads the result. A pure calculation is still easy to write as a behavior that writes a meta key.

## Consequences

- The run order is a property of the declarations, and it can be tested and explained without running the form.
- An optimization of the ranking must keep the order between registrations of equal rank, because results depend on it. An incremental topological sort that picks an arbitrary order among equals was rejected for that reason ([#6](https://github.com/TheAsda/anyshape/issues/6)).
- The store's flush is still a loop of rounds. Behaviors are triggered through the store's internal reaction channel. Each round delivers the changes made so far to the reactions listening for them, then runs the lowest pending rank, whose writes are delivered in the next round. The loop ends when no reaction fired and nothing is pending, and it throws after a fixed number of rounds. The reaction channel sits below the runtime and knows no order of its own, so the loop is what carries one rank's writes to the next; the order comes from the ranks. Listeners (`subscribe`) run once, after the loop, and may not write.
- A reader of a pending tally (`pendingOf`, `pendingIn`) is the one instance that can run twice in a flush. Pending changes when a run starts or ends, not when a key is written, so there is no ranking edge from a key's writer to its pending readers. A reader that ranks first runs, then runs again when the tally changes, and the result converges. An edge would turn an owner that reads `pendingOf` of its own target into a cycle ([#15](https://github.com/TheAsda/anyshape/issues/15)).
- An async run completes after its flush. Its writes apply in a later flush, which runs its own ordered pass.
