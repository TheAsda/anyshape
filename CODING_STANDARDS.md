# Coding standards

The page a review starts from. It lists the sources a change is reviewed against, and holds the few rules that have no other home. Each source keeps its own rules; read the ones that apply to the change. What the tools check (types, lint with its import boundaries, formatting, the doc samples, the packed tarball; see [`docs/testing.md`](docs/testing.md#setup-and-commands)) needs no review.

## What a change is reviewed against

- [`AGENTS.md`](AGENTS.md): the project status (pre-release, so a change needs no shims or deprecations) and the core/recipes boundary: recipes and examples build on the public entries only, node internals stay in the core, and no code finds a meta key by a string. Applies to every code change.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): tests shown red first, pinned results before an optimization, a sign-off for a change to observable behavior, comments that describe the current code, where a rule goes, and when a changeset is due. Applies to every change.
- [`docs/principles.md`](docs/principles.md): what the library promises and refuses, and the ideas it turned down. Applies to a change to the core, its public interface or a recipe's design.
- [`docs/testing.md`](docs/testing.md): where a new test goes, the test and fixture conventions, and the mechanisms that need a mutation check. Applies to a change that adds or moves a test, or touches a listed mechanism.
- [`GLOSSARY.md`](GLOSSARY.md): the domain words, and under _Avoid_ the words that stay out of the docs and out of code names. Applies to every new name and every doc.
- [`docs/adr/`](docs/adr/): the runtime decisions that are hard to reverse, each with the options it turned down. Applies to a change to behaviors, contributions, key definitions or the run order.

## Rules that live only here

- Write everything in our own words: code, comments, docs, tests and commit messages. An idea from another project is restated, not quoted.
- Cite only public sources: issues and pull requests on [github.com/TheAsda/anyshape](https://github.com/TheAsda/anyshape), and published docs. A claim stands on its own reasoning or on one of those links.

Both rules come from the [brief for the design docs](https://github.com/TheAsda/anyshape/issues/70#issuecomment-5973258361).
