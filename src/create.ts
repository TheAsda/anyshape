// ============================================================
// createStore – wires the store and the behavior runtime.
// ============================================================

import type { StoreOptions } from "./behaviors.js";
import { Diagnostics } from "./diagnostics.js";
import { isDev } from "./internal.js";
import { BehaviorRuntime, defaultBehaviors } from "./runtime.js";
import type { ObjectNode, InferValue } from "./shape.js";
import { RootStore } from "./store.js";

/**
 * Create a store for a shape from `form()`: `initialValues` are its values and
 * its baseline; `options.behaviors` run once now, then on every change they
 * declare.
 * @see {@link https://github.com/TheAsda/anyshape/blob/master/docs/guide/store.md | The store} in the guide.
 */
export function createStore<N extends ObjectNode<any>>(
  shape: N,
  initialValues: InferValue<N>,
  options: StoreOptions = {},
): RootStore<N> {
  const onError =
    options.onError ?? ((error, info) => console.error(`[form] "${info.behavior}" failed at "${info.scope}"`, error));
  const store = new RootStore(shape, initialValues, (root) => new BehaviorRuntime(root, onError));
  if (isDev()) store._probe = new Diagnostics();
  store._batch(() => {
    const defaults = defaultBehaviors(shape);
    if (defaults.length) store._runtime.add(store, defaults);
    if (options.behaviors) store._runtime.add(store, options.behaviors);
  });
  return store;
}
