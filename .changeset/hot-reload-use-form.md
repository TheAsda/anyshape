---
"anyshape": patch
---

`useForm` survives a hot reload. A new `shape` (an edited shape module under React Fast Refresh) used to leave the store on the old shape, so the next hook threw `"…" is not part of this form`. Now it builds a new store that keeps every value and baseline whose path and kind are unchanged. A new `behaviors` object replaces the registered behaviors on the same store. A shape or behaviors created inside a component, a new object on every render, gets a dev warning.
