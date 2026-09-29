import { describe, it, expect } from "vitest";
import * as company from "./test/fixtures/company";
import { form, object, array, field, meta, createStore, countIn, type InferValue, type Origin } from "./index";

import { address, userShape, initial, type User } from "./test/fixtures/user";




it("static meta incl. root meta", () => {
  expect(userShape._meta.title).toBe("User");
  expect(userShape.name._meta.label).toBe("Full name");
  expect(userShape.items._meta.maxItems).toBe(10);
});




// ---------------------------------------------------------------------------
// Root + object substores
it("get/set through root", () => {
  const s = createStore(userShape, initial());
  s.setValue(userShape.shipping.city, "Vilnius");
  expect(s.getValue(userShape.shipping.city)).toBe("Vilnius");
  expect(s.getValues().billing.city).toBe("Tallinn");
});

it("structural sharing: unchanged branches keep references", () => {
  const s = createStore(userShape, initial());
  const billing = s.getValues().billing;
  const items = s.getValues().items;
  s.setValue(userShape.shipping.city, "Vilnius");
  expect(s.getValues().billing).toBe(billing);
  expect(s.getValues().items).toBe(items);
});

it("same-value write is a no-op", () => {
  const s = createStore(userShape, initial());
  const before = s.getValues();
  s.setValue(userShape.name, "Ann");
  expect(s.getValues()).toBe(before);
});

it("substores are cached", () => {
  const s = createStore(userShape, initial());
  expect(s.substore(userShape.shipping)).toBe(s.substore(userShape.shipping));
  expect(s.substore(userShape.items)).toBe(s.substore(userShape.items));
});

it("substore rejects nodes outside its focus", () => {
  const s = createStore(userShape, initial());
  const shipping = s.substore(userShape.shipping);
  expect(() => shipping.getValue(userShape.name)).toThrow(/not part of/);
  expect(() => shipping.getValue(userShape.billing.city)).toThrow(/not part of/);
  // @ts-expect-error – fields are not substores
  expect(() => s.substore(userShape.name)).toThrow(/object or array/);
});

it("root cannot reach into array items", () => {
  const s = createStore(userShape, initial());
  expect(() => s.getValue(userShape.items.item.sku)).toThrow(/array item/);
});

it("meta: one owner per node, seeded from static meta", () => {
  const s = createStore(userShape, initial());
  const shipping = s.substore(userShape.shipping);
  expect(s.getMeta(userShape.shipping.city).label).toBe("City");
  shipping.setMeta(userShape.shipping.city, { error: "Bad city" });
  expect(s.getMeta(userShape.shipping.city).error).toBe("Bad city");          // delegated to owner
  expect(s.getMeta(userShape.billing.city).error).toBe(undefined);            // reused shape, separate meta
  s.setMeta(userShape.shipping, { collapsed: true });                  // section meta owned by root
  expect(shipping.getMeta(userShape.shipping).collapsed).toBe(true);
});

it("meta keeps static types", () => {
  const s = createStore(userShape, initial());
  const m = s.getMeta(userShape.name);
  const label: string = m.label;
  const required: boolean = m.required;
  expect(label).toBe("Full name");
  expect(required).toBe(true);
});

// ---------------------------------------------------------------------------
// Arrays
it("items() returns stores in order with stable ids", () => {
  const s = createStore(userShape, initial());
  const items = s.substore(userShape.items);
  const [a, b] = items.items();
  expect(a.getValue(userShape.items.item.sku)).toBe("A");
  expect(b.getValue(userShape.items.item.sku)).toBe("B");
  expect(items.items()[0]).toBe(a);
  expect(a.stableId === b.stableId).toBe(false);
});

it("writes through an item store preserve identity and meta", () => {
  const s = createStore(userShape, initial());
  const items = s.substore(userShape.items);
  const a = items.itemAt(0);
  const oldRef = s.getValues().items[0];
  a.setMeta(userShape.items.item.sku, { touched: true });

  a.setValue(userShape.items.item.qty, 5);

  const newRef = s.getValues().items[0];
  expect(newRef === oldRef, "item reference changed").toBe(false);
  expect(newRef.qty).toBe(5);
  expect(items.item(newRef), "same store for the new reference").toBe(a);
  expect(items.itemAt(0).stableId).toBe(a.stableId);
  expect(a.getMeta(userShape.items.item.sku).touched).toBe(true);
  expect(() => items.item(oldRef)).toThrow(/not currently in/);
});

it("per-item meta is isolated", () => {
  const s = createStore(userShape, initial());
  const [a, b] = s.substore(userShape.items).items();
  a.setMeta(userShape.items.item.sku, { error: "Required" });
  expect(b.getMeta(userShape.items.item.sku).error).toBe(undefined);
  expect(b.getMeta(userShape.items.item.sku).required).toBe(true);   // static meta seeded per item
  a.setMeta(userShape.items.item, { rowError: "Bad row" });   // whole-row meta on the item store
  expect(b.getMeta(userShape.items.item).rowError).toBe(undefined);
});

it("reordering keeps stores", () => {
  const s = createStore(userShape, initial());
  const items = s.substore(userShape.items);
  const [a, b] = items.items();
  const [ra, rb] = s.getValues().items;
  s.setValue(userShape.items, [rb, ra]);
  expect(items.itemAt(0)).toBe(b);
  expect(items.itemAt(1)).toBe(a);
});

it("new object from outside = new store", () => {
  const s = createStore(userShape, initial());
  const items = s.substore(userShape.items);
  const a = items.itemAt(0);
  const [ra, rb] = s.getValues().items;
  s.setValue(userShape.items, [{ ...ra }, rb]);
  expect(items.itemAt(0) === a).toBe(false);
  expect(a.isAttached()).toBe(false);
});

it("detached store: reads undefined, writes throw", () => {
  const s = createStore(userShape, initial());
  const items = s.substore(userShape.items);
  const b = items.itemAt(1);
  s.setValue(userShape.items, [s.getValues().items[0]]);
  expect(b.isAttached()).toBe(false);
  expect(b.getValue(userShape.items.item.sku)).toBe(undefined);
  expect(() => b.setValue(userShape.items.item.sku, "Z")).toThrow(/detached/);
  expect(() => b.setMeta(userShape.items.item.sku, { error: "x" })).toThrow(/detached/);
});

it("nested arrays: identity preserved at both levels", () => {
  const s = createStore(userShape, initial());
  const line = s.substore(userShape.items).itemAt(0);
  const notes = line.substore(userShape.items.item.notes);
  const note = notes.itemAt(0);
  note.setValue(userShape.items.item.notes.item.text, "edited");
  expect(s.getValues().items[0].notes[0].text).toBe("edited");
  expect(s.substore(userShape.items).itemAt(0)).toBe(line);
  expect(notes.itemAt(0)).toBe(note);
  expect(line.isAttached() && note.isAttached()).toBe(true);
});

it("object substore inside an item reads through the item scope", () => {
  const s = createStore(userShape, initial());
  const line = s.substore(userShape.items).itemAt(1);
  const notes = line.substore(userShape.items.item.notes);
  notes.setValue(userShape.items.item.notes, [{ text: "b1" }]);
  expect(s.getValues().items[1].notes[0].text).toBe("b1");
  expect(s.substore(userShape.items).itemAt(1)).toBe(line);
});

it("structural validation", () => {
  const s = createStore(userShape, initial());
  const r = s.getValues().items[0];
  expect(() => s.setValue(userShape.items, [r, r])).toThrow(/same object twice/);
  expect(() => s.setValue(userShape.items, [1 as any])).toThrow(/must be an object/);
  expect(() => createStore(userShape, { ...initial(), items: "x" as any })).toThrow(/must be an array/);
});


it("meta of a deep node is one object, whichever store is asked", () => {
  const s = createStore(userShape, initial());
  const section = s.substore(userShape.shipping);
  expect(section.getMeta(userShape.shipping.city)).toBe(s.getMeta(userShape.shipping.city));
  section.setMeta(userShape.shipping.city, { error: "Bad" });
  expect(s.getMeta(userShape.shipping.city).error).toBe("Bad");
  expect(s.get(userShape.shipping.city.error)).toBe("Bad");
  expect(s.getMeta(userShape.billing.city).error, "the reused shape's other copy is separate").toBe(undefined);
});

it("substore() needs an object or array node", () => {
  const s = createStore(userShape, initial());
  expect(() => s.substore(userShape.name as never)).toThrow(/needs an object or array node, got field "name"/);
});

// ---------------------------------------------------------------------------
it("nodes of another form, or uninstantiated descriptions, are rejected", () => {
  const s = createStore(userShape, initial());
  const other = form(object({ name: field<string>(), shipping: address }));
  expect(() => s.get(other.name)).toThrow(/is not part of the store/);
  expect(() => s.set(other.name, "x")).toThrow(/is not part of the store/);
  expect(() => s.substore(other.shipping)).toThrow(/is not part of the store/);
  expect(() => s.get(address.city)).toThrow(/is not part of the store/);
});

it("a row write that would put the same object in the array twice is rejected", () => {
  const s = createStore(userShape, initial());
  const [a, b] = s.substore(userShape.items).items();
  const aValue = a.get(userShape.items.item);
  expect(() => b.set(userShape.items.item, aValue)).toThrow(/would contain the same object twice/);
  expect(s.get(userShape.items).map((i) => i.sku), "unchanged").toEqual(["A", "B"]);
});

describe('D, E · reference API and array helpers', () => {
  const { shape, L, initial, originsOf } = company;
  // Compile-time only – never called.
  function typeOnlyChecks() {
    const s = createStore(shape, initial());
    const b: boolean = s.get(shape.name.touched);
    const e: string | undefined = s.get(shape.name.error);
    const n: number = s.get(countIn(shape, "error"));
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
  it("get / set with value and meta refs", () => {
    const s = createStore(shape, initial());
    expect(s.get(shape.name)).toBe("Ann");
    s.set(shape.name, "Bob");
    expect(s.getValue(shape.name)).toBe("Bob");
    s.set(shape.name.error, "Bad");
    expect(s.get(shape.name.error)).toBe("Bad");
    expect(s.getMeta(shape.name).error).toBe("Bad");
  });

  // ---------------------------------------------------------------------------
  // Array helpers
  it("append / insert / remove / move", () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
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

  it("arrays without create need complete items", () => {
    const s = createStore(shape, initial());
    const tags = s.substore(shape.tags);
    tags.append({ text: "t" });
    expect(tags.items().length).toBe(1);
    // @ts-expect-error – no create factory: an item is required
    expect(() => tags.append()).toThrow(/no `create` factory/);
  });

  it("helpers pass the origin through", () => {
    const s = createStore(shape, initial());
    const seen: Origin[][] = [];
    s.react(shape.lines, (_n, _p, i) => seen.push([...i.origins]));
    s.substore(shape.lines).append(undefined, { origin: "user" });
    expect(seen).toEqual([["user"]]);
  });

  it("helpers reject out-of-range indexes", () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
    const [a] = lines.items();
    expect(() => lines.itemAt(-1)).toThrow(RangeError);
    expect(() => lines.itemAt(2)).toThrow(RangeError);
    expect(() => lines.insert(-1, { sku: "X" })).toThrow(RangeError);
    expect(() => lines.insert(3, { sku: "X" })).toThrow(RangeError);
    expect(() => lines.move(a, -1)).toThrow(RangeError);
    expect(() => lines.move(a, 2)).toThrow(RangeError);
    expect(lines.items().map((r) => r.get(L.sku)), "nothing changed").toEqual(["A", "B"]);
  });

  it("helpers reject objects and rows that are not in this array", () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
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
  it("the create factory's result is copied, so even a shared default gives distinct rows", () => {
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
