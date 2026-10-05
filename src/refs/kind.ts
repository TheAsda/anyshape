// ============================================================
// Reference kinds (internal)
// ------------------------------------------------------------
// Every reference (a node, node.key, countIn, initialOf, ...) answers to one
// RefKind, reached through `ref[KIND]`. The store, the behavior runtime and the
// hooks only call this interface, so a new kind is one module in src/refs/.
//
// This module has no runtime imports: classes in shape.ts use KIND as a
// computed member name while the other modules are still being evaluated.
// ============================================================

import type { AnyNode } from "../shape";
import type { MetaKeyDef } from "../meta";
import type { BaseStore, Phase, SubFn, Unsubscribe, WriteOptions } from "../store";

export const KIND: unique symbol = Symbol("form-lib.refKind");

/** What a write to a writable reference changes: a node's value, or one meta key of a node. */
export interface Target {
  readonly node: AnyNode;
  /** Set for meta keys: the name the node declares the key under, and its definition. */
  readonly key?: string;
  readonly def?: MetaKeyDef<any>;
}

export interface RefKind<R = any> {
  /** The node the reference belongs to; its scope decides which store reads it. */
  node(ref: R): AnyNode;
  /** Equal for references to the same data. */
  id(ref: R): string;
  /** For messages. */
  label(ref: R): string;
  /** The value on `store`, whose scope contains the reference's node. */
  read(store: BaseStore<any>, ref: R): unknown;
  /** Calls `fn` on `store` when the value changes (phase: behavior or UI). */
  subscribe(store: BaseStore<any>, ref: R, phase: Phase, fn: SubFn): Unsubscribe;
  /**
   * Can writing `target` change the value? Orders behaviors. Only when the
   * target's node and the reference's node are on one line of the tree (the
   * same node, or one an ancestor of the other): the runtime looks for edges there.
   */
  affectedBy(ref: R, target: Target): boolean;
  /** Depends on its node only, not on a subtree. Default behaviors may use only local references. */
  readonly local: boolean;
  /** Writable kinds only. */
  readonly writer?: {
    target(ref: R): Target;
    write(store: BaseStore<any>, ref: R, value: unknown, options?: WriteOptions): void;
  };
  /** Read-only kinds: the error `set` throws. */
  readonly readOnly?: string;
}

export function kindOf<R>(ref: R): RefKind<R> {
  return (ref as any)[KIND];
}
