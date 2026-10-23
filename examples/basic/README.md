# The basic example

```sh
bun install                 # at the repository root: the library's own dependencies
cd examples/basic
bun install
bun run dev
```

A purchase requisition in three steps: who is asking, the items, and delivery. It puts most of the library in one complete form: `control()` fields with sync and async rules, rows of items with per-row rules and computed totals, sections shown and cleared on purpose, a lookup that fills in a department's budget, a submit per step and one for the whole form, and a server that rejects some data by path, mapped back onto the fields. [`src/form.ts`](src/form.ts) declares the shape, the behaviors and the fake server; the components are in [`src/App.tsx`](src/App.tsx), [`src/fields.tsx`](src/fields.tsx) and [`src/ItemsSection.tsx`](src/ItemsSection.tsx). It imports the [default recipes](../../recipes/README.md) from `anyshape/recipes` and `anyshape/recipes/react`, as an app would, with their policies as they are ([`recipes/POLICIES.md`](../../recipes/POLICIES.md)). The example resolves those entries, like `anyshape` itself, to the library's source. The [evolution example](../evolution/README.md) shows the other path: a copied set with one policy changed.
