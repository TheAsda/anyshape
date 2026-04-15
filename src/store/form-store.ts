import { LensStore } from './lens-store.js';
import { BaseSpec, ValidatableSpec } from '../specs/base.js';
import { type ObjectSpecChildren, ObjectSpec } from '../specs/object.js';
import { ArraySpec } from '../specs/array.js';
import { FieldSpec } from '../specs/field.js';
import type { ZodType } from 'zod/v4';

export interface ArrayState {
  items: Array<{ id: string; index: number }>;
}

export class FormStore {
  private values: Record<string, unknown>;
  private initialValues: Record<string, unknown>;
  private lenses: LensStore;
  private formSpec: ObjectSpec;
  private staticDefaults: WeakMap<BaseSpec, unknown>;
  private arrayStates: Map<ArraySpec, ArrayState>;
  private initialArrayStates: Map<ArraySpec, ArrayState>;
  private parents: WeakMap<BaseSpec, BaseSpec | null>;
  private touched: WeakSet<BaseSpec>;
  private containingArray: WeakMap<BaseSpec, ArraySpec>;
  private idCounter: number;
  private errors: WeakMap<BaseSpec, Map<string, string | null>>;
  private schemaOverrides: WeakMap<BaseSpec, ZodType>;
  private listeners: WeakMap<BaseSpec, Set<() => void>>;

  constructor(form: ObjectSpec, initialData?: Record<string, unknown>) {
    this.formSpec = form;
    this.lenses = new LensStore(form);
    this.values = {};
    this.initialValues = {};
    this.staticDefaults = new WeakMap();
    this.arrayStates = new Map();
    this.initialArrayStates = new Map();
    this.parents = new WeakMap();
    this.touched = new WeakSet();
    this.containingArray = new WeakMap();
    this.idCounter = 0;
    this.errors = new WeakMap();
    this.schemaOverrides = new WeakMap();
    this.listeners = new WeakMap();

    this.buildParentsTree(form, null);
    this.computeAllStaticDefaults(form);

    const preFilled = this.preFillValues(form);
    this.values = (preFilled as Record<string, unknown>) ?? {};

    if (initialData) {
      this.values = this.deepMerge(this.values, initialData);
    }

    if (initialData) {
      this.processInitialDataArrays(form, initialData);
    }

    this.initialValues = this.deepClone(this.values);
    this.initialArrayStates = this.cloneArrayStates(this.arrayStates);
  }

  get(spec: BaseSpec, options?: { itemId?: string }): unknown {
    if (options?.itemId !== undefined) {
      const arraySpec = this.findContainingArray(spec);
      if (!arraySpec) {
        throw new Error(
          `Spec is not an array item descendant: ${spec.id}`,
        );
      }
      const state = this.arrayStates.get(arraySpec);
      if (!state) {
        throw new Error(`No array state for: ${arraySpec.id}`);
      }
      const item = state.items.find((i) => i.id === options.itemId);
      if (!item) {
        throw new Error(`No item with id: ${options.itemId}`);
      }
      return this.lenses.getWithIndex(spec, item.index).get(this.values);
    }
    return this.lenses.get(spec).get(this.values);
  }

  set(
    spec: BaseSpec,
    value: unknown,
    options?: { noTouch?: boolean; noValidate?: boolean; itemId?: string },
  ): void {
    if (options?.itemId !== undefined) {
      const arraySpec = this.findContainingArray(spec);
      if (!arraySpec) {
        throw new Error(
          `Spec is not an array item descendant: ${spec.id}`,
        );
      }
      const state = this.arrayStates.get(arraySpec);
      if (!state) {
        throw new Error(`No array state for: ${arraySpec.id}`);
      }
      const item = state.items.find((i) => i.id === options.itemId);
      if (!item) {
        throw new Error(`No item with id: ${options.itemId}`);
      }
      this.values = this.lenses
        .getWithIndex(spec, item.index)
        .set(value, this.values) as Record<string, unknown>;
    } else {
      this.values = this.lenses
        .get(spec)
        .set(value, this.values) as Record<string, unknown>;
    }

    if (!options?.noTouch) {
      this.touched.add(spec);
    }

    this.notifyValueChanged(spec);
  }

  getValues(): Record<string, unknown> {
    return this.values;
  }

  reset(spec?: BaseSpec): void {
    if (!spec) {
      this.values = this.deepClone(this.initialValues);
      this.arrayStates = this.cloneArrayStates(this.initialArrayStates);
      this.touched = new WeakSet();
      this.notifyReset(this.formSpec);
      return;
    }

    const lens = this.lenses.get(spec);
    const initialVal = lens.get(this.initialValues);
    this.values = lens.set(initialVal, this.values) as Record<string, unknown>;
    this.clearTouchedSubtree(spec);
    this.notifyReset(spec);
  }

  isTouched(spec: BaseSpec): boolean {
    return this.touched.has(spec);
  }

  validateSpec(
    spec: BaseSpec,
    itemId?: string,
  ): { success: boolean; error: string | null } {
    const schema =
      this.schemaOverrides.get(spec) ??
      (spec instanceof ValidatableSpec ? spec._schema : undefined);

    if (!schema) {
      const errorMap = this.getOrCreateErrorMap(spec);
      errorMap.set(itemId ?? '', null);
      return { success: true, error: null };
    }

    const value = this.get(spec, itemId ? { itemId } : undefined);
    const result = schema.safeParse(value);

    const errorMap = this.getOrCreateErrorMap(spec);
    if (result.success) {
      errorMap.set(itemId ?? '', null);
      return { success: true, error: null };
    }

    const message =
      (result.error as { issues?: Array<{ message?: string }> })
        ?.issues?.[0]?.message ?? 'Validation failed';
    errorMap.set(itemId ?? '', message);
    return { success: false, error: message };
  }

  validateTree(
    spec?: BaseSpec,
    itemId?: string,
  ): { success: boolean; errors: Map<BaseSpec, string | null> } {
    const allErrors = new Map<BaseSpec, string | null>();

    let specsToValidate: BaseSpec[];
    if (!spec) {
      specsToValidate = this.collectTreeSpecs(this.formSpec);
    } else {
      specsToValidate = [spec, ...this.collectDescendants(spec)];
    }

    for (const s of specsToValidate) {
      this.validateSpec(s, itemId);
      allErrors.set(s, this.getError(s, itemId));
    }

    const success = Array.from(allErrors.values()).every((e) => e === null);
    return { success, errors: allErrors };
  }

  getError(spec: BaseSpec, itemId?: string): string | null {
    const errorMap = this.errors.get(spec);
    if (!errorMap) return null;
    return errorMap.get(itemId ?? '') ?? null;
  }

  setSchema(spec: BaseSpec, schema: ZodType): void {
    this.schemaOverrides.set(spec, schema);
  }

  removeSchema(spec: BaseSpec): void {
    this.schemaOverrides.delete(spec);
  }

  subscribe(spec: BaseSpec, listener: () => void): () => void {
    let listenerSet = this.listeners.get(spec);
    if (!listenerSet) {
      listenerSet = new Set();
      this.listeners.set(spec, listenerSet);
    }
    listenerSet.add(listener);
    return () => {
      const set = this.listeners.get(spec);
      if (set) {
        set.delete(listener);
      }
    };
  }

  getStaticDefault(spec: BaseSpec): unknown {
    return this.staticDefaults.get(spec);
  }

  getArrayState(arraySpec: ArraySpec): ArrayState | undefined {
    return this.arrayStates.get(arraySpec);
  }

  private generateId(): string {
    return `item_${this.idCounter++}`;
  }

  private getOrCreateErrorMap(spec: BaseSpec): Map<string, string | null> {
    let errorMap = this.errors.get(spec);
    if (!errorMap) {
      errorMap = new Map();
      this.errors.set(spec, errorMap);
    }
    return errorMap;
  }

  private collectTreeSpecs(spec: BaseSpec): BaseSpec[] {
    return [spec, ...this.collectDescendants(spec)];
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

  private notifyValueChanged(spec: BaseSpec): void {
    this.fireListeners(spec);
    let current: BaseSpec | null | undefined = this.parents.get(spec);
    while (current !== null && current !== undefined) {
      this.fireListeners(current);
      current = this.parents.get(current);
    }
  }

  private notifyReset(spec: BaseSpec): void {
    const notified = new Set<BaseSpec>();

    this.fireListeners(spec);
    notified.add(spec);

    const descendants = this.collectDescendants(spec);
    for (const d of descendants) {
      if (!notified.has(d)) {
        this.fireListeners(d);
        notified.add(d);
      }
    }

    let current: BaseSpec | null | undefined = this.parents.get(spec);
    while (current !== null && current !== undefined) {
      if (!notified.has(current)) {
        this.fireListeners(current);
        notified.add(current);
      }
      current = this.parents.get(current);
    }
  }

  private fireListeners(spec: BaseSpec): void {
    const listenerSet = this.listeners.get(spec);
    if (listenerSet) {
      for (const listener of listenerSet) {
        listener();
      }
    }
  }

  private findContainingArray(spec: BaseSpec): ArraySpec | undefined {
    return this.containingArray.get(spec);
  }

  private buildParentsTree(
    spec: ObjectSpec,
    parentSpec: BaseSpec | null,
  ): void {
    for (const child of Object.values(spec.children as ObjectSpecChildren)) {
      this.parents.set(child, spec);

      if (child instanceof ObjectSpec) {
        this.buildParentsTree(child, spec);
      }

      if (child instanceof ArraySpec) {
        this.parents.set(child.item, child);
        this.containingArray.set(child.item, child);
        this.buildArrayParentsTree(child.item, child);
      }
    }
  }

  private buildArrayParentsTree(
    spec: ObjectSpec,
    arraySpec: ArraySpec,
  ): void {
    for (const child of Object.values(spec.children as ObjectSpecChildren)) {
      this.parents.set(child, spec);
      this.containingArray.set(child, arraySpec);

      if (child instanceof ObjectSpec) {
        this.buildArrayParentsTree(child, arraySpec);
      }
    }
  }

  private computeAllStaticDefaults(spec: BaseSpec): void {
    if (spec instanceof ObjectSpec) {
      if (spec.defaultValue !== undefined) {
        this.staticDefaults.set(spec, spec.defaultValue);
      }
      for (const child of Object.values(spec.children as ObjectSpecChildren)) {
        this.computeAllStaticDefaults(child);
      }
    } else if (spec instanceof FieldSpec) {
      const def = this.computeFieldStaticDefault(spec);
      if (def !== undefined) {
        this.staticDefaults.set(spec, def);
      }
    } else if (spec instanceof ArraySpec) {
      if (spec.defaultValue !== undefined) {
        this.staticDefaults.set(spec, spec.defaultValue);
      }
      this.computeAllStaticDefaults(spec.item);
    }
  }

  private computeFieldStaticDefault(spec: FieldSpec<unknown>): unknown {
    if (spec.defaultValue !== undefined) return spec.defaultValue;
    if (spec._schema) {
      const result = spec._schema.safeParse(undefined);
      if (result.success) return result.data;
    }
    return undefined;
  }

  private preFillValues(spec: BaseSpec): unknown {
    if (spec.mountRequired === false) return undefined;

    if (spec instanceof ObjectSpec) {
      const base: Record<string, unknown> = spec.defaultValue
        ? { ...(spec.defaultValue as Record<string, unknown>) }
        : {};

      for (const [key, child] of Object.entries(
        spec.children as ObjectSpecChildren,
      )) {
        if (child.mountRequired === false) {
          if (key in base) {
            delete base[key];
          }
          continue;
        }
        const childValue = this.preFillValues(child);
        if (childValue !== undefined) {
          base[key] = childValue;
        }
      }
      return base;
    }

    if (spec instanceof FieldSpec) {
      return this.staticDefaults.get(spec);
    }

    if (spec instanceof ArraySpec) {
      if (spec.defaultValue && spec.defaultValue.length > 0) {
        const items: unknown[] = [];
        const state: ArrayState = { items: [] };

        for (let i = 0; i < spec.defaultValue.length; i++) {
          const id = this.generateId();
          state.items.push({ id, index: i });

          const templateValue = this.preFillValues(spec.item);
          const defaultItem = spec.defaultValue[i];

          if (
            templateValue &&
            typeof templateValue === 'object' &&
            !Array.isArray(templateValue) &&
            defaultItem &&
            typeof defaultItem === 'object' &&
            !Array.isArray(defaultItem)
          ) {
            items.push({
              ...(templateValue as Record<string, unknown>),
              ...(defaultItem as Record<string, unknown>),
            });
          } else {
            items.push(defaultItem ?? templateValue);
          }
        }

        this.arrayStates.set(spec, state);
        return items;
      }
      return [];
    }

    return undefined;
  }

  private processInitialDataArrays(
    spec: BaseSpec,
    data: Record<string, unknown>,
  ): void {
    if (spec instanceof ObjectSpec) {
      for (const [key, child] of Object.entries(
        spec.children as ObjectSpecChildren,
      )) {
        const childData = data[key];
        if (childData === undefined) continue;

        if (child instanceof ArraySpec && Array.isArray(childData)) {
          const state: ArrayState = { items: [] };
          for (let i = 0; i < childData.length; i++) {
            state.items.push({ id: this.generateId(), index: i });
          }
          this.arrayStates.set(child, state);
        } else if (
          child instanceof ObjectSpec &&
          typeof childData === 'object' &&
          childData !== null &&
          !Array.isArray(childData)
        ) {
          this.processInitialDataArrays(
            child,
            childData as Record<string, unknown>,
          );
        }
      }
    }
  }

  private clearTouchedSubtree(spec: BaseSpec): void {
    this.touched.delete(spec);

    if (spec instanceof ObjectSpec) {
      for (const child of Object.values(spec.children as ObjectSpecChildren)) {
        this.clearTouchedSubtree(child);
      }
    } else if (spec instanceof ArraySpec) {
      this.clearTouchedSubtree(spec.item);
    }
  }

  private cloneArrayStates(
    source: Map<ArraySpec, ArrayState>,
  ): Map<ArraySpec, ArrayState> {
    const clone = new Map<ArraySpec, ArrayState>();
    for (const [key, state] of source) {
      clone.set(key, {
        items: state.items.map((item) => ({ ...item })),
      });
    }
    return clone;
  }

  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...target };
    for (const key of Object.keys(source)) {
      const sourceVal = source[key];
      if (sourceVal === undefined) continue;

      const targetVal = result[key];
      if (
        sourceVal !== null &&
        typeof sourceVal === 'object' &&
        !Array.isArray(sourceVal) &&
        targetVal !== null &&
        typeof targetVal === 'object' &&
        !Array.isArray(targetVal)
      ) {
        result[key] = this.deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>,
        );
      } else {
        result[key] = this.deepClone(sourceVal);
      }
    }
    return result;
  }

  private deepClone<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map((v) => this.deepClone(v)) as T;
    }
    const out: Record<string, unknown> = {};
    const src = value as Record<string, unknown>;
    for (const k of Object.keys(src)) {
      out[k] = this.deepClone(src[k]);
    }
    return out as T;
  }
}
