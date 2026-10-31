---
"anyshape": minor
---

**Breaking:** `ControlNode` and `ControlBinding` are parameterized by the node's value type, and `useControl` with them. A reusable component types its props by value now:

```tsx
function NameField({ node }: { node: ControlNode<string> }) {
  const { value } = useControl(node); // value: string
}

// A binding's type argument is the value, not the node:
let c!: ControlBinding<InferValue<typeof shape.name>>; // was ReturnType<typeof useControl<typeof shape.name>>
```

The refs in `ControlNode<T>` keep the types the default `control()` declares (`error: MetaRef<string | undefined>`, the booleans as `MetaRef<boolean>`). A copied set that changes a key's type has already copied `control.ts` and edits it there ([#173](https://github.com/TheAsda/anyshape/issues/173)).
