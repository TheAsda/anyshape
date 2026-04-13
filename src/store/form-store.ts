import { Lens } from '../lens/index.js';
import type { Lens as LensT } from '../lens/index.js';
import type { BaseSpec } from '../specs/base.js';

interface SpecEntry {
  lens: LensT<unknown, unknown>;
  path: string;
  spec: BaseSpec;
}

interface SafeParseResult {
  success: boolean;
  data?: unknown;
  error?: { issues: Array<{ message: string }> };
}

interface ZodLike {
  safeParse(value: unknown): SafeParseResult;
}

function isZodLike(schema: unknown): schema is ZodLike {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    typeof (schema as Record<string, unknown>).safeParse === 'function'
  );
}

export class FormStore {
  private values: Record<string, unknown>;
  private errors: WeakMap<BaseSpec, string | null>;
  private touched: WeakMap<BaseSpec, boolean>;
  private mounted: WeakSet<BaseSpec>;
  private schemaOverrides: WeakMap<BaseSpec, unknown>;
  private domRefs: WeakMap<BaseSpec, HTMLElement | null>;
  private listeners: WeakMap<BaseSpec, Set<() => void>>;
  private specRegistry: WeakMap<BaseSpec, SpecEntry>;
  private treeOrder: BaseSpec[];
  private initialValues: Record<string, unknown>;

  constructor(
    formDefinition: Record<string, BaseSpec>,
    initialData?: Record<string, unknown>,
  ) {
    this.values = {};
    this.errors = new WeakMap();
    this.touched = new WeakMap();
    this.mounted = new WeakSet();
    this.schemaOverrides = new WeakMap();
    this.domRefs = new WeakMap();
    this.listeners = new WeakMap();
    this.specRegistry = new WeakMap();
    this.treeOrder = [];

    this.walkSpecTree(formDefinition, '', null);
    this.values = this.buildInitialValues(formDefinition, initialData);
    this.initialValues = this.deepClone(this.values);
  }

  get(spec: BaseSpec): unknown {
    const entry = this.specRegistry.get(spec);
    if (!entry) throw new Error(`Unknown spec: ${spec.id}`);
    return entry.lens.get(this.values);
  }

  set(
    spec: BaseSpec,
    value: unknown,
    options?: { noValidate?: boolean; noTouch?: boolean },
  ): void {
    const entry = this.specRegistry.get(spec);
    if (!entry) throw new Error(`Unknown spec: ${spec.id}`);

    this.values = entry.lens.set(value, this.values) as Record<string, unknown>;

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
      this.notifyAllListeners();
      return;
    }

    const entry = this.specRegistry.get(spec);
    if (!entry) throw new Error(`Unknown spec: ${spec.id}`);

    const initialVal = entry.lens.get(this.initialValues);
    this.values = entry.lens.set(initialVal, this.values) as Record<string, unknown>;

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

  setSchema(spec: BaseSpec, schema: unknown): void {
    this.schemaOverrides.set(spec, schema);
  }

  removeSchema(spec: BaseSpec): void {
    this.schemaOverrides.delete(spec);
  }

  validateSpec(spec: BaseSpec): { success: boolean; error: string | null } {
    const entry = this.specRegistry.get(spec);
    if (!entry) throw new Error(`Unknown spec: ${spec.id}`);

    const schema =
      this.schemaOverrides.get(spec) ??
      (entry.spec as unknown as Record<string, unknown>)._schema ??
      null;

    if (!isZodLike(schema)) {
      this.errors.set(spec, null);
      return { success: true, error: null };
    }

    const value = entry.lens.get(this.values);
    const result = schema.safeParse(value);

    if (result.success) {
      this.errors.set(spec, null);
      return { success: true, error: null };
    }

    const message = result.error?.issues?.[0]?.message ?? 'Validation failed';
    this.errors.set(spec, message);
    return { success: false, error: message };
  }

  validateTree(
    spec?: BaseSpec,
  ): { success: boolean; errors: Map<BaseSpec, string | null> } {
    const specs = spec
      ? [spec, ...this.getDescendants(spec)]
      : this.treeOrder;

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

    const entry = this.specRegistry.get(spec);
    if (!entry) return;

    const specAny = entry.spec as unknown as Record<string, unknown>;
    const shouldKeep =
      keepValue ??
      (specAny.keepOnUnmount as boolean) ??
      false;

    if (!shouldKeep) {
      const dv = specAny.defaultValue;
      this.values = entry.lens.set(
        dv !== undefined ? dv : undefined,
        this.values,
      ) as Record<string, unknown>;
      this.touched.delete(spec);
      this.errors.set(spec, null);
    }
  }

  isMounted(spec: BaseSpec): boolean {
    return this.mounted.has(spec);
  }

  setRef(spec: BaseSpec, element: HTMLElement | null): void {
    this.domRefs.set(spec, element);
  }

  getSpecs(): BaseSpec[] {
    return [...this.treeOrder];
  }

  getSpecInfo(spec: BaseSpec): { path: string; kind: string; mountRequired: boolean } {
    const entry = this.specRegistry.get(spec);
    if (!entry) throw new Error(`Unknown spec: ${spec.id}`);
    return {
      path: entry.path,
      kind: entry.spec._kind,
      mountRequired: entry.spec.mountRequired,
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

    return { specTree: this.getSpecTree(), values: this.values, errors, touched, mounted };
  }

  getSpecTree(): Record<string, unknown> {
    const tree: Record<string, unknown> = {};
    for (const spec of this.treeOrder) {
      const entry = this.specRegistry.get(spec);
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

    const unmounted: BaseSpec[] = [];
    for (const spec of this.treeOrder) {
      if (spec.mountRequired && !this.mounted.has(spec)) {
        unmounted.push(spec);
      }
    }

    if (!vr.success || unmounted.length > 0) {
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

    let ancestor = spec._parent;
    while (ancestor) {
      this.validateSpec(ancestor);
      this.fireListeners(ancestor);
      ancestor = ancestor._parent;
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

    let ancestor = spec._parent;
    while (ancestor) {
      if (!notified.has(ancestor)) {
        this.fireListeners(ancestor);
        notified.add(ancestor);
      }
      ancestor = ancestor._parent;
    }
  }

  private fireListeners(spec: BaseSpec): void {
    const set = this.listeners.get(spec);
    if (set) {
      for (const fn of set) fn();
    }
  }

  private notifyAllListeners(): void {
    for (const spec of this.treeOrder) {
      this.fireListeners(spec);
    }
  }

  private walkSpecTree(
    children: Record<string, BaseSpec>,
    pathPrefix: string,
    parentLens: LensT<unknown, unknown> | null,
  ): void {
    for (const [key, spec] of Object.entries(children)) {
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      const lens =
        parentLens != null
          ? Lens.compose(parentLens, Lens.prop(key))
          : Lens.prop(key);

      this.specRegistry.set(spec, { lens, path, spec });

      this.treeOrder.push(spec);

      if (spec._kind === 'object') {
        const objChildren = (spec as unknown as { children: Record<string, BaseSpec> }).children;
        this.walkSpecTree(objChildren, path, lens);
      }
    }
  }

  private buildInitialValues(
    children: Record<string, BaseSpec>,
    initialData: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, spec] of Object.entries(children)) {
      const hasInit =
        initialData != null &&
        key in initialData &&
        (initialData as Record<string, unknown>)[key] !== undefined;

      if (spec._kind === 'object') {
        const objChildren = (spec as unknown as { children: Record<string, BaseSpec> }).children;
        result[key] = this.buildInitialValues(
          objChildren,
          hasInit
            ? ((initialData as Record<string, unknown>)[key] as Record<string, unknown>)
            : undefined,
        );
      } else if (spec._kind === 'field') {
        const dv = (spec as unknown as { defaultValue?: unknown }).defaultValue;
        result[key] = hasInit
          ? (initialData as Record<string, unknown>)[key]
          : dv !== undefined
            ? dv
            : undefined;
      } else {
        result[key] = hasInit
          ? (initialData as Record<string, unknown>)[key]
          : undefined;
      }
    }

    return result;
  }

  private getDescendants(spec: BaseSpec): BaseSpec[] {
    if (spec._kind === 'object') {
      const children = (spec as unknown as { children: Record<string, BaseSpec> }).children;
      const out: BaseSpec[] = [];
      for (const child of Object.values(children)) {
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
