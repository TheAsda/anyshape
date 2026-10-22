---
"anyshape": minor
---

**Breaking:** a node's identity is no longer exposed as properties. `node.path`, `node.parent`, `node.id`, `node.lens`, `node._type` and `node._hasCreate` are gone, and so are the names they reserved: nearly every name is now free for a field or a meta key. `pathOf(node)` and `parentOf(node)` take their place, in the style of `initialOf` / `pendingOf`; there is no `idOf` or `lensOf`, because nothing outside the core needs them, and the public `FieldId` type goes with `node.id` for the same reason. `pathOf` also accepts a reference and labels the key it points at (`pathOf(node.error)` is `"name#error"`).

```ts
// before
object({ id: field<string>() }); // threw: "id" is a reserved name
rule(node, ...); // took AnyNode & { readonly _type: V; readonly error: ... }
`${node.path}#${key}`; // messages and behavior names

// after
object({ id: field<string>() }); // a field named "id" is fine
rule(node, ...); // takes ShapeNode<V> & { readonly error: ... }
`${pathOf(node)}#${key}`;
```

A node that requires a value type is now `ShapeNode<V>` instead of `AnyNode & { readonly _type: V }`, and an array with a `create` factory is `ArrayNode<Item, true>` – internally the markers are `declare`d unique symbols, so nothing exists at run time.

Only `meta`, `constructor` and `__proto__` stay reserved: `meta` is the declaration method, and the other two break the node if a field takes their name. All three are rejected for field names and meta keys at compile time, with the run-time check kept as a backstop. A meta key named `item` collides only with an array's item template, through the child/key rule; on fields and objects it is a normal key.
