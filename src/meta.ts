// ============================================================
// Meta declarations
// ------------------------------------------------------------
// An entry in .meta() is either
//   • a plain value – a key with a default, free for one user behavior, or
//   • a key definition (metaKey) – a default plus optional capabilities.
// Features are plain objects of key definitions (see recipes/features.ts).
// ============================================================

import type { BehaviorConfig } from "./behaviors";
import { PLAIN } from "./internal";

export type Meta = Record<string, unknown>;

export interface MetaKeyOptions<V> {
  /**
   * "feature": only the feature that declares the key (its default behavior or
   * runtime) may write it among behaviors. Application code may still write it.
   */
  owner?: "feature";
  /**
   * Default behavior, registered once per node (per row for row templates)
   * and limited to that node: `self` (its value), its meta keys and
   * initialOf(self). The node is typed loosely because the key is declared
   * before the node exists.
   */
  behavior?: (self: any) => BehaviorConfig;
  /** Counted per subtree: nodes for which this returns true (countIn / collect). */
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

export class MetaKeyDef<V = unknown> {
  /** Phantom type – never exists at runtime. */
  declare readonly _value: V;
  readonly defaultValue: V;
  readonly options: Readonly<MetaKeyOptions<V>>;
  /** @internal true when created from a plain value in .meta({...}) */
  declare readonly [PLAIN]: boolean;

  constructor(defaultValue: V, options: MetaKeyOptions<V> = {}, plain = false) {
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
export function metaKey<V>(defaultValue: V, options?: MetaKeyOptions<V>): MetaKeyDef<V> {
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
// Type mapping: declarations → value types
// ============================================================
export type MetaInput = Meta | MetaBuilder<any>;

type ValuesOfEntries<T> = { [K in keyof T]: T[K] extends MetaKeyDef<infer V> ? V : T[K] };

/** Value types declared by one .meta() input. */
export type MetaValuesOf<I> = I extends MetaBuilder<infer T> ? ValuesOfEntries<T> : ValuesOfEntries<I>;

/** Value types declared by all inputs of one .meta(a, b, c) call. */
export type MergeMetaInputs<Is extends readonly unknown[]> =
  Is extends readonly [infer H, ...infer R] ? MetaValuesOf<H> & MergeMetaInputs<R> : {};
