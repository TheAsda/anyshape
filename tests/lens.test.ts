import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Lens, LensImpl } from '../src/lens/index.js';
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

  it('returns same reference when setting same value', () => {
    const lens = Lens.prop('name');
    const obj = { name: 'Alice', age: 30 };
    const updated = lens.set('Alice', obj);
    assert.strictEqual(updated, obj);
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

  it('returns same reference when setting same value', () => {
    const lens = Lens.index(0);
    const arr = [10, 20];
    const updated = lens.set(10, arr);
    assert.strictEqual(updated, arr);
  });
});

describe('Lens.compose', () => {
  it('gets nested property', () => {
    const lens = Lens.compose(Lens.prop('address'), Lens.prop('city'));
    assert.equal(
      lens.get({ address: { city: 'Boston', zip: '02101' } }),
      'Boston',
    );
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
    assert.strictEqual(updated.address.zip, obj.address.zip);
    assert.strictEqual(updated.name, obj.name);
  });

  it('preserves referential equality of unchanged siblings', () => {
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

  it('returns same reference when value unchanged', () => {
    const lens = Lens.compose(Lens.prop('a'), Lens.prop('b'));
    const inner = { b: 1, c: 2 };
    const obj = { a: inner };
    const updated = lens.set(1, obj) as typeof obj;
    assert.strictEqual(updated, obj);
    assert.strictEqual(updated.a, obj.a);
    assert.strictEqual(updated.a.b, obj.a.b);
    assert.strictEqual(updated.a.c, obj.a.c);
  });

  it('compose prop → index → prop (deep mixed nesting)', () => {
    const lens = Lens.compose(
      Lens.compose(Lens.prop('users'), Lens.index(1)),
      Lens.prop('name'),
    );
    const obj = {
      users: [
        { name: 'Alice' },
        { name: 'Bob', age: 25 },
        { name: 'Carol' },
      ],
    };
    assert.equal(lens.get(obj), 'Bob');
    const updated = lens.set('Dave', obj) as typeof obj;
    assert.equal(updated.users[1].name, 'Dave');
    assert.equal(updated.users[1].age, 25);
    assert.equal(updated.users[0].name, 'Alice');
    assert.equal(updated.users[2].name, 'Carol');
    assert.strictEqual(updated.users[0], obj.users[0]);
    assert.strictEqual(updated.users[2], obj.users[2]);
  });
});

describe('Lens chaining (instance methods)', () => {
  it('prop().prop() chains for nested access', () => {
    const lens = Lens.prop('a').prop('b');
    assert.equal(lens.get({ a: { b: 42 } }), 42);
    const updated = lens.set(99, { a: { b: 42, c: 1 } });
    assert.deepEqual(updated, { a: { b: 99, c: 1 } });
  });

  it('prop().index() chains for array-in-object access', () => {
    const lens = Lens.prop('items').index(0);
    assert.equal(lens.get({ items: [10, 20] }), 10);
    const updated = lens.set(99, { items: [10, 20], tag: 'x' });
    assert.deepEqual(updated, { items: [99, 20], tag: 'x' });
  });

  it('prop().index().prop() chains for deep mixed access', () => {
    const lens = Lens.prop('users').index(0).prop('name');
    const obj = { users: [{ name: 'Alice', age: 30 }], meta: 'test' };
    assert.equal(lens.get(obj), 'Alice');
    const updated = lens.set('Bob', obj);
    assert.deepEqual(
      (updated as Record<string, unknown>).users,
      [{ name: 'Bob', age: 30 }],
    );
    assert.strictEqual(
      (updated as Record<string, unknown>).meta,
      (obj as Record<string, unknown>).meta,
    );
  });

  it('chaining preserves structural sharing', () => {
    const lens = Lens.prop('a').prop('b');
    const sharedRef = { x: 1 };
    const obj = { a: { b: 'old', c: sharedRef }, d: sharedRef };
    const updated = lens.set('new', obj);
    assert.strictEqual(
      (updated as Record<string, unknown>).d,
      obj.d,
    );
  });
});

describe('Lens.identity', () => {
  it('get returns source as-is', () => {
    const lens = Lens.identity<{ x: number }>();
    const obj = { x: 42 };
    assert.strictEqual(lens.get(obj), obj);
  });

  it('set replaces source with value', () => {
    const lens = Lens.identity<{ x: number }>();
    const obj = { x: 42 };
    const newVal = { x: 99 };
    assert.strictEqual(lens.set(newVal, obj), newVal);
  });

  it('identity.prop() chains to focus on a field', () => {
    const lens = Lens.identity<Record<string, unknown>>().prop('name');
    assert.equal(lens.get({ name: 'Alice' }), 'Alice');
    assert.deepEqual(lens.set('Bob', { name: 'Alice', age: 30 }), {
      name: 'Bob',
      age: 30,
    });
  });

  it('identity.prop().index().prop() for deep root-based chaining', () => {
    const lens = Lens.identity<Record<string, unknown>>()
      .prop('items')
      .index(0)
      .prop('value');
    const obj = { items: [{ value: 10 }, { value: 20 }] };
    assert.equal(lens.get(obj), 10);
    const updated = lens.set(99, obj);
    assert.deepEqual((updated as Record<string, unknown>).items, [
      { value: 99 },
      { value: 20 },
    ]);
  });
});

describe('Lens type export', () => {
  it('Lens type is exported and usable as structural type', () => {
    const myLens: LensType<{ x: number }, number> = {
      get: (s) => s.x,
      set: (v, s) => ({ ...s, x: v }),
    };
    assert.equal(myLens.get({ x: 42 }), 42);
    assert.deepEqual(myLens.set(1, { x: 42 }), { x: 1 });
  });

  it('structural Lens works with Lens.compose', () => {
    const propX: LensType<{ x: number }, number> = {
      get: (s) => s.x,
      set: (v, s) => ({ ...s, x: v }),
    };
    const doubled: LensType<number, number> = {
      get: (s) => s * 2,
      set: (v, _s) => v / 2,
    };
    const composed = Lens.compose(propX, doubled);
    assert.equal(composed.get({ x: 5 }), 10);
    assert.equal(composed.set(20, { x: 5 }).x, 10);
  });
});

describe('LensImpl export', () => {
  it('LensImpl is exported and usable for typed chaining variables', () => {
    const root: LensImpl<Record<string, unknown>, unknown> =
      Lens.identity<Record<string, unknown>>();
    const child = root.prop('name');
    assert.equal(child.get({ name: 'test' }), 'test');
  });
});
