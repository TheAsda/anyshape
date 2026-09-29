import {
  form, object, array, field, meta, metaKey, MetaRef, createStore,
  control, validation, touched, visibility, disableable, submission,
  type InferValue, type InferMeta,
} from "./index";
import { it, expect } from "vitest";

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
it("defaults from plain values and key definitions", () => {
  expect(shape.name._meta).toEqual({
    error: undefined, validating: false, touched: false, dirty: false, revealed: false, focusTarget: undefined, label: "Name",
  });
  expect(shape._meta).toEqual({ submitCount: 0, submitting: false });
});

it("key definitions keep their capabilities", () => {
  const defs = shape.name._metaDefs;
  expect(defs.error.options.owner).toBe("feature");
  expect(defs.error.options.aggregate!("x")).toBe(true);
  expect(defs.error.options.aggregate!(undefined)).toBe(false);
  expect(defs.focusTarget.options.reactive).toBe(false);
  expect(defs.label.plain).toBe(true);
  expect(shape.company._metaDefs.visible.options.inherit).toBe("all");
  expect(shape.company._metaDefs.disabled.options.inherit).toBe("any");
});

it("variadic and chained .meta() merge", () => {
  const a = field<string>().meta(validation(), { hint: "x" }).meta(touched());
  expect(Object.keys(a._metaDefs).sort()).toEqual(["error", "hint", "touched", "validating"]);
});

it("MetaBuilder still works", () => {
  const f = field<string>().meta(meta().required().label("A"));
  expect(f._meta).toEqual({ required: true, label: "A" });
});

it("plain values can be overridden by plain values", () => {
  const f = field<string>().meta({ hint: "a" }).meta({ hint: "b" });
  expect(f._meta.hint).toBe("b");
});

it("key definitions cannot be declared twice", () => {
  expect(() => field<string>().meta(validation()).meta(validation())).toThrow(/already declared/);
  expect(() => field<string>().meta(control(), touched())).toThrow(/already declared/);
  expect(() => field<string>().meta({ error: "" }).meta(validation())).toThrow(/already declared/);
  expect(() => field<string>().meta(validation()).meta({ error: "" })).toThrow(/already declared/);
});

it("reserved meta keys are rejected", () => {
  expect(() => field<string>().meta({ path: "" })).toThrow(/reserved/);
  expect(() => field<string>().meta({ id: 1 })).toThrow(/reserved/);
  expect(() => field<string>().meta({ item: 1 })).toThrow(/reserved/);
  expect(() => field<string>().meta({ _meta: 1 })).toThrow(/reserved/);
});

it("inherit on a non-boolean key throws at runtime too", () => {
  expect(() => metaKey(0, { inherit: "any" } as any)).toThrow(/boolean/);
});

// ---------------------------------------------------------------------------
// Meta references
it("meta refs point at the instantiated node", () => {
  const ref = shape.name.error;
  expect(ref instanceof MetaRef).toBe(true);
  expect(ref.node).toBe(shape.name);
  expect(ref.key).toBe("error");
  expect(ref.path).toBe("name#error");
  expect(ref.def).toBe(shape.name._metaDefs.error);
});

it("reused shapes get separate refs", () => {
  expect(shape.shipping.city.error.node).toBe(shape.shipping.city);
  expect(shape.billing.city.error.node).toBe(shape.billing.city);
  expect(shape.shipping.city.error === shape.billing.city.error).toBe(false);
  expect(address.city.error.node === shape.shipping.city, "reusable shape keeps its own refs").toBe(false);
});

it("row template refs", () => {
  expect(shape.lines.item.sku.error.node).toBe(shape.lines.item.sku);
  expect(shape.lines.item.sku.error.path).toBe("lines[].sku#error");
});

it("container and root refs", () => {
  expect(shape.company.visible.node).toBe(shape.company);
  expect(shape.submitCount.path).toBe("#submitCount");
});

it("a child field wins over a meta key with the same name", () => {
  const f = form({
    group: object({ label: field<string>() }).meta({ label: "Group" }),
  });
  expect(f.group.label instanceof MetaRef).toBe(false);
  expect(f.group.label.path).toBe("group.label");
  expect(f.group._meta.label).toBe("Group");
});

it(".meta() leaves the original node untouched", () => {
  const base = field<string>();
  const withMeta = base.meta(validation());
  expect((base as any).error).toBe(undefined);
  expect(withMeta.error instanceof MetaRef).toBe(true);
});

// ---------------------------------------------------------------------------
// Closed meta in the store
it("setMeta accepts only declared keys", () => {
  const s = createStore(shape, {
    note: "", name: "", company: { vat: "" },
    shipping: { street: "", city: "" }, billing: { street: "", city: "" },
    lines: [], tags: [],
  });
  s.setMeta(shape.name, { label: "Full name" });
  expect(s.getMeta(shape.name).label).toBe("Full name");
  // @ts-expect-error – `hint` is not declared on `name`
  expect(() => s.setMeta(shape.name, { hint: "x" })).toThrow(/no meta key "hint"/);
  // @ts-expect-error – `note` declares no meta at all
  expect(() => s.setMeta(shape.note, { error: "x" })).toThrow(/no meta key "error"/);
});

// ---------------------------------------------------------------------------
// Arrays
it("array create is kept on the instantiated node", () => {
  const a = shape.lines._create!();
  const b = shape.lines._create!();
  expect(a).toEqual({ sku: "", qty: 1 });
  expect(a === b, "a new object per call").toBe(false);
  expect(shape.tags._create).toBe(undefined);
});

it("array create must be a function", () => {
  expect(() => array(object({ a: field<string>() }), { create: {} as any })).toThrow(/must be a function/);
});

// ---------------------------------------------------------------------------
// Reserved names, table-driven
const NODE_INTERNALS = [
  "id", "lens", "path", "parent", "meta", "constructor",
  "_meta", "_metaDefs", "_type", "_fields", "_create", "_hasCreate",
  "_instantiate", "_createInstance", "_attachMetaRefs", "_hasChild",
];

it("every node-internal name is rejected as a field name and as a meta key", () => {
  for (const name of NODE_INTERNALS) {
    expect(() => object({ [name]: field<string>() }), `field "${name}"`).toThrow(/reserved name/);
    expect(() => field<string>().meta({ [name]: 1 }), `meta key "${name}"`).toThrow(/reserved name/);
  }
  expect(() => field<string>().meta({ item: 1 }), "`item` is reserved for meta keys").toThrow(/reserved name/);
  expect(() => object({ item: field<string>() }), "…but allowed as a field name").not.toThrow();
});

// ---------------------------------------------------------------------------
// MetaBuilder
it("MetaBuilder: chained helpers and custom keys build a typed plain object", () => {
  const built = meta().required().label("Name").custom("hint", "Use your legal name").custom("max", 3);
  expect(built.build()).toEqual({ required: true, label: "Name", hint: "Use your legal name", max: 3 });
  const f = form({ name: field<string>().meta(built) });
  type M = InferMeta<typeof f.name>;
  type _c1 = Expect<Equal<M["hint"], string>>;
  type _c2 = Expect<Equal<M["max"], number>>;
  type _c3 = Expect<Equal<M["required"], boolean>>;
  expect(f.name._meta).toEqual({ required: true, label: "Name", hint: "Use your legal name", max: 3 });
  expect(f.name.hint instanceof MetaRef).toBe(true);
  expect(meta().disabled(false).visible().placeholder("x").build()).toEqual({ disabled: false, visible: true, placeholder: "x" });
});

it("paths through nested arrays, for nodes and meta refs", () => {
  const f = form({
    outer: array(object({ inner: array(object({ v: field<string>().meta(control()) })) })),
  });
  expect(f.outer.item.inner.item.v.path).toBe("outer[].inner[].v");
  expect(f.outer.item.inner.item.v.error.path).toBe("outer[].inner[].v#error");
  expect(f.outer.item.inner.path).toBe("outer[].inner");
});
