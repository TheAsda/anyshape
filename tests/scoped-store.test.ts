import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { field, object, form } from '../src/specs/factories.js';
import { FormStore } from '../src/store/form-store.js';
import { ScopedStore } from '../src/store/scoped-store.js';
import { ObjectSpec } from '../src/specs/object.js';

describe('ScopedStore — mount initializes data slice when at static default', () => {
  it('mounts the scope spec in FormStore', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    rootScope.mount();

    assert.equal(store.isMounted(spec), true);
  });

  it('fills undefined fields with static defaults on mount', () => {
    const citySpec = field<string>({ defaultValue: 'NYC' });
    const zipSpec = field<string>();
    const addressSpec = object({ city: citySpec, zip: zipSpec });
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    addressScope.mount();

    assert.equal(store.get(citySpec), 'NYC');
    assert.equal(store.get(zipSpec), undefined);
  });
});

describe('ScopedStore — mount with defaults overrides pre-filled static default', () => {
  it('mount defaults override static defaults when scope is at static default', () => {
    const citySpec = field<string>({ defaultValue: 'default-city' });
    const zipSpec = field<string>({ defaultValue: '00000' });
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: 'default-city', zip: '00000' } },
    );
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    addressScope.mount({ city: 'Boston', zip: '02134' });

    assert.equal(store.get(citySpec), 'Boston');
    assert.equal(store.get(zipSpec), '02134');
  });

  it('mount defaults merge partially — only specified fields override', () => {
    const citySpec = field<string>({ defaultValue: 'default-city' });
    const zipSpec = field<string>({ defaultValue: '00000' });
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: 'default-city', zip: '00000' } },
    );
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    addressScope.mount({ city: 'Boston' });

    assert.equal(store.get(citySpec), 'Boston');
    assert.equal(store.get(zipSpec), '00000');
  });
});

describe('ScopedStore — mount does NOT override initialData', () => {
  it('mount defaults skip fields that were set via initialData', () => {
    const nameSpec = field<string>({ defaultValue: 'default-name' });
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec, { name: 'from-init' });
    const rootScope = new ScopedStore(store, spec, null);

    rootScope.mount({ name: 'mount-default' });

    assert.equal(store.get(nameSpec), 'from-init');
  });

  it('mount defaults partially applied when some fields from initialData', () => {
    const citySpec = field<string>({ defaultValue: 'default-city' });
    const zipSpec = field<string>({ defaultValue: '00000' });
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: 'default-city', zip: '00000' } },
    );
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec, address: addressSpec });
    const store = new FormStore(spec, {
      address: { city: 'init-city' },
    });
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    addressScope.mount({ city: 'mount-city', zip: 'mount-zip' });

    assert.equal(store.get(citySpec), 'init-city');
    assert.equal(store.get(zipSpec), 'mount-zip');
  });
});

describe('ScopedStore — unmount resets to static default', () => {
  it('unmount resets value to static default', () => {
    const citySpec = field<string>({ defaultValue: 'default-city' });
    const zipSpec = field<string>({ defaultValue: '00000' });
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: 'default-city', zip: '00000' } },
    );
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec, {
      address: { city: 'Boston', zip: '02134' },
    });
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    addressScope.mount({ city: 'Boston', zip: '02134' });
    assert.equal(store.get(citySpec), 'Boston');

    addressScope.unmount();

    assert.deepEqual(store.get(addressSpec), {
      city: 'default-city',
      zip: '00000',
    });
    assert.equal(store.isMounted(addressSpec), false);
  });
});

describe('ScopedStore — re-mount after unmount applies mount defaults again', () => {
  it('unmount resets to static default, re-mount sees static default and applies defaults', () => {
    const citySpec = field<string>({ defaultValue: 'default-city' });
    const addressSpec = object(
      { city: citySpec },
      { defaultValue: { city: 'default-city' } },
    );
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    addressScope.mount({ city: 'first-mount' });
    assert.equal(store.get(citySpec), 'first-mount');

    addressScope.unmount();
    assert.equal(store.get(citySpec), 'default-city');

    addressScope.mount({ city: 'second-mount' });
    assert.equal(store.get(citySpec), 'second-mount');
  });
});

describe('ScopedStore — write to owned field succeeds', () => {
  it('set on owned field delegates to FormStore', () => {
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    addressScope.set(citySpec, 'NYC');

    assert.equal(store.get(citySpec), 'NYC');
  });

  it('set on root-owned field succeeds', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    rootScope.set(nameSpec, 'Alice');

    assert.equal(store.get(nameSpec), 'Alice');
  });
});

describe('ScopedStore — write to non-owned field throws', () => {
  it('set on parent scope field from child scope throws', () => {
    const nameSpec = field<string>();
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ name: nameSpec, address: addressSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    assert.throws(
      () => addressScope.set(nameSpec, 'Alice'),
      /not owned by this scope/,
    );
  });

  it('set on sibling scope field throws', () => {
    const nameSpec = field<string>();
    const emailSpec = field<string>();
    const spec = form({ name: nameSpec, email: emailSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    // nameSpec is owned by root — writing from root is fine
    rootScope.set(nameSpec, 'Alice');

    // But emailSpec is also owned by root
    rootScope.set(emailSpec, 'a@b.com');

    // Both are owned by root, so both succeed
    assert.equal(store.get(nameSpec), 'Alice');
    assert.equal(store.get(emailSpec), 'a@b.com');
  });
});

describe('ScopedStore — read from owned field works', () => {
  it('get on owned field returns value from FormStore', () => {
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec, { address: { city: 'Boston' } });
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    assert.equal(addressScope.get(citySpec), 'Boston');
  });
});

describe('ScopedStore — read from ancestor field bubbles up', () => {
  it('child scope reads parent scope field via bubble', () => {
    const nameSpec = field<string>();
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ name: nameSpec, address: addressSpec });
    const store = new FormStore(spec, {
      name: 'Alice',
      address: { city: 'Boston' },
    });
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    // addressScope doesn't own nameSpec, but rootScope does
    assert.equal(addressScope.get(nameSpec), 'Alice');
  });

  it('deeply nested scope bubbles through multiple ancestors', () => {
    const nameSpec = field<string>();
    const citySpec = field<string>();
    const zipSpec = field<string>();
    const locationSpec = object({ zip: zipSpec });
    const addressSpec = object({ city: citySpec, location: locationSpec });
    const spec = form({ name: nameSpec, address: addressSpec });
    const store = new FormStore(spec, {
      name: 'Alice',
      address: { city: 'Boston', location: { zip: '02134' } },
    });

    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );
    const locationScope = new ScopedStore(
      store,
      locationSpec as ObjectSpec,
      addressScope,
    );

    // locationScope doesn't own nameSpec, bubbles through addressScope → rootScope
    assert.equal(locationScope.get(nameSpec), 'Alice');
    assert.equal(locationScope.get(zipSpec), '02134');
  });

  it('reading field not in scope chain throws', () => {
    const nameSpec = field<string>();
    const otherSpec = field<string>();
    const spec1 = form({ name: nameSpec });
    const spec2 = form({ other: otherSpec });
    const store = new FormStore(spec1);
    const rootScope = new ScopedStore(store, spec1, null);

    assert.throws(
      () => rootScope.get(otherSpec),
      /not accessible from this scope chain/,
    );
  });
});

describe('ScopedStore — nested scope creation via scopeObject', () => {
  it('scopeObject creates child ScopedStore', () => {
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    const addressScope = rootScope.scopeObject(
      addressSpec as ObjectSpec,
    );

    addressScope.mount({ city: 'NYC' });
    assert.equal(store.get(citySpec), 'NYC');
  });

  it('scopeObject on non-child spec throws', () => {
    const citySpec = field<string>();
    const addressSpec = object({ city: citySpec });
    const otherSpec = object({ city: field<string>() });
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    assert.throws(
      () => rootScope.scopeObject(otherSpec),
      /not owned by this scope/,
    );
  });

  it('scopeObject chain supports deep nesting', () => {
    const zipSpec = field<string>();
    const locationSpec = object({ zip: zipSpec });
    const addressSpec = object({ location: locationSpec });
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    const addressScope = rootScope.scopeObject(
      addressSpec as ObjectSpec,
    );
    const locationScope = addressScope.scopeObject(
      locationSpec as ObjectSpec,
    );

    locationScope.mount({ zip: '02134' });
    assert.equal(store.get(zipSpec), '02134');
  });
});

describe('ScopedStore — mount does not overwrite user-edited data', () => {
  it('user edits preserved on mount with defaults', () => {
    const citySpec = field<string>({ defaultValue: 'default-city' });
    const zipSpec = field<string>({ defaultValue: '00000' });
    const addressSpec = object(
      { city: citySpec, zip: zipSpec },
      { defaultValue: { city: 'default-city', zip: '00000' } },
    );
    const spec = form({ address: addressSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);
    const addressScope = new ScopedStore(
      store,
      addressSpec as ObjectSpec,
      rootScope,
    );

    // First mount with defaults
    addressScope.mount({ city: 'first-city', zip: '11111' });
    assert.equal(store.get(citySpec), 'first-city');

    // User edits city
    store.set(citySpec, 'user-edited');

    // Unmount
    addressScope.unmount();
    assert.equal(store.get(citySpec), 'default-city');

    // Re-mount with different defaults — city is at static default so it should be overridden
    addressScope.mount({ city: 'second-city', zip: '22222' });
    assert.equal(store.get(citySpec), 'second-city');
    assert.equal(store.get(zipSpec), '22222');
  });
});

describe('ScopedStore — getError delegates to FormStore', () => {
  it('getError returns error from FormStore', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    assert.equal(rootScope.getError(nameSpec), null);
  });
});

describe('ScopedStore — subscribe delegates to FormStore', () => {
  it('subscribe receives notifications via FormStore', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    let callCount = 0;
    const unsub = rootScope.subscribe(nameSpec, () => {
      callCount++;
    });

    store.set(nameSpec, 'hello');
    assert.equal(callCount, 1);

    unsub();
    store.set(nameSpec, 'world');
    assert.equal(callCount, 1);
  });
});

describe('ScopedStore — scopeArray throws', () => {
  it('scopeArray throws not implemented', () => {
    const nameSpec = field<string>();
    const spec = form({ name: nameSpec });
    const store = new FormStore(spec);
    const rootScope = new ScopedStore(store, spec, null);

    assert.throws(
      () => rootScope.scopeArray({} as never),
      /not yet implemented/,
    );
  });
});
