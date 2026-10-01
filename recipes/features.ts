// ============================================================
// Features – meta key definitions, and bundles of them.
// ------------------------------------------------------------
// An option-free key is one definition, declared on every node under its
// own name (field().meta({ touched, dirty })), so a sweep finds it with
// collect(node, touched). Keys with options (validation) are bundles.
// ============================================================

import { metaKey, initialOf } from "form-lib";
import { focusable } from "./focus";
import { reveal } from "./submit";

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

/** true while the value differs (Object.is) from its initial value. Counted per subtree. */
export const dirty = metaKey(false, {
  owner: "feature",
  aggregate: (d) => d,
  behavior: (self, key) => ({
    triggers: [self, initialOf(self)],
    writes: [key],
    run: (ctx) => ctx.set(key, !Object.is(ctx.get(self), ctx.initial(self))),
  }),
});

/** Hidden if this node or any ancestor with `visible` is hidden. */
export const visible = metaKey(true, { inherit: "all" });

/** Disabled if this node or any ancestor with `disabled` is disabled. */
export const disabled = metaKey(false, { inherit: "any" });

/**
 * The usual set for an input: validation, touched, dirty, revealed and a
 * focus target, with their default behaviors.
 * Deliberately not configurable: control() exists to provide this default
 * functionality. For different logic, compose the features you need and
 * declare your own key, e.g. field().meta(validation(), { touched, dirty: false }).
 */
export const control = (options?: ValidationOptions) => ({
  ...validation(options),
  touched,
  dirty,
  ...reveal(),
  ...focusable(),
});
