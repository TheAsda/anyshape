import { expectType, TypeEqual } from 'ts-expect';
import type {
  InferForm,
  InferFormRaw,
  DeepPartial,
  FieldSpecLike,
  ObjectSpecLike,
  ArraySpecLike,
  MetaSpecLike,
} from '../../src/types/index.js';

// ── Test fixture: a nested form definition ──────────────────────────────────

type FormDef = {
  name: FieldSpecLike<string>;
  age: FieldSpecLike<number, number>;
  address: ObjectSpecLike<{
    city: FieldSpecLike<string>;
    zip: FieldSpecLike<string>;
  }>;
  tags: ArraySpecLike<FieldSpecLike<string>>;
  preferences: MetaSpecLike<{ loaded: boolean }>;
};

// ── InferForm resolves to validated output ──────────────────────────────────

type FormOutput = InferForm<FormDef>;

expectType<
  TypeEqual<
    FormOutput,
    {
      name: string;
      age: number;
      address: { city: string; zip: string };
      tags: string[];
      preferences: { loaded: boolean };
    }
  >
>(true);

// ── InferFormRaw resolves to raw (pre-validation) shape ────────────────────

type FormRaw = InferFormRaw<FormDef>;

expectType<
  TypeEqual<
    FormRaw,
    {
      name: string | undefined;
      age: number;
      address: { city: string | undefined; zip: string | undefined };
      tags: (string | undefined)[];
      preferences: { loaded: boolean };
    }
  >
>(true);

// ── DeepPartial makes nested properties optional ───────────────────────────

type PartialObj = { a: string; b: { c: number } };

expectType<
  TypeEqual<DeepPartial<PartialObj>, { a?: string; b?: { c?: number } }>
>(true);

// ── DeepPartial with arrays ────────────────────────────────────────────────

type NestedArr = { items: { name: string }[] };

expectType<
  TypeEqual<
    DeepPartial<NestedArr>,
    { items?: ({ name?: string })[] }
  >
>(true);

// ── DeepPartial with primitives passes through ─────────────────────────────

expectType<TypeEqual<DeepPartial<string>, string>>(true);
expectType<TypeEqual<DeepPartial<number>, number>>(true);
expectType<TypeEqual<DeepPartial<boolean>, boolean>>(true);

// ── InferForm on a single FieldSpecLike ─────────────────────────────────────

expectType<TypeEqual<InferForm<FieldSpecLike<string>>, string>>(true);
expectType<TypeEqual<InferForm<FieldSpecLike<number, number>>, number>>(true);

// ── InferForm on a single MetaSpecLike ─────────────────────────────────────

expectType<TypeEqual<InferForm<MetaSpecLike<boolean>>, boolean>>(true);

// ── InferForm on a single ArraySpecLike ─────────────────────────────────────

expectType<TypeEqual<InferForm<ArraySpecLike<FieldSpecLike<string>>>, string[]>>(true);

// ── InferFormRaw on a single FieldSpecLike ─────────────────────────────────

expectType<TypeEqual<InferFormRaw<FieldSpecLike<string>>, string | undefined>>(true);
expectType<TypeEqual<InferFormRaw<FieldSpecLike<number, number>>, number>>(true);
