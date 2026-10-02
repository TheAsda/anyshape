// ============================================================
// Test-local features: the meta keys the core tests declare, with the same
// behaviors as the features in recipes/, which the core tests never import.
// ============================================================

import { metaKey, initialOf, type BehaviorContext } from "../index";

/** A focus target, as the focus recipe defines it: here only a non-reactive value. */
export interface FocusTarget {
  focus(): void;
}

/** A check contributed to `error`: an error message, or undefined. */
export type Check = (value: any, ctx: Pick<BehaviorContext, "get">) => string | undefined;

/**
 * A test-local combined key: its owner writes the first failing check of the
 * node's contributions (test/rules.ts), in order. Counted per subtree.
 */
export const error = metaKey<string | undefined, Check>(undefined, { aggregate: (e) => e !== undefined }).combine((self, key) => ({
  name: `${self.path || "<root>"}#error`,
  triggers: [self],
  writes: [key],
  run(ctx) {
    const value = ctx.get(self);
    for (const p of ctx.parts) {
      const found = p.payload(value, ctx);
      if (found !== undefined) return ctx.set(key, found);
    }
    ctx.set(key, undefined);
  },
}));

export const validation = () => ({ error });

/** true once the user changed the value; stays true. */
export const touched = metaKey(false, { owner: "feature", aggregate: (t) => t }).behavior((self, key) => ({
  triggers: [self],
  writes: [key],
  origins: ["user"],
  runOn: { init: false },
  run: (ctx) => ctx.set(key, true),
}));

/** true while the value differs (Object.is) from its initial value. */
export const dirty = metaKey(false, { owner: "feature", aggregate: (d) => d }).behavior((self, key) => ({
  triggers: [self, initialOf(self)],
  writes: [key],
  run: (ctx) => ctx.set(key, !Object.is(ctx.get(self), ctx.initial(self))),
}));

export const visible = metaKey(true, { inherit: "all" });

export const disabled = metaKey(false, { inherit: "any" });

export const submitting = metaKey(false, { owner: "feature" });

export const submission = () => ({ submitting });

/** true once the field's error may be shown. */
export const revealed = metaKey(false, { owner: "feature" });

export const focusTarget = metaKey<FocusTarget | undefined>(undefined, { owner: "feature", reactive: false });

/** validation, touched, dirty, revealed and a focus target. */
export const control = () => ({
  ...validation(),
  touched,
  dirty,
  revealed,
  focusTarget,
});
