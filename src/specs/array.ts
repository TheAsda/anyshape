import type { BaseSpec, ValidatableSpecOptions } from './base.js';
import { ValidatableSpec } from './base.js';

type ArrayValid<I extends BaseSpec> =
  I extends BaseSpec<infer V> ? V[] : unknown[];

type ArrayRaw<I extends BaseSpec> =
  I extends ValidatableSpec<infer _V, infer R> ? R[] : unknown[];

export interface ArraySpecOptions<
  I extends BaseSpec,
> extends ValidatableSpecOptions<ArrayValid<I>, ArrayRaw<I>> {}

export class ArraySpec<I extends BaseSpec> extends ValidatableSpec<
  ArrayValid<I>,
  ArrayRaw<I>
> {
  readonly _kind = 'array' as const;

  readonly item: I;

  constructor(itemSpec: I, config?: ArraySpecOptions<I>) {
    super(config);
    this.item = itemSpec;
  }
}
