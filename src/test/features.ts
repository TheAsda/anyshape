// ============================================================
// Test-local features: the meta keys the core tests declare, with the same
// behaviors as the features in recipes/, which the core tests never import.
// ------------------------------------------------------------
// The validation queue still finds some of these keys by name until #26, so
// their names are fixed: error (with data.validation), validating, visible
// and disabled.
// ============================================================

import { metaKey, initialOf } from "../index";

/** A focus target, as the focus recipe defines it: here only a non-reactive value. */
export interface FocusTarget {
  focus(): void;
}

export interface ValidationOptions {
  validateHidden?: boolean;
  validateDisabled?: boolean;
}

export const validation = (options: ValidationOptions = {}) => ({
  error: metaKey<string | undefined>(undefined, {
    owner: "feature",
    aggregate: (e) => e !== undefined,
    data: { validation: true, ...options },
  }),
  validating: metaKey(false, { owner: "feature", aggregate: (v) => v }),
});

/** true once the user changed the value; stays true. */
export const touched = metaKey(false, {
  owner: "feature",
  aggregate: (t) => t,
  behavior: (self, key) => ({
    triggers: [self],
    writes: [key],
    origins: ["user"],
    runOn: { init: false },
    run: (ctx) => ctx.set(key, true),
  }),
});

/** true while the value differs (Object.is) from its initial value. */
export const dirty = metaKey(false, {
  owner: "feature",
  aggregate: (d) => d,
  behavior: (self, key) => ({
    triggers: [self, initialOf(self)],
    writes: [key],
    run: (ctx) => ctx.set(key, !Object.is(ctx.get(self), ctx.initial(self))),
  }),
});

export const visible = metaKey(true, { inherit: "all" });

export const disabled = metaKey(false, { inherit: "any" });

export const submitting = metaKey(false, { owner: "feature" });

export const submission = () => ({ submitting });

/** true once the field's error may be shown. */
export const revealed = metaKey(false, { owner: "feature" });

export const focusTarget = metaKey<FocusTarget | undefined>(undefined, { owner: "feature", reactive: false });

/** validation, touched, dirty, revealed and a focus target. */
export const control = (options?: ValidationOptions) => ({
  ...validation(options),
  touched,
  dirty,
  revealed,
  focusTarget,
});
