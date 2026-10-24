import { test, describe, expect } from "vitest";

import {
  form,
  object,
  array,
  field,
  metaKey,
  MetaRef,
  ArrayNode,
  createStore,
  pathOf,
  type InferValue,
  type InferMeta,
} from "../src/index";
import { META_DEFS, CREATE, defOf } from "../src/internal";
import { control, validation, touched, visible, disabled, submission } from "./support/features";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
const address = object({
  street: field<string>(),
  city: field<string>().meta(validation()),
});

const shape = form(
  object({
    note: field<string>(),
    name: field<string>().meta(control(), { label: metaKey("Name") }),
    company: object({ vat: field<string>().meta(control()) }).meta({ visible, disabled }),
    shipping: address,
    billing: address,
    lines: array(object({ sku: field<string>().meta(control()), qty: field<number>() }), {
      create: () => ({ sku: "", qty: 1 }),
    }),
    tags: array(object({ text: field<string>() })),
  }).meta(submission()),
);

function values(): InferValue<typeof shape> {
  return {
    note: "",
    name: "",
    company: { vat: "" },
    shipping: { street: "", city: "" },
    billing: { street: "", city: "" },
    lines: [],
    tags: [],
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
type _7 = Expect<Equal<typeof shape.lines extends ArrayNode<any, true> ? true : false, true>>;
type _8 = Expect<Equal<typeof shape.tags extends ArrayNode<any, false> ? true : false, true>>;
type _9 = Expect<Equal<InferMeta<typeof shape.note>, {}>>;

// Compile-time only – never called.
export function typeOnlyChecks() {
  // @ts-expect-error – `note` declares no meta
  void shape.note.error;
  // @ts-expect-error – `create` must return a complete item
  array(object({ a: field<string>() }), { create: () => ({}) });
}

describe("Declarations", () => {
  test("an entry that is not a key definition throws", () => {
    // An untyped caller (JS, or a cast) cannot hit the compile error.
    const untyped = { label: "Name" } as never;
    expect(() => field<string>().meta(untyped)).toThrow(`"label" is not a key definition – make it with metaKey()`);
  });

  test("defaults from the key definitions", () => {
    const s = createStore(shape, values());
    const n = shape.name;
    expect([s.get(n.error), s.get(n.touched), s.get(n.dirty), s.get(n.revealed), s.get(n.label)]).toEqual([
      undefined,
      false,
      false,
      false,
      "Name",
    ]);
    expect(s.get(shape.submitting)).toBe(false);
  });

  test("key definitions keep their capabilities", () => {
    const defs = shape.name[META_DEFS];
    expect(defs.error._steps.aggregate!("x")).toBe(true);
    expect(defs.error._steps.aggregate!(undefined)).toBe(false);
  });

  test("variadic and chained .meta() merge", () => {
    const a = field<string>()
      .meta(validation(), { hint: metaKey("x") })
      .meta({ touched });
    expect(Object.keys(a[META_DEFS]).sort()).toEqual(["error", "hint", "touched"]);
  });

  test("a node declares each key once: a second declaration throws, however either is declared", () => {
    const alreadyDeclared = (key: string, kind: string) =>
      `Meta key "${key}" is already declared on this ${kind} – a node declares each key once`;
    expect(() =>
      field<string>()
        .meta({ hint: metaKey("a") })
        .meta({ hint: metaKey("b") }),
    ).toThrow(alreadyDeclared("hint", "field"));
    expect(() => field<string>().meta({ hint: metaKey("a") }, { hint: metaKey("b") })).toThrow(
      alreadyDeclared("hint", "field"),
    );
    expect(() => field<string>().meta(validation()).meta(validation())).toThrow(alreadyDeclared("error", "field"));
    expect(() => field<string>().meta(control(), { touched })).toThrow(alreadyDeclared("touched", "field"));
    expect(() =>
      field<string>()
        .meta({ error: metaKey("") })
        .meta(validation()),
    ).toThrow(alreadyDeclared("error", "field"));
    expect(() =>
      field<string>()
        .meta(validation())
        .meta({ error: metaKey("") }),
    ).toThrow(alreadyDeclared("error", "field"));
    expect(() =>
      object({ a: field<string>() })
        .meta({ hint: metaKey("") })
        .meta({ hint: metaKey("") }),
    ).toThrow(alreadyDeclared("hint", "object"));
    expect(() =>
      array(object({ a: field<string>() }))
        .meta({ hint: metaKey("") })
        .meta({ hint: metaKey("") }),
    ).toThrow(alreadyDeclared("hint", "array"));
  });

  test("reserved meta keys are rejected", () => {
    // @ts-expect-error – "meta" is reserved and rejected at compile time
    expect(() => field<string>().meta({ meta: metaKey(1) })).toThrow(/reserved/);
    // @ts-expect-error – "constructor" is reserved and rejected at compile time
    expect(() => field<string>().meta({ constructor: metaKey(1) })).toThrow(/reserved/);
    // @ts-expect-error – "__proto__" is reserved and rejected at compile time
    expect(() => field<string>().meta({ ["__proto__"]: metaKey(1) })).toThrow(/reserved/);
    // A literal `__proto__` never creates the key: in an object literal it
    // swaps the bag's prototype, which the core rejects instead of dropping it.
    // @ts-expect-error – "__proto__" is reserved and rejected at compile time
    expect(() => field<string>().meta({ __proto__: metaKey(true) })).toThrow(/reserved/);
  });

  test("a meta key named `item` collides only with an array's item template", () => {
    // .meta() runs before form(), so the node is still a template and its
    // path label is "<root>".
    const message = `"item" is the item of "<root>" and cannot also be a meta key`;
    expect(() => array(object({ x: field<string>() })).meta({ item: metaKey(1) })).toThrow(message);
    expect(() => field<string>().meta({ item: metaKey(1) })).not.toThrow();
    expect(() => object({ a: field<string>() }).meta({ item: metaKey(1) })).not.toThrow();
  });
});

describe("Meta references", () => {
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
      `"error" is a field of "<root>" and cannot also be a meta key`,
    );
    expect(() => object({ label: field<string>() }).meta({ label: metaKey("Group") })).toThrow(/"label" is a field of/);
  });

  test(".meta() leaves the original node untouched", () => {
    const base = field<string>();
    const withMeta = base.meta(validation());
    expect((base as any).error).toBe(undefined);
    expect(withMeta.error instanceof MetaRef).toBe(true);
  });

  test("paths through nested arrays, for nodes and meta refs", () => {
    const f = form(
      object({
        outer: array(object({ inner: array(object({ v: field<string>().meta(control()) })) })),
      }),
    );
    expect(pathOf(f.outer.item.inner.item.v)).toBe("outer[].inner[].v");
    expect(f.outer.item.inner.item.v.error.path).toBe("outer[].inner[].v#error");
    expect(pathOf(f.outer.item.inner)).toBe("outer[].inner");
  });
});

describe("Closed meta in the store", () => {
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

describe("Arrays", () => {
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

// The names no field name or meta key may take: the .meta() method, and the
// names JavaScript treats specially on every object. Everything else that the
// node itself needs (id, lens, path, parent, the type markers) lives behind
// symbols, so it cannot collide.
const RESERVED = ["meta", "constructor", "__proto__"];

describe("Reserved names, table-driven", () => {
  test("every reserved name is rejected as a field name and as a meta key", () => {
    for (const name of RESERVED) {
      expect(() => object({ [name]: field<string>() }), `field "${name}"`).toThrow(/reserved name/);
      expect(() => field<string>().meta({ [name]: metaKey(1) }), `meta key "${name}"`).toThrow(/reserved name/);
    }
  });

  test("`item` is free as a field name and as a meta key off arrays", () => {
    expect(() => object({ item: field<string>() })).not.toThrow();
    expect(() => field<string>().meta({ item: metaKey(1) })).not.toThrow();
  });

  test("_fields, _meta and _metaDefs are ordinary field names", () => {
    const f = form(
      object({ _fields: field<string>(), _meta: field<number>(), _metaDefs: field<boolean>() }).meta({
        hint: metaKey("h"),
      }),
    );
    const s = createStore(f, { _fields: "a", _meta: 1, _metaDefs: true });
    s.set(f._meta, 2);
    expect(s.get(f)).toEqual({ _fields: "a", _meta: 2, _metaDefs: true });
    expect(s.get(f.hint), "the node's own meta still works").toBe("h");
  });

  test("_fields, _meta and _metaDefs are ordinary meta keys", () => {
    const f = form(
      object({
        group: object({ x: field<string>() }).meta({
          _fields: metaKey(1),
          _meta: metaKey("m"),
          _metaDefs: metaKey(false),
        }),
      }),
    );
    const s = createStore(f, { group: { x: "a" } });
    s.set(f.group._meta, "n");
    expect([s.get(f.group._fields), s.get(f.group._meta), s.get(f.group._metaDefs)]).toEqual([1, "n", false]);
    expect(s.get(f.group.x), "the node's own children still work").toBe("a");
  });
});
