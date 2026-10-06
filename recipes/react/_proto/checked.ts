// ============================================================
// PROTOTYPE(#128) – throwaway. Component reads of the checked type. useValue
// keeps the stored type; these read a whole step live.
//   R2. useChecked(node): InferChecked<N> | undefined – the value while every
//       check under `node` passes (no error, nothing pending, every
//       `defined` node holds a value); undefined otherwise. One hook; the
//       component renders its own fallback.
//   R3. useIsChecked(node) as the parent's gate, and useCheckedOrThrow(node)
//       in the child: throws to the nearest error boundary when unchecked.
// Both re-render on any change under `node` (they read its value).
// ============================================================

import { countIn, pendingIn, type ContainerNode } from "anyshape";
import { useField, useValue, type HookOptions } from "anyshape/react";

import { undefinedDefined, UncheckedError } from "../../_proto/boundary";
import { error, type InferChecked } from "../../validation";

export function useChecked<N extends ContainerNode>(node: N, options?: HookOptions): InferChecked<N> | undefined {
  const { value, store } = useField(node, options);
  const errors = useValue(countIn(node, error), { store });
  const pending = useValue(pendingIn(node, error), { store });
  if (errors > 0 || pending > 0 || undefinedDefined(store, node).length > 0) return undefined;
  return value as InferChecked<N>;
}

export function useIsChecked(node: ContainerNode, options?: HookOptions): boolean {
  return useChecked(node, options) !== undefined;
}

export function useCheckedOrThrow<N extends ContainerNode>(node: N, options?: HookOptions): InferChecked<N> {
  const checked = useChecked(node, options);
  if (checked === undefined) throw new UncheckedError(node, [], false);
  return checked;
}
