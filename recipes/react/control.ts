// ============================================================
// useControl – an input's binding for a node with control().
// ------------------------------------------------------------
//   Built on useField: the value, a user onChange and the node's own
//   control() keys, written through the node's refs.
//   • When a control's error is shown is a display policy (showError), set
//     once with <ErrorDisplayProvider policy={...}> and inherited by nested
//     providers. The default shows an error once the field is revealed: on
//     blur (onBlur) or by a submit.
// ============================================================

import { createContext, createElement, useCallback, useContext, useRef, type ReactNode } from "react";
import type { AnyNode, BaseStore, InferValue, MetaRef } from "form-lib";
import { useField, type HookOptions } from "form-lib/react";
import type { FocusTarget } from "../focus";

/** What an error display policy decides on: a control's current state. */
export type ErrorDisplayState = Omit<ControlMeta, "focusTarget">;

/** Decides whether a control shows its error (useControl's showError). */
export type ErrorDisplayPolicy = (state: ErrorDisplayState) => boolean;

/** Show an error once the field is revealed (blurred, or covered by a submit); then it stays live. */
export const defaultErrorDisplay: ErrorDisplayPolicy = (s) => s.error !== undefined && s.revealed;

const ErrorDisplayContext = createContext<ErrorDisplayPolicy>(defaultErrorDisplay);

export interface ErrorDisplayProviderProps {
  /** Error display policy for the controls below. */
  policy: ErrorDisplayPolicy;
  children?: ReactNode;
}

/** Set the error display policy for the controls below; the nearest provider wins. */
export function ErrorDisplayProvider(props: ErrorDisplayProviderProps): ReactNode {
  return createElement(ErrorDisplayContext.Provider, { value: props.policy }, props.children);
}

/** The control() keys and their values. */
interface ControlMeta {
  error: string | undefined;
  validating: boolean;
  touched: boolean;
  dirty: boolean;
  revealed: boolean;
  focusTarget: FocusTarget | undefined;
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
  /** Set on blur (onBlur) and by submit; cleared by reset. */
  revealed: boolean;
  /** Whether to show the error now, per the provided display policy. */
  showError: boolean;
  /** Stable; marks the field revealed. Pass it to the input's onBlur. */
  onBlur: () => void;
  /** Stable callback ref: registers the element (or any FocusTarget) for focusing errors. */
  focusRef: (target: FocusTarget | null) => void;
  store: BaseStore<any>;
}

/** A node with control(): value, onChange and the control state. */
export function useControl<N extends ControlNode>(node: N, options?: HookOptions): ControlBinding<N> {
  const { value, onChange, meta, store } = useField(node, options);
  const own = meta as unknown as ControlMeta;

  const registered = useRef<FocusTarget | null>(null);
  const focusRef = useCallback(
    (target: FocusTarget | null) => {
      if (target) {
        registered.current = target;
        store.set(node.focusTarget, target);
        return;
      }
      // Unmount: clear only what this ref registered (another element may have taken over).
      if (registered.current && store.get(node.focusTarget) === registered.current) {
        store.set(node.focusTarget, undefined);
      }
      registered.current = null;
    },
    [store, node]
  );

  const onBlur = useCallback(() => {
    // A row being removed may blur its focused input after detaching.
    if (store.isAttached()) store.set(node.revealed, true, { origin: "user" });
  }, [store, node]);

  const policy = useContext(ErrorDisplayContext);

  return {
    value,
    onChange,
    error: own.error,
    touched: own.touched,
    dirty: own.dirty,
    validating: own.validating,
    revealed: own.revealed,
    showError: policy(own),
    onBlur,
    focusRef,
    store,
  };
}
