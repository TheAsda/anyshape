// ============================================================
// Features – meta key definitions, and bundles of them.
// ------------------------------------------------------------
// An option-free key is one definition, declared on every node under its
// own name (field().meta({ touched, dirty })), so a sweep finds it with
// collect(node, touched). Bundles (validation(), control()) spread several.
// ============================================================

import { metaKey, initialOf } from "form-lib";
import { reveal } from "./submit";
import { validation } from "./validation";

/** true once the user changed the value (origin "user"); stays true. Counted per subtree. */
export const touched = metaKey(false).aggregate((t) => t).behavior((self, key) => ({
  triggers: [self],
  writes: [key],
  origins: ["user"],
  runOn: { init: false },
  run: (ctx) => ctx.set(key, true),
}));

/** true while the value differs (Object.is) from its initial value. Counted per subtree. */
export const dirty = metaKey(false).aggregate((d) => d).behavior((self, key) => ({
  triggers: [self, initialOf(self)],
  writes: [key],
  run: (ctx) => ctx.set(key, !Object.is(ctx.get(self), ctx.get(initialOf(self)))),
}));

/**
 * Whether the node is shown. Only the node's own value: a hidden group says
 * nothing about the keys of the nodes inside it.
 */
export const visible = metaKey(true);

/**
 * Whether the node is disabled. A combined key: true while any contribution
 * (a reason, e.g. disableWhen, exclusive) is present. Application code may
 * still write it. Only the node's own value: a disabled group says nothing
 * about the keys of the nodes inside it.
 */
export const disabled = metaKey<boolean, string>(false).combine((self, key) => ({
  name: `${self.path || "<root>"}#disabled`,
  writes: [key],
  run: (ctx) => ctx.set(key, ctx.parts.length > 0),
}));

/**
 * The usual set for an input: validation, touched, dirty and revealed, with
 * their default behaviors.
 * Deliberately not configurable: control() exists to provide this default
 * functionality. For different logic, compose the features you need and
 * declare your own key, e.g. field().meta(validation(), { touched, dirty: false }).
 */
export const control = () => ({
  ...validation(),
  touched,
  dirty,
  ...reveal(),
});
