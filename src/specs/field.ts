import { ValidatableSpec, ValidatableSpecOptions } from './base.js';

export interface FieldSpecOptions<
  Valid,
  Raw = Valid | undefined,
> extends ValidatableSpecOptions<Valid, Raw> {
  keepOnUnmount?: boolean;
  alwaysValidate?: boolean;
  defaultValue?: Raw;
}

export class FieldSpec<Valid, Raw = Valid | undefined> extends ValidatableSpec<
  Valid,
  Raw
> {
  readonly _kind = 'field' as const;

  readonly defaultValue?: Raw;
  readonly keepOnUnmount: boolean;
  readonly alwaysValidate: boolean;

  constructor(config?: FieldSpecOptions<Valid, Raw>) {
    super(config);
    this.defaultValue = config?.defaultValue;
    this.keepOnUnmount = config?.keepOnUnmount ?? false;
    this.alwaysValidate = config?.alwaysValidate ?? false;
  }
}
