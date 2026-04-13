import { BaseSpec, BaseSpecOptions } from './base.js';

export interface MetaSpecOptions extends BaseSpecOptions {}

export class MetaSpec<Value> extends BaseSpec<Value> {
  readonly _kind = 'meta' as const;

  constructor(config?: MetaSpecOptions) {
    super(config);
  }
}
