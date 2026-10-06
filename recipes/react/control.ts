// ============================================================
// useControl – an input's binding for a node with control().
// ------------------------------------------------------------
//   Built on useField: the value, a user onChange and the node's own
//   control() keys, read and written through the node's refs.
//   • `pending` while a check of the field runs (pendingOf(node.error)).
//   • showError: an error is shown once the field is revealed – on blur
//     (onBlur) or by a submit – and no check is pending.
//   • focusRef, beside the control rather than one of its properties: the
//     React compiler treats a value read as `x.somethingRef` as a ref, and
//     then flags every other read of `x` during render.
// ============================================================

import { pendingOf, type AnyNode, type BaseStore, type InferValue, type MetaRef } from "anyshape";
import { useField, useValue, type HookOptions } from "anyshape/react";
import { useCallback, useRef } from "react";

import { registerFocus, type FocusTarget } from "../focus";

/** A node with the control() keys. */
export type ControlNode = AnyNode & {
  readonly error: MetaRef<string | undefined>;
  readonly touched: MetaRef<boolean>;
  readonly dirty: MetaRef<boolean>;
  readonly revealed: MetaRef<boolean>;
};

export interface ControlBinding<N extends ControlNode> {
  value: InferValue<N>;
  /** Stable; writes with origin "user". */
  onChange: (value: InferValue<N>) => void;
  error: string | undefined;
  touched: boolean;
  dirty: boolean;
  /** A check of the field is running: `error` is the last completed result. */
  pending: boolean;
  /** Set on blur (onBlur) and by submit; cleared by reset. */
  revealed: boolean;
  /** Whether to show the error now: revealed, with an error and no check pending. */
  showError: boolean;
  /** Stable; marks the field revealed. Pass it to the input's onBlur. */
  onBlur: () => void;
  store: BaseStore<any>;
}

/**
 * A node with control(): `control` holds the value, onChange and the
 * control state; `focusRef` is a stable callback ref that registers the
 * element (or any FocusTarget) for focusing errors. Destructure the two.
 */
export function useControl<N extends ControlNode>(
  node: N,
  options?: HookOptions,
): { control: ControlBinding<N>; focusRef: (target: FocusTarget | null) => void } {
  const { value, onChange, store } = useField(node, options);
  const error = useValue(node.error, { store });
  const touched = useValue(node.touched, { store });
  const dirty = useValue(node.dirty, { store });
  const revealed = useValue(node.revealed, { store });
  const pending = useValue(pendingOf(node.error), { store });

  const unregister = useRef<(() => void) | null>(null);
  const focusRef = useCallback(
    (target: FocusTarget | null) => {
      unregister.current?.();
      unregister.current = target ? registerFocus(store, node, target) : null;
    },
    [store, node],
  );

  const onBlur = useCallback(() => {
    // A row being removed may blur its focused input after detaching.
    if (store.isAttached()) store.set(node.revealed, true, { origin: "user" });
  }, [store, node]);

  const control: ControlBinding<N> = {
    value,
    onChange,
    error,
    touched,
    dirty,
    pending,
    revealed,
    // Edit to show errors at another moment, e.g. `error !== undefined && touched`.
    showError: error !== undefined && revealed && !pending,
    onBlur,
    store,
  };
  return { control, focusRef };
}
