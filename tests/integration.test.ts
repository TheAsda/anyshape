import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FormStore } from '../src/store/form-store.js';
import { FieldSpec } from '../src/specs/field.js';
import { ObjectSpec } from '../src/specs/object.js';
import { z } from 'zod';

// ── Integration 1: Full form lifecycle ──────────────────────────────────────

describe('Integration: Full form lifecycle', () => {
  it('create → mount → set → validate → submit', () => {
    const nameSpec = new FieldSpec<string>({ id: 'name' });
    const emailSpec = new FieldSpec<string>({
      id: 'email',
      schema: z.string().email('Invalid email'),
    });
    const ageSpec = new FieldSpec<number>({
      id: 'age',
      defaultValue: 18,
      schema: z.number().min(0, 'Age must be >= 0'),
    });

    const store = new FormStore(
      { name: nameSpec, email: emailSpec, age: ageSpec },
      { name: 'Alice', email: 'alice@example.com' },
    );

    // Verify initial state
    assert.equal(store.get(nameSpec), 'Alice');
    assert.equal(store.get(emailSpec), 'alice@example.com');
    assert.equal(store.get(ageSpec), 18);

    // Mount all
    store.mount(nameSpec);
    store.mount(emailSpec);
    store.mount(ageSpec);

    // Set new values
    store.set(nameSpec, 'Bob');
    store.set(emailSpec, 'bob@test.com');
    store.set(ageSpec, 25);

    assert.equal(store.get(nameSpec), 'Bob');
    assert.equal(store.get(emailSpec), 'bob@test.com');
    assert.equal(store.get(ageSpec), 25);

    // Validate tree
    const vr = store.validateTree();
    assert.equal(vr.success, true);

    // Submit
    let submitted = false;
    let receivedValues: Record<string, unknown> | undefined;
    const result = store.submit((vals) => {
      submitted = true;
      receivedValues = vals;
    });

    assert.equal(result, true);
    assert.equal(submitted, true);
    assert.ok(receivedValues);
    assert.equal(receivedValues!.name, 'Bob');
    assert.equal(receivedValues!.email, 'bob@test.com');
    assert.equal(receivedValues!.age, 25);
  });

  it('submit fails with invalid data', () => {
    const emailSpec = new FieldSpec<string>({
      id: 'email',
      schema: z.string().email('Invalid email'),
    });
    const store = new FormStore({ email: emailSpec });

    store.mount(emailSpec);
    store.set(emailSpec, 'not-an-email');

    let invalidCalled = false;
    const result = store.submit(() => {}, (errs) => {
      invalidCalled = true;
      assert.ok(errs.get(emailSpec));
    });

    assert.equal(result, false);
    assert.equal(invalidCalled, true);
  });
});

// ── Integration 2: Nested form get/set ──────────────────────────────────────

describe('Integration: Nested form with objects', () => {
  it('get/set on nested paths works correctly', () => {
    const streetSpec = new FieldSpec<string>({ id: 'street' });
    const citySpec = new FieldSpec<string>({ id: 'city' });
    const zipSpec = new FieldSpec<string>({ id: 'zip' });
    const addressSpec = new ObjectSpec(
      { street: streetSpec, city: citySpec, zip: zipSpec },
      { id: 'address' },
    );
    const nameSpec = new FieldSpec<string>({ id: 'name' });
    const store = new FormStore(
      { name: nameSpec, address: addressSpec },
      {
        name: 'Alice',
        address: { street: '123 Main', city: 'Boston', zip: '02101' },
      },
    );

    // Spec-based get
    assert.equal(store.get(citySpec), 'Boston');

    // Set nested via spec
    store.set(citySpec, 'NYC');
    assert.equal(store.get(citySpec), 'NYC');
    assert.equal(store.get(streetSpec), '123 Main'); // sibling preserved

    // Set via spec
    store.set(zipSpec, '10001');
    assert.equal(store.get(zipSpec), '10001');

    // getValues reflects everything
    const vals = store.getValues();
    assert.deepEqual(vals.address, { street: '123 Main', city: 'NYC', zip: '10001' });
  });
});

// ── Integration 3: Notification integration ─────────────────────────────────

describe('Integration: Notification with parent-child', () => {
  it('changing child notifies parent', () => {
    const citySpec = new FieldSpec<string>({ id: 'city' });
    const zipSpec = new FieldSpec<string>({ id: 'zip' });
    const addressSpec = new ObjectSpec({ city: citySpec, zip: zipSpec }, { id: 'address' });
    const nameSpec = new FieldSpec<string>({ id: 'name' });
    const store = new FormStore(
      { name: nameSpec, address: addressSpec },
      { name: 'A', address: { city: 'X', zip: 'Z' } },
    );

    const fired: string[] = [];
    store.subscribe(addressSpec, () => fired.push('address'));
    store.subscribe(citySpec, () => fired.push('city'));
    store.subscribe(nameSpec, () => fired.push('name'));

    store.set(citySpec, 'LA');

    assert.deepEqual(fired, ['city', 'address']);
  });

  it('subscribe to parent, change child — parent fires', () => {
    const citySpec = new FieldSpec<string>({ id: 'city' });
    const addressSpec = new ObjectSpec({ city: citySpec }, { id: 'address' });
    const store = new FormStore(
      { address: addressSpec },
      { address: { city: 'X' } },
    );

    let parentCount = 0;
    store.subscribe(addressSpec, () => parentCount++);

    store.set(citySpec, 'Y');
    assert.equal(parentCount, 1);

    store.set(citySpec, 'Z');
    assert.equal(parentCount, 2);
  });
});

// ── Integration 4: Reset integration ────────────────────────────────────────

describe('Integration: Reset restores initial state', () => {
  it('set values → reset → back to initial', () => {
    const nameSpec = new FieldSpec<string>({ id: 'name' });
    const citySpec = new FieldSpec<string>({ id: 'city' });
    const addressSpec = new ObjectSpec({ city: citySpec }, { id: 'address' });
    const store = new FormStore(
      { name: nameSpec, address: addressSpec },
      { name: 'Original', address: { city: 'Boston' } },
    );

    // Mutate
    store.set(nameSpec, 'Changed');
    store.set(citySpec, 'NYC');

    assert.equal(store.get(nameSpec), 'Changed');
    assert.equal(store.get(citySpec), 'NYC');
    assert.equal(store.isTouched(nameSpec), true);
    assert.equal(store.isTouched(citySpec), true);

    // Full reset
    store.reset();

    assert.equal(store.get(nameSpec), 'Original');
    assert.equal(store.get(citySpec), 'Boston');
    assert.equal(store.isTouched(nameSpec), false);
    assert.equal(store.isTouched(citySpec), false);
  });

  it('subtree reset only resets that subtree', () => {
    const nameSpec = new FieldSpec<string>({ id: 'name' });
    const citySpec = new FieldSpec<string>({ id: 'city' });
    const addressSpec = new ObjectSpec({ city: citySpec }, { id: 'address' });
    const store = new FormStore(
      { name: nameSpec, address: addressSpec },
      { name: 'A', address: { city: 'X' } },
    );

    store.set(nameSpec, 'B');
    store.set(citySpec, 'Y');

    store.reset(addressSpec);

    assert.equal(store.get(nameSpec), 'B'); // untouched
    assert.equal(store.get(citySpec), 'X'); // reset
    assert.equal(store.isTouched(nameSpec), true);
    assert.equal(store.isTouched(citySpec), false);
  });
});

// ── Integration 5: DevTools snapshot ────────────────────────────────────────

describe('Integration: DevTools snapshot after mutations', () => {
  it('snapshot reflects all state after lifecycle operations', () => {
    const nameSpec = new FieldSpec<string>({
      id: 'name',
      mountRequired: false,
    });
    const emailSpec = new FieldSpec<string>({
      id: 'email',
      mountRequired: false,
      schema: z.string().min(1, 'Email required'),
    });
    const citySpec = new FieldSpec<string>({ id: 'city', mountRequired: false });
    const addressSpec = new ObjectSpec(
      { city: citySpec },
      { id: 'address', mountRequired: false },
    );

    const store = new FormStore(
      { name: nameSpec, email: emailSpec, address: addressSpec },
      { name: 'Alice', address: { city: 'Boston' } },
    );

    // Initial snapshot
    let snap = store.getDevtoolsSnapshot();
    assert.equal(snap.values.name, 'Alice');
    assert.equal((snap.values.address as Record<string, unknown>).city, 'Boston');
    assert.deepEqual(snap.mounted, []);
    assert.equal(snap.errors[emailSpec.id], null);

    // Mount some fields
    store.mount(nameSpec);
    store.mount(citySpec);

    // Set values + trigger validation error
    store.set(nameSpec, 'Bob');
    store.set(emailSpec, ''); // triggers validation error

    snap = store.getDevtoolsSnapshot();
    assert.equal(snap.values.name, 'Bob');
    assert.equal(snap.values.email, '');
    assert.equal(snap.errors[emailSpec.id], 'Email required');
    assert.equal(snap.touched[nameSpec.id], true);
    assert.equal(snap.touched[emailSpec.id], true);
    assert.ok(snap.mounted.includes(nameSpec.id));
    assert.ok(snap.mounted.includes(citySpec.id));

    // Fix the error
    store.set(emailSpec, 'bob@test.com');

    snap = store.getDevtoolsSnapshot();
    assert.equal(snap.errors[emailSpec.id], null);

    // Reset
    store.reset();

    snap = store.getDevtoolsSnapshot();
    assert.equal(snap.values.name, 'Alice');
    assert.equal(snap.values.email, undefined);
    assert.equal(snap.touched[nameSpec.id], false);
    assert.ok(snap.mounted.includes(nameSpec.id));
    assert.ok(snap.mounted.includes(citySpec.id));
  });
});

// ── Integration 6: Mount tracking + submit gate ─────────────────────────────

describe('Integration: Mount tracking gates submit', () => {
  it('submit returns false when mountRequired fields are not mounted', () => {
    const nameSpec = new FieldSpec<string>({ id: 'name' }); // mountRequired=true
    const store = new FormStore({ name: nameSpec }, { name: 'Alice' });

    // Not mounted yet
    const result = store.submit(() => {});
    assert.equal(result, false);

    // Now mount
    store.mount(nameSpec);
    const result2 = store.submit((vals) => {
      assert.equal(vals.name, 'Alice');
    });
    assert.equal(result2, true);
  });
});

// ── Edge Case 1: Empty form ─────────────────────────────────────────────────

describe('Edge case: Empty form (no fields)', () => {
  it('constructs and operates without errors', () => {
    const store = new FormStore({});

    assert.deepEqual(store.getValues(), {});
    assert.equal(store.submit(() => {}), true); // no fields to mount or validate

    store.reset(); // should not throw
    assert.deepEqual(store.getValues(), {});
  });
});

// ── Edge Case 2: Deeply nested objects (3+ levels) ──────────────────────────

describe('Edge case: Deeply nested objects (3+ levels)', () => {
  it('works with 3-level nesting', () => {
    const codeSpec = new FieldSpec<string>({ id: 'code' });
    const innerSpec = new ObjectSpec({ code: codeSpec }, { id: 'inner' });
    const middleSpec = new ObjectSpec({ inner: innerSpec }, { id: 'middle' });
    const outerSpec = new ObjectSpec({ middle: middleSpec }, { id: 'outer' });
    const nameSpec = new FieldSpec<string>({ id: 'name' });

    const store = new FormStore(
      { name: nameSpec, outer: outerSpec },
      { name: 'test', outer: { middle: { inner: { code: 'ABC' } } } },
    );

    // Get at depth
    assert.equal(store.get(codeSpec), 'ABC');

    // Set at depth
    store.set(codeSpec, 'XYZ');
    assert.equal(store.get(codeSpec), 'XYZ');

    // getValues
    const vals = store.getValues();
    assert.equal((vals.outer as any).middle.inner.code, 'XYZ');
    assert.equal(vals.name, 'test');

    // Notifications propagate up through all levels
    const fired: string[] = [];
    store.subscribe(outerSpec, () => fired.push('outer'));
    store.subscribe(middleSpec, () => fired.push('middle'));
    store.subscribe(innerSpec, () => fired.push('inner'));
    store.subscribe(codeSpec, () => fired.push('code'));
    store.subscribe(nameSpec, () => fired.push('name'));

    store.set(codeSpec, 'NEW');

    assert.deepEqual(fired, ['code', 'inner', 'middle', 'outer']);
  });
});

// ── Edge Case 3: Multiple set operations in sequence ────────────────────────

describe('Edge case: Multiple sequential set operations', () => {
  it('rapid sequential sets maintain consistency', () => {
    const nameSpec = new FieldSpec<string>({ id: 'name' });
    const citySpec = new FieldSpec<string>({ id: 'city' });
    const addressSpec = new ObjectSpec({ city: citySpec }, { id: 'address' });
    const store = new FormStore(
      { name: nameSpec, address: addressSpec },
      { name: '', address: { city: '' } },
    );

    // Rapid sequential sets
    for (let i = 0; i < 100; i++) {
      store.set(nameSpec, `name_${i}`);
      store.set(citySpec, `city_${i}`);
    }

    assert.equal(store.get(nameSpec), 'name_99');
    assert.equal(store.get(citySpec), 'city_99');

    // Values object is consistent
    const vals = store.getValues();
    assert.equal(vals.name, 'name_99');
    assert.equal((vals.address as any).city, 'city_99');
  });

  it('set with noTouch then regular set tracks correctly', () => {
    const f = new FieldSpec<string>({ id: 'f' });
    const store = new FormStore({ f });

    store.set(f, 'a', { noTouch: true });
    assert.equal(store.isTouched(f), false);
    assert.equal(store.get(f), 'a');

    store.set(f, 'b');
    assert.equal(store.isTouched(f), true);
    assert.equal(store.get(f), 'b');

    // Reset and verify
    store.reset();
    assert.equal(store.get(f), undefined);
    assert.equal(store.isTouched(f), false);
  });
});
