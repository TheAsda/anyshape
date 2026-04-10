import { BaseSpec } from './base.js';

export class MetaSpec<Value> extends BaseSpec {
  readonly kind = 'meta' as const;

  constructor(config?: { id?: string }) {
    super(config);
  }
}
