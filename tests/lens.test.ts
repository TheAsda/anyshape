import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Lens } from '../src/lens/index.js';
import type { Lens as LensType } from '../src/lens/index.js';

describe('Lens.prop', () => {
  it('gets a property value', () => {
    const lens = Lens.prop('name');
    assert.equal(lens.get({ name: 'Alice', age: 30 }), 'Alice');
  });

  it('sets a property value immutably', () => {
    const lens = Lens.prop('name');
    const obj = { name: 'Alice', age: 30 };
    const updated = lens.set('Bob', obj);
    assert.deepEqual(updated, { name: 'Bob', age: 30 });
    assert.notEqual(updated, obj);
    assert.equal(updated.age, obj.age);
  });

  it('does not mutate original', () => {
    const lens = Lens.prop('x');
    const obj = { x: 1, y: 2 };
    lens.set(99, obj);
    assert.equal(obj.x, 1);
  });

  it('creates new property if missing', () => {
    const lens = Lens.prop('z');
    const obj: Record<string, unknown> = { x: 1 };
    const updated = lens.set(42, obj);
    assert.equal(updated.z, 42);
    assert.equal(updated.x, 1);
  });
});

describe('Lens.index', () => {
  it('gets an array element', () => {
    const lens = Lens.index(1);
    assert.equal(lens.get(['a', 'b', 'c']), 'b');
  });

  it('sets an array element immutably', () => {
    const lens = Lens.index(1);
    const arr = ['a', 'b', 'c'];
    const updated = lens.set('x', arr);
    assert.deepEqual(updated, ['a', 'x', 'c']);
    assert.notEqual(updated, arr);
  });

  it('returns undefined for out-of-bounds get', () => {
    const lens = Lens.index(5);
    assert.equal(lens.get([1, 2, 3]), undefined);
  });

  it('pads array with undefined for out-of-bounds set', () => {
    const lens = Lens.index(5);
    const arr = [1, 2];
    const updated = lens.set('x', arr);
    assert.equal(updated.length, 6);
    assert.equal(updated[5], 'x');
    assert.equal(updated[0], 1);
    assert.equal(updated[3], undefined);
  });

  it('does not mutate original array', () => {
    const lens = Lens.index(0);
    const arr = [1, 2, 3];
    lens.set(99, arr);
    assert.deepEqual(arr, [1, 2, 3]);
  });
});

describe('Lens.compose', () => {
  it('gets nested property', () => {
    const lens = Lens.compose(Lens.prop('address'), Lens.prop('city'));
    assert.equal(lens.get({ address: { city: 'Boston', zip: '02101' } }), 'Boston');
  });

  it('sets nested property immutably', () => {
    const lens = Lens.compose(Lens.prop('address'), Lens.prop('city'));
    const obj = { address: { city: 'Boston', zip: '02101' }, name: 'Alice' };
    const updated = lens.set('NYC', obj) as typeof obj;
    assert.equal(updated.address.city, 'NYC');
    assert.equal(updated.address.zip, '02101');
    assert.equal(updated.name, 'Alice');
    assert.notEqual(updated, obj);
    assert.notEqual(updated.address, obj.address);
    assert.equal(updated.address.zip, obj.address.zip);
    assert.equal(updated.name, obj.name);
  });

  it('preserves referential equality of unchanged siblings (CRITICAL)', () => {
    const lens = Lens.compose(Lens.prop('address'), Lens.prop('city'));
    const zip = { code: '02101', plus4: '1234' };
    const obj = { address: { city: 'Boston', zip }, name: 'Alice' };
    const updated = lens.set('NYC', obj) as typeof obj;
    assert.strictEqual(updated.address.zip, obj.address.zip);
    assert.strictEqual(updated.name, obj.name);
  });

  it('3-level deep compose works', () => {
    const lens = Lens.compose(
      Lens.compose(Lens.prop('a'), Lens.prop('b')),
      Lens.prop('c'),
    );
    const obj = { a: { b: { c: 42 } } };
    assert.equal(lens.get(obj), 42);
    const updated = lens.set(99, obj) as typeof obj;
    assert.equal(updated.a.b.c, 99);
  });

  it('compose with index', () => {
    const lens = Lens.compose(Lens.prop('items'), Lens.index(0));
    const obj = { items: [10, 20, 30], other: 'x' };
    assert.equal(lens.get(obj), 10);
    const updated = lens.set(99, obj) as typeof obj;
    assert.deepEqual(updated.items, [99, 20, 30]);
    assert.strictEqual(updated.other, obj.other);
  });

  it('set returns same reference when value unchanged', () => {
    const lens = Lens.compose(Lens.prop('a'), Lens.prop('b'));
    const inner = { b: 1, c: 2 };
    const obj = { a: inner };
    const updated = lens.set(1, obj) as typeof obj;
    assert.strictEqual(updated.a.b, obj.a.b);
    assert.strictEqual(updated.a.c, obj.a.c);
  });
});

describe('Lens type export', () => {
  it('Lens type is exported and usable', () => {
    const myLens: LensType<{ x: number }, number> = {
      get: (s) => s.x,
      set: (v, s) => ({ ...s, x: v }),
    };
    assert.equal(myLens.get({ x: 42 }), 42);
    assert.deepEqual(myLens.set(1, { x: 42 }), { x: 1 });
  });
});
