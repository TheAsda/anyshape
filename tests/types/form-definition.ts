import { expectType, TypeEqual } from 'ts-expect';
import { field, object, array, meta, form } from '../../src/specs/factories.js';
import { FieldSpec } from '../../src/specs/field.js';
import { MetaSpec } from '../../src/specs/meta.js';

// ── Concrete form definition ───────────────────────────────────────────────

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

// ── 1. Top-level field resolves to FieldSpec<Valid, Raw> ──────────────────

expectType<TypeEqual<typeof myForm.name, FieldSpec<string, string | undefined>>>(true);

// ── 2. Nested dot-path: object → child field ──────────────────────────────

expectType<TypeEqual<typeof myForm.customer.code, FieldSpec<string, string | undefined>>>(true);

// ── 3. Array wrapping an object: kind is 'array' ─────────────────────────

expectType<TypeEqual<typeof myForm.applications.kind, 'array'>>(true);

// ── 4. ArraySpec forwards ObjectSpec children as named accessors ──────────

expectType<TypeEqual<typeof myForm.applications.appId, FieldSpec<string, string | undefined>>>(true);
expectType<TypeEqual<typeof myForm.applications.score, FieldSpec<number, number | undefined>>>(true);

// ── 5. Primitive array: kind is 'array' ───────────────────────────────────

expectType<TypeEqual<typeof myForm.tags.kind, 'array'>>(true);

// ── 6. MetaSpec resolves with its Value type parameter ───────────────────

expectType<TypeEqual<typeof myForm.extra, MetaSpec<{ loaded: boolean }>>>(true);

// ── Age field with defaultValue retains Raw = number | undefined ──────────

expectType<TypeEqual<typeof myForm.age, FieldSpec<number, number | undefined>>>(true);
