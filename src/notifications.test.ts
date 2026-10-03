import { form, object, array, field, createStore, type InferValue } from "./index";
import { test as base, describe, expect } from "vitest";
import * as company from "./test/fixtures/company";
import type { FocusTarget } from "./test/features";

const address = object({
  street: field<string>(),
  city: field<string>().meta({ error: undefined as string | undefined }),
});

const shape = form({
  name: field<string>().meta({ required: true, touched: false, error: undefined as string | undefined }),
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

const test = base
  .extend("store", () => createStore(shape, initial()))
  .extend("lines", ({ store }) => store.substore(shape.lines))
  .extend("recorder", () => recorder());

describe("F · Rule 1 – value subscriptions", () => {
  test("rule 1: only changed values fire (incl. ancestors via store-wide)", ({ store: s, recorder: r }) => {
    s.subscribeValue(shape.shipping.city, r.on("city"));
    s.subscribeValue(shape.shipping, r.on("shipping"));
    s.subscribeValue(shape.billing.city, r.on("billing.city"));
    s.subscribeValue(shape.name, r.on("name"));
    s.subscribe(r.on("root"));
    s.substore(shape.billing).subscribe(r.on("billingStore"));

    s.setValue(shape.shipping.city, "Vilnius");
    expect(r.take()).toEqual(["city", "root", "shipping"]);
  });

  test("rule 1: replacing a parent fires only children that differ", ({ store: s, recorder: r }) => {
    s.subscribeValue(shape.shipping.city, r.on("city"));
    s.subscribeValue(shape.shipping.street, r.on("street"));
    s.setValue(shape.shipping, { street: "New", city: "Riga" });
    expect(r.take()).toEqual(["street"]);
  });

  test("rule 1: no-op write notifies nobody", ({ store: s, recorder: r }) => {
    s.subscribe(r.on("root"));
    s.setValue(shape.name, "Ann");
    expect(r.take()).toEqual([]);
  });
});

describe("F · Rule 2 – separate channels, no meta bubbling", () => {
  test("rule 2: meta and value channels are separate", ({ store: s, recorder: r }) => {
    s.subscribeValue(shape.name, r.on("value"));
    s.subscribeMeta(shape.name, r.on("meta"));
    s.set(shape.name.touched, true);
    expect(r.take()).toEqual(["meta"]);
    s.setValue(shape.name, "Bob");
    expect(r.take()).toEqual(["value"]);
  });

  test("rule 2: meta does not bubble to parent meta, but store-wide sees it", ({ store: s, recorder: r }) => {
    s.subscribeMeta(shape.shipping, r.on("shippingMeta"));
    s.substore(shape.shipping).subscribe(r.on("shippingStore"));
    s.substore(shape.billing).subscribe(r.on("billingStore"));
    s.subscribe(r.on("root"));
    s.set(shape.shipping.city.error, "Bad");
    expect(r.take()).toEqual(["root", "shippingStore"]);
  });

  test("rule 2: meta changed and changed back in one batch does not fire", ({ store: s }) => {
    s.set(shape.name.touched, false);
    const r = recorder();
    s.subscribeMeta(shape.name, r.on("meta"));
    s.batch(() => {
      s.set(shape.name.touched, true);
      s.set(shape.name.touched, false);
    });
    expect(r.take()).toEqual([]);
  });
});

describe("F · Rule 3 – array structure channel", () => {
  test("rule 3: editing a row does not fire subscribeItems; items() is stable", ({ store: s, lines, recorder: r }) => {
    lines.subscribeItems(r.on("items"));
    lines.subscribeValue(shape.lines, r.on("arrayValue"));
    const before = lines.items();

    lines.itemAt(0).setValue(L.qty, 5);
    expect(r.take()).toEqual(["arrayValue"]);
    expect(lines.items()).toBe(before);
  });

  test("rule 3: add / remove / reorder fire subscribeItems", ({ store: s, lines, recorder: r }) => {
    lines.subscribeItems(r.on("items"));
    const [a, b] = s.getValues().lines;

    s.setValue(shape.lines, [b, a]);
    expect(r.take()).toEqual(["items"]);
    s.setValue(shape.lines, [b, a, { sku: "C", price: 1, qty: 1, notes: [] }]);
    expect(r.take()).toEqual(["items"]);
    s.setValue(shape.lines, [b]);
    expect(r.take()).toEqual(["items"]);
  });
});

describe("F · Rule 4 – attachment changes", () => {
  test("rule 4: removal fires all subscribers of the detached store once", ({ store: s, lines }) => {
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

  test("rule 4: nested stores inside a removed row fire too", ({ store: s }) => {
    const row = s.substore(shape.lines).itemAt(0);
    const note = row.substore(L.notes).itemAt(0);
    const r = recorder();
    note.subscribeValue(L.notes.item.text, r.on("noteText"));
    s.setValue(shape.lines, [s.getValues().lines[1]]);
    expect(r.take()).toEqual(["noteText"]);
    expect(note.isAttached()).toBe(false);
  });

  test("rule 4: restoring an old snapshot re-attaches the same store (undo)", ({ store: s, lines }) => {
    const row = lines.itemAt(0);
    row.set(L.sku.touched, true);
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

  test("bug fix: an older version of a row re-attaches to its store", ({ store: s, lines }) => {
    const row = lines.itemAt(0);
    const older = s.getValues().lines;      // row at version 1
    row.setValue(L.qty, 9);                 // version 2
    s.setValue(shape.lines, older);         // restore version 1
    expect(lines.itemAt(0)).toBe(row);
    expect(row.isAttached()).toBe(true);
    expect(row.getValue(L.qty)).toBe(1);
  });

  test("both versions of a row present → the older one is a new item", ({ store: s, lines }) => {
    const row = lines.itemAt(0);
    const v1 = s.getValues().lines[0];
    row.setValue(L.qty, 9);
    const v2 = s.getValues().lines[0];
    s.setValue(shape.lines, [v2, v1]);
    expect(lines.itemAt(0)).toBe(row);
    expect(lines.itemAt(1) === row).toBe(false);
  });

  test("a row write that drops its nested rows detaches them", ({ lines }) => {
    const row = lines.itemAt(0);
    const note = row.substore(L.notes).itemAt(0);
    const r = recorder();
    note.subscribeValue(L.notes.item.text, r.on("noteText"));
    row.setValue(L.notes, []);
    expect(r.take()).toEqual(["noteText"]);
    expect(note.isAttached()).toBe(false);
  });
});

// Row writes leave the sequence of rows as it is: these pin what the flush
// must still find among the rows.
describe("F · Row writes", () => {
  test("rows written in one batch notify in array order", ({ store: s, lines }) => {
    const [a, b] = lines.items();
    a.setValue(L.price, 11);                // a flush that walks the rows first
    const r = recorder();
    a.subscribeValue(L.qty, r.on("a"));
    b.subscribeValue(L.qty, r.on("b"));
    s.batch(() => {
      b.setValue(L.qty, 5);
      a.setValue(L.qty, 6);
    });
    expect(r.log).toEqual(["a", "b"]);
  });

  test("a row set back to an older version of its object notifies its subscribers", ({ store: s, lines }) => {
    const [a, b] = lines.items();
    const older = s.getValues().lines;
    a.setValue(L.qty, 9);
    const r = recorder();
    a.subscribeValue(L.qty, r.on("a"));
    b.subscribeValue(L.qty, r.on("b"));
    s.setValue(shape.lines, older);
    expect(r.take()).toEqual(["a"]);
    expect(lines.items()).toEqual([a, b]);
  });

  test("a row written again in a later flush notifies again", ({ lines }) => {
    const row = lines.itemAt(1);
    const r = recorder();
    row.subscribeValue(L.qty, r.on("qty"));
    row.setValue(L.qty, 3);
    row.setValue(L.qty, 4);
    expect(r.take()).toEqual(["qty", "qty"]);
  });
});

describe("F · Rule 5 – store-wide", () => {
  test("rule 5: store-wide on an item fires for its values and meta only", ({ store: s, lines }) => {
    const [a, b] = lines.items();
    const r = recorder();
    a.subscribe(r.on("a"));
    b.subscribe(r.on("b"));
    lines.subscribe(r.on("lines"));

    a.setValue(L.qty, 3);
    expect(r.take()).toEqual(["a", "lines"]);
    b.set(L.sku.error, "x");
    expect(r.take()).toEqual(["b", "lines"]);
  });
});

describe("F · Rule 6 – batching", () => {
  test("rule 6: batch notifies once; reads see new values inside", ({ store: s, recorder: r }) => {
    s.subscribe(r.on("root"));
    s.batch(() => {
      s.setValue(shape.name, "B");
      expect(s.getValue(shape.name)).toBe("B");
      s.setValue(shape.shipping.city, "X");
      expect(r.log, "nothing fired inside the batch").toEqual([]);
    });
    expect(r.take()).toEqual(["root"]);
  });

  test("rule 6: nested batches flush at the outermost end", ({ store: s, recorder: r }) => {
    s.subscribe(r.on("root"));
    s.batch(() => {
      s.batch(() => s.setValue(shape.name, "B"));
      expect(r.log).toEqual([]);
    });
    expect(r.take()).toEqual(["root"]);
  });

  test("rule 6: A → B → A in one batch notifies nobody", ({ store: s, recorder: r }) => {
    s.subscribeValue(shape.name, r.on("name"));
    s.batch(() => {
      s.setValue(shape.name, "B");
      s.setValue(shape.name, "Ann");
    });
    expect(r.take()).toEqual([]);
  });
});

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

describe("F · Rule 8 – reactions, then UI", () => {
  test("rule 8: reactions settle before UI; UI sees the final state once", () => {
    const { s, lines } = withTotal();
    const seen: number[] = [];
    s.subscribeValue(shape.total, () => seen.push(s.getValue(shape.total)));
    lines.itemAt(0).setValue(L.qty, 3);     // 30 + 40
    expect(seen).toEqual([70]);
  });

  test("rule 8: chained reactions settle", ({ store: s }) => {
    s.react(shape.name, (name) => s.setValue(shape.shipping.street, `${name} St`));
    s.react(shape.shipping.street, (street) => s.setValue(shape.billing.street, street));
    const r = recorder();
    s.subscribe(r.on("root"));
    s.setValue(shape.name, "Kate");
    expect(s.getValue(shape.billing.street)).toBe("Kate St");
    expect(r.take()).toEqual(["root"]);
  });

  test("rule 8: reactions receive next and prev", ({ store: s }) => {
    const calls: [string, string][] = [];
    s.react(shape.name, (next, prev) => calls.push([next, prev]));
    s.setValue(shape.name, "B");
    s.setValue(shape.name, "C");
    expect(calls).toEqual([["B", "Ann"], ["C", "B"]]);
  });

  test("rule 8: meta reactions", ({ store: s }) => {
    s.reactMeta(shape.name, (next) => {
      if (next.touched) s.set(shape.name.error, s.getValue(shape.name) ? undefined : "Required");
    });
    s.setValue(shape.name, "");
    s.set(shape.name.touched, true);
    expect(s.getMeta(shape.name).error).toBe("Required");
  });

  test("rule 8: cycles are detected", ({ store: s }) => {
    s.react(shape.total, (t) => s.setValue(shape.total, t + 1));
    expect(() => s.setValue(shape.total, 1)).toThrow(/did not settle/);
    // store is still usable afterwards
    s.batch(() => {});
  });

  test("rule 8: UI listeners cannot write", ({ store: s }) => {
    s.subscribeValue(shape.name, () => s.setValue(shape.total, 1));
    expect(() => s.setValue(shape.name, "B")).toThrow(/Cannot write while UI listeners/);
  });

  test("reactions do not run on registration", ({ store: s }) => {
    let calls = 0;
    s.react(shape.name, () => calls++);
    expect(calls).toBe(0);
  });
});

describe("F · Subscription housekeeping", () => {
  test("unsubscribe stops notifications", ({ store: s, recorder: r }) => {
    const off = s.subscribeValue(shape.name, r.on("name"));
    off();
    s.setValue(shape.name, "B");
    expect(r.take()).toEqual([]);
  });

  test("a listener unsubscribed by an earlier listener in the same flush is not called", ({ store: s, recorder: r }) => {
    let offSecond = () => {};
    s.subscribeValue(shape.name, () => offSecond());
    offSecond = s.subscribeValue(shape.name, r.on("second"));
    s.setValue(shape.name, "B");
    expect(r.take()).toEqual([]);
  });

  test("subscribing through any store in scope reaches the same owner", ({ store: s, recorder: r }) => {
    s.subscribeMeta(shape.shipping.city, r.on("viaRoot"));
    s.substore(shape.shipping).set(shape.shipping.city.error, "x");
    expect(r.take()).toEqual(["viaRoot"]);
  });
});

describe("F · Errors during the flush", () => {
  test("a throwing UI listener: the others still run, the first error is rethrown", ({ store: s, recorder: r }) => {
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

  test("a throwing reaction: the write throws, UI is skipped, the next flush catches up", ({ store: s, recorder: r }) => {
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
});

describe("F · Rule 5 on views", () => {
  test("rule 5 on views: an array or object substore's listener sees changes inside it only", ({ store: s, recorder: r }) => {
    s.substore(shape.lines).subscribe(r.on("lines"));
    s.substore(shape.shipping).subscribe(r.on("shipping"));
    const row = s.substore(shape.lines).itemAt(1);

    row.set(L.sku.error, "Bad");
    expect(r.take(), "a row's meta").toEqual(["lines"]);
    row.set(L.qty, 9);
    expect(r.take(), "a row's value").toEqual(["lines"]);
    s.set(shape.shipping.city.error, "x");
    expect(r.take()).toEqual(["shipping"]);
    s.set(shape.billing.city.error, "y");
    expect(r.take(), "the other copy of the reused shape").toEqual([]);
    s.set(shape.name, "Bob");
    expect(r.take()).toEqual([]);
  });
});

describe("F · Array replacement and flat forms", () => {
  test("rule 3: replacing the array with new objects of the same length fires subscribeItems", ({ store: s, lines }) => {
    const before = lines.items();
    let fired = 0;
    lines.subscribeItems(() => fired++);
    s.set(shape.lines, s.get(shape.lines).map((l) => ({ ...l })));
    expect(fired).toBe(1);
    expect(lines.items().length).toBe(2);
    expect(lines.items()[0], "new objects, new row stores").not.toBe(before[0]);
  });

  test("a flat form with 300 fields: one write calls only that field's listener", () => {
    const fields = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, field<number>()]));
    const flat = form(object(fields));
    const s = createStore(flat, Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, 0])) as never);
    const calls: string[] = [];
    const nodes = flat as unknown as Record<string, Parameters<typeof s.subscribeValue>[0]>;
    for (let i = 0; i < 300; i++) s.subscribeValue(nodes[`f${i}`], () => calls.push(`f${i}`));
    s.set(nodes.f150 as never, 1 as never);
    expect(calls).toEqual(["f150"]);
  });
});

describe("F · Meta-key subscriptions", () => {
  const { shape, L, initial, originsOf } = company;
  const test = base
    .extend("store", () => createStore(shape, initial()));

  test("subscribe to a single meta key ignores other keys", ({ store: s }) => {
    let calls = 0;
    s.subscribe(shape.name.error, () => calls++);
    s.set(shape.name.touched, true);
    expect(calls).toBe(0);
    s.set(shape.name.error, "x");
    expect(calls).toBe(1);
  });
});

describe("F · Non-reactive keys", () => {
  const { shape, L, initial } = company;
  const test = base
    .extend("store", () => createStore(shape, initial()))
    .extend("lines", ({ store }) => store.substore(shape.lines));

  test("focus targets never notify and work on detached rows", ({ store: s, lines }) => {
    const row = lines.itemAt(0);
    let calls = 0;
    s.subscribe(() => calls++);
    row.subscribeMeta(L.sku, () => calls++);
    const target: FocusTarget = { focus() {} };
    row.set(L.sku.focusTarget, target);
    expect(calls).toBe(0);
    expect(row.get(L.sku.focusTarget)).toBe(target);
    lines.remove(row);
    calls = 0;
    row.set(L.sku.focusTarget, undefined);        // unmount after removal must not throw
    expect(calls).toBe(0);
  });
});
