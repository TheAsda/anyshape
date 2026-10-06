// ============================================================
// The core entry, `anyshape`. Every public name is listed here, and
// test/exports.test.ts snapshots the list: a change to the surface is a
// reviewed diff. Internal names stay out.
// No comment in this file may contain the internal tag: stripInternal
// drops the declaration that follows it, a whole export list included.
// ============================================================

// Shapes
export {
  ShapeNode,
  FieldNode,
  ObjectNode,
  ArrayNode,
  field,
  object,
  array,
  form,
  type FieldId,
  type AnyNode,
  type ContainerNode,
  type InferValue,
  type InferMeta,
  type Ref,
  type ArrayOptions,
} from "./shape.js";

// Meta keys
export {
  MetaKeyDef,
  metaKey,
  type Meta,
  type NoPayload,
  type MetaKeyOptions,
  type UsedRefs,
  type MergeMetaRefs,
  type Countable,
  type Owned,
} from "./meta.js";

// References
export { MetaRef } from "./refs/meta.js";
export { CountRef, countIn } from "./refs/count.js";
export { InitialRef, initialOf } from "./refs/initial.js";
export { PendingInRef, PendingOfRef, pendingIn, pendingOf } from "./refs/pending.js";

// Stores
export { createStore } from "./create.js";
// The stores as types only: createStore builds the root, and the root hands
// out the substores and rows.
export type {
  RootStore,
  BaseStore,
  ArrayStore,
  ItemStore,
  Listener,
  Unsubscribe,
  Origin,
  WriteOptions,
  AnyRef,
  RefValue,
  CollectEntry,
  NewItemArgs,
} from "./store.js";

// Behaviors
// Behavior and Contribution as types only: defineBehavior and contribute build them.
export type { Behavior, Contribution } from "./behaviors.js";
export {
  when,
  defineBehavior,
  contribute,
  type AnyBehavior,
  type BehaviorConfig,
  type BehaviorContext,
  type Declaration,
  type Guard,
  type WritableRef,
  type OriginKind,
  type Part,
  type OwnerContext,
  type OwnerConfig,
  type BehaviorErrorInfo,
  type StoreOptions,
  type BehaviorHandle,
} from "./behaviors.js";
export { BehaviorBuilder, defineBehaviors } from "./builder.js";
