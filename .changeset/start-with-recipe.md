---
"anyshape": patch
---

New value-behavior recipe: `startWith(ref, value)` gives a meta key its start — the value it holds when the store is created, in every row that is added, and again after `reset()`, in place of the key's default. A load (`{ as: "initial" }`) does not run it: the start is fixed at mount. Takes a meta key only (a value's start is its baseline) and a fixed value; a start computed from the row's own data, or one that also reacts, stays a hand-written behavior, as the guide's behaviors page shows. A key that is combined or has its own behavior is rejected at registration, like any second writer.

```ts
import { startWith } from "anyshape/recipes";

createStore(editor, values, {
  // A form opened over existing content starts in edit mode.
  behaviors: startWith(editor.mode, "edit"),
});
```
