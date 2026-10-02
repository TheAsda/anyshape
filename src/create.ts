// ============================================================
// createStore – wires the store and the behavior runtime.
// ============================================================

import { BehaviorRuntime, defaultBehaviors, type StoreOptions } from "./behaviors";
import { RootStore } from "./store";
import type { ObjectNode, InferValue } from "./shape";

export function createStore<N extends ObjectNode<any>>(
  shape: N,
  initialValues: InferValue<N>,
  options: StoreOptions = {}
): RootStore<N> {
  const store = new RootStore(shape, initialValues);
  const runtime = new BehaviorRuntime(
    store,
    options.onError ?? ((error, info) => console.error(`[form] "${info.behavior}" failed at "${info.scope}"`, error))
  );
  store._runtime = runtime;
  store._batch(() => {
    const defaults = defaultBehaviors(shape);
    if (defaults.length) runtime.add(store, defaults, true);
    if (options.behaviors) runtime.add(store, options.behaviors);
  });
  return store;
}
