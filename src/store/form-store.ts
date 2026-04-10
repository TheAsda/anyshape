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
  private errors: Map<string, string | null>;
  private touched: Map<string, boolean>;
  private mounted: Set<string>;
  private schemaOverrides: Map<string, unknown>;
  private domRefs: Map<string, HTMLElement | null>;
  private listeners: Map<string, Set<() => void>>;
  private specRegistry: Map<string, SpecEntry>;
  private pathToSpecId: Map<string, string>;
  private parentMap: Map<string, string | null>;
  private childrenMap: Map<string, string[]>;
  private treeOrder: string[];
  private initialValues: Record<string, unknown>;

  constructor(
    formDefinition: Record<string, BaseSpec>,
    initialData?: Record<string, unknown>,
  ) {
    this.values = {};
    this.errors = new Map();
    this.touched = new Map();
    this.mounted = new Set();
    this.schemaOverrides = new Map();
    this.domRefs = new Map();
    this.listeners = new Map();
    this.specRegistry = new Map();
    this.pathToSpecId = new Map();
    this.parentMap = new Map();
    this.childrenMap = new Map();
    this.treeOrder = [];

    this.walkSpecTree(formDefinition, '', null as LensT<unknown, unknown> | null, null);
    this.values = this.buildInitialValues(formDefinition, initialData);
    this.initialValues = this.deepClone(this.values);
  }

  get(pathOrSpec: string | BaseSpec): unknown {
    if (typeof pathOrSpec === 'string') {
      const specId = this.pathToSpecId.get(pathOrSpec);
      if (specId) {
        const entry = this.specRegistry.get(specId);
        if (entry) return entry.lens.get(this.values);
      }
      let current: unknown = this.values;
      for (const seg of pathOrSpec.split('.')) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[seg];
      }
      return current;
    }
    const entry = this.specRegistry.get(pathOrSpec.id);
    if (!entry) throw new Error(`Unknown spec: ${pathOrSpec.id}`);
    return entry.lens.get(this.values);
  }

  set(
    pathOrSpec: string | BaseSpec,
    value: unknown,
    options?: { noValidate?: boolean; noTouch?: boolean },
  ): void {
    const specId = this.resolveSpecId(pathOrSpec);
    const entry = this.specRegistry.get(specId);
    if (!entry) throw new Error(`Unknown spec: ${specId}`);

    this.values = entry.lens.set(value, this.values) as Record<string, unknown>;

    if (!options?.noTouch) {
      this.touched.set(specId, true);
    }

    if (options?.noValidate) {
      this.errors.set(specId, null);
    } else {
      this.validateSpec(specId);
    }

    this.notifyValueChanged(specId);
  }

  reset(pathOrSpec?: string | BaseSpec): void {
    if (pathOrSpec === undefined) {
      this.values = this.deepClone(this.initialValues);
      this.errors.clear();
      this.touched.clear();
      this.notifyAllListeners();
      return;
    }

    const specId = this.resolveSpecId(pathOrSpec);
    const entry = this.specRegistry.get(specId);
    if (!entry) throw new Error(`Unknown spec: ${specId}`);

    const initialVal = entry.lens.get(this.initialValues);
    this.values = entry.lens.set(initialVal, this.values) as Record<string, unknown>;

    const ids = [specId, ...this.getDescendants(specId)];
    for (const id of ids) {
      this.touched.delete(id);
      this.errors.set(id, null);
    }

    this.notifyReset(specId);
  }

  getValues(): Record<string, unknown> {
    return this.values;
  }

  getError(specId: string): string | null {
    return this.errors.get(specId) ?? null;
  }

  isTouched(specId: string): boolean {
    return this.touched.get(specId) === true;
  }

  subscribe(specId: string, listener: () => void): () => void {
    let set = this.listeners.get(specId);
    if (!set) {
      set = new Set();
      this.listeners.set(specId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  setSchema(specId: string, schema: unknown): void {
    this.schemaOverrides.set(specId, schema);
  }

  removeSchema(specId: string): void {
    this.schemaOverrides.delete(specId);
  }

  validateSpec(specId: string): { success: boolean; error: string | null } {
    const entry = this.specRegistry.get(specId);
    if (!entry) throw new Error(`Unknown spec: ${specId}`);

    const schema =
      this.schemaOverrides.get(specId) ??
      (entry.spec as unknown as Record<string, unknown>)._schema ??
      null;

    if (!isZodLike(schema)) {
      this.errors.set(specId, null);
      return { success: true, error: null };
    }

    const value = entry.lens.get(this.values);
    const result = schema.safeParse(value);

    if (result.success) {
      this.errors.set(specId, null);
      return { success: true, error: null };
    }

    const message = result.error?.issues?.[0]?.message ?? 'Validation failed';
    this.errors.set(specId, message);
    return { success: false, error: message };
  }

  validateTree(
    specId?: string,
  ): { success: boolean; errors: Map<string, string | null> } {
    const ids = specId
      ? [specId, ...this.getDescendants(specId)]
      : this.treeOrder;

    let allOk = true;
    const errors = new Map<string, string | null>();

    for (const id of ids) {
      const r = this.validateSpec(id);
      errors.set(id, r.error);
      if (!r.success) allOk = false;
    }

    return { success: allOk, errors };
  }

  mount(specId: string): void {
    if (this.mounted.has(specId)) {
      throw new Error(`Spec ${specId} is already mounted`);
    }
    this.mounted.add(specId);
  }

  unmount(specId: string, keepValue?: boolean): void {
    this.mounted.delete(specId);

    const entry = this.specRegistry.get(specId);
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
      this.touched.delete(specId);
      this.errors.set(specId, null);
    }
  }

  isMounted(specId: string): boolean {
    return this.mounted.has(specId);
  }

  setRef(specId: string, element: HTMLElement | null): void {
    this.domRefs.set(specId, element);
  }

  getSpecIds(): string[] {
    return [...this.treeOrder];
  }

  getSpecInfo(specId: string): { path: string; kind: string; mountRequired: boolean } | null {
    const entry = this.specRegistry.get(specId);
    if (!entry) return null;
    return {
      path: entry.path,
      kind: entry.spec.kind,
      mountRequired: entry.spec.mountRequired,
    };
  }

  getDevtoolsSnapshot(): {
    values: Record<string, unknown>;
    errors: Record<string, string | null>;
    touched: Record<string, boolean>;
    mounted: string[];
  } {
    const errors: Record<string, string | null> = {};
    const touched: Record<string, boolean> = {};
    const mounted: string[] = [];

    for (const id of this.treeOrder) {
      const err = this.errors.get(id);
      errors[id] = err ?? null;
      touched[id] = this.touched.get(id) === true;
      if (this.mounted.has(id)) mounted.push(id);
    }

    return { values: this.values, errors, touched, mounted };
  }

  getSpecTree(): Record<string, unknown> {
    const tree: Record<string, unknown> = {};
    for (const id of this.treeOrder) {
      const entry = this.specRegistry.get(id);
      if (!entry) continue;
      tree[entry.path] = {
        id: entry.spec.id,
        kind: entry.spec.kind,
        mountRequired: entry.spec.mountRequired,
      };
    }
    return tree;
  }

  submit(
    onValid: (values: Record<string, unknown>) => void,
    onInvalid?: (errors: Map<string, string | null>) => void,
  ): boolean {
    const vr = this.validateTree();

    const unmounted: string[] = [];
    for (const [id, entry] of this.specRegistry) {
      if (entry.spec.mountRequired && !this.mounted.has(id)) {
        unmounted.push(id);
      }
    }

    if (!vr.success || unmounted.length > 0) {
      for (const id of this.treeOrder) {
        const err = this.errors.get(id);
        if (err) {
          const ref = this.domRefs.get(id);
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

  private resolveSpecId(pathOrSpec: string | BaseSpec): string {
    if (typeof pathOrSpec === 'string') {
      const id = this.pathToSpecId.get(pathOrSpec);
      if (id) return id;
      throw new Error(`Unknown path: ${pathOrSpec}`);
    }
    return pathOrSpec.id;
  }

  private notifyValueChanged(specId: string): void {
    this.fireListeners(specId);

    let ancestor = this.parentMap.get(specId);
    while (ancestor != null) {
      this.validateSpec(ancestor);
      this.fireListeners(ancestor);
      ancestor = this.parentMap.get(ancestor) ?? null;
    }
  }

  private notifyReset(specId: string): void {
    const notified = new Set<string>();

    this.fireListeners(specId);
    notified.add(specId);

    for (const descId of this.getDescendants(specId)) {
      if (!notified.has(descId)) {
        this.fireListeners(descId);
        notified.add(descId);
      }
    }

    let ancestor = this.parentMap.get(specId);
    while (ancestor != null) {
      if (!notified.has(ancestor)) {
        this.fireListeners(ancestor);
        notified.add(ancestor);
      }
      ancestor = this.parentMap.get(ancestor) ?? null;
    }
  }

  private fireListeners(specId: string): void {
    const set = this.listeners.get(specId);
    if (set) {
      for (const fn of set) fn();
    }
  }

  private notifyAllListeners(): void {
    for (const specId of this.treeOrder) {
      this.fireListeners(specId);
    }
  }

  private walkSpecTree(
    children: Record<string, BaseSpec>,
    pathPrefix: string,
    parentLens: LensT<unknown, unknown> | null,
    parentSpecId: string | null,
  ): void {
    for (const [key, spec] of Object.entries(children)) {
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      const lens =
        parentLens != null
          ? Lens.compose(parentLens, Lens.prop(key))
          : Lens.prop(key);

      this.specRegistry.set(spec.id, { lens, path, spec });
      this.pathToSpecId.set(path, spec.id);

      this.parentMap.set(spec.id, parentSpecId);
      if (!this.childrenMap.has(spec.id)) {
        this.childrenMap.set(spec.id, []);
      }
      if (parentSpecId != null) {
        let sibs = this.childrenMap.get(parentSpecId);
        if (!sibs) {
          sibs = [];
          this.childrenMap.set(parentSpecId, sibs);
        }
        sibs.push(spec.id);
      }

      this.treeOrder.push(spec.id);

      if (spec.kind === 'object') {
        const objChildren = (spec as unknown as { children: Record<string, BaseSpec> }).children;
        this.walkSpecTree(objChildren, path, lens, spec.id);
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

      if (spec.kind === 'object') {
        const objChildren = (spec as unknown as { children: Record<string, BaseSpec> }).children;
        result[key] = this.buildInitialValues(
          objChildren,
          hasInit
            ? ((initialData as Record<string, unknown>)[key] as Record<string, unknown>)
            : undefined,
        );
      } else if (spec.kind === 'field') {
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

  private getDescendants(specId: string): string[] {
    const kids = this.childrenMap.get(specId) ?? [];
    const out: string[] = [];
    for (const kid of kids) {
      out.push(kid);
      out.push(...this.getDescendants(kid));
    }
    return out;
  }

  private collectErrors(): Map<string, string | null> {
    const map = new Map<string, string | null>();
    for (const id of this.treeOrder) {
      map.set(id, this.errors.get(id) ?? null);
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
