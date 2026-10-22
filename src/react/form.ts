// ============================================================
// Form lifetime, syncing React data
// ------------------------------------------------------------
//   • useForm creates the store on mount, and a new one only for a new
//     `shape` (below); later `initialValues` are ignored. `options.values`
//     loads data: every new object (by identity) is written as the new
//     baseline ({ as: "initial" }), and reset() returns to it. Re-rendering
//     with the same object does nothing, so edits survive.
//   • Hot reload: an edit under Fast Refresh re-runs the module that declares
//     the shape or the behaviors, and React keeps this hook's state.
//       – A new `shape` builds a new store. Each value and baseline whose path
//         is in both shapes with the same kind (field, object, array) is
//         carried over, rows by index, with origin "program"; the rest comes
//         from `values ?? initialValues`. Meta is not carried: behaviors
//         recompute theirs. The old store's behaviors are removed.
//       – A new `options.behaviors` replaces the registered behaviors on the
//         same store, so nothing is lost.
//     A shape or behaviors that is new on two commits in a row, hot reloads
//     aside, is created in the component: a dev warning says so.
//   • useSync(ref, value) writes React data (query results, props, context)
//     into the form when it changes (origin "program"). The written value
//     stays after unmount.
// ============================================================

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { BehaviorHandle, BehaviorList, StoreOptions } from "../behaviors.js";
import { createStore } from "../create.js";
import { refLabel, targetOf, isDev, FIELDS, CREATE } from "../internal.js";
import { initialOf } from "../refs/initial.js";
import type { MetaRef } from "../refs/meta.js";
import { ArrayNode, FieldNode, ObjectNode, type AnyNode, type InferValue } from "../shape.js";
import type { RootStore } from "../store.js";
import { useStore, resolveStore, type HookOptions } from "./hooks.js";

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

/**
 * `value` of `from`, fitted to `to`: kept where both nodes have the same kind,
 * `initial` (`to`'s part of `values ?? initialValues`) where they don't.
 * `fitted` maps each old object or array to its copy, so one shared by the
 * value and the baseline (an unedited row or branch) stays shared.
 */
function carry(to: AnyNode, from: AnyNode, value: any, initial: any, fitted: Map<object, unknown>): any {
  if (to instanceof FieldNode) return from instanceof FieldNode ? value : initial;
  if (to instanceof ObjectNode) {
    if (!(from instanceof ObjectNode) || value === null || typeof value !== "object") return initial;
    if (fitted.has(value)) return fitted.get(value);
    const out: Record<string, unknown> = {};
    const children = from[FIELDS] as Record<string, AnyNode>;
    for (const [key, child] of Object.entries(to[FIELDS] as Record<string, AnyNode>)) {
      out[key] = key in children ? carry(child, children[key], value[key], initial?.[key], fitted) : initial?.[key];
    }
    fitted.set(value, out);
    return out;
  }
  const array = to as ArrayNode;
  if (!(from instanceof ArrayNode) || !Array.isArray(value)) return initial;
  if (fitted.has(value)) return fitted.get(value);
  const out = value.map((row, i) =>
    carry(
      array.item,
      from.item,
      row,
      Array.isArray(initial) && i < initial.length ? initial[i] : array[CREATE]?.(),
      fitted,
    ),
  );
  fitted.set(value, out);
  return out;
}

/**
 * Warns once when a value is new on two commits in a row that were not hot
 * reloads: then it is created in the component. A hot reload renews it on
 * its own commit, and a deliberate switch (one form, then another) once.
 */
class Renewal {
  private last: unknown;
  private started = false;
  private renewed = false;
  private warned = false;

  constructor(private readonly message: string) {}

  track(value: unknown, hotReload: boolean): void {
    const isNew = this.started && value !== this.last && !hotReload;
    if (isNew && this.renewed && !this.warned) {
      this.warned = true;
      console.warn(`useForm: ${this.message}. Declare it outside components.`);
    }
    this.started = true;
    this.renewed = isNew;
    this.last = value;
  }
}

/**
 * What useForm keeps for one mount: the store and the handle of the behaviors
 * registered on it. A new shape is taken up during render (the store is what
 * the render returns); new behaviors after the commit.
 */
class FormMount<N extends ObjectNode<any>> {
  private store!: RootStore<N>;
  private behaviors: BehaviorList | undefined;
  private handle!: BehaviorHandle;
  private readonly shapes = new Renewal("`shape` is a new object on every render, so the store is rebuilt each time");
  private readonly behaviorLists = new Renewal(
    "`behaviors` is a new object on every render, so they are registered again each time",
  );

  constructor(shape: N, initial: InferValue<N>, options: UseFormOptions<N>) {
    this.start(shape, initial, undefined, options);
  }

  /** The store for `shape`: when the shape is new, a new store carrying over what fits. */
  storeFor(shape: N, initial: InferValue<N>, options: UseFormOptions<N>): RootStore<N> {
    const old = this.store;
    if (old.node === shape) return old;
    const fitted = new Map<object, unknown>();
    const baseline = carry(shape, old.node, old.get(initialOf(old.node)), initial, fitted);
    const current = carry(shape, old.node, old.get(old.node), initial, fitted);
    const oldHandle = this.handle;
    this.start(shape, baseline, current, options);
    oldHandle();
    return this.store;
  }

  /** After a commit: a new behaviors object replaces the registered ones. */
  afterCommit(shape: N, behaviors: BehaviorList | undefined, hotReload: boolean): void {
    if (behaviors !== this.behaviors) {
      this.handle = this.store.replaceBehavior(this.handle, behaviors ?? []);
      this.behaviors = behaviors;
    }
    if (isDev()) {
      this.shapes.track(shape, hotReload);
      this.behaviorLists.track(behaviors, hotReload);
    }
  }

  /** A store for `shape` with `options.behaviors`, adopted only once it is complete. */
  private start(shape: N, baseline: InferValue<N>, current: InferValue<N> | undefined, options: UseFormOptions<N>) {
    const store = createStore(shape, baseline, { onError: options.onError });
    if (current !== undefined) store.set(store.node, current, { origin: "program" });
    let handle: BehaviorHandle;
    try {
      handle = store.addBehavior(options.behaviors ?? []);
    } catch (error) {
      if (this.store === undefined || options.behaviors !== this.behaviors) throw error;
      throw new Error(
        "useForm: `shape` is new but `behaviors` is the same object, declared for the previous shape – " +
          "build the behaviors from the new shape (declare them at module level, beside it)",
        { cause: error },
      );
    }
    this.store = store;
    this.behaviors = options.behaviors;
    this.handle = handle;
  }
}

/**
 * Create a form store on mount. Render it with <StoreProvider store={form}>.
 * A new `shape` (a hot reload) builds a new store carrying the values over; a
 * new `options.behaviors` replaces the registered ones. See the guide.
 * @see {@link https://github.com/TheAsda/anyshape/blob/master/docs/guide/react.md | React} in the guide.
 */
export function useForm<N extends ObjectNode<any>>(
  shape: N,
  initialValues: InferValue<N>,
  options: UseFormOptions<N> = {},
): RootStore<N> {
  const [mount] = useState(() => new FormMount(shape, options.values ?? initialValues, options));
  const store = mount.storeFor(shape, options.values ?? initialValues, options);

  // A new object only on mount and on a hot reload: Fast Refresh re-runs
  // memos whatever their deps.
  const render = useMemo(() => ({}), []);
  const lastRender = useRef(render);
  useLayoutEffect(() => {
    mount.afterCommit(shape, options.behaviors, render !== lastRender.current);
    lastRender.current = render;
  });

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
export function useSync<R extends AnyNode | MetaRef<any>>(
  ref: R,
  value: InferValue<R>,
  options: HookOptions = {},
): void {
  const start = useStore(options);
  const store = resolveStore(start, ref);

  if (isDev() && !warned.has(ref)) {
    const def = targetOf(ref)?.def;
    if (def && !def.options.keepOnReset) {
      warned.add(ref);
      console.warn(
        `useSync: "${refLabel(ref)}" is not declared with keepOnReset – reset() will clear it until the synced value changes.`,
      );
    }
  }

  useLayoutEffect(() => {
    if (!store.isAttached()) return;
    if (!Object.is(store.get(ref as never), value)) store.set(ref as never, value as never, { origin: "program" });
  }, [store, ref, value]);
}
