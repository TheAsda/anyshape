// The core entry, `anyshape`. Every public name is listed here, and
// test/exports.test.ts snapshots the list: a change to the surface is a
// reviewed diff. Internal names stay out.
// (No comment in this file may contain the internal tag: stripInternal
// drops the declaration that follows it, a whole export list included.)

// Shapes
export {
  ShapeNode, FieldNode, ObjectNode, ArrayNode, field, object, array, form,
  type FieldId, type AnyNode, type ContainerNode, type InferValue, type InferMeta, type Ref, type ArrayOptions,
} from "./shape.js";

// Meta keys
export {
  MetaKeyDef, metaKey,
  type Meta, type NoPayload, type MetaKeyOptions, type UsedRefs, type MergeMetaRefs,
} from "./meta.js";

// References
export { MetaRef } from "./refs/meta.js";
export { CountRef, countIn } from "./refs/count.js";
export { InitialRef, initialOf } from "./refs/initial.js";
export { PendingInRef, PendingOfRef, pendingIn, pendingOf } from "./refs/pending.js";

// Stores
export { createStore } from "./create.js";
// The type only: createStore is the one way to build a root store.
export type { RootStore } from "./store.js";
export {
  BaseStore, ArrayStore, ItemStore,
  type Listener, type Unsubscribe, type Origin, type WriteOptions, type AnyRef, type RefValue, type CollectEntry,
  type NewItemArgs,
} from "./store.js";

// Behaviors
export {
  Behavior, Contribution, when, defineBehavior, contribute,
  type AnyBehavior, type BehaviorConfig, type BehaviorContext, type Declaration, type Guard, type WritableRef,
  type OriginKind, type Part, type OwnerContext, type OwnerConfig, type BehaviorErrorInfo, type StoreOptions,
  type BehaviorHandle,
} from "./behaviors.js";
export { BehaviorBuilder, defineBehaviors } from "./builder.js";
