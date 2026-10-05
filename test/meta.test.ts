import {
  form, object, array, field, MetaRef, createStore, type InferValue, type InferMeta,
} from "../src/index";
import { control, validation, touched, visible, disabled, submission } from "./support/features";
import { META_DEFS, CREATE, defOf } from "../src/internal";
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
    company: object({ vat: field<string>().meta(control()) }).meta({ visible, disabled }),
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
type _4 = Expect<Equal<InferValue<typeof shape.submitting>, boolean>>;
type _5 = Expect<Equal<InferValue<typeof shape.company.visible>, boolean>>;
type _6 = Expect<Equal<InferValue<typeof shape.lines.item.sku.error>, string | undefined>>;
type _7 = Expect<Equal<typeof shape.lines._hasCreate, true>>;
type _8 = Expect<Equal<typeof shape.tags._hasCreate, false>>;
type _9 = Expect<Equal<InferMeta<typeof shape.note>, {}>>;

// Compile-time only – never called.
export function typeOnlyChecks() {
  // @ts-expect-error – `note` declares no meta
  void shape.note.error;
  // @ts-expect-error – `create` must return a complete item
  array(object({ a: field<string>() }), { create: () => ({}) });
}

describe("C · Declarations", () => {
  test("defaults from plain values and key definitions", () => {
    const s = createStore(shape, values());
    const n = shape.name;
    expect([s.get(n.error), s.get(n.touched), s.get(n.dirty), s.get(n.revealed), s.get(n.label)])
      .toEqual([undefined, false, false, false, "Name"]);
    expect(s.get(shape.submitting)).toBe(false);
  });

  test("key definitions keep their capabilities", () => {
    const defs = shape.name[META_DEFS];
    expect(defs.error._steps.aggregate!("x")).toBe(true);
    expect(defs.error._steps.aggregate!(undefined)).toBe(false);
  });

  test("variadic and chained .meta() merge", () => {
    const a = field<string>().meta(validation(), { hint: "x" }).meta({ touched });
    expect(Object.keys(a[META_DEFS]).sort()).toEqual(["error", "hint", "touched"]);
  });

  test("a node declares each key once: a second declaration throws, plain value or key definition", () => {
    const alreadyDeclared = (key: string, kind: string) => `Meta key "${key}" is already declared on this ${kind} – a node declares each key once`;
    expect(() => field<string>().meta({ hint: "a" }).meta({ hint: 1 })).toThrow(alreadyDeclared("hint", "field"));
    expect(() => field<string>().meta({ hint: "a" }, { hint: "b" })).toThrow(alreadyDeclared("hint", "field"));
    expect(() => field<string>().meta(validation()).meta(validation())).toThrow(alreadyDeclared("error", "field"));
    expect(() => field<string>().meta(control(), { touched })).toThrow(alreadyDeclared("touched", "field"));
    expect(() => field<string>().meta({ error: "" }).meta(validation())).toThrow(alreadyDeclared("error", "field"));
    expect(() => field<string>().meta(validation()).meta({ error: "" })).toThrow(alreadyDeclared("error", "field"));
    expect(() => object({ a: field<string>() }).meta({ hint: "" }).meta({ hint: "" })).toThrow(alreadyDeclared("hint", "object"));
    expect(() => array(object({ a: field<string>() })).meta({ hint: "" }).meta({ hint: "" })).toThrow(alreadyDeclared("hint", "array"));
  });

  test("reserved meta keys are rejected", () => {
    expect(() => field<string>().meta({ path: "" })).toThrow(/reserved/);
    expect(() => field<string>().meta({ id: 1 })).toThrow(/reserved/);
    expect(() => field<string>().meta({ item: 1 })).toThrow(/reserved/);
    expect(() => field<string>().meta({ _type: 1 })).toThrow(/reserved/);
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
    expect(shape.submitting.path).toBe("#submitting");
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

  test("paths through nested arrays, for nodes and meta refs", () => {
    const f = form(object({
      outer: array(object({ inner: array(object({ v: field<string>().meta(control()) })) })),
    }));
    expect(f.outer.item.inner.item.v.path).toBe("outer[].inner[].v");
    expect(f.outer.item.inner.item.v.error.path).toBe("outer[].inner[].v#error");
    expect(f.outer.item.inner.path).toBe("outer[].inner");
  });
});

describe("C · Closed meta in the store", () => {
  test("only declared keys have refs", () => {
    const s = createStore(shape, values());
    s.set(shape.name.label, "Full name");
    expect(s.get(shape.name.label)).toBe("Full name");
    // @ts-expect-error – `hint` is not declared on `name`
    expect(shape.name.hint).toBe(undefined);
    // @ts-expect-error – `note` declares no meta at all
    expect(shape.note.error).toBe(undefined);
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
    const f = form(object({
      group: object({ x: field<string>() }).meta({ _fields: 1, _meta: "m", _metaDefs: false }),
    }));
    const s = createStore(f, { group: { x: "a" } });
    s.set(f.group._meta, "n");
    expect([s.get(f.group._fields), s.get(f.group._meta), s.get(f.group._metaDefs)]).toEqual([1, "n", false]);
    expect(s.get(f.group.x), "the node's own children still work").toBe("a");
  });
});
