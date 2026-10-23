---
status: accepted
---

# Recipes ship as a subpath; copying is for customizing

The default recipes ship inside the `anyshape` package, as two entries beside the core's: `anyshape/recipes` (validation, rules, input state, visibility, disabling, value behaviors, submit and focus) and `anyshape/recipes/react` (`useControl` and the input adapters). They are built in the same library build as `anyshape` and `anyshape/react` and import the core through them, so there is one copy of the core between all four entries ([principle 22](../principles.md#22-one-copy-of-the-core)). The tarball also holds their `.ts` sources, without their tests, and [`recipes/POLICIES.md`](../../recipes/POLICIES.md), which lists every policy they hold. The default recipes have no options. A team that needs another policy copies the whole set out of its installed package and edits the copy ([#130](https://github.com/TheAsda/anyshape/issues/130), [#162](https://github.com/TheAsda/anyshape/issues/162)).

We chose this because copying everything up front put the whole cost of the recipes on every user, including the many who would never change a line of them: about a thousand lines before a first form worked, and code a team then had to own. Shipping them makes the default path an import, while keeping the property that made copying attractive: a recipe is built only on the public interface ([principle 7](../principles.md#7-recipes-build-only-on-the-public-entries-the-core-never-imports-a-recipe)), so a copy of the shipped sources works against the installed package unchanged.

## Considered options

- **Recipes only as code to copy**, from the repository at a release tag. Rejected: it was the rule before this record, and it charged every user the full cost up front. It also left the default policies documented only as comments in code the user hadn't read yet.
- **A separate package for the recipes.** Rejected: two version lines to keep in step, and a recipe package that bundles its own copy of the core would break the one-copy rule in every project where the versions drift.
- **One entry per recipe file** (`anyshape/recipes/validation`, `anyshape/recipes/submit`, …). Rejected: the entries would expose the file layout as public surface, and two entries are enough for tree-shaking and for keeping React out of the non-React one.
- **Options on the default recipes**, so that a different policy doesn't need a copy. Rejected: every option multiplies the code paths every copy carries, and principle 9 already turned option bags down.
- **A one-call setup** such as `basicForm(shape)` that declares the keys and wires validation, submit and focus. Rejected: it changes the call site, and the call site is what stays the same between the default recipes and a copy.

## Consequences

- A change to a default policy (when an error shows, what counts as empty, a message string) is a breaking change of the package, released with a changeset that says so. Before 1.0, that is a minor version.
- Renaming a default key, meta group or definition is breaking too ([ADR 0007](0007-keys-are-declared-through-meta-groups.md)).
- Keys are matched by definition, so a form uses the default recipes or one copy of them, never a mix: a copied `validate` or `handleSubmit` doesn't see the keys the shipped `control()` declares. Moving a form to a copy changes import paths, not call sites, and moves every recipe at once.
- The recipes' tests stay in the repository, at the release tag, for a team that wants to keep its copy passing.
- The package check guards the arrangement on the packed tarball: one copy of the core, no React reached from `anyshape/recipes`, a node from `anyshape` working with `useControl`, and the shipped sources compiling, unchanged, against the installed package.
