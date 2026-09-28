// Run: npx tsx src/store.test.ts   (type checks: npx tsc)
import { form, object, array, field, meta, createStore, type InferValue } from "./index";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (e) { console.error(`FAIL ${name}\n  ${(e as Error).message}`); process.exitCode = 1; }
}
function eq(a: unknown, b: unknown, msg = "") {
  if (!Object.is(a, b)) throw new Error(`${msg} expected ${String(b)}, got ${String(a)}`);
}
function throws(fn: () => unknown, re: RegExp) {
  try { fn(); } catch (e) { if (re.test((e as Error).message)) return; throw new Error(`wrong error: ${(e as Error).message}`); }
  throw new Error(`expected throw matching ${re}`);
}
declare const process: { exitCode?: number };

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
test("parent links", () => {
  eq(userShape.parent, undefined);
  eq(userShape.shipping.parent, userShape);
  eq(userShape.shipping.city.parent, userShape.shipping);
  eq(userShape.items.item.parent, userShape.items);
  eq(userShape.items.item.notes.item.text.parent, userShape.items.item.notes.item);
});

test("reused shapes get distinct nodes", () => {
  eq(userShape.shipping.city === userShape.billing.city, false);
  eq(userShape.shipping.city.id === userShape.billing.city.id, false);
});

test("item template lenses are item-relative", () => {
  eq(userShape.items.item.sku.lens.get({ sku: "X" }), "X");
  eq(userShape.items.item.sku.path, "items[].sku");
});

test("static meta incl. root meta", () => {
  eq(userShape._meta.title, "User");
  eq(userShape.name._meta.label, "Full name");
  eq(userShape.items._meta.maxItems, 10);
});

test("reserved field names rejected", () => {
  throws(() => object({ parent: field<string>() }), /reserved/);
});

test("arrays of primitives rejected", () => {
  // @ts-expect-error – items must be object shapes
  throws(() => array(field<string>()), /object shapes/);
});

test(".meta() after form() rejected", () => {
  throws(() => userShape.name.meta({ x: 1 }), /before form/);
});

// ---------------------------------------------------------------------------
// Root + object substores
test("get/set through root", () => {
  const s = createStore(userShape, initial());
  s.setValue(userShape.shipping.city, "Vilnius");
  eq(s.getValue(userShape.shipping.city), "Vilnius");
  eq(s.getValues().billing.city, "Tallinn");
});

test("structural sharing: unchanged branches keep references", () => {
  const s = createStore(userShape, initial());
  const billing = s.getValues().billing;
  const items = s.getValues().items;
  s.setValue(userShape.shipping.city, "Vilnius");
  eq(s.getValues().billing, billing);
  eq(s.getValues().items, items);
});

test("same-value write is a no-op", () => {
  const s = createStore(userShape, initial());
  const before = s.getValues();
  s.setValue(userShape.name, "Ann");
  eq(s.getValues(), before);
});

test("substores are cached", () => {
  const s = createStore(userShape, initial());
  eq(s.substore(userShape.shipping), s.substore(userShape.shipping));
  eq(s.substore(userShape.items), s.substore(userShape.items));
});

test("substore rejects nodes outside its focus", () => {
  const s = createStore(userShape, initial());
  const shipping = s.substore(userShape.shipping);
  throws(() => shipping.getValue(userShape.name), /not part of/);
  throws(() => shipping.getValue(userShape.billing.city), /not part of/);
  // @ts-expect-error – fields are not substores
  throws(() => s.substore(userShape.name), /object or array/);
});

test("root cannot reach into array items", () => {
  const s = createStore(userShape, initial());
  throws(() => s.getValue(userShape.items.item.sku), /array item/);
});

test("meta: one owner per node, seeded from static meta", () => {
  const s = createStore(userShape, initial());
  const shipping = s.substore(userShape.shipping);
  eq(s.getMeta(userShape.shipping.city).label, "City");
  shipping.setMeta(userShape.shipping.city, { error: "Bad city" });
  eq(s.getMeta(userShape.shipping.city).error, "Bad city");          // delegated to owner
  eq(s.getMeta(userShape.billing.city).error, undefined);            // reused shape, separate meta
  s.setMeta(userShape.shipping, { collapsed: true });                  // section meta owned by root
  eq(shipping.getMeta(userShape.shipping).collapsed, true);
});

test("meta keeps static types", () => {
  const s = createStore(userShape, initial());
  const m = s.getMeta(userShape.name);
  const label: string = m.label;
  const required: boolean = m.required;
  eq(label, "Full name");
  eq(required, true);
});

// ---------------------------------------------------------------------------
// Arrays
test("items() returns stores in order with stable ids", () => {
  const s = createStore(userShape, initial());
  const items = s.substore(userShape.items);
  const [a, b] = items.items();
  eq(a.getValue(userShape.items.item.sku), "A");
  eq(b.getValue(userShape.items.item.sku), "B");
  eq(items.items()[0], a);
  eq(a.stableId === b.stableId, false);
});

test("writes through an item store preserve identity and meta", () => {
  const s = createStore(userShape, initial());
  const items = s.substore(userShape.items);
  const a = items.itemAt(0);
  const oldRef = s.getValues().items[0];
  a.setMeta(userShape.items.item.sku, { touched: true });

  a.setValue(userShape.items.item.qty, 5);

  const newRef = s.getValues().items[0];
  eq(newRef === oldRef, false, "item reference changed");
  eq(newRef.qty, 5);
  eq(items.item(newRef), a, "same store for the new reference");
  eq(items.itemAt(0).stableId, a.stableId);
  eq(a.getMeta(userShape.items.item.sku).touched, true);
  throws(() => items.item(oldRef), /not currently in/);
});

test("per-item meta is isolated", () => {
  const s = createStore(userShape, initial());
  const [a, b] = s.substore(userShape.items).items();
  a.setMeta(userShape.items.item.sku, { error: "Required" });
  eq(b.getMeta(userShape.items.item.sku).error, undefined);
  eq(b.getMeta(userShape.items.item.sku).required, true);   // static meta seeded per item
  a.setMeta(userShape.items.item, { rowError: "Bad row" });   // whole-row meta on the item store
  eq(b.getMeta(userShape.items.item).rowError, undefined);
});

test("reordering keeps stores", () => {
  const s = createStore(userShape, initial());
  const items = s.substore(userShape.items);
  const [a, b] = items.items();
  const [ra, rb] = s.getValues().items;
  s.setValue(userShape.items, [rb, ra]);
  eq(items.itemAt(0), b);
  eq(items.itemAt(1), a);
});

test("new object from outside = new store", () => {
  const s = createStore(userShape, initial());
  const items = s.substore(userShape.items);
  const a = items.itemAt(0);
  const [ra, rb] = s.getValues().items;
  s.setValue(userShape.items, [{ ...ra }, rb]);
  eq(items.itemAt(0) === a, false);
  eq(a.isAttached(), false);
});

test("detached store: reads undefined, writes throw", () => {
  const s = createStore(userShape, initial());
  const items = s.substore(userShape.items);
  const b = items.itemAt(1);
  s.setValue(userShape.items, [s.getValues().items[0]]);
  eq(b.isAttached(), false);
  eq(b.getValue(userShape.items.item.sku), undefined);
  throws(() => b.setValue(userShape.items.item.sku, "Z"), /detached/);
  throws(() => b.setMeta(userShape.items.item.sku, { error: "x" }), /detached/);
});

test("nested arrays: identity preserved at both levels", () => {
  const s = createStore(userShape, initial());
  const line = s.substore(userShape.items).itemAt(0);
  const notes = line.substore(userShape.items.item.notes);
  const note = notes.itemAt(0);
  note.setValue(userShape.items.item.notes.item.text, "edited");
  eq(s.getValues().items[0].notes[0].text, "edited");
  eq(s.substore(userShape.items).itemAt(0), line);
  eq(notes.itemAt(0), note);
  eq(line.isAttached() && note.isAttached(), true);
});

test("object substore inside an item reads through the item scope", () => {
  const s = createStore(userShape, initial());
  const line = s.substore(userShape.items).itemAt(1);
  const notes = line.substore(userShape.items.item.notes);
  notes.setValue(userShape.items.item.notes, [{ text: "b1" }]);
  eq(s.getValues().items[1].notes[0].text, "b1");
  eq(s.substore(userShape.items).itemAt(1), line);
});

test("structural validation", () => {
  const s = createStore(userShape, initial());
  const r = s.getValues().items[0];
  throws(() => s.setValue(userShape.items, [r, r]), /same object twice/);
  throws(() => s.setValue(userShape.items, [1 as any]), /must be an object/);
  throws(() => createStore(userShape, { ...initial(), items: "x" as any }), /must be an array/);
});

console.log(`${passed} tests passed`);
