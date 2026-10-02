// ============================================================
// Meta declarations
// ------------------------------------------------------------
// An entry in .meta() is either
//   • a plain value – a key with a default, free for one user behavior, or
//   • a key definition (metaKey) – a default plus optional capabilities.
// Features are plain objects of key definitions (see recipes/features.ts).
// ============================================================

import type { BehaviorConfig, OwnerConfig } from "./behaviors";
import type { MetaRef, ShapeNode } from "./shape";
import { PLAIN } from "./internal";

export type Meta = Record<string, unknown>;

declare const NoPayloadBrand: unique symbol;
/**
 * The payload type of keys without `combine`: nothing can be contributed to
 * them. A brand, not `never`, because `never` satisfies every constraint.
 */
export type NoPayload = { readonly [NoPayloadBrand]: true };

export interface MetaKeyOptions<V> {
  /**
   * "feature": only the feature that declares the key (its default behavior or
   * runtime) may write it among behaviors. Application code may still write it.
   */
  owner?: "feature";
  /** Counted per subtree: nodes for which this returns true (countIn). */
  aggregate?: (value: V) => boolean;
  /** Kept by reset(): for keys fed from outside the form (e.g. useSync), not user input. */
  keepOnReset?: boolean;
  /** false: stored and readable, but writing it never notifies, triggers or counts. */
  reactive?: boolean;
  /**
   * Inherited down the tree (boolean keys only):
   *   "all" – true only if this node and every ancestor declaring the key are true (visible)
   *   "any" – true if this node or any ancestor declaring the key is true (disabled)
   */
  inherit?: [V] extends [boolean] ? "all" | "any" : never;
}

type AnyMetaKeyDef = MetaKeyDef<any, any, any>;

/** The node's refs to the keys a definition uses, in the order of .uses(). */
export type UsedRefs<U extends readonly AnyMetaKeyDef[]> = {
  readonly [K in keyof U]: U[K] extends MetaKeyDef<infer V, infer P, any> ? MetaRef<V, P> : never;
};

/**
 * @internal What a definition's steps (.uses(), .behavior(), .combine())
 * declared, read by the core. Method syntax on purpose: the parameters are
 * then bivariant, so a definition stays assignable to MetaKeyDef<V>.
 */
export interface MetaKeySteps<V, P, U extends readonly AnyMetaKeyDef[]> {
  uses?: U;
  behavior?(self: any, key: MetaRef<V, P>, uses: UsedRefs<U>): BehaviorConfig;
  combine?(self: ShapeNode<unknown>, key: MetaRef<V, P>, uses: UsedRefs<U>): OwnerConfig<P>;
}

/**
 * `P` defaults to `unknown` here, so MetaKeyDef<V> accepts any definition
 * (combined or not); metaKey() defaults it to NoPayload, so a key declared
 * without `combine` takes no contributions.
 *
 * A definition is immutable: each step returns a new one.
 */
export class MetaKeyDef<V = unknown, P = unknown, U extends readonly AnyMetaKeyDef[] = readonly AnyMetaKeyDef[]> {
  /** Phantom type – never exists at runtime. */
  declare readonly _value: V;
  /** Phantom type: the payload contributions to this key carry (NoPayload: none). */
  declare readonly _payload: P;
  readonly defaultValue: V;
  readonly options: Readonly<MetaKeyOptions<V>>;
  /** @internal */
  readonly _steps: Readonly<MetaKeySteps<V, P, U>>;
  /** @internal true when created from a plain value in .meta({...}) */
  declare readonly [PLAIN]: boolean;

  constructor(defaultValue: V, options: MetaKeyOptions<V> = {}, plain = false, steps: MetaKeySteps<V, P, U> = {}) {
    if (steps.combine && steps.behavior) throw new Error("`combine` and `behavior` are mutually exclusive");
    if (options.inherit !== undefined && typeof defaultValue !== "boolean") {
      throw new Error("`inherit` is only supported for boolean meta keys");
    }
    if (options.aggregate && options.aggregate(defaultValue)) {
      // Subtree counts start at zero, so untouched nodes never need to be visited.
      throw new Error("`aggregate` must return false for the key's default value");
    }
    this.defaultValue = defaultValue;
    this.options = Object.freeze({ ...options });
    this._steps = Object.freeze({ ...steps });
    (this as any)[PLAIN] = plain;
  }

  /**
   * Keys of the same node that `behavior` or `combine` gets refs to, matched
   * by definition: `uses` receives the node's ref to each, in this order,
   * whatever name the node declares it under. It grants no access: declare
   * the refs in triggers, reads or writes.
   */
  uses<const U2 extends readonly AnyMetaKeyDef[]>(...defs: U2): MetaKeyDef<V, P, U2> {
    if (this._steps.combine || this._steps.behavior) throw new Error("call .uses() before .combine() or .behavior()");
    if (this._steps.uses) throw new Error(".uses() is declared once – list every used key in one call");
    return new MetaKeyDef<V, P, U2>(this.defaultValue, this.options, false, { uses: defs });
  }

  /**
   * Default behavior, registered once per node (per row for row templates)
   * and per name the node declares the key under, limited to that node:
   * `self` (its value), its meta keys and initialOf(self). `key` is the
   * node's ref under that name. The node is typed loosely because the key is
   * declared before the node exists.
   */
  behavior(factory: (self: any, key: MetaRef<V, P>, uses: UsedRefs<U>) => BehaviorConfig): MetaKeyDef<V, P, U> {
    return new MetaKeyDef(this.defaultValue, this.options, false, { ...this._steps, behavior: factory });
  }

  /**
   * Key contributions: the key is written by one owner behavior per node
   * instance, configured by `combine` and fed by contribute(ref, payload)
   * declarations, which its run reads as ctx.parts. Called once per node and
   * key, like `behavior`; `key` is the node's ref under the name it declares
   * the key with. Mutually exclusive with `behavior`.
   */
  combine(factory: (self: ShapeNode<unknown>, key: MetaRef<V, P>, uses: UsedRefs<U>) => OwnerConfig<P>): MetaKeyDef<V, P, U> {
    return new MetaKeyDef(this.defaultValue, this.options, false, { ...this._steps, combine: factory });
  }
}

/** Declare a meta key with capabilities. Add a default behavior or an owner with .behavior() / .combine(). */
export function metaKey<V, P = NoPayload>(defaultValue: V, options?: MetaKeyOptions<V>): MetaKeyDef<V, P, []> {
  return new MetaKeyDef(defaultValue, options);
}

// ============================================================
// Type mapping: declarations → meta references
// ============================================================
type RefsOf<T> = {
  readonly [K in keyof T]: T[K] extends MetaKeyDef<infer V, infer P, any> ? MetaRef<V, P> : MetaRef<T[K], NoPayload>;
};

/** Meta references declared by all inputs of one .meta(a, b, c) call, typed with their payloads. */
export type MergeMetaRefs<Is extends readonly unknown[]> =
  Is extends readonly [infer H, ...infer R] ? RefsOf<H> & MergeMetaRefs<R> : {};
