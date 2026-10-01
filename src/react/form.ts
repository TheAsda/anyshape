// ============================================================
// Form lifetime, syncing React data, DOM focus order
// ------------------------------------------------------------
//   • useForm creates the store once per mount. Later changes to `shape` or
//     `initialValues` are ignored (dev warning for a different shape).
//     `options.values` loads data: every new object (by identity) is written
//     as the new baseline ({ as: "initial" }) – not dirty, reset() returns to
//     it. Re-rendering with the same object does nothing, so edits survive.
//   • Errors are focused in DOM order by default (domOrder).
//   • useSync(ref, value) writes React data (query results, props, context)
//     into the form when it changes. The written value stays after unmount
//     unless { resetOnUnmount: true }.
// ============================================================

import { useLayoutEffect, useRef, useState } from "react";
import { MetaRef, type AnyNode, type InferValue, type ObjectNode } from "../shape";
import { createStore } from "../create";
import type { StoreOptions } from "../behaviors";
import type { FocusTarget } from "../features";
import type { RootStore, WriteOptions } from "../store";
import { useStore, resolveStore, type HookOptions } from "./hooks";
import { defOf } from "../internal";

const isDev = () => (globalThis as any).process?.env?.NODE_ENV !== "production";

// ============================================================
// DOM order
// ============================================================
/**
 * Orders focus targets by their position in the document. Targets that are
 * not DOM nodes (custom focus handles) compare equal, so they keep their
 * shape order relative to each other.
 */
export function domOrder(a: FocusTarget, b: FocusTarget): number {
  if (typeof Node === "undefined" || !(a instanceof Node) || !(b instanceof Node) || a === b) return 0;
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

// ============================================================
// useForm
// ============================================================
export interface UseFormOptions<N extends ObjectNode<any, any>> extends StoreOptions {
  /**
   * Data to load. Each new object is written as the baseline; while it is
   * undefined (e.g. still loading) the form shows `initialValues`.
   */
  values?: InferValue<N>;
}

/** Create a form store once per mount. Render it with <StoreProvider store={form}>. */
export function useForm<N extends ObjectNode<any, any>>(
  shape: N,
  initialValues: InferValue<N>,
  options: UseFormOptions<N> = {}
): RootStore<N> {
  const [store] = useState(() =>
    createStore(shape, options.values ?? initialValues, {
      ...options,
      focusOrder: options.focusOrder ?? domOrder,
    })
  );

  if (isDev() && store.node !== shape) {
    console.warn("useForm: `shape` changed after the form was created – the change is ignored. Create shapes outside components.");
  }

  // Load new data objects as the baseline, before paint.
  const applied = useRef<unknown>(options.values);
  useLayoutEffect(() => {
    const values = options.values;
    if (values === undefined || values === applied.current) return;
    applied.current = values;
    store.setValues(values, { as: "initial" });
  }, [store, options.values]);

  return store;
}

// ============================================================
// useSync
// ============================================================
export interface SyncOptions extends HookOptions {
  /** Default origin "program". */
  origin?: WriteOptions["origin"];
  /** Write the key's default (meta) or the initial value (node) when the component unmounts. */
  resetOnUnmount?: boolean;
}

const warned = new WeakSet<object>();

/**
 * Keep a value or meta key of the form equal to `value`: written (before
 * paint) whenever `value` changes. Meta keys fed this way should be declared
 * with keepOnReset, or reset() puts them back to their default while `value`
 * is unchanged.
 */
export function useSync<R extends AnyNode | MetaRef<any>>(ref: R, value: InferValue<R>, options: SyncOptions = {}): void {
  const start = useStore(options);
  const store = resolveStore(start, ref);

  if (isDev() && ref instanceof MetaRef && !defOf(ref).options.keepOnReset && !warned.has(ref)) {
    warned.add(ref);
    console.warn(`useSync: "${ref.path}" is not declared with keepOnReset – reset() will clear it until the synced value changes.`);
  }

  const origin = options.origin ?? "program";
  useLayoutEffect(() => {
    if (!store.isAttached()) return;
    if (!Object.is(store.get(ref as never), value)) store.set(ref as never, value as never, { origin });
  }, [store, ref, value, origin]);

  const resetOnUnmount = options.resetOnUnmount === true;
  useLayoutEffect(() => {
    if (!resetOnUnmount) return;
    return () => {
      if (!store.isAttached()) return;
      const reset = ref instanceof MetaRef ? defOf(ref).defaultValue : store.getInitial(ref as AnyNode);
      store.set(ref as never, reset as never, { origin });
    };
  }, [store, ref, resetOnUnmount, origin]);
}
