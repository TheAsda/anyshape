// ============================================================
// Meta declarations
// ------------------------------------------------------------
// An entry in .meta() is either
//   • a plain value – a key with a default, free for one user behavior, or
//   • a key definition (metaKey) – a default plus optional capabilities.
// Features are plain objects of key definitions (see recipes/features.ts).
// ============================================================

import type { BehaviorConfig, Contribution, OwnerConfig } from "./behaviors.js";
import type { MetaRef } from "./refs/meta.js";
import type { ShapeNode } from "./shape.js";

export type Meta = Record<string, unknown>;

declare const NoPayloadBrand: unique symbol;
/**
 * The payload type of keys without `combine`: nothing can be contributed to
 * them. A brand, not `never`, because `never` satisfies every constraint.
 */
export type NoPayload = { readonly [NoPayloadBrand]: true };

export interface MetaKeyOptions {
  /** Kept by reset(): for keys fed from outside the form (e.g. useSync), not user input. */
  keepOnReset?: boolean;
}

type AnyMetaKeyDef = MetaKeyDef<any, any, any>;

declare const CountableBrand: unique symbol;
declare const OwnedBrand: unique symbol;
/** Marks a definition .aggregate() made countable: countIn takes only such a key. */
export interface Countable {
  readonly [CountableBrand]: true;
}
/** Marks a definition whose writer .behavior() or .combine() declared. */
export interface Owned {
  readonly [OwnedBrand]: true;
}
/** The markers `S` carries, for a step that changes the rest of its type. */
type Markers<S> = (S extends Countable ? Countable : unknown) & (S extends Owned ? Owned : unknown);
/** Fails a step's `this` check with `Message` when the receiver already carries marker `M`. */
type Not<S, M, Message extends string> = S extends M ? { readonly error: Message } : unknown;

/** The node's refs to the keys a definition uses, in the order of .uses(). */
export type UsedRefs<U extends readonly AnyMetaKeyDef[]> = {
  readonly [K in keyof U]: U[K] extends MetaKeyDef<infer V, infer P, any> ? MetaRef<V, P> : never;
};

/**
 * @internal What a definition's steps (.aggregate(), .uses(), .behavior(),
 * .combine()) declared, read by the core. Method syntax on purpose: the
 * parameters are then bivariant, so a definition stays assignable to
 * MetaKeyDef<V>.
 */
export interface MetaKeySteps<V, P, U extends readonly AnyMetaKeyDef[]> {
  aggregate?(value: V): boolean;
  uses?: U;
  // PROTOTYPE(#128): a default behavior may be one contribution to a used key.
  behavior?(self: any, key: MetaRef<V, P>, uses: UsedRefs<U>): BehaviorConfig | Contribution<any>;
  combine?(self: ShapeNode<unknown>, key: MetaRef<V, P>, uses: UsedRefs<U>): OwnerConfig<P>;
}

/**
 * `P` defaults to `unknown` here, so MetaKeyDef<V> accepts any definition
 * (combined or not); metaKey() defaults it to NoPayload, so a key declared
 * without `combine` takes no contributions.
 *
 * A definition is immutable: each step returns a new one. Steps add markers
 * to its type, which the later steps keep: Countable from .aggregate(), so
 * countIn takes the key, and Owned from .behavior() or .combine(). The steps
 * check the markers they're called on, so a step out of order is a type
 * error with the message it throws at run time.
 */
export class MetaKeyDef<V = unknown, P = unknown, U extends readonly AnyMetaKeyDef[] = readonly AnyMetaKeyDef[]> {
  /** Phantom type – never exists at runtime. */
  declare readonly _value: V;
  /** Phantom type: the payload contributions to this key carry (NoPayload: none). */
  declare readonly _payload: P;
  readonly defaultValue: V;
  readonly options: Readonly<MetaKeyOptions>;
  /** @internal */
  readonly _steps: Readonly<MetaKeySteps<V, P, U>>;
  /** @internal – use metaKey() */
  constructor(defaultValue: V, options: MetaKeyOptions = {}, steps: MetaKeySteps<V, P, U> = {}) {
    if (steps.combine && steps.behavior) throw new Error("`combine` and `behavior` are mutually exclusive");
    if (steps.aggregate && steps.aggregate(defaultValue)) {
      // Subtree counts start at zero, so untouched nodes never need to be visited.
      throw new Error("`aggregate` must return false for the key's default value");
    }
    this.defaultValue = defaultValue;
    this.options = Object.freeze({ ...options });
    this._steps = Object.freeze({ ...steps });
  }

  /**
   * Counted per subtree: countIn(node, def) counts the nodes in the subtree
   * where `isCounted` returns true for the key's value. It must return false
   * for the default value.
   */
  aggregate<S extends MetaKeyDef<V, P, U>>(
    this: S & Not<S, Countable, ".aggregate() is declared once">,
    isCounted: (value: V) => boolean,
  ): S & Countable {
    if (this._steps.aggregate) throw new Error(".aggregate() is declared once");
    return new MetaKeyDef<V, P, U>(this.defaultValue, this.options, {
      ...this._steps,
      aggregate: isCounted,
    }) as S & Countable;
  }

  /**
   * Keys of the same node that `behavior` or `combine` gets refs to, matched
   * by definition: `uses` receives the node's ref to each, in this order,
   * whatever name the node declares it under. It grants no access: declare
   * the refs in triggers, reads or writes.
   */
  uses<const U2 extends readonly AnyMetaKeyDef[], S extends MetaKeyDef<V, P, U> = this>(
    this: S & Not<S, Owned, "call .uses() before .combine() or .behavior()">,
    ...defs: U2
  ): MetaKeyDef<V, P, U2> & Markers<S> {
    const { behavior, combine, ...before } = this._steps;
    if (combine || behavior) throw new Error("call .uses() before .combine() or .behavior()");
    if (before.uses) throw new Error(".uses() is declared once – list every used key in one call");
    const def = new MetaKeyDef<V, P, U2>(this.defaultValue, this.options, { ...before, uses: defs });
    return def as typeof def & Markers<S>;
  }

  /**
   * Default behavior, registered once per node (per row for row templates)
   * and per name the node declares the key under, limited to that node:
   * `self` (its value), its meta keys and initialOf(self). `key` is the
   * node's ref under that name. The node is typed loosely because the key is
   * declared before the node exists.
   */
  behavior<S extends MetaKeyDef<V, P, U>>(
    this: S & Not<S, Owned, "`combine` and `behavior` are mutually exclusive">,
    factory: (self: any, key: MetaRef<V, P>, uses: UsedRefs<U>) => BehaviorConfig | Contribution<any>,
  ): S & Owned {
    return new MetaKeyDef<V, P, U>(this.defaultValue, this.options, { ...this._steps, behavior: factory }) as S & Owned;
  }

  /**
   * Key contributions: the key is written by one owner behavior per node
   * instance, configured by `combine` and fed by contribute(ref, payload)
   * declarations, which its run reads as ctx.parts. Called once per node and
   * key, like `behavior`; `key` is the node's ref under the name it declares
   * the key with. Mutually exclusive with `behavior`.
   */
  combine<S extends MetaKeyDef<V, P, U>>(
    this: S & Not<S, Owned, "`combine` and `behavior` are mutually exclusive">,
    factory: (self: ShapeNode<unknown>, key: MetaRef<V, P>, uses: UsedRefs<U>) => OwnerConfig<P>,
  ): S & Owned {
    return new MetaKeyDef<V, P, U>(this.defaultValue, this.options, { ...this._steps, combine: factory }) as S & Owned;
  }
}

/** Declare a meta key with capabilities. Count it with .aggregate(); add a default behavior or an owner with .behavior() / .combine(). */
export function metaKey<V, P = NoPayload>(defaultValue: V, options?: MetaKeyOptions): MetaKeyDef<V, P, []> {
  return new MetaKeyDef<V, P, []>(defaultValue, options);
}

// ============================================================
// Type mapping: declarations → meta references
// ============================================================
type RefsOf<T> = {
  readonly [K in keyof T]: T[K] extends MetaKeyDef<infer V, infer P, any> ? MetaRef<V, P> : MetaRef<T[K], NoPayload>;
};

/** Meta references declared by all inputs of one .meta(a, b, c) call, typed with their payloads. */
export type MergeMetaRefs<Is extends readonly unknown[]> = Is extends readonly [infer H, ...infer R]
  ? RefsOf<H> & MergeMetaRefs<R>
  : {};
