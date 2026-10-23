// ============================================================
// Control – the keys an input needs, and control(), which declares them.
// ------------------------------------------------------------
//   • `edited` is true once the user changed the value (a write with origin
//     "user"), and stays true. A submit doesn't set it; reset() clears it.
//   • `dirty` is true while the value differs (Object.is) from its baseline.
//   • `revealed` is true once the field's error may be shown: set on blur by
//     the bindings, by a submit for every node of its subtree, or by code.
//     reset() clears it.
//   • control() = validation() + edited + dirty + revealed. It has no
//     options: for another set, declare the meta groups you need,
//     e.g. field().meta(validation(), edited()).
// ============================================================

import { metaKey, initialOf } from "anyshape";

import { validation } from "./validation.js";

/** true once the user changed the value (origin "user"); stays true. Counted per subtree. */
export const editedKey = metaKey(false)
  .aggregate((t) => t)
  .behavior((self, key) => ({
    triggers: [self],
    writes: [key],
    origins: ["user"],
    runOn: { init: false },
    run: (ctx) => ctx.set(key, true),
  }));

/** true while the value differs (Object.is) from its baseline. Counted per subtree. */
export const dirtyKey = metaKey(false)
  .aggregate((d) => d)
  .behavior((self, key) => ({
    triggers: [self, initialOf(self)],
    writes: [key],
    run: (ctx) => ctx.set(key, !Object.is(ctx.get(self), ctx.get(initialOf(self)))),
  }));

/** true once the field's error may be shown: set on blur by the bindings and by a submit. Cleared by reset(). */
export const revealedKey = metaKey(false);

/** The `edited` meta group. */
export const edited = () => ({ edited: editedKey });

/** The `dirty` meta group. */
export const dirty = () => ({ dirty: dirtyKey });

/** The `revealed` meta group. */
export const revealed = () => ({ revealed: revealedKey });

/** The usual set for an input: validation(), edited, dirty and revealed, with their default behaviors. */
export const control = () => ({
  ...validation(),
  ...edited(),
  ...dirty(),
  ...revealed(),
});
