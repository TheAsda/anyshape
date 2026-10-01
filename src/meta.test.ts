import {
  form, object, array, field, meta, metaKey, MetaRef, createStore,
  control, validation, touched, visibility, disableable, submission,
  type InferValue, type InferMeta,
} from "./index";
import { META, META_DEFS, CREATE, PLAIN, defOf } from "./internal";
import { test, describe, expect } from "vitest";

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

function values(): InferValue<typeof shape> {
  return {
    note: "", name: "", company: { vat: "" },
    shipping: { street: "", city: "" }, billing: { street: "", city: "" },
    lines: [], tags: [],
  };
}

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

describe("C · Declarations", () => {
  test("defaults from plain values and key definitions", () => {
    const s = createStore(shape, values());
    expect(s.getMeta(shape.name)).toEqual({
      error: undefined, validating: false, touched: false, dirty: false, revealed: false, focusTarget: undefined, label: "Name",
    });
    expect(s.getMeta(shape)).toEqual({ submitCount: 0, submitting: false });
  });

  test("key definitions keep their capabilities", () => {
    const defs = shape.name[META_DEFS];
    expect(defs.error.options.owner).toBe("feature");
    expect(defs.error.options.aggregate!("x")).toBe(true);
    expect(defs.error.options.aggregate!(undefined)).toBe(false);
    expect(defs.focusTarget.options.reactive).toBe(false);
    expect(defs.label[PLAIN]).toBe(true);
    expect(shape.company[META_DEFS].visible.options.inherit).toBe("all");
    expect(shape.company[META_DEFS].disabled.options.inherit).toBe("any");
  });

  test("variadic and chained .meta() merge", () => {
    const a = field<string>().meta(validation(), { hint: "x" }).meta(touched());
    expect(Object.keys(a[META_DEFS]).sort()).toEqual(["error", "hint", "touched", "validating"]);
  });

  test("MetaBuilder still works", () => {
    const f = field<string>().meta(meta().required().label("A"));
    expect(f[META]).toEqual({ required: true, label: "A" });
  });

  test("plain values can be overridden by plain values", () => {
    const f = field<string>().meta({ hint: "a" }).meta({ hint: "b" });
    expect(f[META]).toEqual({ hint: "b" });
  });

  test("key definitions cannot be declared twice", () => {
    expect(() => field<string>().meta(validation()).meta(validation())).toThrow(/already declared/);
    expect(() => field<string>().meta(control(), touched())).toThrow(/already declared/);
    expect(() => field<string>().meta({ error: "" }).meta(validation())).toThrow(/already declared/);
    expect(() => field<string>().meta(validation()).meta({ error: "" })).toThrow(/already declared/);
  });

  test("reserved meta keys are rejected", () => {
    expect(() => field<string>().meta({ path: "" })).toThrow(/reserved/);
    expect(() => field<string>().meta({ id: 1 })).toThrow(/reserved/);
    expect(() => field<string>().meta({ item: 1 })).toThrow(/reserved/);
    expect(() => field<string>().meta({ _type: 1 })).toThrow(/reserved/);
  });

  test("inherit on a non-boolean key throws at runtime too", () => {
    expect(() => metaKey(0, { inherit: "any" } as any)).toThrow(/boolean/);
  });
});

describe("C · Meta references", () => {
  test("meta refs point at the instantiated node", () => {
    const ref = shape.name.error;
    expect(ref instanceof MetaRef).toBe(true);
    expect(ref.node).toBe(shape.name);
    expect(ref.key).toBe("error");
    expect(ref.path).toBe("name#error");
    expect(defOf(ref)).toBe(shape.name[META_DEFS].error);
  });

  test("reused shapes get separate refs", () => {
    expect(shape.shipping.city.error.node).toBe(shape.shipping.city);
    expect(shape.billing.city.error.node).toBe(shape.billing.city);
    expect(shape.shipping.city.error === shape.billing.city.error).toBe(false);
    expect(address.city.error.node === shape.shipping.city, "reusable shape keeps its own refs").toBe(false);
  });

  test("row template refs", () => {
    expect(shape.lines.item.sku.error.node).toBe(shape.lines.item.sku);
    expect(shape.lines.item.sku.error.path).toBe("lines[].sku#error");
  });

  test("container and root refs", () => {
    expect(shape.company.visible.node).toBe(shape.company);
    expect(shape.submitCount.path).toBe("#submitCount");
  });

  test("a meta key cannot share a name with a child", () => {
    expect(() => object({ error: field<string>() }).meta(validation())).toThrow(
      `"error" is a field of "<root>" and cannot also be a meta key`
    );
    expect(() => object({ label: field<string>() }).meta({ label: "Group" })).toThrow(/"label" is a field of/);
  });

  test(".meta() leaves the original node untouched", () => {
    const base = field<string>();
    const withMeta = base.meta(validation());
    expect((base as any).error).toBe(undefined);
    expect(withMeta.error instanceof MetaRef).toBe(true);
  });
});

describe("C · Closed meta in the store", () => {
  test("setMeta accepts only declared keys", () => {
    const s = createStore(shape, values());
    s.setMeta(shape.name, { label: "Full name" });
    expect(s.getMeta(shape.name).label).toBe("Full name");
    // @ts-expect-error – `hint` is not declared on `name`
    expect(() => s.setMeta(shape.name, { hint: "x" })).toThrow(/no meta key "hint"/);
    // @ts-expect-error – `note` declares no meta at all
    expect(() => s.setMeta(shape.note, { error: "x" })).toThrow(/no meta key "error"/);
  });
});

describe("C · Arrays", () => {
  test("array create is kept on the instantiated node", () => {
    const a = shape.lines[CREATE]!();
    const b = shape.lines[CREATE]!();
    expect(a).toEqual({ sku: "", qty: 1 });
    expect(a === b, "a new object per call").toBe(false);
    expect(shape.tags[CREATE]).toBe(undefined);
  });

  test("array create must be a function", () => {
    expect(() => array(object({ a: field<string>() }), { create: {} as any })).toThrow(/must be a function/);
  });
});

const NODE_INTERNALS = ["id", "lens", "path", "parent", "meta", "constructor", "_type", "_hasCreate"];

describe("C · Reserved names, table-driven", () => {
  test("every node-internal name is rejected as a field name and as a meta key", () => {
    for (const name of NODE_INTERNALS) {
      expect(() => object({ [name]: field<string>() }), `field "${name}"`).toThrow(/reserved name/);
      expect(() => field<string>().meta({ [name]: 1 }), `meta key "${name}"`).toThrow(/reserved name/);
    }
    expect(() => field<string>().meta({ item: 1 }), "`item` is reserved for meta keys").toThrow(/reserved name/);
    expect(() => object({ item: field<string>() }), "…but allowed as a field name").not.toThrow();
  });

  test("_fields, _meta and _metaDefs are ordinary field names", () => {
    const f = form(
      object({ _fields: field<string>(), _meta: field<number>(), _metaDefs: field<boolean>() }).meta({ hint: "h" })
    );
    const s = createStore(f, { _fields: "a", _meta: 1, _metaDefs: true });
    s.set(f._meta, 2);
    expect(s.get(f)).toEqual({ _fields: "a", _meta: 2, _metaDefs: true });
    expect(s.get(f.hint), "the node's own meta still works").toBe("h");
  });

  test("_fields, _meta and _metaDefs are ordinary meta keys", () => {
    const f = form({
      group: object({ x: field<string>() }).meta({ _fields: 1, _meta: "m", _metaDefs: false }),
    });
    const s = createStore(f, { group: { x: "a" } });
    s.set(f.group._meta, "n");
    expect(s.getMeta(f.group)).toEqual({ _fields: 1, _meta: "n", _metaDefs: false });
    expect(s.get(f.group.x), "the node's own children still work").toBe("a");
  });
});

describe("C · MetaBuilder", () => {
  test("MetaBuilder: chained helpers and custom keys build a typed plain object", () => {
    const built = meta().required().label("Name").custom("hint", "Use your legal name").custom("max", 3);
    expect(built.build()).toEqual({ required: true, label: "Name", hint: "Use your legal name", max: 3 });
    const f = form({ name: field<string>().meta(built) });
    type M = InferMeta<typeof f.name>;
    type _c1 = Expect<Equal<M["hint"], string>>;
    type _c2 = Expect<Equal<M["max"], number>>;
    type _c3 = Expect<Equal<M["required"], boolean>>;
    expect(f.name[META]).toEqual({ required: true, label: "Name", hint: "Use your legal name", max: 3 });
    expect(f.name.hint instanceof MetaRef).toBe(true);
    expect(meta().disabled(false).visible().placeholder("x").build()).toEqual({ disabled: false, visible: true, placeholder: "x" });
  });

  test("paths through nested arrays, for nodes and meta refs", () => {
    const f = form({
      outer: array(object({ inner: array(object({ v: field<string>().meta(control()) })) })),
    });
    expect(f.outer.item.inner.item.v.path).toBe("outer[].inner[].v");
    expect(f.outer.item.inner.item.v.error.path).toBe("outer[].inner[].v#error");
    expect(f.outer.item.inner.path).toBe("outer[].inner");
  });
});
