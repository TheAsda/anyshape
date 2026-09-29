import { it, expect } from "vitest";
import { form, object, array, field, meta, createStore, type InferValue } from "./index";

// ---------------------------------------------------------------------------
const address = object({
  street: field<string>(),
  city: field<string>().meta(meta().required().label("City"), { error: undefined as string | undefined }),
});

const lineShape = object({
  sku: field<string>().meta(meta().required(), { touched: false, error: undefined as string | undefined }),
  qty: field<number>(),
  notes: array(object({ text: field<string>() })),
}).meta({ rowError: undefined as string | undefined });

const userShape = form(
  object({
    name: field<string>().meta(meta().required().label("Full name")),
    shipping: address.meta({ collapsed: false }),
    billing: address,
    items: array(lineShape).meta(meta().custom("maxItems", 10)),
  }).meta({ title: "User" })
);

type User = InferValue<typeof userShape>;

function initial(): User {
  return {
    name: "Ann",
    shipping: { street: "Main", city: "Riga" },
    billing: { street: "Side", city: "Tallinn" },
    items: [
      { sku: "A", qty: 1, notes: [{ text: "a1" }] },
      { sku: "B", qty: 2, notes: [] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Nodes
it("parent links", () => {
  expect(userShape.parent).toBe(undefined);
  expect(userShape.shipping.parent).toBe(userShape);
  expect(userShape.shipping.city.parent).toBe(userShape.shipping);
  expect(userShape.items.item.parent).toBe(userShape.items);
  expect(userShape.items.item.notes.item.text.parent).toBe(userShape.items.item.notes.item);
});

it("reused shapes get distinct nodes", () => {
  expect(userShape.shipping.city === userShape.billing.city).toBe(false);
  expect(userShape.shipping.city.id === userShape.billing.city.id).toBe(false);
});

it("item template lenses are item-relative", () => {
  expect(userShape.items.item.sku.lens.get({ sku: "X" })).toBe("X");
  expect(userShape.items.item.sku.path).toBe("items[].sku");
});

it("static meta incl. root meta", () => {
  expect(userShape._meta.title).toBe("User");
  expect(userShape.name._meta.label).toBe("Full name");
  expect(userShape.items._meta.maxItems).toBe(10);
});

it("reserved field names rejected", () => {
  expect(() => object({ parent: field<string>() })).toThrow(/reserved/);
});

it("arrays of primitives rejected", () => {
  // @ts-expect-error – items must be object shapes
  expect(() => array(field<string>())).toThrow(/object shapes/);
});

it(".meta() after form() rejected", () => {
  expect(() => userShape.name.meta({ x: 1 })).toThrow(/before form/);
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

// ---------------------------------------------------------------------------
// Reused shapes containing arrays; meta delegation; substore arguments
it("a reused shape containing an array: separate templates, ids and paths per use", () => {
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
