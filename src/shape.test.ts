// A · Shape: node instantiation, identity, parents, templates and structural checks.

import {
  form, object, array, field, createStore,
} from "./index";
import { test, describe, expect } from "vitest";
import { userShape, initial } from "./test/fixtures/user";

describe("A · Nodes", () => {
  test("parent links", () => {
    expect(userShape.parent).toBe(undefined);
    expect(userShape.shipping.parent).toBe(userShape);
    expect(userShape.shipping.city.parent).toBe(userShape.shipping);
    expect(userShape.items.item.parent).toBe(userShape.items);
    expect(userShape.items.item.notes.item.text.parent).toBe(userShape.items.item.notes.item);
  });

  test("reused shapes get distinct nodes", () => {
    expect(userShape.shipping.city === userShape.billing.city).toBe(false);
    expect(userShape.shipping.city.id === userShape.billing.city.id).toBe(false);
  });

  test("item template lenses are item-relative", () => {
    expect(userShape.items.item.sku.lens.get({ sku: "X" })).toBe("X");
    expect(userShape.items.item.sku.path).toBe("items[].sku");
  });

  test("reserved field names rejected", () => {
    expect(() => object({ parent: field<string>() })).toThrow(/reserved/);
  });

  test("arrays of primitives rejected", () => {
    // @ts-expect-error – items must be object shapes
    expect(() => array(field<string>())).toThrow(/object shapes/);
  });

  test(".meta() after form() rejected", () => {
    expect(() => userShape.name.meta({ x: 1 })).toThrow(/before form/);
  });
});

describe("A · Reused shapes containing arrays", () => {
  test("a reused shape containing an array: separate templates, ids and paths per use", () => {
    const block = object({ items: array(object({ x: field<string>() })) });
    const f = form({ a: block, b: block });
    expect(f.a.items.item).not.toBe(f.b.items.item);
    expect(f.a.items.item.x.path).toBe("a.items[].x");
    expect(f.b.items.item.x.path).toBe("b.items[].x");
    const nodes = [f, f.a, f.a.items, f.a.items.item, f.a.items.item.x, f.b, f.b.items, f.b.items.item, f.b.items.item.x];
    expect(new Set(nodes.map((n) => n.id)).size, "every id is unique").toBe(nodes.length);

    const s = createStore(f, { a: { items: [{ x: "1" }] }, b: { items: [{ x: "2" }] } });
    const rowA = s.substore(f.a.items).itemAt(0);
    expect(rowA.get(f.a.items.item.x)).toBe("1");
    expect(s.substore(f.b.items).itemAt(0).get(f.b.items.item.x)).toBe("2");
    expect(() => rowA.get(f.b.items.item.x), "the other copy's template is not in this row").toThrow();
  });
});
