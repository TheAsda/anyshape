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

export interface MetaKeyOptions<V, P = NoPayload> {
  /**
   * "feature": only the feature that declares the key (its default behavior or
   * runtime) may write it among behaviors. Application code may still write it.
   */
  owner?: "feature";
  /**
   * Default behavior, registered once per node (per row for row templates)
   * and per name the node declares the key under, limited to that node:
   * `self` (its value), its meta keys and initialOf(self). `key` is the
   * node's ref under that name. The node is typed loosely because the key is
   * declared before the node exists.
   */
  behavior?(self: any, key: MetaRef<V, P>): BehaviorConfig;
  /**
   * Key contributions: the key is written by one owner behavior per node
   * instance, configured by `combine` and fed by contribute(ref, payload)
   * declarations, which its run reads as ctx.parts. Called once per node and
   * key, like `behavior`; `key` is the node's ref under the name it declares
   * the key with. Mutually exclusive with `behavior`.
   *
   * `behavior` and `combine` use method syntax on purpose: their parameters
   * are then bivariant, so a definition stays assignable to MetaKeyDef<V>.
   */
  combine?(self: ShapeNode<unknown>, key: MetaRef<V, P>): OwnerConfig<P>;
  /** Counted per subtree: nodes for which this returns true (countIn). */
  aggregate?: (value: V) => boolean;
  /** Feature-specific settings (e.g. validation options), read by the feature's runtime. */
  data?: Readonly<Record<string, unknown>>;
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

/**
 * `P` defaults to `unknown` here, so MetaKeyDef<V> accepts any definition
 * (combined or not); metaKey() defaults it to NoPayload, so a key declared
 * without `combine` takes no contributions.
 */
export class MetaKeyDef<V = unknown, P = unknown> {
  /** Phantom type – never exists at runtime. */
  declare readonly _value: V;
  /** Phantom type: the payload contributions to this key carry (NoPayload: none). */
  declare readonly _payload: P;
  readonly defaultValue: V;
  readonly options: Readonly<MetaKeyOptions<V, P>>;
  /** @internal true when created from a plain value in .meta({...}) */
  declare readonly [PLAIN]: boolean;

  constructor(defaultValue: V, options: MetaKeyOptions<V, P> = {}, plain = false) {
    if (options.combine && options.behavior) throw new Error("`combine` and `behavior` are mutually exclusive");
    if (options.inherit !== undefined && typeof defaultValue !== "boolean") {
      throw new Error("`inherit` is only supported for boolean meta keys");
    }
    if (options.aggregate && options.aggregate(defaultValue)) {
      // Subtree counts start at zero, so untouched nodes never need to be visited.
      throw new Error("`aggregate` must return false for the key's default value");
    }
    this.defaultValue = defaultValue;
    this.options = Object.freeze({ ...options });
    (this as any)[PLAIN] = plain;
  }
}

/** Declare a meta key with capabilities. */
export function metaKey<V, P = NoPayload>(defaultValue: V, options?: MetaKeyOptions<V, P>): MetaKeyDef<V, P> {
  return new MetaKeyDef(defaultValue, options);
}

// ============================================================
// MetaBuilder – fluent helper for plain values (unchanged API)
// ============================================================
export class MetaBuilder<T extends Meta = {}> {
  /** Phantom type for inference. */
  declare readonly _metaType: T;

  private constructor(private readonly data: T) {}

  static create(): MetaBuilder {
    return new MetaBuilder({});
  }

  required(value = true): MetaBuilder<T & { required: boolean }> {
    return new MetaBuilder({ ...this.data, required: value });
  }

  disabled(value = true): MetaBuilder<T & { disabled: boolean }> {
    return new MetaBuilder({ ...this.data, disabled: value });
  }

  visible(value = true): MetaBuilder<T & { visible: boolean }> {
    return new MetaBuilder({ ...this.data, visible: value });
  }

  label(value: string): MetaBuilder<T & { label: string }> {
    return new MetaBuilder({ ...this.data, label: value });
  }

  placeholder(value: string): MetaBuilder<T & { placeholder: string }> {
    return new MetaBuilder({ ...this.data, placeholder: value });
  }

  custom<K extends string, V>(key: K, value: V): MetaBuilder<T & { [P in K]: V }> {
    return new MetaBuilder({ ...this.data, [key]: value } as any);
  }

  build(): T {
    return this.data;
  }
}

export function meta(): MetaBuilder {
  return MetaBuilder.create();
}

// ============================================================
// Type mapping: declarations → meta references
// ============================================================
export type MetaInput = Meta | MetaBuilder<any>;

type RefsOfEntries<T> = {
  readonly [K in keyof T]: T[K] extends MetaKeyDef<infer V, infer P> ? MetaRef<V, P> : MetaRef<T[K], NoPayload>;
};
type RefsOf<I> = I extends MetaBuilder<infer T> ? RefsOfEntries<T> : RefsOfEntries<I>;

/** Meta references declared by all inputs of one .meta(a, b, c) call, typed with their payloads. */
export type MergeMetaRefs<Is extends readonly unknown[]> =
  Is extends readonly [infer H, ...infer R] ? RefsOf<H> & MergeMetaRefs<R> : {};
