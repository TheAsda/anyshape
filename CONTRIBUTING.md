# Contributing

Thanks for helping with anyshape. This page holds the rules a change is reviewed against. Before you propose a change to the library's design, read [`docs/principles.md`](docs/principles.md), which says what the library promises and refuses, and the decision records in [`docs/adr/`](docs/adr/). The domain words are defined in [`GLOSSARY.md`](GLOSSARY.md).

anyshape is pre-release. Any public interface, name or behavior may still change, and the better design wins over compatibility.

## Setup and checks

```sh
bun install
bunx playwright install chromium   # once per machine, for the React tests
```

Before you open a pull request, run:

- `bun run test`: all four test projects;
- `bun run typecheck`: the source, the recipes and the type-level tests, which run only here.

CI also builds the examples and checks the packed tarball (`bun run build && bun run check:package`). How the tests are laid out, and the conventions they follow, are in [`docs/testing.md`](docs/testing.md).

## Tests

- Tests go through the public interface. They assert what a user of the library can observe, not calls to internals.
- Show a new test failing before you make it pass. For a fix, that means the test fails on the code before the fix.
- A test that passes at once proves nothing yet: break the code it covers on purpose and check that the test fails. [`docs/testing.md`](docs/testing.md#mechanisms-to-mutation-check) lists the mechanisms that always get this check.
- A known bug without a fix is pinned with `test.fails` and a comment naming its issue.

## Changing observable behavior

- An optimization keeps every observable result: the run order between registrations of equal rank, the error messages, and which of several conflicts is reported first. Pin the current result with a test before the change, so the pin passes on the code you start from.
- A change to observable behavior is a decision, not a side effect. Say so in the pull request, and wait for the maintainer to sign it off.

## Performance

- Measure first. Profile before you optimize, and record the numbers before and after on the issue.
- The benches create production stores, so they measure the library and not the development tooling.
- Timings are tracked, not asserted. To pin a performance property in a test, assert the amount of work (for example, one run per row) rather than the time it takes.

## Comments

Comments describe the code as it is now, not how it got there. Drop notes like "stage 2" or "(unchanged)". When a change makes a comment wrong, fix the comment in the same pull request.

## Examples and fixtures

Examples and test fixtures keep declarations and key access in plain view. Don't wrap which keys a node declares, or how a key is reached, in a helper: showing that is what an example is for.

## Where a rule goes

- **An ADR** in `docs/adr/` only for a decision that is hard to reverse, would surprise a reader without its context, and was a real trade-off between options.
- **Rules for contributors** go in this file, or in [`AGENTS.md`](AGENTS.md) when coding agents need them too.
- **[`GLOSSARY.md`](GLOSSARY.md)** holds domain words only, never implementation names. A term the glossary lists under _Avoid_ stays out of code names too.

## Changesets

The changelog and version numbers come from [Changesets](https://github.com/changesets/changesets). CI doesn't enforce this policy; reviews do.

- A pull request that changes the published output adds a changeset with `bun run changeset`. The published output is `src/`, and the package's `exports`, types and peer dependencies.
- Docs, tests, recipes, examples and CI need no changeset.
- While the version is 0.x:
  - a breaking change is a `minor` changeset. Its text starts with **Breaking:** and shows the change as code;
  - features and fixes are `patch`;
  - `major` is never used, because it would jump to 1.0.0.
- 1.0.0 comes when the public interface is declared stable.
