// ============================================================
// Built-in features – bundles of meta key definitions.
// ------------------------------------------------------------
// Stage 1 declares the keys and their capabilities. The default
// behaviors of `touched` and `dirty` are attached in stage 3, and
// the validation queue that owns `error` / `validating` in stage 4.
// ============================================================

import { metaKey } from "./meta";
import { initialOf } from "./store";

/** Anything that can receive focus – an input, or a custom component's handle. */
export interface FocusTarget {
  focus(): void;
  scrollIntoView?(): void;
}

export interface ValidationOptions {
  /** Keep validating while the field is effectively hidden. Default false. */
  validateHidden?: boolean;
  /** Keep validating while the field is effectively disabled. Default false. */
  validateDisabled?: boolean;
}

/**
 * error + validating, owned by the field's validation queue; both counted per
 * subtree. Rules (rule / asyncRule) can only target nodes with this feature.
 */
export const validation = (options: ValidationOptions = {}) => ({
  error: metaKey<string | undefined>(undefined, {
    owner: "feature",
    aggregate: (e) => e !== undefined,
    data: { validation: true, ...options },
  }),
  validating: metaKey(false, { owner: "feature", aggregate: (v) => v }),
});

/** true once the user changed the value (origin "user"); stays true. Counted per subtree. */
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

/** true while the value differs (Object.is) from its initial value. Counted per subtree. */
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

/** Hidden if this node or any ancestor with `visible` is hidden. */
export const visibility = () => ({
  visible: metaKey(true, { inherit: "all" }),
});

/** Disabled if this node or any ancestor with `disabled` is disabled. */
export const disableable = () => ({
  disabled: metaKey(false, { inherit: "any" }),
});

/** Where focusFirst / focus() move the cursor. Registered by the bindings; never notifies. */
export const focusable = () => ({
  focusTarget: metaKey<FocusTarget | undefined>(undefined, { owner: "feature", reactive: false }),
});

/** Form-level submit state. */
export const submission = () => ({
  submitCount: metaKey(0, { owner: "feature" }),
  submitting: metaKey(false, { owner: "feature" }),
});

/**
 * The usual set for an input: validation, touched, dirty and a focus target,
 * with their default behaviors.
 * Deliberately not configurable: control() exists to provide this default
 * functionality. For different logic, compose the features you need and
 * declare your own key, e.g. field().meta(validation(), touched(), { dirty: false }).
 */
export const control = (options?: ValidationOptions) => ({
  ...validation(options),
  ...touched(),
  ...dirty(),
  ...focusable(),
});
