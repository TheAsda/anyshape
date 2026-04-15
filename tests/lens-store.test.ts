import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LensStore } from '../src/store/lens-store.js';
import { field, object, array, form } from '../src/specs/factories.js';
import { ObjectSpec } from '../src/specs/object.js';
import { ArraySpec } from '../src/specs/array.js';
import { FieldSpec } from '../src/specs/field.js';

describe('LensStore — static fields', () => {
  it('resolves a top-level field lens', () => {
    const spec = form({
      name: field<string>(),
    });

    const store = new LensStore(spec);
    const nameSpec = (spec.children.name as FieldSpec<string>);
    const lens = store.get(nameSpec);

    const data = { name: 'Alice' };
    assert.equal(lens.get(data), 'Alice');
  });

  it('resolves a nested object field lens', () => {
    const spec = form({
      address: object({
        city: field<string>(),
        zip: field<string>(),
      }),
    });

    const store = new LensStore(spec);
    const addressSpec = (spec.children.address as ObjectSpec);
    const citySpec = (addressSpec.children.city as FieldSpec<string>);
    const zipSpec = (addressSpec.children.zip as FieldSpec<string>);

    const data = {
      address: { city: 'NYC', zip: '10001' },
    };

    assert.equal(store.get(citySpec).get(data), 'NYC');
    assert.equal(store.get(zipSpec).get(data), '10001');
  });

  it('sets a value through a nested field lens', () => {
    const spec = form({
      address: object({
        city: field<string>(),
      }),
    });

    const store = new LensStore(spec);
    const citySpec = ((spec.children.address as ObjectSpec).children.city as FieldSpec<string>);
    const lens = store.get(citySpec);

    const data = { address: { city: 'NYC' } };
    const updated = lens.set('LA', data);
    assert.deepEqual(updated, { address: { city: 'LA' } });
    assert.equal(data.address.city, 'NYC');
  });

  it('resolves deeply nested static fields', () => {
    const spec = form({
      customer: object({
        profile: object({
          email: field<string>(),
        }),
      }),
    });

    const store = new LensStore(spec);
    const emailSpec = (
      ((spec.children.customer as ObjectSpec).children.profile as ObjectSpec)
        .children.email as FieldSpec<string>
    );

    const data = { customer: { profile: { email: 'a@b.com' } } };
    assert.equal(store.get(emailSpec).get(data), 'a@b.com');
  });
});

describe('LensStore — array item fields with dynamic index', () => {
  it('getWithIndex returns different values for different indices', () => {
    const spec = form({
      items: array(object({
        name: field<string>(),
        qty: field<number>(),
      })),
    });

    const store = new LensStore(spec);
    const itemsSpec = (spec.children.items as ArraySpec);
    const nameSpec = (itemsSpec.item.children.name as FieldSpec<string>);

    const data = {
      items: [
        { name: 'Apple', qty: 3 },
        { name: 'Banana', qty: 5 },
        { name: 'Cherry', qty: 7 },
      ],
    };

    assert.equal(store.getWithIndex(nameSpec, 0).get(data), 'Apple');
    assert.equal(store.getWithIndex(nameSpec, 1).get(data), 'Banana');
    assert.equal(store.getWithIndex(nameSpec, 2).get(data), 'Cherry');
  });

  it('getWithIndex sets values at correct indices', () => {
    const spec = form({
      items: array(object({
        name: field<string>(),
      })),
    });

    const store = new LensStore(spec);
    const itemsSpec = (spec.children.items as ArraySpec);
    const nameSpec = (itemsSpec.item.children.name as FieldSpec<string>);

    const data = {
      items: [
        { name: 'Apple' },
        { name: 'Banana' },
      ],
    };

    const lens1 = store.getWithIndex(nameSpec, 1);
    const updated = lens1.set('Orange', data);
    assert.deepEqual(updated, {
      items: [
        { name: 'Apple' },
        { name: 'Orange' },
      ],
    });
    assert.equal(data.items[1].name, 'Banana');
  });

  it('getWithIndex at index 0 produces same result as previous hardcoded index(0)', () => {
    const spec = form({
      items: array(object({
        val: field<number>(),
      })),
    });

    const store = new LensStore(spec);
    const valSpec = ((spec.children.items as ArraySpec).item.children.val as FieldSpec<number>);

    const data = { items: [{ val: 42 }] };
    assert.equal(store.getWithIndex(valSpec, 0).get(data), 42);
  });

  it('getWithIndex does not affect sibling indices on set', () => {
    const spec = form({
      items: array(object({
        name: field<string>(),
      })),
    });

    const store = new LensStore(spec);
    const nameSpec = ((spec.children.items as ArraySpec).item.children.name as FieldSpec<string>);

    const data = {
      items: [
        { name: 'First' },
        { name: 'Second' },
        { name: 'Third' },
      ],
    };

    const updated = store.getWithIndex(nameSpec, 1).set('Changed', data) as typeof data;
    assert.equal(updated.items[0].name, 'First');
    assert.equal(updated.items[1].name, 'Changed');
    assert.equal(updated.items[2].name, 'Third');
  });
});

describe('LensStore — deeply nested with arrays', () => {
  it('resolves field inside array inside object', () => {
    const spec = form({
      customer: object({
        addresses: array(object({
          zip: field<string>(),
        })),
      }),
    });

    const store = new LensStore(spec);
    const addressesSpec = (
      (spec.children.customer as ObjectSpec).children.addresses as ArraySpec
    );
    const zipSpec = (addressesSpec.item.children.zip as FieldSpec<string>);

    const data = {
      customer: {
        addresses: [
          { zip: '10001' },
          { zip: '90210' },
        ],
      },
    };

    assert.equal(store.getWithIndex(zipSpec, 0).get(data), '10001');
    assert.equal(store.getWithIndex(zipSpec, 1).get(data), '90210');
  });

  it('sets value in deeply nested array field', () => {
    const spec = form({
      customer: object({
        addresses: array(object({
          zip: field<string>(),
        })),
      }),
    });

    const store = new LensStore(spec);
    const addressesSpec = (
      (spec.children.customer as ObjectSpec).children.addresses as ArraySpec
    );
    const zipSpec = (addressesSpec.item.children.zip as FieldSpec<string>);

    const data = {
      customer: {
        addresses: [
          { zip: '10001' },
          { zip: '90210' },
        ],
      },
    };

    const updated = store.getWithIndex(zipSpec, 1).set('30301', data);
    assert.deepEqual(updated, {
      customer: {
        addresses: [
          { zip: '10001' },
          { zip: '30301' },
        ],
      },
    });
  });

  it('resolves multiple array fields independently', () => {
    const spec = form({
      phones: array(object({
        number: field<string>(),
      })),
      emails: array(object({
        address: field<string>(),
      })),
    });

    const store = new LensStore(spec);
    const phonesSpec = (spec.children.phones as ArraySpec);
    const emailsSpec = (spec.children.emails as ArraySpec);
    const numberSpec = (phonesSpec.item.children.number as FieldSpec<string>);
    const addressSpec = (emailsSpec.item.children.address as FieldSpec<string>);

    const data = {
      phones: [
        { number: '555-0001' },
        { number: '555-0002' },
      ],
      emails: [
        { address: 'a@b.com' },
        { address: 'c@d.com' },
      ],
    };

    assert.equal(store.getWithIndex(numberSpec, 0).get(data), '555-0001');
    assert.equal(store.getWithIndex(numberSpec, 1).get(data), '555-0002');
    assert.equal(store.getWithIndex(addressSpec, 0).get(data), 'a@b.com');
    assert.equal(store.getWithIndex(addressSpec, 1).get(data), 'c@d.com');
  });
});

describe('LensStore — root spec and array spec lenses', () => {
  it('stores a lens for the root object spec', () => {
    const spec = form({
      name: field<string>(),
    });

    const store = new LensStore(spec);
    const rootLens = store.get(spec);

    const data = { name: 'Test' };
    assert.deepEqual(rootLens.get(data), data);
  });

  it('stores a lens for the array spec itself', () => {
    const spec = form({
      items: array(object({
        name: field<string>(),
      })),
    });

    const store = new LensStore(spec);
    const itemsSpec = (spec.children.items as ArraySpec);
    const arrayLens = store.get(itemsSpec);

    const data = { items: [{ name: 'A' }, { name: 'B' }] };
    assert.deepEqual(arrayLens.get(data), [{ name: 'A' }, { name: 'B' }]);
  });

  it('getWithIndex on item ObjectSpec focuses on array element', () => {
    const spec = form({
      items: array(object({
        name: field<string>(),
      })),
    });

    const store = new LensStore(spec);
    const itemSpec = (spec.children.items as ArraySpec).item;

    const data = { items: [{ name: 'A' }, { name: 'B' }] };
    assert.deepEqual(store.getWithIndex(itemSpec, 0).get(data), { name: 'A' });
    assert.deepEqual(store.getWithIndex(itemSpec, 1).get(data), { name: 'B' });
  });
});

describe('LensStore — error handling', () => {
  it('throws for unknown spec', () => {
    const spec = form({
      name: field<string>(),
    });

    const store = new LensStore(spec);
    const orphan = field<string>();
    assert.throws(
      () => store.get(orphan),
      { message: /Unknown spec/ },
    );
  });

  it('throws for non-array-descendant spec in getWithIndex', () => {
    const spec = form({
      name: field<string>(),
    });

    const store = new LensStore(spec);
    const nameSpec = (spec.children.name as FieldSpec<string>);
    assert.throws(
      () => store.getWithIndex(nameSpec, 0),
      { message: /not an array item descendant/ },
    );
  });
});
