import type { SpecKind } from '../types/index.js';
import type { ZodType } from 'zod/v4';

export interface BaseSpecOptions {
  id?: string;
  mountRequired?: boolean;
}

export abstract class BaseSpec<Value = unknown> {
  abstract readonly _kind: SpecKind;
  readonly id: string;
  readonly mountRequired: boolean;

  private static _counter = 0;

  constructor(config?: BaseSpecOptions) {
    this.id = config?.id ?? `spec_${BaseSpec._counter++}`;
    this.mountRequired = config?.mountRequired ?? true;
  }
}

export interface ValidatableSpecOptions<Valid, Raw> extends BaseSpecOptions {
  schema?: ZodType<Valid, Raw>;
}

export abstract class ValidatableSpec<Valid, Raw> extends BaseSpec<Valid> {
  _schema?: ZodType<Valid>;

  constructor(config?: ValidatableSpecOptions<Valid, Raw>) {
    super(config);
    this._schema = config?.schema;
  }
}
