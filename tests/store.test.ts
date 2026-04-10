import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FormStore } from '../src/store/form-store.js';
import { FieldSpec } from '../src/specs/field.js';
import { ObjectSpec } from '../src/specs/object.js';
import { z } from 'zod';

function createTestSpecs() {
  const nameSpec = new FieldSpec<string>({ id: 'name' });
  const citySpec = new FieldSpec<string>({ id: 'city' });
  const zipSpec = new FieldSpec<string>({ id: 'zip' });
  const addressSpec = new ObjectSpec({ city: citySpec, zip: zipSpec }, { id: 'address' });
  const passwordSpec = new FieldSpec<string>({ id: 'password', schema: z.string().min(1, 'Password required') });
  const confirmSpec = new FieldSpec<string>({ id: 'confirm', schema: z.string().min(1, 'Confirm required') });
  return { nameSpec, citySpec, zipSpec, addressSpec, passwordSpec, confirmSpec };
}

function createStore(
  specs: ReturnType<typeof createTestSpecs>,
  initialData?: Record<string, unknown>,
) {
  return new FormStore(
    {
      name: specs.nameSpec,
      address: specs.addressSpec,
      password: specs.passwordSpec,
      confirm: specs.confirmSpec,
    },
    initialData,
  );
}

// ── Construction ──────────────────────────────────────────────────────────

describe('Construction', () => {
  it('initializes values from initialData', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'Alice', address: { city: 'Boston', zip: '02101' } });

    assert.equal(store.get(specs.nameSpec), 'Alice');
    assert.equal(store.get(specs.citySpec), 'Boston');
    assert.equal(store.get(specs.zipSpec), '02101');
  });

  it('falls back to defaultValue when initialData missing', () => {
    const withDefault = new FieldSpec<string>({ id: 'greeting', defaultValue: 'hello' });
    const withoutDefault = new FieldSpec<string>({ id: 'empty' });
    const store = new FormStore({ withDefault, withoutDefault });

    assert.equal(store.get(withDefault), 'hello');
    assert.equal(store.get(withoutDefault), undefined);
  });

  it('initialData takes priority over defaultValue', () => {
    const field = new FieldSpec<string>({ id: 'f', defaultValue: 'default' });
    const store = new FormStore({ field }, { field: 'from-init' });

    assert.equal(store.get(field), 'from-init');
  });

  it('initializes undefined for fields without data or default', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    assert.equal(store.get(specs.nameSpec), undefined);
    assert.equal(store.get(specs.passwordSpec), undefined);
  });

  it('getValues returns the full root object', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'Bob', address: { city: 'NYC', zip: '10001' }, password: 'x', confirm: 'x' });

    const vals = store.getValues();
    assert.equal(vals.name, 'Bob');
    assert.deepEqual(vals.address, { city: 'NYC', zip: '10001' });
  });

  it('get accepts dot-path string', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'Carol', address: { city: 'LA', zip: '90001' }, password: 'p', confirm: 'p' });

    assert.equal(store.get('name'), 'Carol');
    assert.equal(store.get('address.city'), 'LA');
    assert.equal(store.get('address.zip'), '90001');
  });
});

// ── Get / Set ─────────────────────────────────────────────────────────────

describe('Get / Set', () => {
  it('set updates value immutably', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'A', address: { city: 'X', zip: 'Z' }, password: 'p', confirm: 'p' });
    const before = store.getValues();

    store.set(specs.nameSpec, 'B');

    assert.equal(store.get(specs.nameSpec), 'B');
    assert.notEqual(store.getValues(), before);
  });

  it('set preserves sibling references (referential equality)', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'A', address: { city: 'X', zip: 'Z' }, password: 'p', confirm: 'p' });
    const addressRef = store.getValues().address;

    store.set(specs.nameSpec, 'B');

    assert.strictEqual(store.getValues().address, addressRef);
  });

  it('set on nested field preserves sibling fields in same object', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'A', address: { city: 'X', zip: 'Z' }, password: 'p', confirm: 'p' });

    store.set(specs.citySpec, 'Chicago');

    assert.equal(store.get(specs.citySpec), 'Chicago');
    assert.equal(store.get(specs.zipSpec), 'Z');
  });

  it('set accepts dot-path string', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set('name', 'Eve');
    assert.equal(store.get('name'), 'Eve');
  });

  it('set with noTouch skips touched marking', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.nameSpec, 'X', { noTouch: true });
    assert.equal(store.isTouched(specs.nameSpec.id), false);

    store.set(specs.nameSpec, 'Y');
    assert.equal(store.isTouched(specs.nameSpec.id), true);
  });

  it('set with noValidate clears error', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.passwordSpec, '');
    assert.ok(store.getError(specs.passwordSpec.id));

    store.set(specs.passwordSpec, '', { noValidate: true });
    assert.equal(store.getError(specs.passwordSpec.id), null);
  });
});

// ── Reset ─────────────────────────────────────────────────────────────────

describe('Reset', () => {
  it('resets entire form to initial values', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'A', address: { city: 'X', zip: 'Z' }, password: 'p', confirm: 'p' });

    store.set(specs.nameSpec, 'B');
    store.set(specs.citySpec, 'Y');
    store.reset();

    assert.equal(store.get(specs.nameSpec), 'A');
    assert.equal(store.get(specs.citySpec), 'X');
  });

  it('reset clears touched state', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.nameSpec, 'X');
    assert.equal(store.isTouched(specs.nameSpec.id), true);

    store.reset();
    assert.equal(store.isTouched(specs.nameSpec.id), false);
  });

  it('reset clears errors', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.passwordSpec, '');
    assert.ok(store.getError(specs.passwordSpec.id));

    store.reset();
    assert.equal(store.getError(specs.passwordSpec.id), null);
  });

  it('resets a subtree by spec', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'A', address: { city: 'X', zip: 'Z' }, password: 'p', confirm: 'p' });

    store.set(specs.citySpec, 'Y');
    store.set(specs.nameSpec, 'B');
    store.reset(specs.addressSpec);

    assert.equal(store.get(specs.citySpec), 'X');
    assert.equal(store.get(specs.nameSpec), 'B');
    assert.equal(store.isTouched(specs.citySpec.id), false);
    assert.equal(store.isTouched(specs.nameSpec.id), true);
  });

  it('reset subtree clears descendant errors', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'A', address: { city: '', zip: '' }, password: 'p', confirm: 'p' });

    store.validateTree();
    store.reset(specs.addressSpec);

    assert.equal(store.getError(specs.citySpec.id), null);
    assert.equal(store.getError(specs.zipSpec.id), null);
  });
});

// ── Notifications ─────────────────────────────────────────────────────────

describe('Notifications', () => {
  it('value change fires self listeners', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);
    let count = 0;
    store.subscribe(specs.nameSpec.id, () => count++);

    store.set(specs.nameSpec, 'X');

    assert.equal(count, 1);
  });

  it('value change fires ancestor listeners, not siblings', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);
    const fired: string[] = [];

    store.subscribe(specs.nameSpec.id, () => fired.push('name'));
    store.subscribe(specs.citySpec.id, () => fired.push('city'));
    store.subscribe(specs.addressSpec.id, () => fired.push('address'));

    store.set(specs.citySpec, 'LA');

    assert.deepEqual(fired, ['city', 'address']);
  });

  it('subscribe returns unsubscribe function', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);
    let count = 0;
    const unsub = store.subscribe(specs.nameSpec.id, () => count++);

    store.set(specs.nameSpec, 'A');
    unsub();
    store.set(specs.nameSpec, 'B');

    assert.equal(count, 1);
  });

  it('reset fires self + descendants + ancestors (deduplicated)', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'A', address: { city: 'X', zip: 'Z' }, password: 'p', confirm: 'p' });
    const fired: string[] = [];

    store.subscribe(specs.addressSpec.id, () => fired.push('address'));
    store.subscribe(specs.citySpec.id, () => fired.push('city'));
    store.subscribe(specs.zipSpec.id, () => fired.push('zip'));
    store.subscribe(specs.nameSpec.id, () => fired.push('name'));

    store.reset(specs.addressSpec);

    assert.ok(fired.includes('address'));
    assert.ok(fired.includes('city'));
    assert.ok(fired.includes('zip'));
    assert.ok(!fired.includes('name'));

    const addressCount = fired.filter(f => f === 'address').length;
    assert.equal(addressCount, 1, 'address should fire exactly once (dedup)');
  });

  it('full reset fires all listeners', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);
    let nameCount = 0;
    let cityCount = 0;

    store.subscribe(specs.nameSpec.id, () => nameCount++);
    store.subscribe(specs.citySpec.id, () => cityCount++);

    store.reset();

    assert.equal(nameCount, 1);
    assert.equal(cityCount, 1);
  });
});

// ── Validation ────────────────────────────────────────────────────────────

describe('Validation', () => {
  it('valid value passes validation', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.passwordSpec, 'secret');

    assert.equal(store.getError(specs.passwordSpec.id), null);
  });

  it('invalid value sets error message', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.passwordSpec, '');

    assert.equal(store.getError(specs.passwordSpec.id), 'Password required');
  });

  it('schema override takes precedence', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const longerSchema = z.string().min(5, 'At least 5 chars');
    store.setSchema(specs.passwordSpec.id, longerSchema);

    store.set(specs.passwordSpec, 'abc');
    assert.equal(store.getError(specs.passwordSpec.id), 'At least 5 chars');

    store.set(specs.passwordSpec, 'abcde');
    assert.equal(store.getError(specs.passwordSpec.id), null);
  });

  it('removeSchema reverts to spec default schema', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.setSchema(specs.passwordSpec.id, z.string().min(5, '5+'));
    store.removeSchema(specs.passwordSpec.id);

    store.set(specs.passwordSpec, 'abc');
    assert.equal(store.getError(specs.passwordSpec.id), null);
  });

  it('validateSpec without schema returns success', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const result = store.validateSpec(specs.nameSpec.id);
    assert.equal(result.success, true);
    assert.equal(result.error, null);
  });

  it('validateTree validates all specs', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.passwordSpec, '', { noValidate: true });
    store.set(specs.confirmSpec, '', { noValidate: true });

    const result = store.validateTree();
    assert.equal(result.success, false);
    assert.ok(result.errors.get(specs.passwordSpec.id));
    assert.ok(result.errors.get(specs.confirmSpec.id));
  });

  it('validateTree with specId validates subtree only', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const result = store.validateTree(specs.addressSpec.id);
    assert.equal(result.success, true);
    assert.equal(result.errors.has(specs.passwordSpec.id), false);
  });
});

// ── Touched state ─────────────────────────────────────────────────────────

describe('Touched state', () => {
  it('defaults to false', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    assert.equal(store.isTouched(specs.nameSpec.id), false);
  });

  it('set marks as touched', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.nameSpec, 'X');

    assert.equal(store.isTouched(specs.nameSpec.id), true);
  });

  it('reset clears touched', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.nameSpec, 'X');
    store.reset();

    assert.equal(store.isTouched(specs.nameSpec.id), false);
  });
});

// ── Mount tracking ────────────────────────────────────────────────────────

describe('Mount tracking', () => {
  it('mount and isMounted', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    assert.equal(store.isMounted(specs.nameSpec.id), false);
    store.mount(specs.nameSpec.id);
    assert.equal(store.isMounted(specs.nameSpec.id), true);
  });

  it('double mount throws', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.mount(specs.nameSpec.id);
    assert.throws(() => store.mount(specs.nameSpec.id));
  });

  it('unmount clears value when keepOnUnmount is false', () => {
    const field = new FieldSpec<string>({ id: 'f', defaultValue: 'init' });
    const store = new FormStore({ field });
    store.mount(field.id);
    store.set(field, 'changed');

    store.unmount(field.id);

    assert.equal(store.get(field), 'init');
    assert.equal(store.isTouched(field.id), false);
    assert.equal(store.getError(field.id), null);
  });

  it('unmount preserves value when keepOnUnmount is true', () => {
    const field = new FieldSpec<string>({ id: 'f', keepOnUnmount: true });
    const store = new FormStore({ field }, { field: 'original' });
    store.mount(field.id);
    store.set(field, 'changed');

    store.unmount(field.id);

    assert.equal(store.get(field), 'changed');
  });

  it('unmount with keepValue=true preserves regardless of keepOnUnmount', () => {
    const field = new FieldSpec<string>({ id: 'f', keepOnUnmount: false });
    const store = new FormStore({ field }, { field: 'original' });
    store.mount(field.id);
    store.set(field, 'changed');

    store.unmount(field.id, true);

    assert.equal(store.get(field), 'changed');
  });
});

// ── Submit ────────────────────────────────────────────────────────────────

describe('Submit', () => {
  it('calls onValid with values when form is valid', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'A', address: { city: 'X', zip: 'Z' }, password: 'p', confirm: 'p' });

    store.mount(specs.nameSpec.id);
    store.mount(specs.addressSpec.id);
    store.mount(specs.citySpec.id);
    store.mount(specs.zipSpec.id);
    store.mount(specs.passwordSpec.id);
    store.mount(specs.confirmSpec.id);

    let received: Record<string, unknown> | undefined;
    const result = store.submit((vals) => { received = vals; });

    assert.equal(result, true);
    assert.ok(received);
    assert.equal(received!.name, 'A');
  });

  it('calls onInvalid and returns false when validation fails', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.mount(specs.nameSpec.id);
    store.mount(specs.addressSpec.id);
    store.mount(specs.citySpec.id);
    store.mount(specs.zipSpec.id);
    store.mount(specs.passwordSpec.id);
    store.mount(specs.confirmSpec.id);

    let invalidCalled = false;
    const result = store.submit(
      () => {},
      () => { invalidCalled = true; },
    );

    assert.equal(result, false);
    assert.equal(invalidCalled, true);
  });

  it('focuses first error field via domRef', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    let focused = false;
    store.setRef(specs.passwordSpec.id, { focus: () => { focused = true; } } as unknown as HTMLElement);

    store.mount(specs.nameSpec.id);
    store.mount(specs.addressSpec.id);
    store.mount(specs.citySpec.id);
    store.mount(specs.zipSpec.id);
    store.mount(specs.passwordSpec.id);
    store.mount(specs.confirmSpec.id);

    store.submit(() => {}, () => {});

    assert.equal(focused, true);
  });

  it('returns false when mountRequired spec is not mounted', () => {
    const specs = createTestSpecs();
    const store = createStore(specs, { name: 'A', address: { city: 'X', zip: 'Z' }, password: 'p', confirm: 'p' });

    const result = store.submit(() => {});
    assert.equal(result, false);
  });

  it('onInvalid receives error map', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.mount(specs.nameSpec.id);
    store.mount(specs.addressSpec.id);
    store.mount(specs.citySpec.id);
    store.mount(specs.zipSpec.id);
    store.mount(specs.passwordSpec.id);
    store.mount(specs.confirmSpec.id);

    let receivedErrors: Map<string, string | null> | undefined;
    store.submit(
      () => {},
      (errs) => { receivedErrors = errs; },
    );

    assert.ok(receivedErrors);
    assert.ok(receivedErrors!.get(specs.passwordSpec.id));
    assert.ok(receivedErrors!.get(specs.confirmSpec.id));
  });
});
