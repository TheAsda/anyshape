import type { BaseSpec, ValidatableSpecOptions } from './base.js';
import { ValidatableSpec } from './base.js';

export type ObjectSpecChildren = Record<string, BaseSpec>;

type ObjectValid<C extends ObjectSpecChildren> = {
  [K in keyof C]: C[K] extends BaseSpec<infer V> ? V : unknown;
};

type ObjectRaw<C extends ObjectSpecChildren> = {
  [K in keyof C]: C[K] extends ValidatableSpec<infer _V, infer R> ? R : unknown;
};

export interface ObjectSpecOptions<
  C extends ObjectSpecChildren,
> extends ValidatableSpecOptions<ObjectValid<C>, ObjectRaw<C>> {}

export class ObjectSpec<
  C extends ObjectSpecChildren = ObjectSpecChildren,
> extends ValidatableSpec<ObjectValid<C>, ObjectRaw<C>> {
  readonly _kind = 'object' as const;
  readonly children: C;

  constructor(children: C, config?: ObjectSpecOptions<C>) {
    super(config);
    this.children = children;
  }
}
