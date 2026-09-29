import { form, object, array, field, meta, createStore, type InferValue } from "./index";
import { it, expect } from "vitest";

const address = object({
  street: field<string>(),
  city: field<string>().meta({ error: undefined as string | undefined }),
});

const shape = form({
  name: field<string>().meta(meta().required(), { touched: false, error: undefined as string | undefined }),
  total: field<number>(),
  shipping: address,
  billing: address,
  lines: array(
    object({
      sku: field<string>().meta({ touched: false, error: undefined as string | undefined }),
      price: field<number>(),
      qty: field<number>(),
      notes: array(object({ text: field<string>() })),
    })
  ),
});
type Values = InferValue<typeof shape>;
const L = shape.lines.item;

function initial(): Values {
  return {
    name: "Ann",
    total: 0,
    shipping: { street: "Main", city: "Riga" },
    billing: { street: "Side", city: "Tallinn" },
    lines: [
      { sku: "A", price: 10, qty: 1, notes: [{ text: "a1" }] },
      { sku: "B", price: 20, qty: 2, notes: [] },
    ],
  };
}

/** Records which labelled listeners fired. */
function recorder() {
  const log: string[] = [];
  return { log, on: (label: string) => () => log.push(label), take: () => log.splice(0).sort() };
}

// ---------------------------------------------------------------------------
// Rule 1 – value subscriptions
it("rule 1: only changed values fire (incl. ancestors via store-wide)", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.subscribeValue(shape.shipping.city, r.on("city"));
  s.subscribeValue(shape.shipping, r.on("shipping"));
  s.subscribeValue(shape.billing.city, r.on("billing.city"));
  s.subscribeValue(shape.name, r.on("name"));
  s.subscribe(r.on("root"));
  s.substore(shape.billing).subscribe(r.on("billingStore"));

  s.setValue(shape.shipping.city, "Vilnius");
  expect(r.take()).toEqual(["city", "root", "shipping"]);
});

it("rule 1: replacing a parent fires only children that differ", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.subscribeValue(shape.shipping.city, r.on("city"));
  s.subscribeValue(shape.shipping.street, r.on("street"));
  s.setValue(shape.shipping, { street: "New", city: "Riga" });
  expect(r.take()).toEqual(["street"]);
});

it("rule 1: no-op write notifies nobody", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.subscribe(r.on("root"));
  s.setValue(shape.name, "Ann");
  expect(r.take()).toEqual([]);
});

// ---------------------------------------------------------------------------
// Rule 2 – separate channels, no meta bubbling
it("rule 2: meta and value channels are separate", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.subscribeValue(shape.name, r.on("value"));
  s.subscribeMeta(shape.name, r.on("meta"));
  s.setMeta(shape.name, { touched: true });
  expect(r.take()).toEqual(["meta"]);
  s.setValue(shape.name, "Bob");
  expect(r.take()).toEqual(["value"]);
});

it("rule 2: meta does not bubble to parent meta, but store-wide sees it", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.subscribeMeta(shape.shipping, r.on("shippingMeta"));
  s.substore(shape.shipping).subscribe(r.on("shippingStore"));
  s.substore(shape.billing).subscribe(r.on("billingStore"));
  s.subscribe(r.on("root"));
  s.setMeta(shape.shipping.city, { error: "Bad" });
  expect(r.take()).toEqual(["root", "shippingStore"]);
});

it("rule 2: meta changed and changed back in one batch does not fire", () => {
  const s = createStore(shape, initial());
  s.setMeta(shape.name, { touched: false });
  const r = recorder();
  s.subscribeMeta(shape.name, r.on("meta"));
  s.batch(() => {
    s.setMeta(shape.name, { touched: true });
    s.setMeta(shape.name, { touched: false });
  });
  expect(r.take()).toEqual([]);
});

// ---------------------------------------------------------------------------
// Rule 3 – array structure channel
it("rule 3: editing a row does not fire subscribeItems; items() is stable", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const r = recorder();
  lines.subscribeItems(r.on("items"));
  lines.subscribeValue(shape.lines, r.on("arrayValue"));
  const before = lines.items();

  lines.itemAt(0).setValue(L.qty, 5);
  expect(r.take()).toEqual(["arrayValue"]);
  expect(lines.items()).toBe(before);
});

it("rule 3: add / remove / reorder fire subscribeItems", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const r = recorder();
  lines.subscribeItems(r.on("items"));
  const [a, b] = s.getValues().lines;

  s.setValue(shape.lines, [b, a]);
  expect(r.take()).toEqual(["items"]);
  s.setValue(shape.lines, [b, a, { sku: "C", price: 1, qty: 1, notes: [] }]);
  expect(r.take()).toEqual(["items"]);
  s.setValue(shape.lines, [b]);
  expect(r.take()).toEqual(["items"]);
});

// ---------------------------------------------------------------------------
// Rule 4 – attachment changes
it("rule 4: removal fires all subscribers of the detached store once", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(1);
  const r = recorder();
  row.subscribeValue(L.sku, r.on("sku"));
  row.subscribeMeta(L.sku, r.on("skuMeta"));
  row.subscribe(r.on("rowStore"));

  s.setValue(shape.lines, [s.getValues().lines[0]]);
  expect(r.take()).toEqual(["rowStore", "sku", "skuMeta"]);
  expect(row.getValue(L.sku)).toBe(undefined);

  s.setValue(shape.name, "Other");
  expect(r.take(), "no further notifications").toEqual([]);
});

it("rule 4: nested stores inside a removed row fire too", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  const note = row.substore(L.notes).itemAt(0);
  const r = recorder();
  note.subscribeValue(L.notes.item.text, r.on("noteText"));
  s.setValue(shape.lines, [s.getValues().lines[1]]);
  expect(r.take()).toEqual(["noteText"]);
  expect(note.isAttached()).toBe(false);
});

it("rule 4: restoring an old snapshot re-attaches the same store (undo)", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  row.setMeta(L.sku, { touched: true });
  row.setValue(L.qty, 7);                 // row now points at a new reference
  const snapshot = initial().lines;       // unrelated objects → would be new stores
  const undo = s.getValues().lines.slice();

  s.setValue(shape.lines, [undo[1]]);     // remove row 0
  expect(row.isAttached()).toBe(false);

  const r = recorder();
  row.subscribeValue(L.qty, r.on("qty"));
  s.setValue(shape.lines, undo);          // put it back
  expect(r.take()).toEqual(["qty"]);
  expect(row.isAttached()).toBe(true);
  expect(lines.itemAt(0)).toBe(row);
  expect(row.getMeta(L.sku).touched, "meta survived").toBe(true);
  expect(snapshot.length).toBe(2);
});

it("bug fix: an older version of a row re-attaches to its store", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  const older = s.getValues().lines;      // row at version 1
  row.setValue(L.qty, 9);                 // version 2
  s.setValue(shape.lines, older);         // restore version 1
  expect(lines.itemAt(0)).toBe(row);
  expect(row.isAttached()).toBe(true);
  expect(row.getValue(L.qty)).toBe(1);
});

it("both versions of a row present → the older one is a new item", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  const v1 = s.getValues().lines[0];
  row.setValue(L.qty, 9);
  const v2 = s.getValues().lines[0];
  s.setValue(shape.lines, [v2, v1]);
  expect(lines.itemAt(0)).toBe(row);
  expect(lines.itemAt(1) === row).toBe(false);
});

// ---------------------------------------------------------------------------
// Rule 5 – store-wide
it("rule 5: store-wide on an item fires for its values and meta only", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const [a, b] = lines.items();
  const r = recorder();
  a.subscribe(r.on("a"));
  b.subscribe(r.on("b"));
  lines.subscribe(r.on("lines"));

  a.setValue(L.qty, 3);
  expect(r.take()).toEqual(["a", "lines"]);
  b.setMeta(L.sku, { error: "x" });
  expect(r.take()).toEqual(["b", "lines"]);
});

// ---------------------------------------------------------------------------
// Rule 6 – batching
it("rule 6: batch notifies once; reads see new values inside", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.subscribe(r.on("root"));
  s.batch(() => {
    s.setValue(shape.name, "B");
    expect(s.getValue(shape.name)).toBe("B");
    s.setValue(shape.shipping.city, "X");
    expect(r.log, "nothing fired inside the batch").toEqual([]);
  });
  expect(r.take()).toEqual(["root"]);
});

it("rule 6: nested batches flush at the outermost end", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.subscribe(r.on("root"));
  s.batch(() => {
    s.batch(() => s.setValue(shape.name, "B"));
    expect(r.log).toEqual([]);
  });
  expect(r.take()).toEqual(["root"]);
});

it("rule 6: A → B → A in one batch notifies nobody", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.subscribeValue(shape.name, r.on("name"));
  s.batch(() => {
    s.setValue(shape.name, "B");
    s.setValue(shape.name, "Ann");
  });
  expect(r.take()).toEqual([]);
});

// ---------------------------------------------------------------------------
// Rule 8 – reactions, then UI
function withTotal() {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const recalc = () => {
    const total = lines.current().reduce((sum, l) => sum + l.price * l.qty, 0);
    s.setValue(shape.total, total);
  };
  s.react(shape.lines, recalc);
  return { s, lines };
}

it("rule 8: reactions settle before UI; UI sees the final state once", () => {
  const { s, lines } = withTotal();
  const seen: number[] = [];
  s.subscribeValue(shape.total, () => seen.push(s.getValue(shape.total)));
  lines.itemAt(0).setValue(L.qty, 3);     // 30 + 40
  expect(seen).toEqual([70]);
});

it("rule 8: chained reactions settle", () => {
  const s = createStore(shape, initial());
  s.react(shape.name, (name) => s.setValue(shape.shipping.street, `${name} St`));
  s.react(shape.shipping.street, (street) => s.setValue(shape.billing.street, street));
  const r = recorder();
  s.subscribe(r.on("root"));
  s.setValue(shape.name, "Kate");
  expect(s.getValue(shape.billing.street)).toBe("Kate St");
  expect(r.take()).toEqual(["root"]);
});

it("rule 8: reactions receive next and prev", () => {
  const s = createStore(shape, initial());
  const calls: [string, string][] = [];
  s.react(shape.name, (next, prev) => calls.push([next, prev]));
  s.setValue(shape.name, "B");
  s.setValue(shape.name, "C");
  expect(calls).toEqual([["B", "Ann"], ["C", "B"]]);
});

it("rule 8: meta reactions", () => {
  const s = createStore(shape, initial());
  s.reactMeta(shape.name, (next) => {
    if (next.touched) s.setMeta(shape.name, { error: s.getValue(shape.name) ? undefined : "Required" });
  });
  s.setValue(shape.name, "");
  s.setMeta(shape.name, { touched: true });
  expect(s.getMeta(shape.name).error).toBe("Required");
});

it("rule 8: cycles are detected", () => {
  const s = createStore(shape, initial());
  s.react(shape.total, (t) => s.setValue(shape.total, t + 1));
  expect(() => s.setValue(shape.total, 1)).toThrow(/did not settle/);
  // store is still usable afterwards
  s.batch(() => {});
});

it("rule 8: UI listeners cannot write", () => {
  const s = createStore(shape, initial());
  s.subscribeValue(shape.name, () => s.setValue(shape.total, 1));
  expect(() => s.setValue(shape.name, "B")).toThrow(/Cannot write while UI listeners/);
});

it("reactions do not run on registration", () => {
  const s = createStore(shape, initial());
  let calls = 0;
  s.react(shape.name, () => calls++);
  expect(calls).toBe(0);
});

// ---------------------------------------------------------------------------
// Subscription housekeeping
it("unsubscribe stops notifications", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  const off = s.subscribeValue(shape.name, r.on("name"));
  off();
  s.setValue(shape.name, "B");
  expect(r.take()).toEqual([]);
});

it("a listener unsubscribed by an earlier listener in the same flush is not called", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  let offSecond = () => {};
  s.subscribeValue(shape.name, () => offSecond());
  offSecond = s.subscribeValue(shape.name, r.on("second"));
  s.setValue(shape.name, "B");
  expect(r.take()).toEqual([]);
});

it("subscribing through any store in scope reaches the same owner", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.subscribeMeta(shape.shipping.city, r.on("viaRoot"));
  s.substore(shape.shipping).setMeta(shape.shipping.city, { error: "x" });
  expect(r.take()).toEqual(["viaRoot"]);
});

// ---------------------------------------------------------------------------
// Errors during the flush
it("a throwing UI listener: the others still run, the first error is rethrown", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.subscribe(shape.name, () => {
    r.log.push("a");
    throw new Error("first");
  });
  s.subscribe(shape.name, () => {
    r.log.push("b");
    throw new Error("second");
  });
  s.subscribe(shape.name, r.on("c"));
  expect(() => s.set(shape.name, "Bob")).toThrow("first");
  expect(r.take(), "every listener was called").toEqual(["a", "b", "c"]);
  expect(s.get(shape.name), "the write itself happened").toBe("Bob");

  // The store is not stuck in the UI phase: the next write flushes normally.
  s.subscribe(shape.total, r.on("total"));
  s.set(shape.total, 5);
  expect(r.take()).toEqual(["total"]);
});

it("a throwing reaction: the write throws, UI is skipped, the next flush catches up", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  let fail = true;
  s.react(shape.name, () => {
    if (fail) throw new Error("reaction");
  });
  s.subscribe(shape.name, r.on("name"));
  expect(() => s.set(shape.name, "Bob")).toThrow("reaction");
  expect(r.take(), "UI listeners are not called for the failed flush").toEqual([]);
  expect(s.get(shape.name)).toBe("Bob");

  fail = false;
  s.set(shape.total, 1); // any later write flushes
  expect(r.take(), "the name listener catches up: its value changed since it was last told").toEqual(["name"]);
});

// ---------------------------------------------------------------------------
// Rule 5 on views
it("rule 5 on views: an array or object substore's listener sees changes inside it only", () => {
  const s = createStore(shape, initial());
  const r = recorder();
  s.substore(shape.lines).subscribe(r.on("lines"));
  s.substore(shape.shipping).subscribe(r.on("shipping"));
  const row = s.substore(shape.lines).itemAt(1);

  row.setMeta(L.sku, { error: "Bad" });
  expect(r.take(), "a row's meta").toEqual(["lines"]);
  row.set(L.qty, 9);
  expect(r.take(), "a row's value").toEqual(["lines"]);
  s.setMeta(shape.shipping.city, { error: "x" });
  expect(r.take()).toEqual(["shipping"]);
  s.setMeta(shape.billing.city, { error: "y" });
  expect(r.take(), "the other copy of the reused shape").toEqual([]);
  s.set(shape.name, "Bob");
  expect(r.take()).toEqual([]);
});

// ---------------------------------------------------------------------------
it("rule 3: replacing the array with new objects of the same length fires subscribeItems", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const before = lines.items();
  let fired = 0;
  lines.subscribeItems(() => fired++);
  s.set(shape.lines, s.get(shape.lines).map((l) => ({ ...l })));
  expect(fired).toBe(1);
  expect(lines.items().length).toBe(2);
  expect(lines.items()[0], "new objects, new row stores").not.toBe(before[0]);
});

it("a flat form with 300 fields: one write calls only that field's listener", () => {
  const fields = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, field<number>()]));
  const flat = form(object(fields));
  const s = createStore(flat, Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, 0])) as never);
  const calls: string[] = [];
  const nodes = flat as unknown as Record<string, Parameters<typeof s.subscribeValue>[0]>;
  for (let i = 0; i < 300; i++) s.subscribeValue(nodes[`f${i}`], () => calls.push(`f${i}`));
  s.set(nodes.f150 as never, 1 as never);
  expect(calls).toEqual(["f150"]);
});
