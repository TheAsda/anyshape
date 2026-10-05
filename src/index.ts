// The core entry, `anyshape`. Every public name is listed here, and
// test/exports.test.ts snapshots the list: a change to the surface is a
// reviewed diff. Names marked @internal stay out.

// Shapes
export {
  ShapeNode, FieldNode, ObjectNode, ArrayNode, field, object, array, form,
  type FieldId, type AnyNode, type ContainerNode, type InferValue, type InferMeta, type Ref, type ArrayOptions,
} from "./shape";

// Meta keys
export {
  MetaKeyDef, metaKey,
  type Meta, type NoPayload, type MetaKeyOptions, type MetaKeySteps, type UsedRefs, type MergeMetaRefs,
} from "./meta";

// References
export { MetaRef } from "./refs/meta";
export { CountRef, countIn } from "./refs/count";
export { InitialRef, initialOf } from "./refs/initial";
export { PendingInRef, PendingOfRef, pendingIn, pendingOf } from "./refs/pending";

// Stores
export { createStore } from "./create";
// The type only: createStore is the one way to build a root store.
export type { RootStore } from "./store";
export {
  BaseStore, ArrayStore, ItemStore,
  type Listener, type Unsubscribe, type Origin, type WriteOptions, type AnyRef, type RefValue, type CollectEntry,
  type NewItemArgs,
} from "./store";

// Behaviors
export {
  Behavior, Contribution, when, defineBehavior, contribute,
  type AnyBehavior, type BehaviorConfig, type BehaviorContext, type Declaration, type Guard, type WritableRef,
  type OriginKind, type Part, type OwnerContext, type OwnerConfig, type BehaviorErrorInfo, type StoreOptions,
  type BehaviorHandle,
} from "./behaviors";
export { BehaviorBuilder, defineBehaviors } from "./builder";
