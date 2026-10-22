// Shape: node instantiation, identity, parents, templates and structural checks.

import { test, describe, expect } from "vitest";

import { form, object, array, field, createStore, parentOf, pathOf } from "../src/index";
import { ID, LENS } from "../src/internal";
import { userShape } from "./support/fixtures/user";

describe("Nodes", () => {
  test("parent links", () => {
    expect(parentOf(userShape)).toBe(undefined);
    expect(parentOf(userShape.shipping)).toBe(userShape);
    expect(parentOf(userShape.shipping.city)).toBe(userShape.shipping);
    expect(parentOf(userShape.items.item)).toBe(userShape.items);
    expect(parentOf(userShape.items.item.notes.item.text)).toBe(userShape.items.item.notes.item);
  });

  test("reused shapes get distinct nodes", () => {
    expect(userShape.shipping.city === userShape.billing.city).toBe(false);
    expect(userShape.shipping.city[ID] === userShape.billing.city[ID]).toBe(false);
  });

  test("item template paths are item-relative", () => {
    expect(pathOf(userShape.items.item.sku)).toBe("items[].sku");
    expect(pathOf(userShape)).toBe("");
    expect(pathOf(userShape.items)).toBe("items");
  });

  test("id, lens, path, parent, _type, _hasCreate and item are free as field names", () => {
    const shape = form(
      object({
        id: field<string>(),
        lens: field<string>(),
        path: field<string>(),
        parent: field<string>(),
        _type: field<string>(),
        _hasCreate: field<string>(),
        item: field<string>(),
        toString: field<string>(),
      }).meta({ hint: "x" }),
    );
    const initial = {
      id: "a",
      lens: "b",
      path: "c",
      parent: "d",
      _type: "e",
      _hasCreate: "f",
      item: "g",
      toString: "h",
    };
    const s = createStore(shape, initial);
    expect(s.get(shape)).toEqual(initial);
    s.set(shape.id, "a2");
    expect(s.get(shape.id)).toBe("a2");
    expect(s.get(shape.hint)).toBe("x");
    expect(pathOf(shape)).toBe("");
    expect(pathOf(object({ id: field<string>() })), "a template is unnamed").toBe("");
    const named = field<string>().meta({ id: 1, path: "", item: 1, toString: "x" });
    const namedShape = form(object({ name: named }));
    const namedStore = createStore(namedShape, { name: "v" });
    expect(namedStore.get(namedShape.name.id)).toBe(1);
    expect(namedStore.get(namedShape.name.path)).toBe("");
    expect(namedStore.get(namedShape.name.item)).toBe(1);
  });

  test("item template lenses are item-relative", () => {
    const shape = form(object({ items: array(object({ sku: field<string>() })) }));
    expect(shape.items.item.sku[LENS].get({ sku: "a" })).toBe("a");
  });

  test("the names that stay reserved are rejected as field names", () => {
    const message = (key: string) => `"${key}" is a reserved name and cannot be used as a field name`;
    // @ts-expect-error – "meta" is reserved and rejected at compile time
    expect(() => object({ meta: field<string>() })).toThrow(message("meta"));
    // @ts-expect-error – "constructor" is reserved and rejected at compile time
    expect(() => object({ constructor: field<string>() })).toThrow(message("constructor"));
    // @ts-expect-error – "__proto__" is reserved and rejected at compile time
    expect(() => object({ ["__proto__"]: field<string>() })).toThrow(message("__proto__"));
    // The plain literal never creates the key: for an object value it swaps
    // the bag's prototype, and the field would silently disappear.
    // @ts-expect-error – "__proto__" is reserved and rejected at compile time
    expect(() => object({ __proto__: field<string>() })).toThrow(message("__proto__"));
  });

  test("arrays of primitives rejected", () => {
    // @ts-expect-error – items must be object shapes
    expect(() => array(field<string>())).toThrow(/object shapes/);
  });

  test("form() takes only an object node", () => {
    const message = "form() takes an object node – wrap the fields, e.g. form(object({ ... }))";
    expect(() => form({ a: field<string>() } as never)).toThrow(message);
    expect(() => form(field<string>() as never)).toThrow(message);
    expect(() => form(array(object({ a: field<string>() })) as never)).toThrow(message);
  });

  test(".meta() after form() rejected", () => {
    expect(() => userShape.name.meta({ x: 1 })).toThrow(/before form/);
  });
});

describe("Reused shapes containing arrays", () => {
  test("a reused shape containing an array: separate templates, ids and paths per use", () => {
    const block = object({ items: array(object({ x: field<string>() })) });
    const f = form(object({ a: block, b: block }));
    expect(f.a.items.item).not.toBe(f.b.items.item);
    expect(pathOf(f.a.items.item.x)).toBe("a.items[].x");
    expect(pathOf(f.b.items.item.x)).toBe("b.items[].x");
    const nodes = [
      f,
      f.a,
      f.a.items,
      f.a.items.item,
      f.a.items.item.x,
      f.b,
      f.b.items,
      f.b.items.item,
      f.b.items.item.x,
    ];
    expect(new Set(nodes.map((n) => n[ID])).size, "every id is unique").toBe(nodes.length);

    const s = createStore(f, { a: { items: [{ x: "1" }] }, b: { items: [{ x: "2" }] } });
    const rowA = s.substore(f.a.items).itemAt(0);
    expect(rowA.get(f.a.items.item.x)).toBe("1");
    expect(s.substore(f.b.items).itemAt(0).get(f.b.items.item.x)).toBe("2");
    expect(() => rowA.get(f.b.items.item.x), "the other copy's template is not in this row").toThrow(
      /"b\.items\[\]\.x" is inside an array item/,
    );
  });
});
