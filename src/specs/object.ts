import { ValidatableSpec } from './base.js';
import type { BaseSpec } from './base.js';

type ObjectValid<C extends Record<string, BaseSpec>> = {
  [K in keyof C]: C[K] extends ValidatableSpec<infer V, infer _R> ? V : unknown;
};

type ObjectRaw<C extends Record<string, BaseSpec>> = {
  [K in keyof C]: C[K] extends ValidatableSpec<infer _V, infer R> ? R : unknown;
};

class ObjectSpecClass<C extends Record<string, BaseSpec>> extends ValidatableSpec<
  ObjectValid<C>,
  ObjectRaw<C>
> {
  readonly kind = 'object' as const;
  readonly children: C;

  constructor(
    children: C,
    config?: { id?: string; mountRequired?: boolean; schema?: unknown },
  ) {
    super(config);
    this.children = children;

    for (const key of Object.keys(children)) {
      const child = children[key];
      child._parent = this;

      Object.defineProperty(this, key, {
        get: () => this.children[key],
        enumerable: false,
        configurable: true,
      });
    }
  }
}

type ObjectSpecInstance<C extends Record<string, BaseSpec>> = ObjectSpecClass<C> & C;

export interface ObjectSpec {
  new <C extends Record<string, BaseSpec>>(
    children: C,
    config?: { id?: string; mountRequired?: boolean; schema?: unknown },
  ): ObjectSpecInstance<C>;
}

export const ObjectSpec: ObjectSpec = ObjectSpecClass as ObjectSpec;
