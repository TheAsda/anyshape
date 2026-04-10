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
    assert.equal(f.kind, 'field');
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
  it('creates an ObjectSpec with named child accessors', () => {
    const nameField = field<string>();
    const obj = object({ name: nameField });
    assert.ok(obj instanceof ObjectSpec);
    assert.strictEqual(obj.name, nameField);
    assert.equal(obj.kind, 'object');
  });

  it('sets _parent on children', () => {
    const f = field<string>();
    const obj = object({ f });
    assert.strictEqual(f._parent, obj);
  });
});

describe('array() factory', () => {
  it('creates an ArraySpec with kind="array"', () => {
    const arr = array(field<string>());
    assert.ok(arr instanceof ArraySpec);
    assert.equal(arr.kind, 'array');
  });

  it('exposes itemSpec', () => {
    const itemField = field<string>();
    const arr = array(itemField);
    assert.strictEqual(arr.itemSpec, itemField);
  });

  it('forwards ObjectSpec item children as named accessors', () => {
    const codeField = field<string>();
    const scoreField = field<number>();
    const arr = array(object({ code: codeField, score: scoreField }));
    assert.strictEqual(arr.code, codeField);
    assert.strictEqual(arr.score, scoreField);
  });
});

describe('meta() factory', () => {
  it('creates a MetaSpec with kind="meta"', () => {
    const m = meta<{ loaded: boolean }>();
    assert.ok(m instanceof MetaSpec);
    assert.equal(m.kind, 'meta');
  });

  it('creates specs with unique ids', () => {
    const a = meta<boolean>();
    const b = meta<string>();
    assert.notStrictEqual(a.id, b.id);
  });
});

describe('form() factory — dot-path traversal', () => {
  const myForm = form({
    name: field<string>(),
    age: field<number>({ defaultValue: 0 }),
    customer: object({
      code: field<string>(),
    }),
    applications: array(object({ appId: field<string>(), score: field<number>() })),
    tags: array(field<string>()),
    extra: meta<{ loaded: boolean }>(),
  });

  it('returns an object with all spec instances accessible', () => {
    assert.ok('name' in myForm);
    assert.ok('age' in myForm);
    assert.ok('customer' in myForm);
    assert.ok('applications' in myForm);
    assert.ok('tags' in myForm);
    assert.ok('extra' in myForm);
  });

  it('top-level field is a FieldSpec', () => {
    assert.ok(myForm.name instanceof FieldSpec);
    assert.equal(myForm.name.kind, 'field');
  });

  it('nested ObjectSpec is accessible and has kind="object"', () => {
    assert.ok(myForm.customer instanceof ObjectSpec);
    assert.equal(myForm.customer.kind, 'object');
  });

  it('nested child via dot-path is a FieldSpec', () => {
    assert.ok(myForm.customer.code instanceof FieldSpec);
    assert.equal(myForm.customer.code.kind, 'field');
  });

  it('ArraySpec forwards children from ObjectSpec item', () => {
    assert.ok(myForm.applications instanceof ArraySpec);
    assert.ok(myForm.applications.appId instanceof FieldSpec);
    assert.ok(myForm.applications.score instanceof FieldSpec);
    assert.equal(myForm.applications.appId.kind, 'field');
  });

  it('primitive array is an ArraySpec', () => {
    assert.ok(myForm.tags instanceof ArraySpec);
    assert.equal(myForm.tags.kind, 'array');
  });

  it('MetaSpec is accessible', () => {
    assert.ok(myForm.extra instanceof MetaSpec);
    assert.equal(myForm.extra.kind, 'meta');
  });

  it('every spec has a unique id', () => {
    const ids = new Set<string>();
    const allSpecs = [
      myForm.name,
      myForm.age,
      myForm.customer,
      myForm.customer.code,
      myForm.applications,
      myForm.applications.appId,
      myForm.applications.score,
      myForm.tags,
      myForm.extra,
    ];
    for (const spec of allSpecs) {
      assert.ok(!ids.has(spec.id), `duplicate id: ${spec.id}`);
      ids.add(spec.id);
    }
  });

  it('field with defaultValue stores it', () => {
    assert.equal(myForm.age.defaultValue, 0);
  });
});
