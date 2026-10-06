---
"anyshape": patch
---

Docs: the combined-keys guide said that removing a key's last contribution leaves whatever the owner computes from none. The key returns to its default instead: an owner runs in a scope only while a contribution is registered for it, on that scope's store or an enclosing one. A contribution whose guard fails is still absent, and when none applies the owner runs with an empty `ctx.parts`.
