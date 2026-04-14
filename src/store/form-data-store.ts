import { Lens } from '../lens';

type StoreValues = Record<string, unknown>;

export class ObjectStore {
  private store: ValuesStore;
  private parentLens: Lens<StoreValues, unknown>;
  constructor(store: ValuesStore, parentLens: Lens<StoreValues, unknown>) {
    this.store = store;
    this.parentLens = parentLens;
  }

  set<Value>(key: string, value: Value): void {
    const lens = this.parentLens.prop(key);
    this.store.set(lens, value);
  }
  get<Value>(key: string): Value {
    const lens = this.parentLens.prop(key);
    return this.store.get(lens) as Value;
  }
  scopeObject(key: string): ObjectStore {
    const value = this.get(key);
    if (value === undefined) {
      this.set(key, {});
    } else if (typeof value !== 'object' || value === null) {
      throw new Error(`Expected object on key ${key} but got ${typeof value}`);
    }
    const lens = this.parentLens.prop(key);
    return new ObjectStore(this.store, lens);
  }
  scopeArray(key: string): ArrayStore {
    const value = this.get(key);
    if (value === undefined) {
      this.set(key, []);
    } else if (!Array.isArray(value)) {
      throw new Error(`Expected object on key ${key} but got ${typeof value}`);
    } else if (
      !value.every((item) => typeof item === 'object' && item !== null)
    ) {
      throw new Error('Expected every array item to be object');
    }
    const lens = this.parentLens.prop(key);
    return new ArrayStore(this.store, lens);
  }

  destroy() {
    this.store.set(this.parentLens, undefined);
  }
}

export class ArrayStore {
  private store: ValuesStore;
  private parentLens: Lens<StoreValues, unknown>;
  constructor(store: ValuesStore, parentLens: Lens<StoreValues, unknown>) {
    this.store = store;
    this.parentLens = parentLens;
  }

  scopeIndex(n: number): ObjectStore {
    const lens = this.parentLens.index(n);
    const value = this.store.get(lens);
    if (value === undefined) {
      this.store.set(lens, {});
    } else if (typeof value !== 'object' || value === null) {
      throw new Error(`Expected object on index ${n} but got ${typeof value}`);
    }
    return new ObjectStore(this.store, lens);
  }

  destroy() {
    this.store.set(this.parentLens, undefined);
  }
}

export class ValuesStore {
  private values: StoreValues;

  constructor() {
    this.values = {};
  }

  set<Value>(lens: Lens<StoreValues, Value>, value: Value) {
    this.values = lens.set(this.values, value);
  }

  get<Value>(lens: Lens<StoreValues, Value>): Value {
    return lens.get(this.values);
  }

  getValues() {
    return this.values;
  }
}
