import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValuesStore,
  ObjectStore,
  ArrayStore,
} from '../src/store/form-data-store.js';
import { Lens } from '../src/lens/index.js';

describe('ValuesStore', () => {
  it('starts with empty values', () => {
    const store = new ValuesStore();
    assert.deepStrictEqual(store.getValues(), {});
  });

  it('stores and retrieves a value via lens', () => {
    const store = new ValuesStore();
    const lens = new Lens<Record<string, unknown>, string>();
    store.set(lens, 'hello');
    assert.strictEqual(store.get(lens), 'hello');
  });

  it('set is immutable — each set produces new root', () => {
    const store = new ValuesStore();
    const rootLens = new Lens<
      Record<string, unknown>,
      Record<string, unknown>
    >();
    const propLens = rootLens.prop('x');

    store.set(propLens, 'first');
    const afterFirst = store.getValues();

    store.set(propLens, 'second');
    const afterSecond = store.getValues();

    assert.notStrictEqual(afterFirst, afterSecond);
    assert.strictEqual(afterFirst.x, 'first');
    assert.strictEqual(afterSecond.x, 'second');
  });

  it('get on unset key returns undefined', () => {
    const store = new ValuesStore();
    const rootLens = new Lens<
      Record<string, unknown>,
      Record<string, unknown>
    >();
    assert.strictEqual(store.get(rootLens.prop('missing')), undefined);
  });
});

describe('ObjectStore', () => {
  function createRootObjectStore() {
    const store = new ValuesStore();
    const rootLens = new Lens<Record<string, unknown>, unknown>();
    return new ObjectStore(store, rootLens);
  }

  describe('set and get', () => {
    it('stores and retrieves values by key', () => {
      const obj = createRootObjectStore();
      obj.set('name', 'John');
      obj.set('age', 30);
      assert.strictEqual(obj.get('name'), 'John');
      assert.strictEqual(obj.get('age'), 30);
    });
  });

  describe('scopeObject', () => {
    it('auto-creates empty object when key is undefined', () => {
      const obj = createRootObjectStore();
      const scoped = obj.scopeObject('nested');
      assert.deepStrictEqual(obj.get('nested'), {});
      scoped.set('property', 'value');
      assert.strictEqual(scoped.get('property'), 'value');
    });

    it('returns scoped ObjectStore for existing object', () => {
      const obj = createRootObjectStore();
      obj.set('existing', { inner: 'value' });
      const scoped = obj.scopeObject('existing');
      assert.strictEqual(scoped.get('inner'), 'value');
      scoped.set('newProp', 'newVal');
      assert.strictEqual(scoped.get('newProp'), 'newVal');
    });

    it('throws on string value', () => {
      const obj = createRootObjectStore();
      obj.set('str', 'not an object');
      assert.throws(
        () => obj.scopeObject('str'),
        /Expected object on key str but got string/,
      );
    });

    it('throws on null value', () => {
      const obj = createRootObjectStore();
      obj.set('nullable', null);
      assert.throws(
        () => obj.scopeObject('nullable'),
        /Expected object on key nullable/,
      );
    });

    it('throws on number value', () => {
      const obj = createRootObjectStore();
      obj.set('num', 42);
      assert.throws(
        () => obj.scopeObject('num'),
        /Expected object on key num but got number/,
      );
    });
  });

  describe('scopeArray', () => {
    it('auto-creates empty array when key is undefined', () => {
      const obj = createRootObjectStore();
      const arr = obj.scopeArray('items');
      assert.deepStrictEqual(obj.get('items'), []);
    });

    it('returns ArrayStore for existing valid array', () => {
      const obj = createRootObjectStore();
      obj.set('items', [{ name: 'a' }, { name: 'b' }]);
      const arr = obj.scopeArray('items');
      assert.strictEqual(arr.scopeIndex(0).get('name'), 'a');
      assert.strictEqual(arr.scopeIndex(1).get('name'), 'b');
    });

    it('throws on non-array value', () => {
      const obj = createRootObjectStore();
      obj.set('notArr', 'string');
      assert.throws(
        () => obj.scopeArray('notArr'),
        /Expected object on key notArr but got string/,
      );
    });

    it('throws when array contains non-object items', () => {
      const obj = createRootObjectStore();
      obj.set('mixed', ['string', { ok: true }]);
      assert.throws(
        () => obj.scopeArray('mixed'),
        /Expected every array item to be object/,
      );
    });

    it('throws when array contains null items', () => {
      const obj = createRootObjectStore();
      obj.set('withNull', [{ ok: true }, null]);
      assert.throws(
        () => obj.scopeArray('withNull'),
        /Expected every array item to be object/,
      );
    });
  });
});

describe('ArrayStore', () => {
  it('scopeIndex auto-creates empty object at new index', () => {
    const store = new ValuesStore();
    const rootLens = new Lens<Record<string, unknown>, unknown>();
    const obj = new ObjectStore(store, rootLens);
    const arr = obj.scopeArray('items');

    const scoped = arr.scopeIndex(0);
    scoped.set('name', 'first');
    assert.strictEqual(scoped.get('name'), 'first');
  });

  it('scopeIndex returns ObjectStore for existing object', () => {
    const store = new ValuesStore();
    const rootLens = new Lens<Record<string, unknown>, unknown>();
    const obj = new ObjectStore(store, rootLens);
    obj.set('items', [{ existing: 'value' }]);
    const arr = obj.scopeArray('items');

    const scoped = arr.scopeIndex(0);
    assert.strictEqual(scoped.get('existing'), 'value');
    scoped.set('added', true);
    assert.strictEqual(scoped.get('added'), true);
  });

  it('scopeIndex throws on string element', () => {
    const store = new ValuesStore();
    const rootLens = new Lens<Record<string, unknown>, unknown>();
    // Manually set array with string — bypass scopeArray validation
    const arrLens = rootLens.prop('arr');
    store.set(arrLens, ['not-object']);
    const arr = new ArrayStore(store, arrLens);

    assert.throws(
      () => arr.scopeIndex(0),
      /Expected object on index 0 but got string/,
    );
  });

  it('scopeIndex throws on null element', () => {
    const store = new ValuesStore();
    const rootLens = new Lens<Record<string, unknown>, unknown>();
    const obj = new ObjectStore(store, rootLens);
    // Manually set array with null — bypass scopeArray validation
    const arrLens = rootLens.prop('arr');
    store.set(arrLens, [null]);
    const arr = new ArrayStore(store, arrLens);

    assert.throws(() => arr.scopeIndex(0), /Expected object on index 0/);
  });

  it('scopeIndex throws on number element', () => {
    const store = new ValuesStore();
    const rootLens = new Lens<Record<string, unknown>, unknown>();
    const obj = new ObjectStore(store, rootLens);
    // Manually set array with number — bypass scopeArray validation
    const arrLens = rootLens.prop('arr');
    store.set(arrLens, [42]);
    const arr = new ArrayStore(store, arrLens);

    assert.throws(
      () => arr.scopeIndex(0),
      /Expected object on index 0 but got number/,
    );
  });
});

describe('Integration (nested scoping)', () => {
  it('object → array → index → object round-trip', () => {
    const store = new ValuesStore();
    const rootLens = new Lens<Record<string, unknown>, unknown>();
    const obj = new ObjectStore(store, rootLens);

    const users = obj.scopeArray('users');
    const first = users.scopeIndex(0);
    const profile = first.scopeObject('profile');

    profile.set('name', 'John');
    profile.set('age', 30);

    assert.strictEqual(profile.get('name'), 'John');
    assert.strictEqual(profile.get('age'), 30);

    const usersLens = rootLens.prop('users');
    assert.deepStrictEqual(store.get(usersLens), [
      { profile: { name: 'John', age: 30 } },
    ]);
  });

  it('deeply nested object → object → array → index', () => {
    const store = new ValuesStore();
    const rootLens = new Lens<Record<string, unknown>, unknown>();
    const root = new ObjectStore(store, rootLens);

    const company = root.scopeObject('company');
    company.set('name', 'Tech Corp');

    const employees = company.scopeArray('employees');
    employees.scopeIndex(0).set('name', 'Alice');
    employees.scopeIndex(1).set('name', 'Bob');

    const details = employees.scopeIndex(0).scopeObject('details');
    details.set('position', 'Engineer');
    details.set('level', 'Senior');

    assert.strictEqual(details.get('position'), 'Engineer');
    assert.strictEqual(details.get('level'), 'Senior');
    assert.strictEqual(employees.scopeIndex(0).get('name'), 'Alice');
    assert.strictEqual(employees.scopeIndex(1).get('name'), 'Bob');
    assert.strictEqual(company.get('name'), 'Tech Corp');
  });
});
