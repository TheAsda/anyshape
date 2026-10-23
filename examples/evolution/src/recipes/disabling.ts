// ============================================================
// Disabling – `disabled` as a combined key, fed by reasons.
// ------------------------------------------------------------
//   • `disabled` is true while any reason (a contribution) is present:
//     disableWhen, exclusive, or a team's own contribute(node.disabled, …).
//   • Writing the key from a behavior is rejected at registration.
//     Application code may still write it with store.set, as a one-off
//     override.
//   • Only the node's own value: a disabled object node says nothing about
//     the keys of the nodes inside it. A disabled value is still submitted.
// ============================================================

import {
  metaKey,
  contribute,
  when,
  pathOf,
  type AnyNode,
  type AnyRef,
  type Contribution,
  type MetaRef,
  type RefValue,
} from "anyshape";

/** Whether the node is disabled: true while any reason (a contribution, its payload a name) is present. */
export const disabledKey = metaKey<boolean, string>(false).combine((self, key) => ({
  name: `${pathOf(self) || "<root>"}#disabled`,
  writes: [key],
  run: (ctx) => ctx.set(key, ctx.parts.length > 0),
}));

/** The `disabled` meta group. */
export const disabled = () => ({ disabled: disabledKey });

/** A node with disabled(): its reasons (contributions) are strings. */
export type Disableable = AnyNode & { readonly disabled: MetaRef<boolean, string> };

type Values<Rs extends readonly AnyRef[]> = { -readonly [K in keyof Rs]: RefValue<Rs[K]> };

/** Disables the target while test(...refs) holds. Other reasons (exclusive, more disableWhen) still apply. */
export function disableWhen<const Rs extends readonly AnyRef[]>(
  target: Disableable,
  refs: Rs,
  test: (...values: Values<Rs>) => boolean,
  options: { name?: string } = {},
): Contribution<string> {
  const name = options.name ?? `disableWhen(${pathOf(target)})`;
  return contribute(target.disabled, name, { name, when: when(refs, test) });
}
