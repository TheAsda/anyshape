import { BaseSpec } from '../specs/base.js';
import { ObjectSpec } from '../specs/object.js';
import { ArraySpec } from '../specs/array.js';
import { FormStore } from './form-store.js';
import type { ArrayScopedStore } from './array-scoped-store.js';

type ArrayScopedStoreCtor = new (
  formStore: FormStore,
  arraySpec: ArraySpec,
  parentScope: ScopedStore,
) => ArrayScopedStore;

let _arrayScopedStoreCtor: ArrayScopedStoreCtor | null = null;

export function _registerArrayScopedStore(ctor: ArrayScopedStoreCtor): void {
  _arrayScopedStoreCtor = ctor;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
}

export class ScopedStore {
  protected formStore: FormStore;
  protected scopeSpec: ObjectSpec;
  protected parentScope: ScopedStore | null;
  protected ownedFields: Set<BaseSpec>;

  constructor(
    formStore: FormStore,
    scopeSpec: ObjectSpec,
    parentScope: ScopedStore | null,
  ) {
    this.formStore = formStore;
    this.scopeSpec = scopeSpec;
    this.parentScope = parentScope;
    this.ownedFields = new Set(Object.values(scopeSpec.children));
  }

  mount(defaults?: Record<string, unknown>): void {
    const currentValue = this.formStore.get(this.scopeSpec) as Record<
      string,
      unknown
    > | null;
    const staticDefault =
      this.formStore.getStaticDefault(this.scopeSpec) as Record<
        string,
        unknown
      > | null;

    const isAtStaticDefault = deepEqual(currentValue, staticDefault);

    if (defaults && Object.keys(defaults).length > 0) {
      if (isAtStaticDefault) {
        // Entire scope is at static default — merge defaults over the current value
        const merged: Record<string, unknown> = {
          ...(currentValue as Record<string, unknown>),
          ...defaults,
        };
        this.formStore.set(this.scopeSpec, merged, { noTouch: true });
      } else {
        // Current value differs from static default (initialData or user-edited)
        // Only override fields that are still at their static default
        for (const [key, defaultVal] of Object.entries(defaults)) {
          const childSpec = this.scopeSpec.children[key];
          if (childSpec) {
            const childCurrent = this.formStore.get(childSpec);
            const childStaticDefault = this.formStore.getStaticDefault(childSpec);
            if (deepEqual(childCurrent, childStaticDefault)) {
              this.formStore.set(childSpec, defaultVal, { noTouch: true });
            }
          }
        }
      }
    }

    this.formStore.mount(this.scopeSpec);
  }

  unmount(): void {
    this.formStore.unmount(this.scopeSpec);
  }

  get(fieldSpec: BaseSpec): unknown {
    if (this.ownedFields.has(fieldSpec)) {
      return this.formStore.get(fieldSpec);
    }
    if (this.parentScope) {
      return this.parentScope.get(fieldSpec);
    }
    throw new Error(
      `Field ${fieldSpec.id} is not accessible from this scope chain`,
    );
  }

  set(fieldSpec: BaseSpec, value: unknown): void {
    if (!this.ownedFields.has(fieldSpec)) {
      throw new Error(
        `Cannot write to field ${fieldSpec.id}: not owned by this scope`,
      );
    }
    this.formStore.set(fieldSpec, value);
  }

  getError(fieldSpec: BaseSpec): string | null {
    return this.formStore.getError(fieldSpec);
  }

  subscribe(fieldSpec: BaseSpec, listener: () => void): () => void {
    return this.formStore.subscribe(fieldSpec, listener);
  }

  scopeObject(childObjectSpec: ObjectSpec): ScopedStore {
    if (!this.ownedFields.has(childObjectSpec)) {
      throw new Error(
        `Cannot scope object ${childObjectSpec.id}: not owned by this scope`,
      );
    }
    return new ScopedStore(this.formStore, childObjectSpec, this);
  }

  scopeArray(childArraySpec: ArraySpec): ArrayScopedStore {
    if (!this.ownedFields.has(childArraySpec)) {
      throw new Error(
        `Cannot scope array ${childArraySpec.id}: not owned by this scope`,
      );
    }
    if (!_arrayScopedStoreCtor) {
      throw new Error('ArrayScopedStore not registered');
    }
    return new _arrayScopedStoreCtor(this.formStore, childArraySpec, this);
  }
}
