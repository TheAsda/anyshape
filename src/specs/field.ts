import type { FieldConfig } from '../types/index.js';
import { ValidatableSpec } from './base.js';

export class FieldSpec<Valid, Raw = Valid | undefined> extends ValidatableSpec<
  Valid,
  Raw
> {
  readonly kind = 'field' as const;

  defaultValue?: Raw;
  keepOnUnmount: boolean;
  alwaysValidate: boolean;

  constructor(config?: FieldConfig<Valid, Raw> & { id?: string; mountRequired?: boolean }) {
    super(config);
    this.defaultValue = config?.defaultValue;
    this.keepOnUnmount = config?.keepOnUnmount ?? false;
    this.alwaysValidate = config?.alwaysValidate ?? false;
  }
}
