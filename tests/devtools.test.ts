import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FormStore } from '../src/store/form-store.js';
import { FieldSpec } from '../src/specs/field.js';
import { ObjectSpec } from '../src/specs/object.js';
import { formDevtoolsProtocol } from '../src/devtools/protocol.js';
import { FormDevtools } from '../src/devtools/form-devtools.js';

function createTestSpecs() {
  const nameSpec = new FieldSpec<string>({ id: 'name', mountRequired: false });
  const emailSpec = new FieldSpec<string>({ id: 'email', mountRequired: false });
  const citySpec = new FieldSpec<string>({ id: 'city', mountRequired: false });
  const zipSpec = new FieldSpec<string>({ id: 'zip', mountRequired: false });
  const addressSpec = new ObjectSpec({ city: citySpec, zip: zipSpec }, { id: 'address', mountRequired: false });
  return { nameSpec, emailSpec, citySpec, zipSpec, addressSpec };
}

function createStore(specs: ReturnType<typeof createTestSpecs>) {
  return new FormStore({
    name: specs.nameSpec,
    email: specs.emailSpec,
    address: specs.addressSpec,
  });
}

describe('Protocol definition', () => {
  it('has all four message keys', () => {
    assert.ok('formRegistered' in formDevtoolsProtocol);
    assert.ok('formStateChanged' in formDevtoolsProtocol);
    assert.ok('formMutation' in formDevtoolsProtocol);
    assert.ok('triggerValidation' in formDevtoolsProtocol);
  });

  it('formRegistered direction is page->panel', () => {
    assert.equal(formDevtoolsProtocol.formRegistered.direction, 'page->panel');
  });

  it('formStateChanged direction is page->panel', () => {
    assert.equal(formDevtoolsProtocol.formStateChanged.direction, 'page->panel');
  });

  it('formMutation direction is page->panel', () => {
    assert.equal(formDevtoolsProtocol.formMutation.direction, 'page->panel');
  });

  it('triggerValidation direction is panel->page', () => {
    assert.equal(formDevtoolsProtocol.triggerValidation.direction, 'panel->page');
  });

  it('formRegistered is notification pattern', () => {
    assert.equal(formDevtoolsProtocol.formRegistered._pattern, 'notification');
  });

  it('triggerValidation is notification pattern', () => {
    assert.equal(formDevtoolsProtocol.triggerValidation._pattern, 'notification');
  });
});

describe('FormStore accessor methods', () => {
  it('getSpecIds returns spec IDs in tree order', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const ids = store.getSpecIds();
    assert.deepEqual(ids, [
      specs.nameSpec.id,
      specs.emailSpec.id,
      specs.addressSpec.id,
      specs.citySpec.id,
      specs.zipSpec.id,
    ]);
  });

  it('getSpecInfo returns correct data for a field spec', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const info = store.getSpecInfo(specs.nameSpec.id);
    assert.deepEqual(info, { path: 'name', kind: 'field', mountRequired: false });
  });

  it('getSpecInfo returns correct data for an object spec', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const info = store.getSpecInfo(specs.addressSpec.id);
    assert.deepEqual(info, { path: 'address', kind: 'object', mountRequired: false });
  });

  it('getSpecInfo returns null for unknown spec ID', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    assert.equal(store.getSpecInfo('nonexistent'), null);
  });

  it('getSpecTree returns correct structure', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const tree = store.getSpecTree();
    assert.deepEqual(tree, {
      name: { id: specs.nameSpec.id, kind: 'field', mountRequired: false },
      email: { id: specs.emailSpec.id, kind: 'field', mountRequired: false },
      address: { id: specs.addressSpec.id, kind: 'object', mountRequired: false },
      'address.city': { id: specs.citySpec.id, kind: 'field', mountRequired: false },
      'address.zip': { id: specs.zipSpec.id, kind: 'field', mountRequired: false },
    });
  });
});

describe('FormStore getDevtoolsSnapshot', () => {
  it('returns initial state with no errors or touched', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const snap = store.getDevtoolsSnapshot();
    assert.deepEqual(snap.errors, {
      [specs.nameSpec.id]: null,
      [specs.emailSpec.id]: null,
      [specs.addressSpec.id]: null,
      [specs.citySpec.id]: null,
      [specs.zipSpec.id]: null,
    });
    assert.deepEqual(snap.touched, {
      [specs.nameSpec.id]: false,
      [specs.emailSpec.id]: false,
      [specs.addressSpec.id]: false,
      [specs.citySpec.id]: false,
      [specs.zipSpec.id]: false,
    });
    assert.deepEqual(snap.mounted, []);
  });

  it('reflects values after set', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.nameSpec, 'Alice');
    const snap = store.getDevtoolsSnapshot();
    assert.equal(snap.values.name, 'Alice');
  });

  it('reflects touched state', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.set(specs.nameSpec, 'Alice');
    const snap = store.getDevtoolsSnapshot();
    assert.equal(snap.touched[specs.nameSpec.id], true);
    assert.equal(snap.touched[specs.emailSpec.id], false);
  });

  it('reflects mounted specs', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    store.mount(specs.nameSpec.id);
    store.mount(specs.citySpec.id);
    const snap = store.getDevtoolsSnapshot();
    assert.deepEqual(snap.mounted, [specs.nameSpec.id, specs.citySpec.id]);
  });

  it('reflects validation errors', () => {
    const passwordSpec = new FieldSpec<string>({
      id: 'password',
      mountRequired: false,
      schema: { safeParse: (v: unknown) => typeof v === 'string' && v.length > 0 ? { success: true } : { success: false, error: { issues: [{ message: 'Required' }] } } },
    });
    const store = new FormStore({ password: passwordSpec });

    store.validateSpec(passwordSpec.id);
    const snap = store.getDevtoolsSnapshot();
    assert.equal(snap.errors[passwordSpec.id], 'Required');
  });
});

describe('FormDevtools', () => {
  it('constructs without throwing', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const devtools = new FormDevtools(store, 'test-form');
    assert.ok(devtools);
  });

  it('uses default formId when none provided', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const devtools = new FormDevtools(store);
    assert.ok(devtools);
  });

  it('disconnect cleans up without error', () => {
    const specs = createTestSpecs();
    const store = createStore(specs);

    const devtools = new FormDevtools(store, 'test-form');
    devtools.disconnect();
  });
});
