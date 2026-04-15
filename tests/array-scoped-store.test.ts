import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { field, object, array, form } from '../src/specs/factories.js';
import { FormStore } from '../src/store/form-store.js';
import { ScopedStore } from '../src/store/scoped-store.js';
import { ArrayScopedStore } from '../src/store/array-scoped-store.js';

function setupArrayStore() {
  const nameSpec = field<string>({ defaultValue: '' });
  const ageSpec = field<number>({ defaultValue: 0 });
  const itemSpec = object({ name: nameSpec, age: ageSpec });
  const itemsSpec = array(itemSpec);
  const spec = form({ items: itemsSpec });
  const store = new FormStore(spec);
  const rootScope = new ScopedStore(store, spec, null);
  const arrayScope = rootScope.scopeArray(itemsSpec);
  return { store, arrayScope, nameSpec, ageSpec, itemSpec, itemsSpec, spec };
}

describe('ArrayScopedStore — append creates item with stable ID and field defaults', () => {
  it('appends an item and returns its stable ID', () => {
    const { arrayScope } = setupArrayStore();

    const id = arrayScope.append();

    assert.match(id, /^item_\d+$/);
    assert.equal(arrayScope.getItems().length, 1);
    assert.equal(arrayScope.getItems()[0].id, id);
  });

  it('appended item uses field defaults', () => {
    const { store, arrayScope, nameSpec, itemsSpec } = setupArrayStore();

    const id = arrayScope.append();

    const data = store.getArrayData(itemsSpec) as Record<string, unknown>[];
    assert.equal(data.length, 1);
    assert.equal(data[0].name, '');
    assert.equal(data[0].age, 0);

    assert.equal(store.get(nameSpec, { itemId: id }), '');
  });

  it('append with explicit data works', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const ageSpec = field<number>({ defaultValue: 0 });
    const itemSpec = object({ name: nameSpec, age: ageSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id = arrayScope.append({ name: 'Bob', age: 25 });

    assert.equal(store.get(nameSpec, { itemId: id }), 'Bob');
    assert.equal(store.get(ageSpec, { itemId: id }), 25);
  });
});

describe('ArrayScopedStore — append 3 items', () => {
  it('each item has unique ID and correct data', () => {
    const { store, arrayScope, nameSpec, ageSpec, itemsSpec } = setupArrayStore();

    const id1 = arrayScope.append({ name: 'Alice', age: 30 });
    const id2 = arrayScope.append({ name: 'Bob', age: 25 });
    const id3 = arrayScope.append({ name: 'Charlie', age: 35 });

    const items = arrayScope.getItems();
    assert.equal(items.length, 3);
    assert.notEqual(id1, id2);
    assert.notEqual(id2, id3);
    assert.notEqual(id1, id3);

    assert.equal(store.get(nameSpec, { itemId: id1 }), 'Alice');
    assert.equal(store.get(nameSpec, { itemId: id2 }), 'Bob');
    assert.equal(store.get(nameSpec, { itemId: id3 }), 'Charlie');

    assert.equal(store.get(ageSpec, { itemId: id1 }), 30);
    assert.equal(store.get(ageSpec, { itemId: id2 }), 25);
    assert.equal(store.get(ageSpec, { itemId: id3 }), 35);

    const data = store.getArrayData(itemsSpec) as Record<string, unknown>[];
    assert.equal(data.length, 3);
    assert.equal(data[0].name, 'Alice');
    assert.equal(data[1].name, 'Bob');
    assert.equal(data[2].name, 'Charlie');
  });
});

describe('ArrayScopedStore — remove item by ID and reindex', () => {
  it('removes middle item and reindexes', () => {
    const { store, arrayScope, nameSpec, itemsSpec } = setupArrayStore();

    const id1 = arrayScope.append({ name: 'Alice', age: 30 });
    const id2 = arrayScope.append({ name: 'Bob', age: 25 });
    const id3 = arrayScope.append({ name: 'Charlie', age: 35 });

    arrayScope.remove(id2);

    const items = arrayScope.getItems();
    assert.equal(items.length, 2);
    assert.equal(items[0].id, id1);
    assert.equal(items[0].index, 0);
    assert.equal(items[1].id, id3);
    assert.equal(items[1].index, 1);

    const data = store.getArrayData(itemsSpec) as Record<string, unknown>[];
    assert.equal(data.length, 2);
    assert.equal(data[0].name, 'Alice');
    assert.equal(data[1].name, 'Charlie');

    assert.equal(store.get(nameSpec, { itemId: id1 }), 'Alice');
    assert.equal(store.get(nameSpec, { itemId: id3 }), 'Charlie');
  });

  it('removes first item', () => {
    const { arrayScope } = setupArrayStore();

    const id1 = arrayScope.append({ name: 'Alice', age: 30 });
    const id2 = arrayScope.append({ name: 'Bob', age: 25 });

    arrayScope.remove(id1);

    const items = arrayScope.getItems();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, id2);
    assert.equal(items[0].index, 0);
  });

  it('removes non-existent ID does nothing', () => {
    const { arrayScope } = setupArrayStore();

    arrayScope.append({ name: 'Alice', age: 30 });
    arrayScope.remove('item_nonexistent');

    assert.equal(arrayScope.getItems().length, 1);
  });
});

describe('ArrayScopedStore — reorder items', () => {
  it('moves item from index 0 to index 2', () => {
    const { store, arrayScope, nameSpec, itemsSpec } = setupArrayStore();

    const id1 = arrayScope.append({ name: 'Alice', age: 30 });
    const id2 = arrayScope.append({ name: 'Bob', age: 25 });
    const id3 = arrayScope.append({ name: 'Charlie', age: 35 });

    arrayScope.reorder(0, 2);

    const data = store.getArrayData(itemsSpec) as Record<string, unknown>[];
    assert.equal(data[0].name, 'Bob');
    assert.equal(data[1].name, 'Charlie');
    assert.equal(data[2].name, 'Alice');

    const items = arrayScope.getItems();
    assert.equal(items[0].id, id2);
    assert.equal(items[0].index, 0);
    assert.equal(items[1].id, id3);
    assert.equal(items[1].index, 1);
    assert.equal(items[2].id, id1);
    assert.equal(items[2].index, 2);

    assert.equal(store.get(nameSpec, { itemId: id1 }), 'Alice');
    assert.equal(store.get(nameSpec, { itemId: id2 }), 'Bob');
    assert.equal(store.get(nameSpec, { itemId: id3 }), 'Charlie');
  });

  it('moves item from index 2 to index 0', () => {
    const { store, arrayScope, itemsSpec } = setupArrayStore();

    arrayScope.append({ name: 'Alice', age: 30 });
    arrayScope.append({ name: 'Bob', age: 25 });
    const id3 = arrayScope.append({ name: 'Charlie', age: 35 });

    arrayScope.reorder(2, 0);

    const data = store.getArrayData(itemsSpec) as Record<string, unknown>[];
    assert.equal(data[0].name, 'Charlie');
    assert.equal(data[1].name, 'Alice');
    assert.equal(data[2].name, 'Bob');

    const items = arrayScope.getItems();
    assert.equal(items[0].id, id3);
    assert.equal(items[0].index, 0);
  });
});

describe('ArrayScopedStore — getItemScope returns ScopedStore for array item', () => {
  it('item scope reads owned fields with itemId', () => {
    const { arrayScope, nameSpec, ageSpec } = setupArrayStore();

    const id = arrayScope.append({ name: 'Alice', age: 30 });
    const itemScope = arrayScope.getItemScope(id);

    assert.equal(itemScope.get(nameSpec), 'Alice');
    assert.equal(itemScope.get(ageSpec), 30);
  });

  it('item scope writes owned fields with itemId', () => {
    const { store, arrayScope, nameSpec } = setupArrayStore();

    const id = arrayScope.append({ name: 'Alice', age: 30 });
    const itemScope = arrayScope.getItemScope(id);

    itemScope.set(nameSpec, 'Bob');

    assert.equal(store.get(nameSpec, { itemId: id }), 'Bob');
  });

  it('item scope reads ancestor fields via bubble', () => {
    const rootField = field<string>({ defaultValue: 'root-value' });
    const nameSpec = field<string>({ defaultValue: '' });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ rootField, items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id = arrayScope.append({ name: 'Alice' });
    const itemScope = arrayScope.getItemScope(id);

    assert.equal(itemScope.get(rootField), 'root-value');
  });

  it('getItemScope throws for non-existent itemId', () => {
    const { arrayScope } = setupArrayStore();

    arrayScope.append({ name: 'Alice', age: 30 });

    assert.throws(
      () => arrayScope.getItemScope('item_nonexistent'),
      /No item with id/,
    );
  });
});

describe('ArrayScopedStore — per-item field validation works', () => {
  it('validateItemField validates a single field for an item', () => {
    const nameSpec = field<string>({
      schema: z.string().min(1, 'Name is required'),
    });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id = arrayScope.append({ name: '' });

    const result = arrayScope.validateItemField(id, nameSpec);
    assert.equal(result.success, false);
    assert.equal(result.error, 'Name is required');
  });

  it('validateItem validates all fields for an item', () => {
    const nameSpec = field<string>({
      schema: z.string().min(1, 'Name is required'),
    });
    const ageSpec = field<number>({
      schema: z.number().min(0, 'Age must be positive'),
    });
    const itemSpec = object({ name: nameSpec, age: ageSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id1 = arrayScope.append({ name: '', age: -1 });
    const id2 = arrayScope.append({ name: 'Alice', age: 30 });

    const result1 = arrayScope.validateItem(id1);
    assert.equal(result1.success, false);

    const result2 = arrayScope.validateItem(id2);
    assert.equal(result2.success, true);
  });

  it('validateItemField passes for valid data', () => {
    const nameSpec = field<string>({
      schema: z.string().min(1, 'Name is required'),
    });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id = arrayScope.append({ name: 'Alice' });

    const result = arrayScope.validateItemField(id, nameSpec);
    assert.equal(result.success, true);
    assert.equal(result.error, null);
  });

  it('validateArray validates all items', () => {
    const nameSpec = field<string>({
      schema: z.string().min(1, 'Name is required'),
    });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id1 = arrayScope.append({ name: '' });
    const id2 = arrayScope.append({ name: 'Alice' });

    const result = arrayScope.validateArray();
    assert.equal(result.success, false);

    const nameErrors = result.errors.get(nameSpec);
    assert.equal(nameErrors?.get(id1), 'Name is required');
    assert.equal(nameErrors?.get(id2), null);
  });

  it('getItemFieldError returns error for validated field', () => {
    const nameSpec = field<string>({
      schema: z.string().min(1, 'Name is required'),
    });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id = arrayScope.append({ name: '' });

    assert.equal(arrayScope.getItemFieldError(id, nameSpec), null);

    arrayScope.validateItemField(id, nameSpec);
    assert.equal(arrayScope.getItemFieldError(id, nameSpec), 'Name is required');
  });
});

describe('ArrayScopedStore — clear removes all items', () => {
  it('clear empties the array', () => {
    const { store, arrayScope, itemsSpec } = setupArrayStore();

    arrayScope.append({ name: 'Alice', age: 30 });
    arrayScope.append({ name: 'Bob', age: 25 });

    arrayScope.clear();

    assert.equal(arrayScope.getItems().length, 0);
    const data = store.getArrayData(itemsSpec) as unknown[];
    assert.equal(data.length, 0);
  });
});

describe('ArrayScopedStore — upsert updates existing or appends new', () => {
  it('upsert updates existing item', () => {
    const { store, arrayScope, nameSpec, itemsSpec } = setupArrayStore();

    const id = arrayScope.append({ name: 'Alice', age: 30 });

    const returnedId = arrayScope.upsert(id, { name: 'Bob' });

    assert.equal(returnedId, id);
    assert.equal(store.get(nameSpec, { itemId: id }), 'Bob');

    const data = store.getArrayData(itemsSpec) as Record<string, unknown>[];
    assert.equal(data.length, 1);
    assert.equal(data[0].name, 'Bob');
    assert.equal(data[0].age, 30);
  });

  it('upsert appends when ID not found', () => {
    const { arrayScope } = setupArrayStore();

    arrayScope.append({ name: 'Alice', age: 30 });

    const newId = arrayScope.upsert('item_999', { name: 'New', age: 40 });

    assert.equal(arrayScope.getItems().length, 2);
    assert.equal(arrayScope.getItems()[1].id, newId);
    assert.match(newId, /^item_\d+$/);
  });
});

describe('ArrayScopedStore — append falls through to Zod default', () => {
  it('uses Zod default when no spec default', () => {
    const nameSpec = field<string>({ schema: z.string().default('zod-default') });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id = arrayScope.append();

    assert.equal(store.get(nameSpec, { itemId: id }), 'zod-default');
  });
});

describe('ArrayScopedStore — remove cleans up per-item metadata', () => {
  it('remove clears errors for removed item', () => {
    const nameSpec = field<string>({
      schema: z.string().min(1, 'Name is required'),
    });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id = arrayScope.append({ name: '' });
    arrayScope.validateItemField(id, nameSpec);
    assert.equal(arrayScope.getItemFieldError(id, nameSpec), 'Name is required');

    arrayScope.remove(id);

    assert.equal(arrayScope.getItemFieldError(id, nameSpec), null);
  });
});

describe('ArrayScopedStore — 2+ items produce correct values (index(0) bug verified fixed)', () => {
  it('second item values are independent from first', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const ageSpec = field<number>({ defaultValue: 0 });
    const itemSpec = object({ name: nameSpec, age: ageSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id1 = arrayScope.append({ name: 'First', age: 1 });
    const id2 = arrayScope.append({ name: 'Second', age: 2 });

    assert.equal(store.get(nameSpec, { itemId: id1 }), 'First');
    assert.equal(store.get(ageSpec, { itemId: id1 }), 1);
    assert.equal(store.get(nameSpec, { itemId: id2 }), 'Second');
    assert.equal(store.get(ageSpec, { itemId: id2 }), 2);

    assert.notEqual(
      store.get(nameSpec, { itemId: id1 }),
      store.get(nameSpec, { itemId: id2 }),
    );
  });

  it('writing to item scope only affects that item', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id1 = arrayScope.append({ name: 'First' });
    const id2 = arrayScope.append({ name: 'Second' });

    const scope1 = arrayScope.getItemScope(id1);
    scope1.set(nameSpec, 'Updated');

    assert.equal(store.get(nameSpec, { itemId: id1 }), 'Updated');
    assert.equal(store.get(nameSpec, { itemId: id2 }), 'Second');
  });
});

describe('ArrayScopedStore — scopeArray from ScopedStore', () => {
  it('scopeArray returns ArrayScopedStore', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    const arrayScope = rootScope.scopeArray(itemsSpec);

    assert.ok(arrayScope instanceof ArrayScopedStore);
  });

  it('scopeArray throws for non-owned spec', () => {
    const nameSpec = field<string>();
    const otherArraySpec = array(object({ name: field<string>() }));
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    assert.throws(
      () => rootScope.scopeArray(otherArraySpec),
      /not owned by this scope/,
    );
  });
});

describe('ArrayScopedStore — item scope getError delegates with itemId', () => {
  it('item scope getError returns per-item validation error', () => {
    const nameSpec = field<string>({
      schema: z.string().min(1, 'Required'),
    });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id1 = arrayScope.append({ name: '' });
    const id2 = arrayScope.append({ name: 'Valid' });

    arrayScope.validateItemField(id1, nameSpec);
    arrayScope.validateItemField(id2, nameSpec);

    const scope1 = arrayScope.getItemScope(id1);
    const scope2 = arrayScope.getItemScope(id2);

    assert.equal(scope1.getError(nameSpec), 'Required');
    assert.equal(scope2.getError(nameSpec), null);
  });
});

describe('ArrayScopedStore — works with initialData', () => {
  it('can append to array created from initialData', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec, {
      items: [{ name: 'Init1' }, { name: 'Init2' }],
    });
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    assert.equal(arrayScope.getItems().length, 2);

    const id3 = arrayScope.append({ name: 'Appended' });

    const items = arrayScope.getItems();
    assert.equal(items.length, 3);

    const initItems = items.slice(0, 2);
    for (const item of initItems) {
      assert.match(item.id, /^item_\d+$/);
    }

    assert.equal(store.get(nameSpec, { itemId: id3 }), 'Appended');
  });

  it('can remove item from initialData array', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec, {
      items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    });
    const rootScope = new ScopedStore(store, spec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const items = arrayScope.getItems();
    const idB = items[1].id;

    arrayScope.remove(idB);

    const remaining = arrayScope.getItems();
    assert.equal(remaining.length, 2);
    assert.equal(remaining[0].index, 0);
    assert.equal(remaining[1].index, 1);
  });
});
