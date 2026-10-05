// ============================================================
// The public type contract, in one place.
// These assertions are checked by `npm run typecheck` (tsc), not by vitest:
// a broken inference fails the typecheck, not the test run.
// ============================================================

import {
  form, object, array, field, metaKey, createStore, countIn, initialOf, contribute, defineBehavior, defineBehaviors,
  type BehaviorContext, type InferValue, type InferMeta, type FieldNode, type AnyNode, type RefValue, type RootStore, MetaRef, type MetaKeyDef, type NoPayload,
} from "../src/index";
import * as core from "../src/index";
import { control, visible, disabled, submission, error } from "./support/features";
import { rule } from "./support/rules";
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
const errorCount = countIn(t, error);
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
  const c: number = s.get(countIn(t, error));

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
  s.set(countIn(t, error), 1);
  // @ts-expect-error – createStore is the one way to build a root store
  new core.RootStore(t, {} as InferValue<typeof t>, () => ({}) as never);

  // @ts-expect-error – `plain` has no validation()
  rule(t.plain, () => undefined);

  return [n, e, c];
}

// ---------------------------------------------------------------------------
// Key contributions: the payload type flows from the key to contribute() and ctx.parts.
const total = metaKey<number, { weight: number }>(0).combine((self, key) => ({
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
}));
const reasons = metaKey<readonly string[], string>([]).combine((_self, key) => ({
  writes: [key],
  run: (ctx) => ctx.set(key, ctx.parts.map((p) => p.payload)),
}));
const ok = metaKey(false);
const c = form(object({ n: field<number>().meta({ total, reasons, ok, plain: 0 }) }));

type _c1 = Expect<Equal<RefValue<typeof c.n.total>, number>>;
type _c2 = Expect<Equal<typeof c.n.total extends MetaRef<any, infer P> ? P : never, { weight: number }>>;
type CM = InferMeta<typeof c.n>;
type _c3 = Expect<Equal<[CM["total"], CM["reasons"], CM["ok"], CM["plain"]], [number, readonly string[], boolean, number]>>;

// @ts-expect-error – `combine` must return a config whose run takes this key's parts
metaKey<number, { weight: number }>(0).combine((_s, k) => ({ writes: [k], run: (ctx: { parts: readonly { payload: string }[] }) => {} }));

// `uses`: the node's refs to other keys arrive typed and in order, with <V, P> spelled out.
const forcedFlag = metaKey(false);
const hintText = metaKey("");
metaKey<number, { weight: number }>(0)
  .uses(forcedFlag, hintText)
  .combine((_self, key, [force, hint]) => {
    type _u = Expect<Equal<[RefValue<typeof force>, RefValue<typeof hint>], [boolean, string]>>;
    return {
      triggers: [force, hint],
      writes: [key, force],
      run(ctx) {
        // @ts-expect-error – `force` is a boolean key
        ctx.set(force, "yes");
      },
    };
  });
metaKey(false)
  .uses(forcedFlag)
  .behavior((_self, _key, [force]) => {
    // @ts-expect-error – a boolean key's ref, not a string key's
    const wrong: MetaRef<string> = force;
    return { run: () => void wrong };
  });
metaKey(0).combine((_self, _key, uses) => {
  type _none = Expect<Equal<typeof uses, readonly []>>;
  return { run() {} };
});

// `aggregate` is a step: V is fixed by metaKey(), so a literal default widens as without it.
const flaggedKey = metaKey(false).aggregate((v) => {
  type _v = Expect<Equal<typeof v, boolean>>;
  return v;
});
type _w1 = Expect<Equal<typeof flaggedKey, MetaKeyDef<boolean, NoPayload, []>>>;
const countKey = metaKey(0).aggregate((v) => v > 0);
type _w2 = Expect<Equal<typeof countKey, MetaKeyDef<number, NoPayload, []>>>;
const labelKey = metaKey("").aggregate((v) => v !== "");
type _w3 = Expect<Equal<typeof labelKey, MetaKeyDef<string, NoPayload, []>>>;
// Spelled-out type arguments are kept as written.
const issueKey = metaKey<string | undefined, { reason: string }>(undefined).aggregate((v) => v !== undefined);
type _w4 = Expect<Equal<typeof issueKey, MetaKeyDef<string | undefined, { reason: string }, []>>>;
// @ts-expect-error – `aggregate` is a step, not an option
metaKey(false, { aggregate: (v: boolean) => v });
// The steps after `aggregate` are typed by the widened value.
metaKey(false)
  .aggregate((v) => v)
  .uses(countKey)
  .combine((_self, key, [count]) => {
    type _u = Expect<Equal<[RefValue<typeof key>, RefValue<typeof count>], [boolean, number]>>;
    return { triggers: [count], writes: [key], run: (ctx) => ctx.set(key, true) };
  });

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

// ---------------------------------------------------------------------------
// Removed behavior options: each had another way to say the same thing.
export function removedOptionChecks() {
  // A run reaches the form only through its declared refs: no store, no initial(), no isInit.
  expectTypeOf<BehaviorContext>().not.toHaveProperty("store");
  expectTypeOf<BehaviorContext>().not.toHaveProperty("initial");
  expectTypeOf<BehaviorContext>().not.toHaveProperty("isInit");
  // @ts-expect-error – a ref that never starts a run is declared in `reads`
  defineBehavior({ triggers: [t.text], runOn: { change: false }, run() {} });
  defineBehaviors(t, (b) => {
    // @ts-expect-error – one behavior computes both values of a target
    b.when([t.text], (v) => v === "", () => {}).otherwise(() => {});
  });
}

// ---------------------------------------------------------------------------
// form() instantiates an object node: there is one way to make an object.
export function formChecks() {
  // @ts-expect-error – a plain record of fields is not an object node
  form({ a: field<string>() });
}

test("a loose node declares no known meta keys", () => {
  expectTypeOf<InferMeta<AnyNode>>().toEqualTypeOf<{}>();
});

test("node internals are not part of a node's type", () => {
  expectTypeOf(t.text).not.toHaveProperty("_meta");
  expectTypeOf(t.text).not.toHaveProperty("_metaDefs");
  expectTypeOf(t.a).not.toHaveProperty("_fields");
  expectTypeOf(t.withCreate).not.toHaveProperty("_create");

  const f = form(object({ _meta: field<number>(), _fields: field<string>() }));
  expectTypeOf(f._meta).toEqualTypeOf<FieldNode<number>>();
  expectTypeOf(f._fields).toEqualTypeOf<FieldNode<string>>();
});

test("the type contract compiles (asserted by npm run typecheck)", () => {
  expect(t.a.name).not.toBe(t.b.name);
  const s = createStore(t, {
    a: { name: "", email: "" }, b: { name: "", email: "" }, grid: [], optional: undefined,
    text: "", count: 0, plain: 0, hidden: { x: "" }, off: "", other: "", withCreate: [], noCreate: [],
  });
  expect(s.get(countIn(t, error))).toBe(0);
});
