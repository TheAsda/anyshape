import { ValidatableSpec } from './base.js';
import type { BaseSpec } from './base.js';
type ArrayValid<I extends BaseSpec> = I extends ValidatableSpec<infer V, infer _R> ? V[] : unknown[];
type ArrayRaw<I extends BaseSpec> = I extends ValidatableSpec<infer _V, infer R> ? R[] : unknown[];
type ForwardedChildren<I extends BaseSpec> = I extends { children: infer C extends Record<string, BaseSpec> } ? C : {};

class ArraySpecClass<I extends BaseSpec> extends ValidatableSpec<
  ArrayValid<I>,
  ArrayRaw<I>
> {
  readonly kind = 'array' as const;

  private readonly _itemSpecValue: I;

  get itemSpec(): I {
    return this._itemSpecValue;
  }

  constructor(
    itemSpec: I,
    config?: { id?: string; mountRequired?: boolean; schema?: unknown },
  ) {
    super(config);
    this._itemSpecValue = itemSpec;

    if ('children' in itemSpec) {
      const objSpec = itemSpec as unknown as { children: Record<string, BaseSpec> };
      for (const key of Object.keys(objSpec.children)) {
        Object.defineProperty(this, key, {
          get: () => objSpec.children[key],
          enumerable: false,
          configurable: true,
        });
      }
    }
  }
}

type ArraySpecInstance<I extends BaseSpec> = ArraySpecClass<I> & ForwardedChildren<I>;

export interface ArraySpec {
  new <I extends BaseSpec>(
    itemSpec: I,
    config?: { id?: string; mountRequired?: boolean; schema?: unknown },
  ): ArraySpecInstance<I>;
}

export const ArraySpec: ArraySpec = ArraySpecClass as unknown as ArraySpec;
