import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FormStore } from '../src/store/form-store.js';
import { field, object, array, form } from '../src/specs/factories.js';
import { FieldSpec } from '../src/specs/field.js';
import { ObjectSpec } from '../src/specs/object.js';
import { ArraySpec } from '../src/specs/array.js';
import { z } from 'zod';

describe('Construction with initialData', () => {
  it('populates values from initialData', () => {
    const nameSpec = field<string>();
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ name: nameSpec, address: addressSpec });

    const store = new FormStore(spec, {
      name: 'Alice',
      address: { city: 'Boston' },
    });

    assert.equal(store.get(nameSpec), 'Alice');
    assert.equal(store.get(citySpec), 'Boston');
  });

  it('getValues returns the full root object', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });

    const store = new FormStore(spec, { name: 'Bob' });

    const vals = store.getValues();
    assert.equal(vals.name, 'Bob');
  });
});

describe('Set updates value immutably', () => {
  it('set returns new root with updated value', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec, { name: 'A' });

    const before = store.getValues();
    store.set(nameSpec, 'B');

    assert.equal(store.get(nameSpec), 'B');
    assert.notEqual(store.getValues(), before);
  });

  it('set preserves sibling referential equality', () => {
    const nameSpec = field<string>();
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ name: nameSpec, address: addressSpec });

    const store = new FormStore(spec, {
      name: 'A',
      address: { city: 'X' },
    });

    const addressRef = store.getValues().address;
    store.set(nameSpec, 'B');

    assert.strictEqual(store.getValues().address, addressRef);
  });

  it('set on nested field preserves sibling fields', () => {
    const citySpec = field<string>();
    const zipSpec = field<string>();
    const addressSpec = object({ city: citySpec, zip: zipSpec });
    const spec = form({ address: addressSpec });

    const store = new FormStore(spec, {
      address: { city: 'X', zip: 'Z' },
    });

    store.set(citySpec, 'Chicago');

    assert.equal(store.get(citySpec), 'Chicago');
    assert.equal(store.get(zipSpec), 'Z');
  });

  it('set with noTouch skips touched marking', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    store.set(nameSpec, 'X', { noTouch: true });
    assert.equal(store.isTouched(nameSpec), false);

    store.set(nameSpec, 'Y');
    assert.equal(store.isTouched(nameSpec), true);
  });
});

describe('Full reset', () => {
  it('restores initial values', () => {
    const nameSpec = field<string>();
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ name: nameSpec, address: addressSpec });

    const store = new FormStore(spec, {
      name: 'A',
      address: { city: 'X' },
    });

    store.set(nameSpec, 'B');
    store.set(citySpec, 'Y');
    store.reset();

    assert.equal(store.get(nameSpec), 'A');
    assert.equal(store.get(citySpec), 'X');
  });

  it('clears touched state', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    store.set(nameSpec, 'X');
    assert.equal(store.isTouched(nameSpec), true);

    store.reset();
    assert.equal(store.isTouched(nameSpec), false);
  });
});

describe('Subtree reset', () => {
  it('only affects the target spec subtree', () => {
    const nameSpec = field<string>();
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ name: nameSpec, address: addressSpec });

    const store = new FormStore(spec, {
      name: 'A',
      address: { city: 'X' },
    });

    store.set(citySpec, 'Y');
    store.set(nameSpec, 'B');
    store.reset(addressSpec);

    assert.equal(store.get(citySpec), 'X');
    assert.equal(store.get(nameSpec), 'B');
  });

  it('clears touched for descendants only', () => {
    const nameSpec = field<string>();
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ name: nameSpec, address: addressSpec });

    const store = new FormStore(spec, {
      name: 'A',
      address: { city: 'X' },
    });

    store.set(citySpec, 'Y');
    store.set(nameSpec, 'B');

    store.reset(addressSpec);

    assert.equal(store.isTouched(citySpec), false);
    assert.equal(store.isTouched(nameSpec), true);
  });
});

describe('Default chain — spec default (#5)', () => {
  it('uses spec defaultValue when no initialData', () => {
    const greetingSpec = field<string>({ defaultValue: 'hello' });
    const spec = form({ greeting: greetingSpec });
    const store = new FormStore(spec);

    assert.equal(store.get(greetingSpec), 'hello');
  });

  it('undefined for fields without any default', () => {
    const emptySpec = field<string>();
    const spec = form({ empty: emptySpec });
    const store = new FormStore(spec);

    assert.equal(store.get(emptySpec), undefined);
  });
});

describe('Default chain — Zod default (#6)', () => {
  it('uses Zod schema default as fallback', () => {
    const emailSpec = field<string>({ schema: z.string().default('zod@email.com') });
    const spec = form({ email: emailSpec });
    const store = new FormStore(spec);

    assert.equal(store.get(emailSpec), 'zod@email.com');
  });
});

describe('Default chain — spec default beats Zod default (#5 > #6)', () => {
  it('spec defaultValue takes precedence over Zod default', () => {
    const nameSpec = field<string>({
      defaultValue: 'from-spec',
      schema: z.string().default('from-zod'),
    });
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    assert.equal(store.get(nameSpec), 'from-spec');
  });
});

describe('Default chain — parent ObjectSpec default (#4)', () => {
  it('parent defaultValue fills children without own defaults', () => {
    const citySpec = field<string>();
    const zipSpec = field<string>();
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: 'parent-city', zip: '00000' } },
    );
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);

    assert.equal(store.get(citySpec), 'parent-city');
    assert.equal(store.get(zipSpec), '00000');
  });

  it('child own default overrides parent default', () => {
    const citySpec = field<string>({ defaultValue: 'NYC' });
    const zipSpec = field<string>();
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: 'parent-city', zip: '00000' } },
    );
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);

    assert.equal(store.get(citySpec), 'NYC');
    assert.equal(store.get(zipSpec), '00000');
  });
});

describe('Default chain — initialData (#1) overrides all', () => {
  it('initialData takes precedence over all defaults', () => {
    const nameSpec = field<string>({ defaultValue: 'spec-default' });
    const emailSpec = field<string>({
      schema: z.string().default('zod-default'),
    });
    const spec = form({ name: nameSpec, email: emailSpec });

    const store = new FormStore(spec, { name: 'from-init' });

    assert.equal(store.get(nameSpec), 'from-init');
    assert.equal(store.get(emailSpec), 'zod-default');
  });

  it('initialData overrides parent ObjectSpec default', () => {
    const citySpec = field<string>();
    const zipSpec = field<string>();
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: 'parent-city', zip: '00000' } },
    );
    const spec = form({ address: addressSpec });

    const store = new FormStore(spec, {
      address: { city: 'from-init' },
    });

    assert.equal(store.get(citySpec), 'from-init');
    assert.equal(store.get(zipSpec), '00000');
  });
});

describe('Eager pre-fill', () => {
  it('populates mountRequired specs at construction', () => {
    const nameSpec = field<string>({ defaultValue: 'hello' });
    const emailSpec = field<string>({
      schema: z.string().default('a@b.com'),
    });
    const spec = form({ name: nameSpec, email: emailSpec });
    const store = new FormStore(spec);

    const vals = store.getValues();
    assert.equal(vals.name, 'hello');
    assert.equal(vals.email, 'a@b.com');
  });

  it('populates nested objects from parent default', () => {
    const citySpec = field<string>();
    const zipSpec = field<string>();
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: 'LA', zip: '90001' } },
    );
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);

    const vals = store.getValues();
    assert.deepEqual(vals.address, { city: 'LA', zip: '90001' });
  });
});

describe('mountRequired: false', () => {
  it('field with mountRequired:false is NOT pre-filled', () => {
    const visibleSpec = field<string>({ defaultValue: 'visible' });
    const hiddenSpec = field<string>({
      defaultValue: 'hidden',
      mountRequired: false,
    });
    const spec = form({ visible: visibleSpec, hidden: hiddenSpec });
    const store = new FormStore(spec);

    assert.equal(store.get(visibleSpec), 'visible');
    assert.equal(store.get(hiddenSpec), undefined);

    const vals = store.getValues();
    assert.equal(vals.visible, 'visible');
    assert.equal(('hidden' in vals), false);
  });

  it('ObjectSpec with mountRequired:false skips entire subtree', () => {
    const nameSpec = field<string>({ defaultValue: 'hello' });
    const innerSpec = field<string>({ defaultValue: 'inner' });
    const nestedSpec = object(
      { inner: innerSpec },
      { mountRequired: false },
    );
    const spec = form({ name: nameSpec, nested: nestedSpec });
    const store = new FormStore(spec);

    assert.equal(store.get(nameSpec), 'hello');
    assert.equal(store.get(nestedSpec), undefined);

    const vals = store.getValues();
    assert.equal(('nested' in vals), false);
  });
});

describe('Array pre-fill', () => {
  it('creates items with stable IDs from defaultValue', () => {
    const itemNameSpec = field<string>();
    const itemSpec = object({ name: itemNameSpec });
    const itemsSpec = array(itemSpec, {
      defaultValue: [{ name: 'Apple' }, { name: 'Banana' }],
    });
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);

    const state = store.getArrayState(itemsSpec);
    assert.ok(state);
    assert.equal(state!.items.length, 2);
    assert.ok(state!.items[0].id);
    assert.ok(state!.items[1].id);
    assert.notEqual(state!.items[0].id, state!.items[1].id);
    assert.equal(state!.items[0].index, 0);
    assert.equal(state!.items[1].index, 1);
  });

  it('populates array values from defaultValue', () => {
    const itemNameSpec = field<string>();
    const itemSpec = object({ name: itemNameSpec });
    const itemsSpec = array(itemSpec, {
      defaultValue: [{ name: 'Apple' }, { name: 'Banana' }],
    });
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);

    const vals = store.getValues();
    assert.ok(Array.isArray(vals.items));
    assert.equal(vals.items!.length, 2);
    assert.deepEqual(vals.items![0], { name: 'Apple' });
    assert.deepEqual(vals.items![1], { name: 'Banana' });
  });

  it('get with itemId resolves correct array item field', () => {
    const itemNameSpec = field<string>();
    const itemSpec = object({ name: itemNameSpec });
    const itemsSpec = array(itemSpec, {
      defaultValue: [{ name: 'Apple' }, { name: 'Banana' }],
    });
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);

    const state = store.getArrayState(itemsSpec)!;
    const firstItemId = state.items[0].id;
    const secondItemId = state.items[1].id;

    assert.equal(store.get(itemNameSpec, { itemId: firstItemId }), 'Apple');
    assert.equal(store.get(itemNameSpec, { itemId: secondItemId }), 'Banana');
  });

  it('set with itemId updates correct array item field', () => {
    const itemNameSpec = field<string>();
    const itemSpec = object({ name: itemNameSpec });
    const itemsSpec = array(itemSpec, {
      defaultValue: [{ name: 'Apple' }, { name: 'Banana' }],
    });
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);

    const state = store.getArrayState(itemsSpec)!;
    const secondItemId = state.items[1].id;

    store.set(itemNameSpec, 'Cherry', { itemId: secondItemId });

    assert.equal(store.get(itemNameSpec, { itemId: secondItemId }), 'Cherry');
    const firstItemId = state.items[0].id;
    assert.equal(store.get(itemNameSpec, { itemId: firstItemId }), 'Apple');
  });
});

describe('initialData array items', () => {
  it('get stable IDs from initialData', () => {
    const itemNameSpec = field<string>();
    const itemSpec = object({ name: itemNameSpec });
    const itemsSpec = array(itemSpec);
    const spec = form({ items: itemsSpec });

    const store = new FormStore(spec, {
      items: [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }],
    });

    const state = store.getArrayState(itemsSpec);
    assert.ok(state);
    assert.equal(state!.items.length, 3);
    assert.equal(state!.items[0].index, 0);
    assert.equal(state!.items[1].index, 1);
    assert.equal(state!.items[2].index, 2);
    assert.ok(state!.items[0].id);
    assert.ok(state!.items[1].id);
    assert.ok(state!.items[2].id);
  });

  it('initialData array overrides defaultValue array', () => {
    const itemNameSpec = field<string>();
    const itemSpec = object({ name: itemNameSpec });
    const itemsSpec = array(itemSpec, {
      defaultValue: [{ name: 'Default' }],
    });
    const spec = form({ items: itemsSpec });

    const store = new FormStore(spec, {
      items: [{ name: 'FromInit' }],
    });

    const vals = store.getValues();
    assert.equal((vals.items as unknown[]).length, 1);
    assert.deepEqual((vals.items as unknown[])[0], { name: 'FromInit' });

    const state = store.getArrayState(itemsSpec)!;
    assert.equal(state.items.length, 1);
  });
});

describe('staticDefaults map', () => {
  it('getStaticDefault returns spec defaultValue', () => {
    const nameSpec = field<string>({ defaultValue: 'hello' });
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    assert.equal(store.getStaticDefault(nameSpec), 'hello');
  });

  it('getStaticDefault returns Zod default when no spec default', () => {
    const emailSpec = field<string>({
      schema: z.string().default('zod@email.com'),
    });
    const spec = form({ email: emailSpec });
    const store = new FormStore(spec);

    assert.equal(store.getStaticDefault(emailSpec), 'zod@email.com');
  });

  it('getStaticDefault returns undefined when no default', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    assert.equal(store.getStaticDefault(nameSpec), undefined);
  });

  it('getStaticDefault returns ObjectSpec defaultValue', () => {
    const citySpec = field<string>();
    const addressSpec = object(
      { city: citySpec },
      { defaultValue: { city: 'LA' } },
    );
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);

    assert.deepEqual(store.getStaticDefault(addressSpec), { city: 'LA' });
  });

  it('getStaticDefault returns ArraySpec defaultValue', () => {
    const itemNameSpec = field<string>();
    const itemSpec = object({ name: itemNameSpec });
    const itemsSpec = array(itemSpec, {
      defaultValue: [{ name: 'A' }],
    });
    const spec = form({ items: itemsSpec });
    const store = new FormStore(spec);

    assert.deepEqual(store.getStaticDefault(itemsSpec), [{ name: 'A' }]);
  });
});

describe('Validation — validateSpec', () => {
  it('valid value passes validation', () => {
    const nameSpec = field<string>({ schema: z.string().min(1) });
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    store.set(nameSpec, 'hello');
    const result = store.validateSpec(nameSpec);

    assert.equal(result.success, true);
    assert.equal(result.error, null);
    assert.equal(store.getError(nameSpec), null);
  });

  it('invalid value sets error message', () => {
    const nameSpec = field<string>({ schema: z.string().min(1) });
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    store.set(nameSpec, '');
    const result = store.validateSpec(nameSpec);

    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.equal(store.getError(nameSpec), result.error);
  });

  it('spec without schema always passes', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    store.set(nameSpec, 'anything');
    const result = store.validateSpec(nameSpec);

    assert.equal(result.success, true);
    assert.equal(result.error, null);
  });
});

describe('Validation — schema overrides', () => {
  it('schema override takes precedence over spec schema', () => {
    const nameSpec = field<string>({ schema: z.string().min(1) });
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    store.setSchema(nameSpec, z.string().min(5));
    store.set(nameSpec, 'ab');

    const result = store.validateSpec(nameSpec);
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('removeSchema restores original spec schema', () => {
    const nameSpec = field<string>({ schema: z.string().min(1) });
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    store.setSchema(nameSpec, z.string().min(5));
    store.removeSchema(nameSpec);
    store.set(nameSpec, 'ab');

    const result = store.validateSpec(nameSpec);
    assert.equal(result.success, true);
    assert.equal(result.error, null);
  });
});

describe('Validation — validateTree', () => {
  it('validates all specs when no spec provided', () => {
    const nameSpec = field<string>({ schema: z.string().min(1) });
    const emailSpec = field<string>({ schema: z.string().email() });
    const spec = form({ name: nameSpec, email: emailSpec });
    const store = new FormStore(spec);

    store.set(nameSpec, 'Alice');
    store.set(emailSpec, 'invalid');

    const result = store.validateTree();
    assert.equal(result.success, false);
    assert.ok(result.errors.get(emailSpec));
    assert.equal(result.errors.get(nameSpec), null);
  });

  it('validates spec + descendants when spec provided', () => {
    const citySpec = field<string>({ schema: z.string().min(1) });
    const zipSpec = field<string>({ schema: z.string().length(5) });
    const addressSpec = object({ city: citySpec, zip: zipSpec });
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec, address: addressSpec });
    const store = new FormStore(spec);

    store.set(citySpec, '');
    store.set(zipSpec, '1234');

    const result = store.validateTree(addressSpec);
    assert.equal(result.success, false);
    assert.ok(result.errors.has(citySpec));
    assert.ok(result.errors.has(zipSpec));
    assert.ok(!result.errors.has(nameSpec));
  });
});

describe('Notifications — subscribe', () => {
  it('value change fires self listener', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    let callCount = 0;
    store.subscribe(nameSpec, () => { callCount++; });

    store.set(nameSpec, 'hello');
    assert.equal(callCount, 1);
  });

  it('value change fires ancestor listeners', () => {
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ name: addressSpec });
    const store = new FormStore(spec);

    let childCalls = 0;
    let parentCalls = 0;
    let rootCalls = 0;
    store.subscribe(citySpec, () => { childCalls++; });
    store.subscribe(addressSpec, () => { parentCalls++; });
    store.subscribe(spec, () => { rootCalls++; });

    store.set(citySpec, 'NYC');
    assert.equal(childCalls, 1);
    assert.equal(parentCalls, 1);
    assert.equal(rootCalls, 1);
  });

  it('value change does NOT fire sibling listeners', () => {
    const nameSpec = field<string>();
    const emailSpec = field<string>();
    const spec = form({ name: nameSpec, email: emailSpec });
    const store = new FormStore(spec);

    let siblingCalls = 0;
    store.subscribe(emailSpec, () => { siblingCalls++; });

    store.set(nameSpec, 'Alice');
    assert.equal(siblingCalls, 0);
  });

  it('unsubscribe stops notifications', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);

    let callCount = 0;
    const unsub = store.subscribe(nameSpec, () => { callCount++; });

    store.set(nameSpec, 'first');
    assert.equal(callCount, 1);

    unsub();
    store.set(nameSpec, 'second');
    assert.equal(callCount, 1);
  });
});

describe('Notifications — reset', () => {
  it('full reset fires all listeners', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec, { name: 'init' });

    let rootCalls = 0;
    let childCalls = 0;
    store.subscribe(spec, () => { rootCalls++; });
    store.subscribe(nameSpec, () => { childCalls++; });

    store.set(nameSpec, 'changed');
    assert.equal(rootCalls, 1);
    assert.equal(childCalls, 1);

    store.reset();
    assert.equal(rootCalls, 2);
    assert.equal(childCalls, 2);
  });

  it('subtree reset fires self + descendants + ancestors (deduplicated)', () => {
    const citySpec = field<string>();
    const zipSpec = field<string>();
    const addressSpec = object({ city: citySpec, zip: zipSpec });
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec, address: addressSpec });
    const store = new FormStore(spec, {
      name: 'A',
      address: { city: 'X', zip: '00000' },
    });

    let rootCalls = 0;
    let addressCalls = 0;
    let cityCalls = 0;
    let zipCalls = 0;
    let nameCalls = 0;
    store.subscribe(spec, () => { rootCalls++; });
    store.subscribe(addressSpec, () => { addressCalls++; });
    store.subscribe(citySpec, () => { cityCalls++; });
    store.subscribe(zipSpec, () => { zipCalls++; });
    store.subscribe(nameSpec, () => { nameCalls++; });

    store.reset(addressSpec);

    assert.equal(rootCalls, 1);
    assert.equal(addressCalls, 1);
    assert.equal(cityCalls, 1);
    assert.equal(zipCalls, 1);
    assert.equal(nameCalls, 0);
  });
});
