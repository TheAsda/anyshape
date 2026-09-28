// Run: npx tsx src/meta.test.ts   (type assertions are checked by: npx tsc)
import {
  form, object, array, field, meta, metaKey, MetaRef, createStore,
  control, validation, touched, visibility, disableable, submission,
  type InferValue, type InferMeta,
} from "./index";
import { test, eq, deepEq, throws, report } from "./test/harness";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
const address = object({
  street: field<string>(),
  city: field<string>().meta(validation()),
});

const shape = form(
  object({
    note: field<string>(),
    name: field<string>().meta(control(), { label: "Name" }),
    company: object({ vat: field<string>().meta(control()) }).meta(visibility(), disableable()),
    shipping: address,
    billing: address,
    lines: array(object({ sku: field<string>().meta(control()), qty: field<number>() }), {
      create: () => ({ sku: "", qty: 1 }),
    }),
    tags: array(object({ text: field<string>() })),
  }).meta(submission())
);

// ---------------------------------------------------------------------------
// Types
type _1 = Expect<Equal<InferValue<typeof shape.name.error>, string | undefined>>;
type _2 = Expect<Equal<InferValue<typeof shape.name.touched>, boolean>>;
type _3 = Expect<Equal<InferValue<typeof shape.name.label>, string>>;
type _4 = Expect<Equal<InferValue<typeof shape.submitCount>, number>>;
type _5 = Expect<Equal<InferValue<typeof shape.company.visible>, boolean>>;
type _6 = Expect<Equal<InferValue<typeof shape.lines.item.sku.error>, string | undefined>>;
type _7 = Expect<Equal<typeof shape.lines._hasCreate, true>>;
type _8 = Expect<Equal<typeof shape.tags._hasCreate, false>>;
type _9 = Expect<Equal<InferMeta<typeof shape.note>, {}>>;

// Compile-time only – never called.
export function typeOnlyChecks() {
  // @ts-expect-error – `note` declares no meta
  shape.note.error;
  // @ts-expect-error – inherit is only for boolean keys
  metaKey(0, { inherit: "any" });
  // @ts-expect-error – `create` must return a complete item
  array(object({ a: field<string>() }), { create: () => ({}) });
}

// ---------------------------------------------------------------------------
// Declarations
test("defaults from plain values and key definitions", () => {
  deepEq(shape.name._meta, {
    error: undefined, validating: false, touched: false, dirty: false, focusTarget: undefined, label: "Name",
  });
  deepEq(shape._meta, { submitCount: 0, submitting: false });
});

test("key definitions keep their capabilities", () => {
  const defs = shape.name._metaDefs;
  eq(defs.error.options.owner, "feature");
  eq(defs.error.options.aggregate!("x"), true);
  eq(defs.error.options.aggregate!(undefined), false);
  eq(defs.focusTarget.options.reactive, false);
  eq(defs.label.plain, true);
  eq(shape.company._metaDefs.visible.options.inherit, "all");
  eq(shape.company._metaDefs.disabled.options.inherit, "any");
});

test("variadic and chained .meta() merge", () => {
  const a = field<string>().meta(validation(), { hint: "x" }).meta(touched());
  deepEq(Object.keys(a._metaDefs).sort(), ["error", "hint", "touched", "validating"]);
});

test("MetaBuilder still works", () => {
  const f = field<string>().meta(meta().required().label("A"));
  deepEq(f._meta, { required: true, label: "A" });
});

test("plain values can be overridden by plain values", () => {
  const f = field<string>().meta({ hint: "a" }).meta({ hint: "b" });
  eq(f._meta.hint, "b");
});

test("key definitions cannot be declared twice", () => {
  throws(() => field<string>().meta(validation()).meta(validation()), /already declared/);
  throws(() => field<string>().meta(control(), touched()), /already declared/);
  throws(() => field<string>().meta({ error: "" }).meta(validation()), /already declared/);
  throws(() => field<string>().meta(validation()).meta({ error: "" }), /already declared/);
});

test("reserved meta keys are rejected", () => {
  throws(() => field<string>().meta({ path: "" }), /reserved/);
  throws(() => field<string>().meta({ id: 1 }), /reserved/);
  throws(() => field<string>().meta({ item: 1 }), /reserved/);
  throws(() => field<string>().meta({ _meta: 1 }), /reserved/);
});

test("inherit on a non-boolean key throws at runtime too", () => {
  throws(() => metaKey(0, { inherit: "any" } as any), /boolean/);
});

// ---------------------------------------------------------------------------
// Meta references
test("meta refs point at the instantiated node", () => {
  const ref = shape.name.error;
  eq(ref instanceof MetaRef, true);
  eq(ref.node, shape.name);
  eq(ref.key, "error");
  eq(ref.path, "name#error");
  eq(ref.def, shape.name._metaDefs.error);
});

test("reused shapes get separate refs", () => {
  eq(shape.shipping.city.error.node, shape.shipping.city);
  eq(shape.billing.city.error.node, shape.billing.city);
  eq(shape.shipping.city.error === shape.billing.city.error, false);
  eq(address.city.error.node === shape.shipping.city, false, "reusable shape keeps its own refs");
});

test("row template refs", () => {
  eq(shape.lines.item.sku.error.node, shape.lines.item.sku);
  eq(shape.lines.item.sku.error.path, "lines[].sku#error");
});

test("container and root refs", () => {
  eq(shape.company.visible.node, shape.company);
  eq(shape.submitCount.path, "#submitCount");
});

test("a child field wins over a meta key with the same name", () => {
  const f = form({
    group: object({ label: field<string>() }).meta({ label: "Group" }),
  });
  eq(f.group.label instanceof MetaRef, false);
  eq(f.group.label.path, "group.label");
  eq(f.group._meta.label, "Group");
});

test(".meta() leaves the original node untouched", () => {
  const base = field<string>();
  const withMeta = base.meta(validation());
  eq((base as any).error, undefined);
  eq(withMeta.error instanceof MetaRef, true);
});

// ---------------------------------------------------------------------------
// Closed meta in the store
test("setMeta accepts only declared keys", () => {
  const s = createStore(shape, {
    note: "", name: "", company: { vat: "" },
    shipping: { street: "", city: "" }, billing: { street: "", city: "" },
    lines: [], tags: [],
  });
  s.setMeta(shape.name, { label: "Full name" });
  eq(s.getMeta(shape.name).label, "Full name");
  // @ts-expect-error – `hint` is not declared on `name`
  throws(() => s.setMeta(shape.name, { hint: "x" }), /no meta key "hint"/);
  // @ts-expect-error – `note` declares no meta at all
  throws(() => s.setMeta(shape.note, { error: "x" }), /no meta key "error"/);
});

// ---------------------------------------------------------------------------
// Arrays
test("array create is kept on the instantiated node", () => {
  const a = shape.lines._create!();
  const b = shape.lines._create!();
  deepEq(a, { sku: "", qty: 1 });
  eq(a === b, false, "a new object per call");
  eq(shape.tags._create, undefined);
});

test("array create must be a function", () => {
  throws(() => array(object({ a: field<string>() }), { create: {} as any }), /must be a function/);
});

report("meta.test.ts");
