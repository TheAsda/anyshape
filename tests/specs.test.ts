import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FieldSpec, MetaSpec, ObjectSpec, ArraySpec, BaseSpec, ValidatableSpec } from '../src/specs/index.js';
import { z } from 'zod/v4';

describe('BaseSpec', () => {
  it('auto-generates unique ids', () => {
    class TestSpec extends BaseSpec { readonly _kind = 'field' as const; }
    const a = new TestSpec();
    const b = new TestSpec();
    assert.ok(a.id.startsWith('spec_'));
    assert.ok(b.id.startsWith('spec_'));
    assert.notStrictEqual(a.id, b.id);
  });

  it('defaults mountRequired to true', () => {
    class TestSpec extends BaseSpec { readonly _kind = 'field' as const; }
    const spec = new TestSpec();
    assert.equal(spec.mountRequired, true);
  });

  it('accepts custom id and mountRequired', () => {
    class TestSpec extends BaseSpec { readonly _kind = 'field' as const; }
    const spec = new TestSpec({ id: 'my-id', mountRequired: false });
    assert.equal(spec.id, 'my-id');
    assert.equal(spec.mountRequired, false);
  });
});

describe('FieldSpec', () => {
  it('has kind="field"', () => {
    const field = new FieldSpec<string>();
    assert.equal(field._kind, 'field');
  });

  it('defaults keepOnUnmount and alwaysValidate to false', () => {
    const field = new FieldSpec<string>();
    assert.equal(field.keepOnUnmount, false);
    assert.equal(field.alwaysValidate, false);
  });

  it('stores defaultValue when provided', () => {
    const field = new FieldSpec<number, number | undefined>({ defaultValue: 0 });
    assert.equal(field.defaultValue, 0);
  });

  it('has no schema by default', () => {
    const field = new FieldSpec<string>();
    assert.equal(field._schema, undefined);
  });

  it('accepts a schema', () => {
    const testSchema = z.string();
    const field = new FieldSpec<string>({ schema: testSchema });
    assert.deepEqual(field._schema, testSchema);
  });
});

describe('MetaSpec', () => {
  it('has kind="meta"', () => {
    const meta = new MetaSpec<boolean>();
    assert.equal(meta._kind, 'meta');
  });

  it('does not have _schema property', () => {
    const meta = new MetaSpec<boolean>();
    assert.equal('_schema' in meta, false);
  });

  it('extends BaseSpec (has id and mountRequired)', () => {
    const meta = new MetaSpec<boolean>();
    assert.ok(meta.id.startsWith('spec_'));
    assert.equal(meta.mountRequired, true);
  });
});

describe('ValidatableSpec', () => {
  it('schema is optional', () => {
    class TestValidatable extends ValidatableSpec<string> { readonly _kind = 'field' as const; }
    const spec = new TestValidatable();
    assert.equal(spec._schema, undefined);
  });
});

describe('ObjectSpec', () => {
  it('creates named child accessors', () => {
    const nameField = new FieldSpec<string>();
    const obj = new ObjectSpec({ name: nameField });
    assert.ok(obj.name instanceof FieldSpec);
    assert.strictEqual(obj.name, nameField);
  });

  it('child accessor returns same reference as children map', () => {
    const ageField = new FieldSpec<number>();
    const obj = new ObjectSpec({ age: ageField });
    assert.strictEqual(obj.age, obj.children.age);
  });

  it('sets _parent on children', () => {
    const field = new FieldSpec<string>();
    const obj = new ObjectSpec({ f: field });
    assert.strictEqual(field._parent, obj);
  });

  it('has kind="object"', () => {
    const obj = new ObjectSpec({ x: new FieldSpec<number>() });
    assert.equal(obj._kind, 'object');
  });
});

describe('ArraySpec', () => {
  it('forwards ObjectSpec item children as getters', () => {
    const idField = new FieldSpec<string>();
    const scoreField = new FieldSpec<number>();
    const objSpec = new ObjectSpec({ id: idField, score: scoreField });
    const arr = new ArraySpec(objSpec);

    assert.strictEqual(arr.id, idField);
    assert.strictEqual(arr.score, scoreField);
  });

  it('does not forward for primitive FieldSpec item', () => {
    const fieldSpec = new FieldSpec<string>();
    const arr = new ArraySpec(fieldSpec);
    const keys = Object.getOwnPropertyNames(arr).filter(
      k => !['_itemSpecValue', 'itemSpec', 'kind', 'id', 'mountRequired', '_schema', '_parent'].includes(k)
    );
    assert.deepEqual(keys, []);
  });

  it('exposes itemSpec', () => {
    const fieldSpec = new FieldSpec<string>();
    const arr = new ArraySpec(fieldSpec);
    assert.strictEqual(arr.itemSpec, fieldSpec);
  });

  it('has kind="array"', () => {
    const arr = new ArraySpec(new FieldSpec<string>());
    assert.equal(arr._kind, 'array');
  });
});

describe('Nested specs', () => {
  it('nested ObjectSpec works', () => {
    const street = new FieldSpec<string>();
    const city = new FieldSpec<string>();
    const address = new ObjectSpec({ street, city });
    const name = new FieldSpec<string>();
    const person = new ObjectSpec({ name, address });

    assert.strictEqual(person.name, name);
    assert.strictEqual(person.address, address);
    assert.strictEqual(person.address.street, street);
    assert.strictEqual(address._parent, person);
  });
});

describe('Unique ids across spec types', () => {
  it('each spec gets a unique auto-generated id', () => {
    const ids = new Set<string>();
    const field = new FieldSpec<string>();
    const meta = new MetaSpec<boolean>();
    const obj = new ObjectSpec({ f: new FieldSpec<string>() });
    const arr = new ArraySpec(new FieldSpec<string>());

    for (const spec of [field, meta, obj, arr]) {
      assert.ok(!ids.has(spec.id), `duplicate id: ${spec.id}`);
      ids.add(spec.id);
    }
  });
});
