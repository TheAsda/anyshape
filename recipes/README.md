# Recipes

Recipes are code you copy into your project and own. They give meta keys one team's meaning (what `error` holds, when it shows, what `disabled` implies, what submitting does) on top of the core's public interface. They are not part of the `anyshape` package: nothing here can be imported from it, and a change you make to your copy is yours to keep.

Each recipe imports only `anyshape`, and the React ones also `anyshape/react`, so a copy works against the installed package without changes. To write your own, read [Writing your own recipe](../docs/guide/writing-a-recipe.md) in the guide.

## The catalog

| File | What it gives you | Keys it defines | Tests |
|---|---|---|---|
| [`validation.ts`](validation.ts) | `rule` and `asyncRule` for a field's checks, and `validate(store, node)`, which checks a subtree and lists its errors. A field's sync rules run in order until one fails; its async rules run after them, with optional debounce, and their results are reused while the inputs are unchanged. | `error` (combined, counted: the first failing rule's message), `forced` (set by `validate`). Feature: `validation()`. | [`validation.test.ts`](validation.test.ts) |
| [`rules.ts`](rules.ts) | Ready rules: `required`, `minLength`, `maxLength`, `min`, `max`, `pattern`, `email`, and the helpers `isEmpty` and `labelOf`. Each states in its type what kind of node it accepts. | None; they contribute to `error`. | [`rules.test.ts`](rules.test.ts) |
| [`features.ts`](features.ts) | The keys an input usually needs, and `control()`, which bundles them. | `touched` (counted: set by the user's first edit), `dirty` (counted: differs from the baseline), `visible`, `disabled` (combined: true while any reason applies). Feature: `control()` = `validation()` + `touched` + `dirty` + `reveal()`. | [`features.test.ts`](features.test.ts), [`types.test.ts`](types.test.ts) |
| [`behaviors.ts`](behaviors.ts) | Behavior helpers: `calculate` (a derived value), `link` (two values kept in step both ways), `visibleWhen`, `disableWhen`, `clearWhen`, and `exclusive` (at most, or exactly, one of several fields filled). | None; they write `visible` and contribute to `disabled` and `error`. | [`behaviors.test.ts`](behaviors.test.ts) |
| [`submit.ts`](submit.ts) | `handleSubmit(store, fn)`: reveals every error, validates, waits for async checks, then calls `fn` with the form's value or focuses the first error. One submit at a time per store. | `submitting` (feature `submission()`), `revealed` (feature `reveal()`, set on blur and by a submit). | [`submit.test.ts`](submit.test.ts), [`react/submit.test.tsx`](react/submit.test.tsx) |
| [`focus.ts`](focus.ts) | `registerFocus(store, node, target)` and `focusFirst(entries)`. The pattern for state kept beside the form: focus targets are DOM handles, so they live in the recipe's own registry, not in the store. | None. | [`focus.test.ts`](focus.test.ts) |
| [`react/control.ts`](react/control.ts) | `useControl(node)`: an input's binding for a node with `control()`: value, `onChange`, the control keys, `pending`, `showError`, `onBlur` and `focusRef`. | None; reads the `control()` keys. | [`react/control.test.tsx`](react/control.test.tsx) |
| [`react/adapters.ts`](react/adapters.ts) | `fromInput` and `fromCheckbox`: turn an `onChange` for values into a DOM change handler. | None. | [`react/control.test.tsx`](react/control.test.tsx) |

This repository's lint (`bun run lint`, the boundary rules in [`.oxlintrc.json`](../.oxlintrc.json)) checks that recipes import only the public entries.

## Copying a recipe

1. Copy the recipe's file and the files it imports into your project, for example under `src/forms/`:
   - `validation.ts` stands alone; `rules.ts` needs `validation.ts`.
   - `behaviors.ts` needs `rules.ts` and `validation.ts`.
   - `focus.ts` stands alone; `submit.ts` needs `focus.ts` and `validation.ts`.
   - `features.ts` needs `validation.ts` and `submit.ts`.
   - `react/control.ts` needs `focus.ts`; `react/adapters.ts` stands alone. Keep the React files apart, so the rest doesn't depend on React.
   - `index.ts` and `react/index.ts` only re-export; copy them if you like a single import.
2. Copy the tests with them if you want to keep them passing as you change things. They use [Vitest](https://vitest.dev); the React tests run in browser mode with `vitest-browser-react`. [`test/`](test/) holds their fixtures and helpers.
3. Rename what you like. The keys are found by their definitions, never by name, so a node can declare `touched` as `wasEdited` and every helper still finds it. Rename exported functions and types freely; nothing outside your copy refers to them.

## Common changes

The recipes have no options for these: edit the line in your copy.

| To change | Edit |
|---|---|
| When an error shows (on blur, after an edit, right away) | The `showError:` line in [`react/control.ts`](react/control.ts), for example `error !== undefined && touched`. |
| A derived value that stops following its sources once the user edits it | `calculate` in [`behaviors.ts`](behaviors.ts): add the target to `triggers` and, in `run`, keep a flag in `ctx.state` once `ctx.changed(target)` with a `"user"` origin, as the guide's [behaviors page](../docs/guide/behaviors.md#the-run-context) shows. |
| What a cleared value is reset to | `const initial = initialOf(target)` in `clearWhen` in [`behaviors.ts`](behaviors.ts): `clearWhen` writes the baseline value; write a fixed empty value instead if you prefer. |
| What counts as filled for `required` and `exclusive` | `isEmpty` in [`rules.ts`](rules.ts), for example to treat `0` or `false` as empty. |
| The order `focusFirst` picks the first error in | The `.sort(...)` line in `focusFirst` in [`focus.ts`](focus.ts): document order, then the entries' order. |
| Default messages | The fallback strings in [`rules.ts`](rules.ts), or pass `message` per rule. |

## See also

- [The guide](../docs/guide/README.md), whose pages link the recipe that shows each concept at work.
- The [evolution example](../examples/evolution/README.md), which uses the recipes stage by stage.
