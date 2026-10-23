// ============================================================
// Visibility – `visible`, and visibleWhen to compute it.
// ------------------------------------------------------------
//   • `visible` is a plain key: one behavior writes it, visibleWhen, both
//     ways (shown and hidden).
//   • Hiding changes nothing else: a hidden value is kept and submitted, and
//     a hidden field's rules still run. Clear it with clearWhen, or guard
//     its rules on `visible`.
//   • Only the node's own value: a hidden object node says nothing about the
//     keys of the nodes inside it.
// ============================================================

import {
  metaKey,
  defineBehavior,
  pathOf,
  type AnyNode,
  type AnyRef,
  type Behavior,
  type MetaRef,
  type RefValue,
} from "anyshape";

/** Whether the node is shown. */
export const visibleKey = metaKey(true);

/** The `visible` meta group. */
export const visible = () => ({ visible: visibleKey });

type Values<Rs extends readonly AnyRef[]> = { -readonly [K in keyof Rs]: RefValue<Rs[K]> };

/** target.visible = test(...refs). */
export function visibleWhen<const Rs extends readonly AnyRef[]>(
  target: AnyNode & { readonly visible: MetaRef<boolean> },
  refs: Rs,
  test: (...values: Values<Rs>) => boolean,
  options: { name?: string } = {},
): Behavior {
  return defineBehavior({
    name: options.name ?? `visibleWhen(${pathOf(target)})`,
    triggers: refs,
    writes: [target.visible],
    run: (ctx) => ctx.set(target.visible, test(...(refs.map((r) => ctx.get(r)) as Values<Rs>))),
  });
}
