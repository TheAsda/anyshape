import { ZodType } from 'zod/v4';
import { Lens } from '../lens/index.js';
import { ValidatableSpec, type BaseSpec } from '../specs/base.js';
import { LensStore } from './lens-store.js';
import { ObjectSpec, ObjectSpecChildren } from '../specs/object.js';
import { ArraySpec } from '../specs/array.js';
import { FieldSpec } from '../specs/field.js';
import type { ArrayStore } from './array-store.js';
import { FormDataStore } from './form-data-store.js';

interface LensEntry {
  lens: Lens<Record<string, unknown>, unknown>;
  path: string;
  spec: BaseSpec;
}

export class FormStore {
  private store: FormDataStore;
  private errors: WeakMap<BaseSpec, string | null>;
  private touched: WeakMap<BaseSpec, boolean>;
  private mounted: WeakSet<BaseSpec>;
  private schemaOverrides: WeakMap<BaseSpec, ZodType>;
  private domRefs: WeakMap<BaseSpec, HTMLElement | null>;
  private listeners: WeakMap<BaseSpec, Set<() => void>>;
  private lenses: LensStore;
  private parents: WeakMap<BaseSpec, BaseSpec | null>;
  // private initialValues: Record<string, unknown>;
  private formSpecs: BaseSpec[];
  private arrayStores: Map<
    ArraySpec<ObjectSpec<ObjectSpecChildren>>,
    ArrayStore
  >;

  private get treeOrder(): BaseSpec[] {
    return this.formSpecs;
  }

  constructor(form: ObjectSpec, initialData?: Record<string, unknown>) {
    this.store = new FormDataStore();
    this.errors = new WeakMap();
    this.touched = new WeakMap();
    this.mounted = new WeakSet();
    this.schemaOverrides = new WeakMap();
    this.domRefs = new WeakMap();
    this.listeners = new WeakMap();
    this.lenses = new LensStore(form);
    this.parents = new WeakMap();
    this.formSpecs = [];
    this.arrayStores = new Map();

    this.buildParentsTree(form, null);
    this.fillFormSpecs(form);
  }

  get(spec: BaseSpec): unknown {
    return this.lenses.get(spec);
  }

  set(
    spec: BaseSpec,
    value: unknown,
    options?: { noValidate?: boolean; noTouch?: boolean },
  ): void {
    this.values = this.lenses.get(spec).set(this.values, value) as Record<
      string,
      unknown
    >;

    if (!options?.noTouch) {
      this.touched.set(spec, true);
    }

    if (options?.noValidate) {
      this.errors.set(spec, null);
    } else {
      this.validateSpec(spec);
    }

    this.notifyValueChanged(spec);
  }

  reset(spec?: BaseSpec): void {
    if (spec === undefined) {
      this.values = this.deepClone(this.initialValues);
      this.errors = new WeakMap();
      this.touched = new WeakMap();
      for (const arrayStore of this.arrayStores.values()) {
        arrayStore.reset();
      }
      this.notifyAllListeners();
      return;
    }

    const lens = this.lenses.get(spec);

    const initialVal = lens.get(this.initialValues);
    this.values = lens.set(this.values, initialVal) as Record<string, unknown>;

    const specs = [spec, ...this.getDescendants(spec)];
    for (const s of specs) {
      this.touched.delete(s);
      this.errors.set(s, null);
    }

    this.notifyReset(spec);
  }

  getValues(): Record<string, unknown> {
    return this.values;
  }

  getError(spec: BaseSpec): string | null {
    return this.errors.get(spec) ?? null;
  }

  isTouched(spec: BaseSpec): boolean {
    return this.touched.get(spec) === true;
  }

  subscribe(spec: BaseSpec, listener: () => void): () => void {
    let set = this.listeners.get(spec);
    if (!set) {
      set = new Set();
      this.listeners.set(spec, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  //#region schema
  setSchema(spec: BaseSpec, schema: ZodType): void {
    this.schemaOverrides.set(spec, schema);
  }

  removeSchema(spec: BaseSpec): void {
    this.schemaOverrides.delete(spec);
  }
  //#endregion

  validateSpec(spec: BaseSpec): { success: boolean; error: string | null } {
    const lens = this.lenses.get(spec);
    if (!lens) throw new Error(`Unknown spec: ${spec.id}`);

    const schema =
      this.schemaOverrides.get(spec) ??
      (spec instanceof ValidatableSpec ? spec._schema : null);

    if (!schema) {
      this.errors.set(spec, null);
      return { success: true, error: null };
    }

    const value = lens.get(this.values);
    const result = schema.safeParse(value);

    if (result.success) {
      this.errors.set(spec, null);
      return { success: true, error: null };
    }

    const message = result.error?.issues?.[0]?.message ?? 'Validation failed';
    this.errors.set(spec, message);
    return { success: false, error: message };
  }

  validateTree(spec?: BaseSpec): {
    success: boolean;
    errors: Map<BaseSpec, string | null>;
  } {
    const specs = spec ? [spec, ...this.getDescendants(spec)] : this.treeOrder;

    let allOk = true;
    const errors = new Map<BaseSpec, string | null>();

    for (const s of specs) {
      const r = this.validateSpec(s);
      errors.set(s, r.error);
      if (!r.success) allOk = false;
    }

    return { success: allOk, errors };
  }

  mount(spec: BaseSpec): void {
    if (this.mounted.has(spec)) {
      throw new Error(`Spec ${spec.id} is already mounted`);
    }
    this.mounted.add(spec);
  }

  unmount(spec: BaseSpec, keepValue?: boolean): void {
    this.mounted.delete(spec);

    const shouldKeep =
      keepValue ?? (spec instanceof FieldSpec ? spec.keepOnUnmount : false);

    if (!shouldKeep) {
      const defaultValue =
        spec instanceof FieldSpec ? spec.defaultValue : undefined;
      this.values = this.lenses
        .get(spec)
        .set(this.values, defaultValue) as Record<string, unknown>;
      this.touched.delete(spec);
      this.errors.set(spec, null);
    }
  }

  isMounted(spec: BaseSpec): boolean {
    return this.mounted.has(spec);
  }

  registerArrayStore(
    arraySpec: ArraySpec<ObjectSpec<ObjectSpecChildren>>,
    store: ArrayStore,
  ): void {
    this.arrayStores.set(arraySpec, store);
  }

  unregisterArrayStore(
    arraySpec: ArraySpec<ObjectSpec<ObjectSpecChildren>>,
  ): void {
    this.arrayStores.delete(arraySpec);
  }

  setRef(spec: BaseSpec, element: HTMLElement | null): void {
    this.domRefs.set(spec, element);
  }

  getSpecInfo(spec: BaseSpec): {
    id: string;
    kind: string;
    mountRequired: boolean;
  } {
    return {
      id: spec.id,
      kind: spec._kind,
      mountRequired: spec.mountRequired,
    };
  }

  getDevtoolsSnapshot(): {
    specTree: Record<string, unknown>;
    values: Record<string, unknown>;
    errors: Record<string, string | null>;
    touched: Record<string, boolean>;
    mounted: string[];
  } {
    const errors: Record<string, string | null> = {};
    const touched: Record<string, boolean> = {};
    const mounted: string[] = [];

    for (const spec of this.treeOrder) {
      const err = this.errors.get(spec);
      errors[spec.id] = err ?? null;
      touched[spec.id] = this.touched.get(spec) === true;
      if (this.mounted.has(spec)) mounted.push(spec.id);
    }

    return {
      specTree: this.getSpecTree(),
      values: this.values,
      errors,
      touched,
      mounted,
    };
  }

  getSpecTree(): Record<string, unknown> {
    const tree: Record<string, unknown> = {};
    for (const spec of this.treeOrder) {
      const entry = this.lenses.get(spec);
      if (!entry) continue;
      tree[entry.path] = {
        id: entry.spec.id,
        kind: entry.spec._kind,
        mountRequired: entry.spec.mountRequired,
      };
    }
    return tree;
  }

  submit(
    onValid: (values: Record<string, unknown>) => void,
    onInvalid?: (errors: Map<BaseSpec, string | null>) => void,
  ): boolean {
    const vr = this.validateTree();

    let arrayValidationOk = true;
    for (const arrayStore of this.arrayStores.values()) {
      const ar = arrayStore.validateTree();
      if (!ar.success) arrayValidationOk = false;
    }

    const unmounted: BaseSpec[] = [];
    for (const spec of this.treeOrder) {
      if (spec.mountRequired && !this.mounted.has(spec)) {
        unmounted.push(spec);
      }
    }

    if (!vr.success || !arrayValidationOk || unmounted.length > 0) {
      for (const spec of this.treeOrder) {
        const err = this.errors.get(spec);
        if (err) {
          const ref = this.domRefs.get(spec);
          if (ref && typeof ref.focus === 'function') {
            ref.focus();
          }
          break;
        }
      }

      onInvalid?.(this.collectErrors());
      return false;
    }

    onValid(this.getValues());
    return true;
  }

  private notifyValueChanged(spec: BaseSpec): void {
    this.fireListeners(spec);

    let ancestor = this.parents.get(spec) ?? null;
    while (ancestor) {
      this.validateSpec(ancestor);
      this.fireListeners(ancestor);
      ancestor = this.parents.get(ancestor) ?? null;
    }
  }

  private notifyReset(spec: BaseSpec): void {
    const notified = new Set<BaseSpec>();

    this.fireListeners(spec);
    notified.add(spec);

    for (const desc of this.getDescendants(spec)) {
      if (!notified.has(desc)) {
        this.fireListeners(desc);
        notified.add(desc);
      }
    }

    let ancestor = this.parents.get(spec) ?? null;
    while (ancestor) {
      if (!notified.has(ancestor)) {
        this.fireListeners(ancestor);
        notified.add(ancestor);
      }
      ancestor = this.parents.get(ancestor) ?? null;
    }
  }

  private fireListeners(spec: BaseSpec): void {
    const set = this.listeners.get(spec);
    if (set) {
      for (const fn of set) fn();
    }
  }

  private notifyAllListeners(): void {
    for (const spec of this.formSpecs) {
      this.fireListeners(spec);
    }
  }

  //#region init
  private buildParentsTree(
    spec: ObjectSpec,
    parentSpec: BaseSpec | null,
  ): void {
    for (const s of Object.values(spec.children as ObjectSpecChildren)) {
      this.parents.set(s, parentSpec);

      if (s instanceof ObjectSpec) {
        this.buildParentsTree(s, spec);
      }

      if (s instanceof ArraySpec) {
        this.parents.set(s.item, s);
        this.buildParentsTree(s.item, s);
      }
    }
  }

  private fillFormSpecs(spec: BaseSpec) {
    this.formSpecs.push(spec);
    switch (true) {
      case spec instanceof ObjectSpec:
        Object.values(spec.children as ObjectSpecChildren).forEach((child) =>
          this.fillFormSpecs(child),
        );
        break;
      case spec instanceof ArraySpec:
        this.fillFormSpecs(spec.item);
        break;
    }
  }

  //#endregion

  // private buildInitialValues(
  //   children: Record<string, BaseSpec>,
  //   initialData: Record<string, unknown> | undefined,
  // ): Record<string, unknown> {
  //   const result: Record<string, unknown> = {};

  //   for (const [key, spec] of Object.entries(children)) {
  //     const hasInit =
  //       initialData != null &&
  //       key in initialData &&
  //       (initialData as Record<string, unknown>)[key] !== undefined;

  //     if (spec._kind === 'object') {
  //       const objChildren = (
  //         spec as unknown as { children: Record<string, BaseSpec> }
  //       ).children;
  //       result[key] = this.buildInitialValues(
  //         objChildren,
  //         hasInit
  //           ? ((initialData as Record<string, unknown>)[key] as Record<
  //               string,
  //               unknown
  //             >)
  //           : undefined,
  //       );
  //     } else if (spec._kind === 'field') {
  //       const dv = (spec as unknown as { defaultValue?: unknown }).defaultValue;
  //       result[key] = hasInit
  //         ? (initialData as Record<string, unknown>)[key]
  //         : dv !== undefined
  //           ? dv
  //           : undefined;
  //     } else if (spec._kind === 'array') {
  //       const arrSpec = spec as unknown as { defaultValue?: unknown[] };
  //       result[key] = hasInit
  //         ? (initialData as Record<string, unknown>)[key]
  //         : (arrSpec.defaultValue ?? []);
  //     } else {
  //       result[key] = hasInit
  //         ? (initialData as Record<string, unknown>)[key]
  //         : undefined;
  //     }
  //   }

  //   return result;
  // }

  private getDescendants(spec: BaseSpec): BaseSpec[] {
    if (spec._kind === 'object') {
      const children = (
        spec as unknown as { children: Record<string, BaseSpec> }
      ).children;
      const out: BaseSpec[] = [];
      for (const child of Object.values(children)) {
        out.push(child);
        out.push(...this.getDescendants(child));
      }
      return out;
    }
    if (spec._kind === 'array') {
      const arrSpec = spec as unknown as ArraySpec<
        ObjectSpec<ObjectSpecChildren>
      >;
      const out: BaseSpec[] = [arrSpec.item];
      for (const child of Object.values(
        arrSpec.item.children as ObjectSpecChildren,
      )) {
        out.push(child);
        out.push(...this.getDescendants(child));
      }
      return out;
    }
    return [];
  }

  private collectErrors(): Map<BaseSpec, string | null> {
    const map = new Map<BaseSpec, string | null>();
    for (const spec of this.treeOrder) {
      map.set(spec, this.errors.get(spec) ?? null);
    }
    return map;
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
