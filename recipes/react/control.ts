// ============================================================
// useControl – an input's binding for a node with control().
// ------------------------------------------------------------
//   Built on useField: the value, a user onChange and the node's own
//   control() keys.
// ============================================================

import type { AnyNode, BaseStore, InferValue, MetaRef } from "form-lib";
import { useField, type HookOptions } from "form-lib/react";

/** The control() keys and their values. */
interface ControlMeta {
  error: string | undefined;
  validating: boolean;
  touched: boolean;
  dirty: boolean;
}

/** A node with the control() keys. */
export type ControlNode = AnyNode & { readonly [K in keyof ControlMeta]: MetaRef<ControlMeta[K]> };

export interface ControlBinding<N extends ControlNode> {
  value: InferValue<N>;
  /** Stable; writes with origin "user". */
  onChange: (value: InferValue<N>) => void;
  error: string | undefined;
  touched: boolean;
  dirty: boolean;
  validating: boolean;
  store: BaseStore<any>;
}

/** A node with control(): value, onChange and the control state. */
export function useControl<N extends ControlNode>(node: N, options?: HookOptions): ControlBinding<N> {
  const { value, onChange, meta, store } = useField(node, options);
  const own = meta as unknown as ControlMeta;
  return {
    value,
    onChange,
    error: own.error,
    touched: own.touched,
    dirty: own.dirty,
    validating: own.validating,
    store,
  };
}
