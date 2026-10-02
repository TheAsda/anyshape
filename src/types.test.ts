// ============================================================
// The public type contract, in one place.
// These assertions are checked by `npm run typecheck` (tsc), not by vitest:
// a broken inference fails the typecheck, not the test run.
// ============================================================

import {
  form, object, array, field, metaKey, createStore, countIn, initialOf, rule, contribute,
  type InferValue, type InferMeta, type FieldNode, type AnyNode, type RefValue, type RootStore, MetaRef, type MetaKeyDef,
} from "./index";
import { control, visible, disabled, submission } from "./test/features";
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
    hidden: object({ x: field<string>() }).meta({ visible }),
    off: field<string>().meta(control(), { disabled }),
    other: field<string>().meta(control(), { disabled }),
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
type _m6 = Expect<Equal<InferMeta<typeof t>["submitting"], boolean>>;
type _m7 = Expect<Equal<InferMeta<typeof t.hidden>["visible"], boolean>>;

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
  // @ts-expect-error – only declared meta keys have refs
  s.set(t.text.nope, 1);
  // @ts-expect-error – refs come from nodes (t.text.error) or collect, never constructed
  new MetaRef(t.text, "error");
  // @ts-expect-error – counts are read-only
  s.set(countIn(t, "error"), 1);

  // @ts-expect-error – `plain` has no validation()
  rule(t.plain, () => undefined);

  return [n, e, c];
}

// ---------------------------------------------------------------------------
// Key contributions: the payload type flows from the key to contribute() and ctx.parts.
const total = metaKey<number, { weight: number }>(0, {
  combine: (self, key) => ({
    name: `${self.path}#total`,
    writes: [key],
    run(ctx) {
      ctx.set(key, ctx.parts.reduce((sum, p) => sum + p.payload.weight, 0));
      // @ts-expect-error – the key's value type is number
      ctx.set(key, "many");
      // @ts-expect-error – the payload type comes from the key
      void ctx.parts[0].payload.w;
      type _self = Expect<Equal<RefValue<typeof self>, unknown>>; // the node's value type is unknowable here
    },
  }),
});
const reasons = metaKey<readonly string[], string>([], {
  combine: (_self, key) => ({ writes: [key], run: (ctx) => ctx.set(key, ctx.parts.map((p) => p.payload)) }),
});
const ok = metaKey(false);
const c = form(object({ n: field<number>().meta({ total, reasons, ok, plain: 0 }) }));

type _c1 = Expect<Equal<RefValue<typeof c.n.total>, number>>;
type _c2 = Expect<Equal<typeof c.n.total extends MetaRef<any, infer P> ? P : never, { weight: number }>>;
type CM = InferMeta<typeof c.n>;
type _c3 = Expect<Equal<[CM["total"], CM["reasons"], CM["ok"], CM["plain"]], [number, readonly string[], boolean, number]>>;

// @ts-expect-error – `combine` must return a config whose run takes this key's parts
metaKey<number, { weight: number }>(0, { combine: (_s, k) => ({ writes: [k], run: (ctx: { parts: readonly { payload: string }[] }) => {} }) });

export function contributionChecks() {
  contribute(c.n.total, { weight: 2 });
  contribute(c.n.reasons, "because");
  // @ts-expect-error – a reason on `total`
  contribute(c.n.total, "because");
  // @ts-expect-error – a weight on `reasons`
  contribute(c.n.reasons, { weight: 1 });
  // @ts-expect-error – keys without `combine` are not combinable
  contribute(c.n.ok, false);
  // @ts-expect-error – plain keys are not combinable
  contribute(c.n.plain, 0);
  // A definition with a payload still fits where MetaKeyDef<V> is expected.
  const def: MetaKeyDef<number> = total;
  return def;
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
