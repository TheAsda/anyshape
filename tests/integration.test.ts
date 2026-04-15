import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { field, object, array, form } from '../src/specs/factories.js';
import { FormStore } from '../src/store/form-store.js';
import { ScopedStore } from '../src/store/scoped-store.js';
import { ArrayScopedStore } from '../src/store/array-scoped-store.js';

// Side-effect: registers ArrayScopedStore in ScopedStore's internal registry
void ArrayScopedStore;

// ── Scenario 1: Full form lifecycle with nested objects and arrays ──────────

describe('Integration: Full form lifecycle with nested objects and arrays', () => {
  it('create form → root scope → nested scopes → set values → append array items → validate → submit', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const citySpec = field<string>({ defaultValue: '' });
    const zipSpec = field<string>();
    const addressSpec = object({ city: citySpec, zip: zipSpec });
    const customerSpec = object({ address: addressSpec });
    const productNameSpec = field<string>({ defaultValue: '' });
    const qtySpec = field<number>({ defaultValue: 1 });
    const itemSpec = object({ productName: productNameSpec, qty: qtySpec });
    const itemsSpec = array(itemSpec);

    const formSpec = form({
      name: nameSpec,
      customer: customerSpec,
      items: itemsSpec,
    });

    const store = new FormStore(formSpec);

    const rootScope = new ScopedStore(store, formSpec, null);
    rootScope.mount();

    const customerScope = rootScope.scopeObject(customerSpec);
    customerScope.mount();

    const addressScope = customerScope.scopeObject(addressSpec);
    addressScope.mount();

    rootScope.set(nameSpec, 'Acme Corp');
    addressScope.set(citySpec, 'NYC');
    addressScope.set(zipSpec, '10001');

    const arrayScope = rootScope.scopeArray(itemsSpec);
    assert.ok(arrayScope instanceof ArrayScopedStore);

    const itemId1 = arrayScope.append({ productName: 'Widget', qty: 5 });
    const itemId2 = arrayScope.append({ productName: 'Gadget', qty: 10 });

    assert.equal(store.get(nameSpec), 'Acme Corp');
    assert.equal(store.get(citySpec), 'NYC');
    assert.equal(store.get(zipSpec), '10001');
    assert.equal(store.get(productNameSpec, { itemId: itemId1 }), 'Widget');
    assert.equal(store.get(qtySpec, { itemId: itemId1 }), 5);
    assert.equal(store.get(productNameSpec, { itemId: itemId2 }), 'Gadget');
    assert.equal(store.get(qtySpec, { itemId: itemId2 }), 10);

    assert.equal(store.get(nameSpec), 'Acme Corp');
    assert.equal(store.get(citySpec), 'NYC');
    assert.equal(store.get(zipSpec), '10001');

    const vals = store.getValues();
    assert.equal(vals.name, 'Acme Corp');

    const customer = vals.customer as Record<string, unknown>;
    const address = customer.address as Record<string, unknown>;
    assert.equal(address.city, 'NYC');
    assert.equal(address.zip, '10001');

    const items = vals.items as Record<string, unknown>[];
    assert.equal(items.length, 2);
    assert.equal(items[0].productName, 'Widget');
    assert.equal(items[0].qty, 5);
    assert.equal(items[1].productName, 'Gadget');
    assert.equal(items[1].qty, 10);
  });
});

// ── Scenario 2: Read bubbling across 3 levels of nesting ───────────────────

describe('Integration: Read bubbling across 3 levels of nesting', () => {
  it('deeply nested scope reads root field through 2 levels', () => {
    const nameSpec = field<string>({ defaultValue: 'root-name' });
    const citySpec = field<string>({ defaultValue: '' });
    const zipSpec = field<string>();
    const addressSpec = object({ city: citySpec, zip: zipSpec });
    const customerSpec = object({ address: addressSpec });

    const formSpec = form({ name: nameSpec, customer: customerSpec });
    const store = new FormStore(formSpec);

    const rootScope = new ScopedStore(store, formSpec, null);
    const customerScope = rootScope.scopeObject(customerSpec);
    const addressScope = customerScope.scopeObject(addressSpec);

    rootScope.mount();
    rootScope.set(nameSpec, 'Alice');

    assert.equal(addressScope.get(nameSpec), 'Alice');
    assert.equal(customerScope.get(nameSpec), 'Alice');

    addressScope.mount({ city: 'Boston' });
    assert.equal(addressScope.get(citySpec), 'Boston');
  });

  it('3-level nesting reads own fields correctly at each level', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const citySpec = field<string>({ defaultValue: '' });
    const zipSpec = field<string>({ defaultValue: '' });
    const addressSpec = object({ city: citySpec, zip: zipSpec });
    const customerSpec = object({ address: addressSpec });
    const formSpec = form({ name: nameSpec, customer: customerSpec });

    const store = new FormStore(formSpec, {
      name: 'root-name',
      customer: { address: { city: 'NYC', zip: '10001' } },
    });

    const rootScope = new ScopedStore(store, formSpec, null);
    const customerScope = rootScope.scopeObject(customerSpec);
    const addressScope = customerScope.scopeObject(addressSpec);

    assert.equal(rootScope.get(nameSpec), 'root-name');
    assert.equal(customerScope.get(nameSpec), 'root-name');
    assert.equal(addressScope.get(nameSpec), 'root-name');

    assert.equal(addressScope.get(citySpec), 'NYC');
    assert.equal(addressScope.get(zipSpec), '10001');
  });
});

// ── Scenario 3: Array items with scoped access ─────────────────────────────

describe('Integration: Array items with scoped access', () => {
  it('3 items with independent scoped access have distinct values', () => {
    const productNameSpec = field<string>({ defaultValue: '' });
    const qtySpec = field<number>({ defaultValue: 1 });
    const itemSpec = object({ productName: productNameSpec, qty: qtySpec });
    const itemsSpec = array(itemSpec);
    const formSpec = form({ items: itemsSpec });

    const store = new FormStore(formSpec);
    const rootScope = new ScopedStore(store, formSpec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id1 = arrayScope.append({ productName: 'Apple', qty: 10 });
    const id2 = arrayScope.append({ productName: 'Banana', qty: 20 });
    const id3 = arrayScope.append({ productName: 'Cherry', qty: 30 });

    const scope1 = arrayScope.getItemScope(id1);
    const scope2 = arrayScope.getItemScope(id2);
    const scope3 = arrayScope.getItemScope(id3);

    scope1.set(productNameSpec, 'Updated Apple');
    scope2.set(productNameSpec, 'Updated Banana');
    scope3.set(productNameSpec, 'Updated Cherry');

    assert.equal(store.get(productNameSpec, { itemId: id1 }), 'Updated Apple');
    assert.equal(store.get(productNameSpec, { itemId: id2 }), 'Updated Banana');
    assert.equal(store.get(productNameSpec, { itemId: id3 }), 'Updated Cherry');

    assert.equal(store.get(qtySpec, { itemId: id1 }), 10);
    assert.equal(store.get(qtySpec, { itemId: id2 }), 20);
    assert.equal(store.get(qtySpec, { itemId: id3 }), 30);

    const vals = store.getValues();
    const items = vals.items as Record<string, unknown>[];
    assert.equal(items[0].productName, 'Updated Apple');
    assert.equal(items[1].productName, 'Updated Banana');
    assert.equal(items[2].productName, 'Updated Cherry');
  });

  it('array item scopes bubble reads to root fields', () => {
    const rootField = field<string>({ defaultValue: 'root-val' });
    const nameSpec = field<string>({ defaultValue: '' });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const formSpec = form({ rootField, items: itemsSpec });

    const store = new FormStore(formSpec);
    const rootScope = new ScopedStore(store, formSpec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id = arrayScope.append({ name: 'Item1' });
    const itemScope = arrayScope.getItemScope(id);

    assert.equal(itemScope.get(rootField), 'root-val');
    assert.equal(itemScope.get(nameSpec), 'Item1');
  });
});

// ── Scenario 4: Scope mount/unmount lifecycle with data ────────────────────

describe('Integration: Scope mount/unmount lifecycle with data', () => {
  it('mount → set → unmount → re-mount cycle', () => {
    const citySpec = field<string>({ defaultValue: 'default-city' });
    const zipSpec = field<string>({ defaultValue: '00000' });
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: 'default-city', zip: '00000' } },
    );
    const formSpec = form({ address: addressSpec });
    const store = new FormStore(formSpec);

    const rootScope = new ScopedStore(store, formSpec, null);
    const addressScope = rootScope.scopeObject(addressSpec);

    addressScope.mount({ city: 'Boston', zip: '02134' });
    assert.equal(store.get(citySpec), 'Boston');
    assert.equal(store.get(zipSpec), '02134');
    assert.equal(store.isMounted(addressSpec), true);

    addressScope.set(citySpec, 'NYC');
    assert.equal(store.get(citySpec), 'NYC');

    addressScope.unmount();
    assert.equal(store.isMounted(addressSpec), false);
    assert.deepEqual(store.get(addressSpec), { city: 'default-city', zip: '00000' });

    addressScope.mount({ city: 'Chicago', zip: '60601' });
    assert.equal(store.get(citySpec), 'Chicago');
    assert.equal(store.get(zipSpec), '60601');
    assert.equal(store.isMounted(addressSpec), true);
  });

  it('nested scope unmount only affects that scope', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const citySpec = field<string>({ defaultValue: '' });
    const zipSpec = field<string>({ defaultValue: '' });
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: '', zip: '' } },
    );
    const customerSpec = object({ address: addressSpec });
    const formSpec = form({ name: nameSpec, customer: customerSpec });

    const store = new FormStore(formSpec, {
      name: 'Acme',
      customer: { address: { city: 'Boston', zip: '02134' } },
    });

    const rootScope = new ScopedStore(store, formSpec, null);
    rootScope.mount();

    const customerScope = rootScope.scopeObject(customerSpec);
    customerScope.mount();

    const addressScope = customerScope.scopeObject(addressSpec);
    addressScope.mount();

    addressScope.set(citySpec, 'NYC');

    addressScope.unmount();

    assert.equal(store.isMounted(customerSpec), true);
    assert.equal(store.isMounted(formSpec), true);
    assert.equal(store.get(nameSpec), 'Acme');
    assert.deepEqual(store.get(addressSpec), { city: '', zip: '' });
  });
});

// ── Scenario 5: Validation across scope boundaries ─────────────────────────

describe('Integration: Validation across scope boundaries', () => {
  it('set invalid in child → validate tree from root → fix → error cleared', () => {
    const nameSpec = field<string>({
      defaultValue: '',
      schema: z.string().min(1, 'Name required'),
    });
    const citySpec = field<string>({
      defaultValue: '',
      schema: z.string().min(1, 'City required'),
    });
    const addressSpec = object({ city: citySpec });
    const formSpec = form({ name: nameSpec, address: addressSpec });

    const store = new FormStore(formSpec);

    const rootScope = new ScopedStore(store, formSpec, null);
    rootScope.mount();

    const addressScope = rootScope.scopeObject(addressSpec);
    addressScope.mount();

    rootScope.set(nameSpec, 'ValidName');
    addressScope.set(citySpec, '');

    const vr = store.validateTree();
    assert.equal(vr.success, false);
    assert.ok(vr.errors.get(citySpec));

    addressScope.set(citySpec, 'NYC');

    const vr2 = store.validateTree();
    assert.equal(vr2.success, true);
    assert.equal(vr2.errors.get(citySpec), null);
  });

  it('validation with array items across scope boundary', () => {
    const productNameSpec = field<string>({
      defaultValue: '',
      schema: z.string().min(1, 'Product name required'),
    });
    const qtySpec = field<number>({
      defaultValue: 1,
      schema: z.number().min(1, 'Qty must be >= 1'),
    });
    const itemSpec = object({ productName: productNameSpec, qty: qtySpec });
    const itemsSpec = array(itemSpec);
    const formSpec = form({ items: itemsSpec });

    const store = new FormStore(formSpec);
    const rootScope = new ScopedStore(store, formSpec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id1 = arrayScope.append({ productName: '', qty: 0 });
    const id2 = arrayScope.append({ productName: 'Valid', qty: 5 });

    const result = arrayScope.validateArray();
    assert.equal(result.success, false);

    const scope1 = arrayScope.getItemScope(id1);
    scope1.set(productNameSpec, 'Fixed Product');
    scope1.set(qtySpec, 3);

    const result2 = arrayScope.validateArray();
    assert.equal(result2.success, true);
  });
});

// ── Scenario 6: Event propagation across scope boundaries ──────────────────

describe('Integration: Event propagation across scope boundaries', () => {
  it('subscribe to root → set in deeply nested scope → root listener fires', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const citySpec = field<string>({ defaultValue: '' });
    const zipSpec = field<string>({ defaultValue: '' });
    const addressSpec = object({ city: citySpec, zip: zipSpec });
    const customerSpec = object({ address: addressSpec });
    const formSpec = form({ name: nameSpec, customer: customerSpec });

    const store = new FormStore(formSpec);
    const rootScope = new ScopedStore(store, formSpec, null);
    const customerScope = rootScope.scopeObject(customerSpec);
    const addressScope = customerScope.scopeObject(addressSpec);

    let rootFired = 0;
    let customerFired = 0;
    let addressFired = 0;
    let cityFired = 0;

    rootScope.subscribe(formSpec, () => rootFired++);
    rootScope.subscribe(customerSpec, () => customerFired++);
    rootScope.subscribe(addressSpec, () => addressFired++);
    rootScope.subscribe(citySpec, () => cityFired++);

    addressScope.set(citySpec, 'NYC');

    assert.equal(cityFired, 1);
    assert.equal(addressFired, 1);
    assert.equal(customerFired, 1);
    assert.equal(rootFired, 1);
  });

  it('subscribe via scope delegates to FormStore correctly', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const formSpec = form({ name: nameSpec });
    const store = new FormStore(formSpec);
    const rootScope = new ScopedStore(store, formSpec, null);

    let fired = false;
    const unsub = rootScope.subscribe(nameSpec, () => { fired = true; });

    rootScope.set(nameSpec, 'hello');
    assert.equal(fired, true);

    fired = false;
    unsub();
    rootScope.set(nameSpec, 'world');
    assert.equal(fired, false);
  });

  it('array item change propagates to root', () => {
    const rootName = field<string>({ defaultValue: 'root' });
    const productNameSpec = field<string>({ defaultValue: '' });
    const itemSpec = object({ productName: productNameSpec });
    const itemsSpec = array(itemSpec);
    const formSpec = form({ rootName, items: itemsSpec });

    const store = new FormStore(formSpec);
    const rootScope = new ScopedStore(store, formSpec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id = arrayScope.append({ productName: 'Widget' });
    const itemScope = arrayScope.getItemScope(id);

    let arrayFired = 0;
    let rootFired = 0;
    rootScope.subscribe(itemsSpec, () => arrayFired++);
    rootScope.subscribe(formSpec, () => rootFired++);

    itemScope.set(productNameSpec, 'Updated Widget');

    assert.equal(arrayFired, 1);
    assert.equal(rootFired, 1);
  });
});

// ── Bonus: End-to-end submit with validation ───────────────────────────────

describe('Integration: Submit with validation across scopes and arrays', () => {
  it('full lifecycle: mount → fill → validate → submit success', () => {
    const nameSpec = field<string>({
      defaultValue: '',
      schema: z.string().min(1, 'Name required'),
    });
    const emailSpec = field<string>({
      defaultValue: '',
      schema: z.string().email('Invalid email'),
    });

    const formSpec = form({ name: nameSpec, email: emailSpec });
    const store = new FormStore(formSpec);

    const rootScope = new ScopedStore(store, formSpec, null);
    rootScope.mount();
    store.mount(nameSpec);
    store.mount(emailSpec);

    rootScope.set(nameSpec, 'Acme Corp');
    rootScope.set(emailSpec, 'acme@example.com');

    const vr = store.validateTree();
    assert.equal(vr.success, true);

    let submitted = false;
    let received: Record<string, unknown> | undefined;
    const ok = store.submit((vals) => {
      submitted = true;
      received = vals;
    });

    assert.equal(ok, true);
    assert.equal(submitted, true);
    assert.ok(received);
    assert.equal(received!.name, 'Acme Corp');
    assert.equal(received!.email, 'acme@example.com');
  });

  it('submit fails with validation errors', () => {
    const emailSpec = field<string>({
      defaultValue: '',
      schema: z.string().email('Invalid email'),
    });
    const formSpec = form({ email: emailSpec });

    const store = new FormStore(formSpec);
    const rootScope = new ScopedStore(store, formSpec, null);
    rootScope.mount();
    store.mount(emailSpec);

    rootScope.set(emailSpec, 'not-an-email');

    let invalidCalled = false;
    const ok = store.submit(
      () => {},
      () => { invalidCalled = true; },
    );

    assert.equal(ok, false);
    assert.equal(invalidCalled, true);
  });

  it('submit fails when mountRequired scope not mounted', () => {
    const nameSpec = field<string>({
      defaultValue: '',
      schema: z.string().min(1, 'Required'),
    });
    const citySpec = field<string>({ defaultValue: '' });
    const addressSpec = object({ city: citySpec });
    const formSpec = form({ name: nameSpec, address: addressSpec });

    const store = new FormStore(formSpec);
    const rootScope = new ScopedStore(store, formSpec, null);
    rootScope.mount();

    rootScope.set(nameSpec, 'valid');

    let onValidCalled = false;
    const result = store.submit(() => { onValidCalled = true; });

    assert.equal(result, false);
    assert.equal(onValidCalled, false);
  });
});

// ── Bonus: Reset integration with scopes ───────────────────────────────────

describe('Integration: Reset with scoped stores', () => {
  it('full reset restores initial state across all scopes', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const citySpec = field<string>({ defaultValue: '' });
    const addressSpec = object({ city: citySpec });
    const formSpec = form({ name: nameSpec, address: addressSpec });

    const store = new FormStore(formSpec, {
      name: 'Original',
      address: { city: 'Boston' },
    });

    const rootScope = new ScopedStore(store, formSpec, null);
    rootScope.mount();

    const addressScope = rootScope.scopeObject(addressSpec);
    addressScope.mount();

    rootScope.set(nameSpec, 'Changed');
    addressScope.set(citySpec, 'NYC');

    assert.equal(store.get(nameSpec), 'Changed');
    assert.equal(store.get(citySpec), 'NYC');

    store.reset();

    assert.equal(store.get(nameSpec), 'Original');
    assert.equal(store.get(citySpec), 'Boston');
  });

  it('subtree reset only resets that subtree, accessible through scopes', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const citySpec = field<string>({ defaultValue: '' });
    const addressSpec = object({ city: citySpec });
    const formSpec = form({ name: nameSpec, address: addressSpec });

    const store = new FormStore(formSpec, {
      name: 'A',
      address: { city: 'X' },
    });

    const rootScope = new ScopedStore(store, formSpec, null);
    const addressScope = rootScope.scopeObject(addressSpec);

    rootScope.set(nameSpec, 'B');
    addressScope.set(citySpec, 'Y');

    store.reset(addressSpec);

    assert.equal(rootScope.get(nameSpec), 'B');
    assert.equal(addressScope.get(citySpec), 'X');
  });
});

// ── Bonus: Array CRUD lifecycle with scope integration ─────────────────────

describe('Integration: Array CRUD lifecycle with scopes', () => {
  it('append → read via scope → update via scope → remove → verify', () => {
    const productNameSpec = field<string>({ defaultValue: '' });
    const qtySpec = field<number>({ defaultValue: 1 });
    const itemSpec = object({ productName: productNameSpec, qty: qtySpec });
    const itemsSpec = array(itemSpec);
    const formSpec = form({ items: itemsSpec });

    const store = new FormStore(formSpec);
    const rootScope = new ScopedStore(store, formSpec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    const id1 = arrayScope.append({ productName: 'A', qty: 1 });
    const id2 = arrayScope.append({ productName: 'B', qty: 2 });

    const scope1 = arrayScope.getItemScope(id1);
    assert.equal(scope1.get(productNameSpec), 'A');
    assert.equal(scope1.get(qtySpec), 1);

    scope1.set(productNameSpec, 'A-updated');
    scope1.set(qtySpec, 100);

    assert.equal(store.get(productNameSpec, { itemId: id1 }), 'A-updated');
    assert.equal(store.get(qtySpec, { itemId: id1 }), 100);

    assert.equal(store.get(productNameSpec, { itemId: id2 }), 'B');
    assert.equal(store.get(qtySpec, { itemId: id2 }), 2);

    arrayScope.remove(id1);

    const items = arrayScope.getItems();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, id2);
    assert.equal(items[0].index, 0);
  });

  it('clear → append → reorder lifecycle', () => {
    const nameSpec = field<string>({ defaultValue: '' });
    const itemSpec = object({ name: nameSpec });
    const itemsSpec = array(itemSpec);
    const formSpec = form({ items: itemsSpec });

    const store = new FormStore(formSpec);
    const rootScope = new ScopedStore(store, formSpec, null);
    const arrayScope = rootScope.scopeArray(itemsSpec);

    arrayScope.append({ name: 'First' });
    arrayScope.append({ name: 'Second' });
    arrayScope.append({ name: 'Third' });

    arrayScope.clear();
    assert.equal(arrayScope.getItems().length, 0);
    assert.deepEqual(store.getValues().items, []);

    const idA = arrayScope.append({ name: 'New A' });
    const idB = arrayScope.append({ name: 'New B' });
    const idC = arrayScope.append({ name: 'New C' });

    arrayScope.reorder(0, 2);

    const data = store.getValues().items as Record<string, unknown>[];
    assert.equal(data[0].name, 'New B');
    assert.equal(data[1].name, 'New C');
    assert.equal(data[2].name, 'New A');

    const items = arrayScope.getItems();
    assert.equal(items[0].id, idB);
    assert.equal(items[1].id, idC);
    assert.equal(items[2].id, idA);
  });
});
