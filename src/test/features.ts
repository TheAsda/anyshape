// ============================================================
// Test-local features: the meta keys the core tests declare, with the same
// behaviors as the features in recipes/, which the core tests never import.
// ------------------------------------------------------------
// The core still finds some of these keys by name, so the names are fixed:
//   • error (with data.validation) and validating – the validation queue,
//     until #26 replaces them with a test-local combined key;
//   • revealed, submitCount, submitting, focusTarget – submit and focus (#32);
//   • visible, disabled – SubmitValue; error, touched, dirty, revealed,
//     validating – useControl.
// ============================================================

import { metaKey, initialOf, type FocusTarget } from "../index";

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
export const touched = () => ({
  touched: metaKey(false, {
    owner: "feature",
    aggregate: (t) => t,
    behavior: (self) => ({
      name: `${self.path || "<root>"}#touched`,
      triggers: [self],
      writes: [self.touched],
      origins: ["user"],
      runOn: { init: false },
      run: (ctx) => ctx.set(self.touched, true),
    }),
  }),
});

/** true while the value differs (Object.is) from its initial value. */
export const dirty = () => ({
  dirty: metaKey(false, {
    owner: "feature",
    aggregate: (d) => d,
    behavior: (self) => ({
      name: `${self.path || "<root>"}#dirty`,
      triggers: [self, initialOf(self)],
      writes: [self.dirty],
      run: (ctx) => ctx.set(self.dirty, !Object.is(ctx.get(self), ctx.initial(self))),
    }),
  }),
});

export const visibility = () => ({
  visible: metaKey(true, { inherit: "all" }),
});

export const disableable = () => ({
  disabled: metaKey(false, { inherit: "any" }),
});

export const submission = () => ({
  submitCount: metaKey(0, { owner: "feature" }),
  submitting: metaKey(false, { owner: "feature" }),
});

/** validation, touched, dirty, revealed and a focus target. */
export const control = (options?: ValidationOptions) => ({
  ...validation(options),
  ...touched(),
  ...dirty(),
  revealed: metaKey(false, { owner: "feature" }),
  focusTarget: metaKey<FocusTarget | undefined>(undefined, { owner: "feature", reactive: false }),
});
