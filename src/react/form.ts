// ============================================================
// Form lifetime, syncing React data
// ------------------------------------------------------------
//   • useForm creates the store once per mount. Later changes to `shape` or
//     `initialValues` are ignored (dev warning for a different shape).
//     `options.values` loads data: every new object (by identity) is written
//     as the new baseline ({ as: "initial" }), and reset() returns to it.
//     Re-rendering with the same object does nothing, so edits survive.
//   • useSync(ref, value) writes React data (query results, props, context)
//     into the form when it changes (origin "program"). The written value
//     stays after unmount.
// ============================================================

import { useLayoutEffect, useRef, useState } from "react";
import type { AnyNode, InferValue, MetaRef, ObjectNode } from "../shape";
import { createStore } from "../create";
import type { StoreOptions } from "../behaviors";
import type { RootStore } from "../store";
import { useStore, resolveStore, type HookOptions } from "./hooks";
import { refLabel, targetOf, isDev } from "../internal";

// ============================================================
// useForm
// ============================================================
export interface UseFormOptions<N extends ObjectNode<any>> extends StoreOptions {
  /**
   * Data to load. Each new object is written as the baseline; while it is
   * undefined (e.g. still loading) the form shows `initialValues`.
   */
  values?: InferValue<N>;
}

/** Create a form store once per mount. Render it with <StoreProvider store={form}>. */
export function useForm<N extends ObjectNode<any>>(
  shape: N,
  initialValues: InferValue<N>,
  options: UseFormOptions<N> = {}
): RootStore<N> {
  const [store] = useState(() => createStore(shape, options.values ?? initialValues, options));

  if (isDev() && store.node !== shape) {
    console.warn("useForm: `shape` changed after the form was created – the change is ignored. Create shapes outside components.");
  }

  // Load new data objects as the baseline, before paint.
  const applied = useRef<unknown>(options.values);
  useLayoutEffect(() => {
    const values = options.values;
    if (values === undefined || values === applied.current) return;
    applied.current = values;
    store.set(store.node, values, { as: "initial" });
  }, [store, options.values]);

  return store;
}

// ============================================================
// useSync
// ============================================================
const warned = new WeakSet<object>();

/**
 * Keep a value or meta key of the form equal to `value`: written (before
 * paint) whenever `value` changes. Meta keys fed this way should be declared
 * with keepOnReset, or reset() puts them back to their default while `value`
 * is unchanged.
 */
export function useSync<R extends AnyNode | MetaRef<any>>(ref: R, value: InferValue<R>, options: HookOptions = {}): void {
  const start = useStore(options);
  const store = resolveStore(start, ref);

  const def = targetOf(ref)?.def;
  if (isDev() && def && !def.options.keepOnReset && !warned.has(ref)) {
    warned.add(ref);
    console.warn(`useSync: "${refLabel(ref)}" is not declared with keepOnReset – reset() will clear it until the synced value changes.`);
  }

  useLayoutEffect(() => {
    if (!store.isAttached()) return;
    if (!Object.is(store.get(ref as never), value)) store.set(ref as never, value as never, { origin: "program" });
  }, [store, ref, value]);
}
