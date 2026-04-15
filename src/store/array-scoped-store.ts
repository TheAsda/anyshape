import { BaseSpec } from '../specs/base.js';
import { ArraySpec } from '../specs/array.js';
import { FieldSpec } from '../specs/field.js';
import { ObjectSpec, type ObjectSpecChildren } from '../specs/object.js';
import { FormStore, type ArrayState } from './form-store.js';
import { ScopedStore, _registerArrayScopedStore } from './scoped-store.js';

export class ArrayScopedStore {
  private formStore: FormStore;
  private arraySpec: ArraySpec;
  private parentScope: ScopedStore;

  constructor(
    formStore: FormStore,
    arraySpec: ArraySpec,
    parentScope: ScopedStore,
  ) {
    this.formStore = formStore;
    this.arraySpec = arraySpec;
    this.parentScope = parentScope;
  }

  getItems(): Array<{ id: string; index: number }> {
    return this.formStore.getArrayState(this.arraySpec)?.items ?? [];
  }

  append(data?: Record<string, unknown>): string {
    const currentData = this.formStore.getArrayData(this.arraySpec);
    const state = this.getOrCreateArrayState();
    const newIndex = currentData.length;
    const id = this.formStore.generateId();

    const itemData = this.buildItemData(data);

    currentData.push(itemData);
    state.items.push({ id, index: newIndex });

    this.formStore.setArrayData(this.arraySpec, currentData);
    this.formStore.setArrayState(this.arraySpec, state);

    return id;
  }

  remove(id: string): void {
    const state = this.formStore.getArrayState(this.arraySpec);
    if (!state) return;

    const itemIndex = state.items.findIndex((i) => i.id === id);
    if (itemIndex === -1) return;

    const currentData = this.formStore.getArrayData(this.arraySpec);
    currentData.splice(itemIndex, 1);
    state.items.splice(itemIndex, 1);

    for (let i = 0; i < state.items.length; i++) {
      state.items[i].index = i;
    }

    this.formStore.setArrayData(this.arraySpec, currentData);
    this.formStore.setArrayState(this.arraySpec, state);

    this.cleanupItemErrors(id);
  }

  reorder(fromIndex: number, toIndex: number): void {
    const state = this.formStore.getArrayState(this.arraySpec);
    if (!state) return;

    const currentData = this.formStore.getArrayData(this.arraySpec);

    const [movedData] = currentData.splice(fromIndex, 1);
    currentData.splice(toIndex, 0, movedData);

    const [movedItem] = state.items.splice(fromIndex, 1);
    state.items.splice(toIndex, 0, movedItem);

    for (let i = 0; i < state.items.length; i++) {
      state.items[i].index = i;
    }

    this.formStore.setArrayData(this.arraySpec, currentData);
    this.formStore.setArrayState(this.arraySpec, state);
  }

  upsert(id: string, data: Record<string, unknown>): string {
    const state = this.formStore.getArrayState(this.arraySpec);
    if (!state) {
      return this.append(data);
    }

    const existingItem = state.items.find((i) => i.id === id);
    if (existingItem) {
      const currentData = this.formStore.getArrayData(this.arraySpec);
      const existingData = currentData[existingItem.index] as
        | Record<string, unknown>
        | undefined;
      if (existingData && typeof existingData === 'object') {
        currentData[existingItem.index] = { ...existingData, ...data };
      } else {
        currentData[existingItem.index] = data;
      }
      this.formStore.setArrayData(this.arraySpec, currentData);
      return id;
    }

    return this.append(data);
  }

  clear(): void {
    const state = this.formStore.getArrayState(this.arraySpec);

    if (state) {
      for (const item of state.items) {
        this.cleanupItemErrors(item.id);
      }
    }

    this.formStore.setArrayData(this.arraySpec, []);
    this.formStore.setArrayState(this.arraySpec, { items: [] });
  }

  getItemScope(itemId: string): ScopedStore {
    const state = this.formStore.getArrayState(this.arraySpec);
    if (!state) {
      throw new Error(`No array state for: ${this.arraySpec.id}`);
    }
    const item = state.items.find((i) => i.id === itemId);
    if (!item) {
      throw new Error(`No item with id: ${itemId}`);
    }

    return new ItemScopedStore(
      this.formStore,
      this.arraySpec.item,
      this.parentScope,
      itemId,
    );
  }

  validateItemField(
    itemId: string,
    fieldSpec: BaseSpec,
  ): { success: boolean; error: string | null } {
    return this.formStore.validateSpec(fieldSpec, itemId);
  }

  validateItem(itemId: string): {
    success: boolean;
    errors: Map<BaseSpec, string | null>;
  } {
    const allErrors = new Map<BaseSpec, string | null>();

    const itemSpec = this.arraySpec.item;
    const specsToValidate: BaseSpec[] = [
      itemSpec,
      ...this.collectDescendants(itemSpec),
    ];

    for (const s of specsToValidate) {
      this.formStore.validateSpec(s, itemId);
      allErrors.set(s, this.formStore.getError(s, itemId));
    }

    const success = Array.from(allErrors.values()).every((e) => e === null);
    return { success, errors: allErrors };
  }

  validateArray(): {
    success: boolean;
    errors: Map<BaseSpec, Map<string, string | null>>;
  } {
    const allErrors = new Map<BaseSpec, Map<string, string | null>>();
    let success = true;

    const state = this.formStore.getArrayState(this.arraySpec);
    if (!state) return { success: true, errors: allErrors };

    const itemSpec = this.arraySpec.item;
    const specsToValidate: BaseSpec[] = [
      itemSpec,
      ...this.collectDescendants(itemSpec),
    ];

    for (const s of specsToValidate) {
      const specErrors = new Map<string, string | null>();
      for (const item of state.items) {
        this.formStore.validateSpec(s, item.id);
        const error = this.formStore.getError(s, item.id);
        specErrors.set(item.id, error);
        if (error !== null) success = false;
      }
      allErrors.set(s, specErrors);
    }

    return { success, errors: allErrors };
  }

  getItemFieldError(itemId: string, fieldSpec: BaseSpec): string | null {
    return this.formStore.getError(fieldSpec, itemId);
  }

  private getOrCreateArrayState(): ArrayState {
    let state = this.formStore.getArrayState(this.arraySpec);
    if (!state) {
      state = { items: [] };
      this.formStore.setArrayState(this.arraySpec, state);
    }
    return state;
  }

  private buildItemData(
    data?: Record<string, unknown>,
  ): Record<string, unknown> {
    const itemData: Record<string, unknown> = {};

    for (const [key, childSpec] of Object.entries(
      this.arraySpec.item.children as ObjectSpecChildren,
    )) {
      if (data && data[key] !== undefined) {
        itemData[key] = data[key];
      } else if (
        childSpec instanceof FieldSpec &&
        childSpec.defaultValue !== undefined
      ) {
        itemData[key] = childSpec.defaultValue;
      } else if (childSpec instanceof FieldSpec && childSpec._schema) {
        const result = childSpec._schema.safeParse(undefined);
        if (result.success) {
          itemData[key] = result.data;
        }
      }
    }

    return itemData;
  }

  private collectDescendants(spec: BaseSpec): BaseSpec[] {
    const result: BaseSpec[] = [];
    if (spec instanceof ObjectSpec) {
      for (const child of Object.values(
        spec.children as ObjectSpecChildren,
      )) {
        result.push(child);
        result.push(...this.collectDescendants(child));
      }
    } else if (spec instanceof ArraySpec) {
      result.push(spec.item);
      result.push(...this.collectDescendants(spec.item));
    }
    return result;
  }

  private cleanupItemErrors(itemId: string): void {
    const itemSpec = this.arraySpec.item;
    const descendants = this.collectDescendants(itemSpec);
    for (const s of [itemSpec, ...descendants]) {
      const errorMap = (
        this.formStore as unknown as {
          errors: WeakMap<BaseSpec, Map<string, string | null>>;
        }
      ).errors.get(s);
      if (errorMap) {
        errorMap.delete(itemId);
      }
    }
  }
}

class ItemScopedStore extends ScopedStore {
  private itemId: string;

  constructor(
    formStore: FormStore,
    scopeSpec: ObjectSpec,
    parentScope: ScopedStore,
    itemId: string,
  ) {
    super(formStore, scopeSpec, parentScope);
    this.itemId = itemId;
  }

  override get(fieldSpec: BaseSpec): unknown {
    if (this.ownedFields.has(fieldSpec)) {
      return this.formStore.get(fieldSpec, { itemId: this.itemId });
    }
    if (this.parentScope) {
      return this.parentScope.get(fieldSpec);
    }
    throw new Error(
      `Field ${fieldSpec.id} is not accessible from this scope chain`,
    );
  }

  override set(fieldSpec: BaseSpec, value: unknown): void {
    if (!this.ownedFields.has(fieldSpec)) {
      throw new Error(
        `Cannot write to field ${fieldSpec.id}: not owned by this scope`,
      );
    }
    this.formStore.set(fieldSpec, value, { itemId: this.itemId });
  }

  override getError(fieldSpec: BaseSpec): string | null {
    return this.formStore.getError(fieldSpec, this.itemId);
  }
}

_registerArrayScopedStore(ArrayScopedStore);
