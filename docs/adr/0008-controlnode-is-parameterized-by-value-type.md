---
status: accepted
---

# `ControlNode` is parameterized by the node's value type

In the React recipes, `ControlNode` is generic over the node's value type: `ControlNode<T = any> = ShapeNode<T> & { …the `control()` refs… }`. The refs keep their hard-coded types (`error: MetaRef<string | undefined>`, the booleans as `MetaRef<boolean>`). `useControl` follows: `useControl<T>(node: ControlNode<T>, options?): ControlBinding<T>`, where `ControlBinding<T = any>` is fully concrete except `value: T` and `onChange: (value: T) => void`. A reusable input component types its props as `{ node: ControlNode<string> }` or takes `{ binding: ControlBinding<string> }`, without coupling to a concrete shape ([#173](https://github.com/TheAsda/anyshape/issues/173)).

The hook infers `T` from the node: `.meta(control())` returns `this & MergeMetaRefs<…>`, so passing a concrete field gives `T` from its `FieldNode<T>` constituent. The bare `ControlNode` keeps today's meaning through `T = any`, matching `AnyNode = ShapeNode<any>`.

The refs' types stay hard-coded rather than derived from the node: the type describes the keys the default `control()` declares. A copied set that changes a key's type has already copied `control.ts` and edits the hook with it ([ADR 0006](0006-recipes-ship-as-a-subpath-and-copying-is-for-customizing.md)), as the evolution example does for `showError`.

## Considered options

- **Keep everything `N`-based** (`useControl<N extends ControlNode>(node: N): ControlBinding<N>` with `value: InferValue<N>`), adding `ControlNode<T>` only as a prop-typing alias. Rejected: two ways to reach the same binding type, and a binding still can't be typed by value alone.
- **`ControlNode<T> = ShapeNode<T>` without the refs.** Rejected: `useControl` reads the refs, so the type would admit nodes that fail at runtime.
- **Derive the refs' types from the node** (`InferMeta<N>`). Dropped from this issue: a copied set that changes key types copies the hook anyway; subset support, if ever wanted, is its own issue.

## Consequences

- Type-level tests switch from `ReturnType<typeof useControl<typeof shape.name>>` to `ControlBinding<InferValue<typeof shape.name>>`.
- A breaking change to the exported types' parameterization, with no runtime behavior change; fine pre-release, and a changeset records it.
- Nothing else moves: the core hooks (`useField`, `useValue`) keep their `N`-based generics, and `recipes/POLICIES.md` is untouched because no policy changes.
