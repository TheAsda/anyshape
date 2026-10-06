## Project status

Work in progress, pre-release: there are no consumers yet. Any public interface, name, file layout or behavior may change without deprecation, shims or migration notes. Prefer the better design over backward compatibility. Remove this section when a stable version is released.

## Core and recipes

Recipes (`recipes/`, the React recipes in `recipes/react/`, the examples) build only on the core entries' public interface: import from `anyshape`, plus `anyshape/react` in React code. No code, whether core, recipe or example, finds a meta key by a string: a key is reached through a node's ref (`node.error`) or, for a sweep, through its definition (`collect(node, revealed)`). Node internals (`_`-prefixed members, anything in `src/internal.ts`) belong to the core's own modules. When a recipe needs something the public interface lacks, grow the interface, but only for what no recipe can do, and by handing the recipe the refs it needs rather than adding a way to look them up. See [Public shape introspection for recipes](https://github.com/TheAsda/anyshape/issues/27) and [why `refOf(node, def)` was turned down](https://github.com/TheAsda/anyshape/issues/37).

## Principles and contributor rules

- Before designing or reviewing a change to the core or its public interface, check it against [`docs/principles.md`](docs/principles.md).
- When writing code, follow [`CONTRIBUTING.md`](CONTRIBUTING.md): tests red first, pinned results before an optimization, current-design comments, changesets.
- Before writing or moving a test, or running the checks, read [`docs/testing.md`](docs/testing.md): setup and commands, the file per layer, the conventions, the mechanisms to mutation-check.
- Run `bun run format` and `bun run lint` before committing.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on TheAsda/anyshape, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, each string equal to its role name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
