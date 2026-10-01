// ============================================================
// The public type contract, in one place.
// These assertions are checked by `npm run typecheck` (tsc), not by vitest:
// a broken inference fails the typecheck, not the test run.
// ============================================================

import {
  form, object, array, field, metaKey, createStore, countIn, initialOf, rule,
  type InferValue, type InferMeta, type FieldNode, type AnyNode, type RefValue, type MetaPatch, type SubmitValue, type RootStore,
} from "./index";
import { control, visibility, disableable, submission } from "./test/features";
import { test, expect, expectTypeOf } from "vitest";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

const person = object({ name: field<string>(), email: field<string>() });

const t = form(
  object({
    a: person,
    b: person,
    grid: array(object({ cells: array(object({ v: field<number>() })) })),
    optional: field<string | undefined>(),
    text: field<string>().meta(control(), {
      hint: "",
      seats: metaKey<number | undefined>(undefined),
    }),
    count: field<number>().meta(control()),
    plain: field<number>(),
    hidden: object({ x: field<string>() }).meta(visibility()),
    off: field<string>().meta(control(), disableable()),
    other: field<string>().meta(control(), disableable()),
    withCreate: array(object({ k: field<string>(), n: field<number>() }), { create: () => ({ k: "", n: 0 }) }),
    noCreate: array(object({ k: field<string>() })),
  }).meta(submission())
);

// ---------------------------------------------------------------------------
// Values
type V = InferValue<typeof t>;
type _v1 = Expect<Equal<V["a"], { name: string; email: string }>>;
type _v2 = Expect<Equal<V["a"], V["b"]>>;
type _v3 = Expect<Equal<V["grid"], { cells: { v: number }[] }[]>>;
type _v4 = Expect<Equal<V["optional"], string | undefined>>;
type _v5 = Expect<Equal<InferValue<typeof t.grid.item.cells.item.v>, number>>;

// ---------------------------------------------------------------------------
// Meta: features, plain values and key definitions merge
type M = InferMeta<typeof t.text>;
type _m1 = Expect<Equal<M["hint"], string>>;
type _m2 = Expect<Equal<M["seats"], number | undefined>>;
type _m3 = Expect<Equal<M["error"], string | undefined>>;
type _m4 = Expect<Equal<M["touched"], boolean>>;
type _m5 = Expect<Equal<M["dirty"], boolean>>;
type _m6 = Expect<Equal<InferMeta<typeof t>["submitCount"], number>>;
type _m7 = Expect<Equal<InferMeta<typeof t.hidden>["visible"], boolean>>;

// A node without meta accepts no meta patch at all.
type _p1 = Expect<Equal<MetaPatch<typeof t.plain>, Record<string, never>>>;

// ---------------------------------------------------------------------------
// References: every kind resolves to its value type
const initialPlain = initialOf(t.plain);
const errorCount = countIn(t, "error");
type _r1 = Expect<Equal<RefValue<typeof t.text>, string>>;
type _r2 = Expect<Equal<RefValue<typeof t.text.error>, string | undefined>>;
type _r3 = Expect<Equal<RefValue<typeof t.text.seats>, number | undefined>>;
type _r4 = Expect<Equal<RefValue<typeof errorCount>, number>>;
type _r5 = Expect<Equal<RefValue<typeof initialPlain>, number>>;
type _r6 = Expect<Equal<RefValue<typeof t.text.touched>, boolean>>; // a MetaRef is never taken for a count

// ---------------------------------------------------------------------------
// Submitted values: exactly the nodes declaring visible / disabled are optional
type S = SubmitValue<typeof t>;
type _s1 = Expect<Equal<S["hidden"], { x: string } | undefined>>;
type _s2 = Expect<Equal<S["off"], string | undefined>>;
type _s3 = Expect<Equal<S["plain"], number>>;
type _s4 = Expect<Equal<S["a"], { name: string; email: string }>>;

// ---------------------------------------------------------------------------
// Calls that must (and must not) compile. Never called.
export function typeOnlyChecks(s: RootStore<typeof t>) {
  // Store reads are typed by the reference.
  const n: number = s.get(t.count);
  const e: string | undefined = s.get(t.text.error);
  const c: number = s.get(countIn(t, "error"));

  // Array helpers: a partial item with `create`, a complete one without.
  s.substore(t.withCreate).append();
  s.substore(t.withCreate).append({ k: "x" });
  s.substore(t.noCreate).append({ k: "x" });
  // @ts-expect-error – no create factory: an item is required
  s.substore(t.noCreate).append();

  // @ts-expect-error – the value type is checked
  s.set(t.plain, "x");
  // @ts-expect-error – only declared meta keys exist
  s.setMeta(t.text, { nope: 1 });
  // @ts-expect-error – counts are read-only
  s.set(countIn(t, "error"), 1);

  // @ts-expect-error – `plain` has no validation()
  rule(t.plain, () => undefined);

  return [n, e, c];
}

test("a loose node declares no known meta keys", () => {
  expectTypeOf<InferMeta<AnyNode>>().toEqualTypeOf<{}>();
});

test("node internals are not part of a node's type", () => {
  expectTypeOf(t.text).not.toHaveProperty("_meta");
  expectTypeOf(t.text).not.toHaveProperty("_metaDefs");
  expectTypeOf(t.a).not.toHaveProperty("_fields");
  expectTypeOf(t.withCreate).not.toHaveProperty("_create");

  const f = form({ _meta: field<number>(), _fields: field<string>() });
  expectTypeOf(f._meta).toEqualTypeOf<FieldNode<number>>();
  expectTypeOf(f._fields).toEqualTypeOf<FieldNode<string>>();
});

test("the type contract compiles (asserted by npm run typecheck)", () => {
  expect(t.a.name).not.toBe(t.b.name);
  const s = createStore(t, {
    a: { name: "", email: "" }, b: { name: "", email: "" }, grid: [], optional: undefined,
    text: "", count: 0, plain: 0, hidden: { x: "" }, off: "", other: "", withCreate: [], noCreate: [],
  });
  expect(s.get(countIn(t, "error"))).toBe(0);
});
