// ============================================================
// The React entry, `anyshape/react`. It imports the core and never copies it.
// Every public name is listed here, and test/exports.test.ts snapshots the list.
// ============================================================

export {
  StoreProvider, useStore, useValue, useField, useArray,
  type StoreProviderProps, type HookOptions, type SelectOptions, type FieldBinding, type ArrayBinding,
} from "./hooks.js";
export { useForm, useSync, type UseFormOptions } from "./form.js";
export { useBehaviors, type UseBehaviorsOptions } from "./behaviors.js";
