// ============================================================
// useControl – an input's binding for a node with control().
// ------------------------------------------------------------
//   Built on useField: the value, a user onChange and the node's own
//   control() keys, read and written through the node's refs.
//   • `pending` while a check of the field runs (pendingOf(node.error)).
//   • `requiredNow` while a required() on the field is present, e.g. for an
//     asterisk on the label.
//   • showError: an error is shown once the field is revealed – on blur
//     (onBlur), by a submit or by code – and no check is pending.
//   • focusRef registers the element for focusing errors. Destructure the
//     result: the React compiler treats a value read as `x.somethingRef` as
//     a ref, and then flags every other read of `x` during render.
// ============================================================

import { pendingOf, type BaseStore, type MetaRef, type ShapeNode } from "anyshape";
import { useField, useValue, type HookOptions } from "anyshape/react";
import { useCallback, useRef } from "react";

import { registerFocus, type FocusTarget } from "../focus.js";

/** A node with the control() keys. `ControlNode<T>` is one whose value type is `T`. */
export type ControlNode<T = any> = ShapeNode<T> & {
  readonly error: MetaRef<string | undefined>;
  readonly requiredNow: MetaRef<boolean>;
  readonly edited: MetaRef<boolean>;
  readonly dirty: MetaRef<boolean>;
  readonly revealed: MetaRef<boolean>;
};

export interface ControlBinding<T = any> {
  value: T;
  /** Stable; writes with origin "user". */
  onChange: (value: T) => void;
  /** Stable; marks the field revealed. Pass it to the input's onBlur. */
  onBlur: () => void;
  error: string | undefined;
  /** Whether to show the error now: revealed, with an error and no check pending. */
  showError: boolean;
  /** A check of the field is running: `error` is the last completed result. */
  pending: boolean;
  /** The user changed the value. Not set by a submit. */
  edited: boolean;
  dirty: boolean;
  /** A required() on the field is present now. */
  requiredNow: boolean;
  /** Set on blur (onBlur), by a submit or by code; cleared by reset. */
  revealed: boolean;
  /** Stable callback ref: registers the element (or any FocusTarget) for focusing errors. */
  focusRef: (target: FocusTarget | null) => void;
  store: BaseStore<any>;
}

/** A node with control(): its value, onChange, onBlur, the control keys, showError and focusRef. Destructure it. */
export function useControl<T>(node: ControlNode<T>, options?: HookOptions): ControlBinding<T> {
  const { value, onChange, store } = useField(node, options);
  const error = useValue(node.error, { store });
  const requiredNow = useValue(node.requiredNow, { store });
  const edited = useValue(node.edited, { store });
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

  return {
    value,
    onChange,
    onBlur,
    error,
    // Edit to show errors at another moment, e.g. `error !== undefined && edited`.
    showError: error !== undefined && revealed && !pending,
    pending,
    edited,
    dirty,
    requiredNow,
    revealed,
    focusRef,
    store,
  };
}
