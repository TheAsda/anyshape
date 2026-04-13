import type { SpecKind } from '../types/index.js';
import type { ZodType } from 'zod/v4';

export abstract class BaseSpec {
  readonly id: string;
  mountRequired: boolean;
  abstract readonly kind: SpecKind;

  _parent?: BaseSpec;

  private static _counter = 0;

  constructor(config?: { id?: string; mountRequired?: boolean }) {
    this.id = config?.id ?? `spec_${BaseSpec._counter++}`;
    this.mountRequired = config?.mountRequired ?? true;
  }
}

export abstract class ValidatableSpec<Valid, Raw = Valid> extends BaseSpec {
  _schema?: ZodType<Valid, Raw>;

  constructor(config?: {
    id?: string;
    mountRequired?: boolean;
    schema?: ZodType<Valid, Raw>;
  }) {
    super(config);
    this._schema = config?.schema;
  }
}
