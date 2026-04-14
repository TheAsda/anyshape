import type { ValidatableSpecOptions } from './base.js';
import { ValidatableSpec } from './base.js';
import { ObjectSpec } from './object.js';

type ArrayValid<I extends ObjectSpec> =
  I extends ObjectSpec<infer V> ? V[] : unknown[];

type ArrayRaw<I extends ObjectSpec> =
  I extends ValidatableSpec<infer _V, infer R> ? R[] : unknown[];

export interface ArraySpecOptions<
  I extends ObjectSpec,
> extends ValidatableSpecOptions<ArrayValid<I>, ArrayRaw<I>> {
  defaultValue?: ArrayRaw<I>;
}

export class ArraySpec<
  I extends ObjectSpec = ObjectSpec,
> extends ValidatableSpec<ArrayValid<I>, ArrayRaw<I>> {
  readonly _kind = 'array' as const;

  readonly item: I;
  readonly defaultValue?: ArrayRaw<I>;

  constructor(itemSpec: I, config?: ArraySpecOptions<I>) {
    super(config);
    this.item = itemSpec;
    this.defaultValue = config?.defaultValue;
  }
}
