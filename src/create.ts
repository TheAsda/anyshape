// ============================================================
// createStore – wires the store, the behavior runtime and validation.
// ============================================================

import { BehaviorRuntime, defaultBehaviors, type StoreOptions } from "./behaviors";
import { ValidationLayer } from "./validation";
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
  const validation = new ValidationLayer(runtime);
  runtime.rules = validation;
  store._runtime = runtime;
  store._validation = validation;
  store._batch(() => {
    const defaults = defaultBehaviors(shape);
    if (defaults.length) runtime.add(store, defaults, true);
    if (options.behaviors) runtime.add(store, options.behaviors);
  });
  return store;
}
