import { test as base, describe, expect } from "vitest";
import * as company from "./test/fixtures/company";
import { form, object, array, field, createStore, countIn, type InferValue } from "./index";
import { watchOrigins } from "./test/harness";
import { error } from "./test/features";

import { address, userShape, initial, type User } from "./test/fixtures/user";

const test = base
  .extend("store", () => createStore(userShape, initial()));

describe("D · Static meta", () => {
  test("static meta incl. root meta", ({ store: s }) => {
    expect(s.get(userShape.title)).toBe("User");
    expect(s.get(userShape.name.label)).toBe("Full name");
    expect(s.get(userShape.items.maxItems)).toBe(10);
  });
});

describe("D · Root + object substores", () => {
  test("get/set through root", ({ store: s }) => {
    s.set(userShape.shipping.city, "Vilnius");
    expect(s.get(userShape.shipping.city)).toBe("Vilnius");
    expect(s.get(userShape).billing.city).toBe("Tallinn");
  });

  test("structural sharing: unchanged branches keep references", ({ store: s }) => {
    const billing = s.get(userShape).billing;
    const items = s.get(userShape).items;
    s.set(userShape.shipping.city, "Vilnius");
    expect(s.get(userShape).billing).toBe(billing);
    expect(s.get(userShape).items).toBe(items);
  });

  test("same-value write is a no-op", ({ store: s }) => {
    const before = s.get(userShape);
    s.set(userShape.name, "Ann");
    expect(s.get(userShape)).toBe(before);
  });

  test("substores are cached", ({ store: s }) => {
    expect(s.substore(userShape.shipping)).toBe(s.substore(userShape.shipping));
    expect(s.substore(userShape.items)).toBe(s.substore(userShape.items));
  });

  test("substore rejects nodes outside its focus", ({ store: s }) => {
    const shipping = s.substore(userShape.shipping);
    expect(() => shipping.get(userShape.name)).toThrow(/not part of/);
    expect(() => shipping.get(userShape.billing.city)).toThrow(/not part of/);
    // @ts-expect-error – fields are not substores
    expect(() => s.substore(userShape.name)).toThrow(/object or array/);
  });

  test("root cannot reach into array items", ({ store: s }) => {
    expect(() => s.get(userShape.items.item.sku)).toThrow(/array item/);
  });

  test("meta: one owner per node, seeded from static meta", ({ store: s }) => {
    const shipping = s.substore(userShape.shipping);
    expect(s.get(userShape.shipping.city.label)).toBe("City");
    shipping.set(userShape.shipping.city.error, "Bad city");
    expect(s.get(userShape.shipping.city.error)).toBe("Bad city");          // delegated to owner
    expect(s.get(userShape.billing.city.error)).toBe(undefined);            // reused shape, separate meta
    s.set(userShape.shipping.collapsed, true);                  // section meta owned by root
    expect(shipping.get(userShape.shipping.collapsed)).toBe(true);
  });

  test("meta keeps static types", ({ store: s }) => {
    const label: string = s.get(userShape.name.label);
    const required: boolean = s.get(userShape.name.required);
    expect(label).toBe("Full name");
    expect(required).toBe(true);
  });
});

describe("E · Arrays", () => {
  test("items() returns stores in order with stable ids", ({ store: s }) => {
    const items = s.substore(userShape.items);
    const [a, b] = items.items();
    expect(a.get(userShape.items.item.sku)).toBe("A");
    expect(b.get(userShape.items.item.sku)).toBe("B");
    expect(items.items()[0]).toBe(a);
    expect(a.stableId === b.stableId).toBe(false);
  });

  test("writes through an item store preserve identity and meta", ({ store: s }) => {
    const items = s.substore(userShape.items);
    const a = items.itemAt(0);
    const oldRef = s.get(userShape).items[0];
    a.set(userShape.items.item.sku.touched, true);

    a.set(userShape.items.item.qty, 5);

    const newRef = s.get(userShape).items[0];
    expect(newRef === oldRef, "item reference changed").toBe(false);
    expect(newRef.qty).toBe(5);
    expect(items.item(newRef), "same store for the new reference").toBe(a);
    expect(items.itemAt(0).stableId).toBe(a.stableId);
    expect(a.get(userShape.items.item.sku.touched)).toBe(true);
    expect(() => items.item(oldRef)).toThrow(/not currently in/);
  });

  test("per-item meta is isolated", ({ store: s }) => {
    const [a, b] = s.substore(userShape.items).items();
    a.set(userShape.items.item.sku.error, "Required");
    expect(b.get(userShape.items.item.sku.error)).toBe(undefined);
    expect(b.get(userShape.items.item.sku.required)).toBe(true);   // static meta seeded per item
    a.set(userShape.items.item.rowError, "Bad row");   // whole-row meta on the item store
    expect(b.get(userShape.items.item.rowError)).toBe(undefined);
  });

  test("reordering keeps stores", ({ store: s }) => {
    const items = s.substore(userShape.items);
    const [a, b] = items.items();
    const [ra, rb] = s.get(userShape).items;
    s.set(userShape.items, [rb, ra]);
    expect(items.itemAt(0)).toBe(b);
    expect(items.itemAt(1)).toBe(a);
  });

  test("new object from outside = new store", ({ store: s }) => {
    const items = s.substore(userShape.items);
    const a = items.itemAt(0);
    const [ra, rb] = s.get(userShape).items;
    s.set(userShape.items, [{ ...ra }, rb]);
    expect(items.itemAt(0) === a).toBe(false);
    expect(a.isAttached()).toBe(false);
  });

  test("detached store: reads undefined, writes throw", ({ store: s }) => {
    const items = s.substore(userShape.items);
    const b = items.itemAt(1);
    s.set(userShape.items, [s.get(userShape).items[0]]);
    expect(b.isAttached()).toBe(false);
    expect(b.get(userShape.items.item.sku)).toBe(undefined);
    expect(() => b.set(userShape.items.item.sku, "Z")).toThrow(/detached/);
    expect(() => b.set(userShape.items.item.sku.error, "x")).toThrow(/detached/);
  });

  test("nested arrays: identity preserved at both levels", ({ store: s }) => {
    const line = s.substore(userShape.items).itemAt(0);
    const notes = line.substore(userShape.items.item.notes);
    const note = notes.itemAt(0);
    note.set(userShape.items.item.notes.item.text, "edited");
    expect(s.get(userShape).items[0].notes[0].text).toBe("edited");
    expect(s.substore(userShape.items).itemAt(0)).toBe(line);
    expect(notes.itemAt(0)).toBe(note);
    expect(line.isAttached() && note.isAttached()).toBe(true);
  });

  test("object substore inside an item reads through the item scope", ({ store: s }) => {
    const line = s.substore(userShape.items).itemAt(1);
    const notes = line.substore(userShape.items.item.notes);
    notes.set(userShape.items.item.notes, [{ text: "b1" }]);
    expect(s.get(userShape).items[1].notes[0].text).toBe("b1");
    expect(s.substore(userShape.items).itemAt(1)).toBe(line);
  });

  test("structural validation", ({ store: s }) => {
    const r = s.get(userShape).items[0];
    expect(() => s.set(userShape.items, [r, r])).toThrow(/same object twice/);
    expect(() => s.set(userShape.items, [1 as any])).toThrow(/must be an object/);
    expect(() => createStore(userShape, { ...initial(), items: "x" as any })).toThrow(/must be an array/);
  });
});

describe("D · Meta delegation and substore arguments", () => {
  test("meta of a deep node is one value, whichever store is asked", ({ store: s }) => {
    const section = s.substore(userShape.shipping);
    section.set(userShape.shipping.city.error, "Bad");
    expect(s.get(userShape.shipping.city.error)).toBe("Bad");
    expect(section.get(userShape.shipping.city.error)).toBe("Bad");
    expect(s.get(userShape.billing.city.error), "the reused shape's other copy is separate").toBe(undefined);
  });

  test("substore() needs an object or array node", ({ store: s }) => {
    expect(() => s.substore(userShape.name as never)).toThrow(/needs an object or array node, got field "name"/);
  });
});

describe("D · Foreign nodes and duplicate rows", () => {
  test("nodes of another form, or uninstantiated descriptions, are rejected", ({ store: s }) => {
    const other = form(object({ name: field<string>(), shipping: address }));
    expect(() => s.get(other.name)).toThrow(/is not part of the store/);
    expect(() => s.set(other.name, "x")).toThrow(/is not part of the store/);
    expect(() => s.substore(other.shipping)).toThrow(/is not part of the store/);
    expect(() => s.get(address.city)).toThrow(/is not part of the store/);
  });

  test("a row write that would put the same object in the array twice is rejected", ({ store: s }) => {
    const [a, b] = s.substore(userShape.items).items();
    const aValue = a.get(userShape.items.item);
    expect(() => b.set(userShape.items.item, aValue)).toThrow(/would contain the same object twice/);
    expect(s.get(userShape.items).map((i) => i.sku), "unchanged").toEqual(["A", "B"]);
  });
});

describe("D, E · Reference API and array helpers", () => {
  const { shape, L, initial, originsOf } = company;
  const test = base
    .extend("store", () => createStore(shape, initial()))
    .extend("lines", ({ store }) => store.substore(shape.lines));
  // Compile-time only – never called.
  function typeOnlyChecks() {
    const s = createStore(shape, initial());
    const b: boolean = s.get(shape.name.touched);
    const e: string | undefined = s.get(shape.name.error);
    const n: number = s.get(countIn(shape, error));
    const v: string = s.get(shape.name);
    // @ts-expect-error – a meta ref is not a count
    const wrong: number = s.get(shape.name.touched);
    // @ts-expect-error – value type is checked
    s.set(shape.name.touched, "yes");
    return [b, e, n, v, wrong];
  }
  void typeOnlyChecks;

  // ---------------------------------------------------------------------------
  // Reference API
  test("get / set with value and meta refs", ({ store: s }) => {
    expect(s.get(shape.name)).toBe("Ann");
    s.set(shape.name, "Bob");
    expect(s.get(shape.name)).toBe("Bob");
    s.set(shape.name.error, "Bad");
    expect(s.get(shape.name.error)).toBe("Bad");
    expect(s.get(shape.name.error)).toBe("Bad");
  });

  // ---------------------------------------------------------------------------
  // Array helpers
  test("append / insert / remove / move", ({ store: s, lines }) => {
    const c = lines.append({ sku: "C" });
    expect(lines.items().map((r) => r.get(L.sku))).toEqual(["A", "B", "C"]);
    expect(c.get(L.qty), "factory default kept").toBe(1);
    const z = lines.insert(0, { sku: "Z", qty: 3 });
    expect(lines.items().map((r) => r.get(L.sku))).toEqual(["Z", "A", "B", "C"]);
    lines.move(z, 3);
    expect(lines.items().map((r) => r.get(L.sku))).toEqual(["A", "B", "C", "Z"]);
    lines.remove(c);
    expect(lines.items().map((r) => r.get(L.sku))).toEqual(["A", "B", "Z"]);
    expect(c.isAttached()).toBe(false);
    expect(() => lines.remove(c)).toThrow(/detached/);
  });

  test("arrays without create need complete items", ({ store: s }) => {
    const tags = s.substore(shape.tags);
    tags.append({ text: "t" });
    expect(tags.items().length).toBe(1);
    // @ts-expect-error – no create factory: an item is required
    expect(() => tags.append()).toThrow(/no `create` factory/);
  });

  test("helpers pass the origin through", ({ store: s }) => {
    const seen = watchOrigins(s, shape.lines);
    s.substore(shape.lines).append(undefined, { origin: "user" });
    expect(seen).toEqual([["user"]]);
  });

  test("helpers reject out-of-range indexes", ({ store: s, lines }) => {
    const [a] = lines.items();
    expect(() => lines.itemAt(-1)).toThrow(RangeError);
    expect(() => lines.itemAt(2)).toThrow(RangeError);
    expect(() => lines.insert(-1, { sku: "X" })).toThrow(RangeError);
    expect(() => lines.insert(3, { sku: "X" })).toThrow(RangeError);
    expect(() => lines.move(a, -1)).toThrow(RangeError);
    expect(() => lines.move(a, 2)).toThrow(RangeError);
    expect(lines.items().map((r) => r.get(L.sku)), "nothing changed").toEqual(["A", "B"]);
  });

  test("helpers reject objects and rows that are not in this array", ({ store: s, lines }) => {
    expect(() => lines.item({ sku: "A", qty: 1, notes: [] })).toThrow(/not currently in "lines"/);
    const [note] = lines.itemAt(0).substore(L.notes).items();
    expect(() => lines.remove(note as never)).toThrow(/does not belong to "lines"/);
    expect(() => lines.move(note as never, 0)).toThrow(/does not belong to "lines"/);
    const [a] = lines.items();
    lines.remove(a);
    expect(() => lines.move(a, 0)).toThrow(/detached/);
  });

  // ---------------------------------------------------------------------------
  // Factories and baselines
  test("the create factory's result is copied, so even a shared default gives distinct rows", () => {
    const shared = { t: "" };
    const f = form({ rows: array(object({ t: field<string>() }), { create: () => shared }) });
    const s = createStore(f, { rows: [] });
    const rows = s.substore(f.rows);
    const a = rows.append();
    const b = rows.append({ t: "x" });
    expect(a).not.toBe(b);
    expect(rows.items().length).toBe(2);
    expect(s.get(f.rows)[0]).not.toBe(shared);
    expect(shared, "the factory's object is never written").toEqual({ t: "" });
  });
});

describe("I · Own-node meta keys", () => {
  const { shape, L, initial } = company;
  const test = base
    .extend("store", () => createStore(shape, initial()))
    .extend("lines", ({ store }) => store.substore(shape.lines));

  test("a meta key that an ancestor also declares reads its own node only (#90)", ({ store: s, lines }) => {
    const row = lines.itemAt(0);
    const seen: unknown[] = [];
    s.subscribe(shape.company.address.city.visible, () => seen.push("city"));
    row.subscribe(L.sku.disabled, () => seen.push("sku"));
    s.set(shape.company.visible, false);
    s.set(shape.company.address.visible, false);
    s.set(shape.disabled, true);
    s.set(shape.lines.disabled, true);
    expect(s.get(shape.company.address.city.visible)).toBe(true);
    expect(row.get(L.sku.disabled), "across a row boundary").toBe(false);
    expect(seen, "an ancestor's write does not notify").toEqual([]);
  });
});
