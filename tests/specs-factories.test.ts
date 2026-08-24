import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { field, object, array, meta, form } from '../src/specs/factories.js';
import { FieldSpec } from '../src/specs/field.js';
import { ObjectSpec } from '../src/specs/object.js';
import { ArraySpec } from '../src/specs/array.js';
import { MetaSpec } from '../src/specs/meta.js';

describe('field() factory', () => {
  it('creates a FieldSpec with kind="field"', () => {
    const f = field<string>();
    assert.equal(f._kind, 'field');
    assert.ok(f instanceof FieldSpec);
  });

  it('creates a FieldSpec with defaultValue when provided', () => {
    const f = field<number>({ defaultValue: 0 });
    assert.equal(f.defaultValue, 0);
  });

  it('creates specs with unique auto-generated ids', () => {
    const a = field<string>();
    const b = field<string>();
    assert.notStrictEqual(a.id, b.id);
  });

  it('accepts custom id', () => {
    const f = field<string>({ id: 'my-field' });
    assert.equal(f.id, 'my-field');
  });
});

describe('object() factory', () => {
  it('creates an ObjectSpec with children', () => {
    const nameField = field<string>();
    const obj = object({ name: nameField });
    assert.ok(obj instanceof ObjectSpec);
    assert.strictEqual(obj.children.name, nameField);
    assert.equal(obj._kind, 'object');
  });
});

describe('array() factory', () => {
  it('creates an ArraySpec with kind="array"', () => {
    const arr = array(object({ value: field<string>() }));
    assert.ok(arr instanceof ArraySpec);
    assert.equal(arr._kind, 'array');
  });

  it('exposes item', () => {
    const itemSpec = object({ value: field<string>() });
    const arr = array(itemSpec);
    assert.strictEqual(arr.item, itemSpec);
  });
});

describe('meta() factory', () => {
  it('creates a MetaSpec with kind="meta"', () => {
    const m = meta<{ loaded: boolean }>();
    assert.ok(m instanceof MetaSpec);
    assert.equal(m._kind, 'meta');
  });

  it('creates specs with unique ids', () => {
    const a = meta<boolean>();
    const b = meta<string>();
    assert.notStrictEqual(a.id, b.id);
  });
});

describe('form() factory', () => {
  const myForm = form({
    name: field<string>(),
    age: field<number>({ defaultValue: 0 }),
    customer: object({
      code: field<string>(),
    }),
    applications: array(
      object({ appId: field<string>(), score: field<number>() }),
    ),
    extra: meta<{ loaded: boolean }>(),
  });

  it('returns an ObjectSpec', () => {
    assert.ok(myForm instanceof ObjectSpec);
    assert.equal(myForm._kind, 'object');
  });

  it('top-level children are accessible via .children', () => {
    assert.ok(myForm.children.name instanceof FieldSpec);
    assert.ok(myForm.children.age instanceof FieldSpec);
    assert.ok(myForm.children.customer instanceof ObjectSpec);
    assert.ok(myForm.children.applications instanceof ArraySpec);
    assert.ok(myForm.children.extra instanceof MetaSpec);
  });

  it('nested ObjectSpec children are accessible', () => {
    assert.ok(myForm.children.customer.children.code instanceof FieldSpec);
    assert.equal(myForm.children.customer.children.code._kind, 'field');
  });

  it('ArraySpec item is an ObjectSpec with children', () => {
    assert.ok(myForm.children.applications.item instanceof ObjectSpec);
    assert.ok(
      myForm.children.applications.item.children.appId instanceof FieldSpec,
    );
    assert.ok(
      myForm.children.applications.item.children.score instanceof FieldSpec,
    );
  });

  it('assigns path-based ids to children', () => {
    assert.equal(myForm.children.name.id, 'name');
    assert.equal(myForm.children.age.id, 'age');
    assert.equal(myForm.children.customer.id, 'customer');
    assert.equal(myForm.children.customer.children.code.id, 'customer.code');
    assert.equal(myForm.children.applications.id, 'applications');
    assert.equal(myForm.children.applications.item.id, 'applications[]');
    assert.equal(
      myForm.children.applications.item.children.appId.id,
      'applications[].appId',
    );
    assert.equal(
      myForm.children.applications.item.children.score.id,
      'applications[].score',
    );
    assert.equal(myForm.children.extra.id, 'extra');
  });

  it('every spec has a unique id', () => {
    const ids = new Set<string>();
    const allSpecs = [
      myForm,
      myForm.children.name,
      myForm.children.age,
      myForm.children.customer,
      myForm.children.customer.children.code,
      myForm.children.applications,
      myForm.children.applications.item,
      myForm.children.applications.item.children.appId,
      myForm.children.applications.item.children.score,
      myForm.children.extra,
    ];
    for (const spec of allSpecs) {
      assert.ok(!ids.has(spec.id), `duplicate id: ${spec.id}`);
      ids.add(spec.id);
    }
  });

  it('field with defaultValue stores it', () => {
    assert.equal(myForm.children.age.defaultValue, 0);
  });
});
