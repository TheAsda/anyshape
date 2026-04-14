import type { FormStore } from './form-store.js';
import type { ArraySpec } from '../specs/array.js';
import type { ObjectSpec, ObjectSpecChildren } from '../specs/object.js';
import type { BaseSpec } from '../specs/base.js';
import type { FieldSpec } from '../specs/field.js';
import { ValidatableSpec } from '../specs/base.js';
import type { ZodType } from 'zod/v4';

export interface ArrayItem {
  id: string;
  index: number;
}

export class ArrayStore {
  private readonly formStore: FormStore;
  private readonly arraySpec: ArraySpec;
  private readonly itemChildren: ObjectSpecChildren;
  private readonly specToKey: Map<BaseSpec, string>;
  private readonly hookDefaultValue: Record<string, unknown>[] | undefined;
  private items: ArrayItem[];
  private listeners: Set<() => void>;
  private itemFieldErrors: Map<string, string | null>;
  private arrayError: string | null;

  constructor(
    formStore: FormStore,
    arraySpec: ArraySpec,
    options?: { defaultValue?: Record<string, unknown>[] },
  ) {
    this.formStore = formStore;
    this.arraySpec = arraySpec;
    this.itemChildren = (arraySpec.item as unknown as ObjectSpec).children;
    this.hookDefaultValue = options?.defaultValue;
    this.listeners = new Set();

    this.specToKey = new Map();
    for (const [key, spec] of Object.entries(this.itemChildren)) {
      this.specToKey.set(spec, key);
    }

    this.itemFieldErrors = new Map();
    this.arrayError = null;

    this.items = [];
    const existing = this.formStore.get(this.arraySpec);
    const isFromSpecDefault = existing === this.arraySpec.defaultValue;

    if (Array.isArray(existing) && existing.length > 0 && !isFromSpecDefault) {
      // initialData wins — hydrate, filling undefined fields with field defaults
      for (let i = 0; i < existing.length; i++) {
        existing[i] = this.applyFieldDefaults(
          existing[i] as Record<string, unknown>,
        );
        this.items.push({ id: crypto.randomUUID(), index: i });
      }
      this.formStore.set(this.arraySpec, existing, { noValidate: true });
    } else {
      // No initialData — resolve hook-level → array-def defaults, then field defaults
      const defaults = this.resolveDefaults();
      if (defaults.length > 0) {
        const filled = defaults.map((item) => this.applyFieldDefaults(item));
        this.formStore.set(this.arraySpec, filled, { noValidate: true });
        for (let i = 0; i < filled.length; i++) {
          this.items.push({ id: crypto.randomUUID(), index: i });
        }
      }
    }

    this.formStore.registerArrayStore(arraySpec, this);
  }

  get(fieldSpec: BaseSpec, itemId: string): unknown {
    const key = this.specToKey.get(fieldSpec);
    if (key === undefined) {
      throw new Error(`Unknown field spec: ${fieldSpec.id}`);
    }
    const idx = this.getItemIndex(itemId);
    const items = this.getArrayValues();
    return items[idx]?.[key];
  }

  set(fieldSpec: BaseSpec, itemId: string, value: unknown): void {
    const key = this.specToKey.get(fieldSpec);
    if (key === undefined) {
      throw new Error(`Unknown field spec: ${fieldSpec.id}`);
    }
    const idx = this.getItemIndex(itemId);
    const items = this.getArrayValues();

    const newItems = [...items];
    newItems[idx] = {
      ...(newItems[idx] as Record<string, unknown>),
      [key]: value,
    };

    this.formStore.set(this.arraySpec, newItems, { noValidate: true });
    this.notifyListeners();
  }

  getItems(): Array<{ id: string }> {
    return this.items.map((item) => ({ id: item.id }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  append(data?: Record<string, unknown>): string {
    const id = crypto.randomUUID();
    this.items.push({ id, index: this.items.length });

    const currentArray = this.getArrayValues();
    const newItemData: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(this.itemChildren)) {
      if (data && key in data) {
        newItemData[key] = data[key];
      } else if ('defaultValue' in spec) {
        newItemData[key] = (spec as FieldSpec<unknown>).defaultValue;
      }
    }

    const newArray = [...currentArray, newItemData];
    this.formStore.set(this.arraySpec, newArray, { noValidate: true });
    this.notifyListeners();
    return id;
  }

  remove(id: string): void {
    const idx = this.getItemIndex(id);
    this.items.splice(idx, 1);
    this.reindexItems();

    const currentArray = this.getArrayValues();
    const newArray = [...currentArray];
    newArray.splice(idx, 1);

    this.formStore.set(this.arraySpec, newArray, { noValidate: true });
    this.notifyListeners();
  }

  reorder(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= this.items.length ||
      toIndex < 0 ||
      toIndex >= this.items.length
    ) {
      throw new Error(
        `Index out of range: from ${fromIndex} to ${toIndex}, length ${this.items.length}`,
      );
    }

    const [moved] = this.items.splice(fromIndex, 1);
    this.items.splice(toIndex, 0, moved);
    this.reindexItems();

    const currentArray = this.getArrayValues();
    const newArray = [...currentArray];
    const [movedData] = newArray.splice(fromIndex, 1);
    newArray.splice(toIndex, 0, movedData);

    this.formStore.set(this.arraySpec, newArray, { noValidate: true });
    this.notifyListeners();
  }

  upsert(id: string, data: Record<string, unknown>): string {
    const item = this.items.find((i) => i.id === id);
    if (item !== undefined) {
      const idx = item.index;
      const currentArray = this.getArrayValues();
      const newArray = [...currentArray];
      newArray[idx] = {
        ...(newArray[idx] as Record<string, unknown>),
        ...data,
      };

      this.formStore.set(this.arraySpec, newArray, { noValidate: true });
      this.notifyListeners();
      return id;
    }
    return this.append(data);
  }

  clear(): void {
    this.items = [];
    this.formStore.set(this.arraySpec, [], { noValidate: true });
    this.notifyListeners();
  }

  reset(): void {
    this.items = [];
    this.itemFieldErrors.clear();
    this.arrayError = null;
    const existing = this.formStore.get(this.arraySpec);
    if (Array.isArray(existing)) {
      for (let i = 0; i < existing.length; i++) {
        this.items.push({ id: crypto.randomUUID(), index: i });
      }
    }
    this.notifyListeners();
  }

  validateItemField(
    itemId: string,
    fieldSpec: BaseSpec,
  ): { success: boolean; error: string | null } {
    const key = `${itemId}:${fieldSpec.id}`;
    const schema: ZodType | undefined =
      fieldSpec instanceof ValidatableSpec ? fieldSpec._schema : undefined;

    if (!schema) {
      this.itemFieldErrors.set(key, null);
      return { success: true, error: null };
    }

    const value = this.get(fieldSpec, itemId);
    const result = schema.safeParse(value);

    if (result.success) {
      this.itemFieldErrors.set(key, null);
      return { success: true, error: null };
    }

    const message = result.error?.issues?.[0]?.message ?? 'Validation failed';
    this.itemFieldErrors.set(key, message);
    return { success: false, error: message };
  }

  validateItem(itemId: string): {
    success: boolean;
    errors: Map<string, string | null>;
  } {
    let allOk = true;
    const errors = new Map<string, string | null>();

    for (const spec of Object.values(this.itemChildren)) {
      const r = this.validateItemField(itemId, spec);
      errors.set(`${itemId}:${spec.id}`, r.error);
      if (!r.success) allOk = false;
    }

    return { success: allOk, errors };
  }

  validateArray(): { success: boolean; error: string | null } {
    const schema = this.arraySpec._schema;

    if (!schema) {
      this.arrayError = null;
      return { success: true, error: null };
    }

    const value = this.formStore.get(this.arraySpec);
    const result = schema.safeParse(value);

    if (result.success) {
      this.arrayError = null;
      return { success: true, error: null };
    }

    const message = result.error?.issues?.[0]?.message ?? 'Validation failed';
    this.arrayError = message;
    return { success: false, error: message };
  }

  validateTree(): {
    success: boolean;
    arrayError: string | null;
    itemErrors: Map<string, string | null>;
  } {
    let allOk = true;
    const itemErrors = new Map<string, string | null>();

    const arrayResult = this.validateArray();
    itemErrors.set('array', arrayResult.error);
    if (!arrayResult.success) allOk = false;

    for (const item of this.items) {
      const itemResult = this.validateItem(item.id);
      for (const [key, error] of itemResult.errors) {
        itemErrors.set(key, error);
      }
      if (!itemResult.success) allOk = false;
    }

    return { success: allOk, arrayError: arrayResult.error, itemErrors };
  }

  getItemFieldError(itemId: string, fieldSpec: BaseSpec): string | null {
    return this.itemFieldErrors.get(`${itemId}:${fieldSpec.id}`) ?? null;
  }

  getArrayError(): string | null {
    return this.arrayError;
  }

  private reindexItems(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].index = i;
    }
  }

  getItemIndex(itemId: string): number {
    const item = this.items.find((i) => i.id === itemId);
    if (item === undefined) {
      throw new Error(`Unknown item ID: ${itemId}`);
    }
    return item.index;
  }

  private getArrayValues(): Record<string, unknown>[] {
    const val = this.formStore.get(this.arraySpec);
    if (!Array.isArray(val)) {
      return [];
    }
    return val as Record<string, unknown>[];
  }

  private notifyListeners(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }

  private resolveDefaults(): Record<string, unknown>[] {
    if (this.hookDefaultValue && this.hookDefaultValue.length > 0) {
      return this.hookDefaultValue;
    }
    const specDefault = this.arraySpec.defaultValue;
    if (specDefault && specDefault.length > 0) {
      return specDefault as Record<string, unknown>[];
    }
    return [];
  }

  private applyFieldDefaults(
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...data };
    for (const [key, spec] of Object.entries(this.itemChildren)) {
      if (!(key in result) || result[key] === undefined) {
        if ('defaultValue' in spec) {
          result[key] = (spec as FieldSpec<unknown>).defaultValue;
        }
      }
    }
    return result;
  }
}
