// ============================================================
// NF4: removed rows (their stores, meta, behavior instances and async
// state) become collectable. Needs --expose-gc (see vitest.memory.config.ts).
// ============================================================

import { it, expect } from "vitest";
import {
  form, object, array, field, createStore, defineBehavior, type ItemStore,
} from "../index";
import { control } from "../test/features";
import { rule } from "../test/rules";

const gc = (globalThis as { gc?: () => void }).gc;

const shape = form({
  lines: array(
    object({
      sku: field<string>().meta(control()),
      qty: field<number>().meta(control()),
      lineTotal: field<number>(),
      lookup: field<string>(),
    }),
    { create: () => ({ sku: "", qty: 1, lineTotal: 0, lookup: "" }) }
  ),
});
const L = shape.lines.item;

async function collectGarbage() {
  for (let i = 0; i < 10; i++) {
    gc!();
    await new Promise((r) => setTimeout(r, 10));
  }
}

it.skipIf(!gc)("removed rows are collectable: stores, values and per-row state", async () => {
  const s = createStore(shape, { lines: [] }, {
    behaviors: [
      defineBehavior({ triggers: [L.qty], writes: [L.lineTotal], run: (c) => c.set(L.lineTotal, c.get(L.qty) * 2) }),
      rule(L.sku, (v) => (v ? undefined : "Required")),
      defineBehavior({
        triggers: [L.sku],
        writes: [L.lookup],
        runOn: { init: false },
        run: async (c) => {
          const sku = c.get(L.sku);
          c.set(L.lookup, await c.keep([sku], async () => (sku === "taken" ? "Taken" : "")));
        },
      }),
    ],
  });
  const lines = s.substore(shape.lines);
  const stores: WeakRef<ItemStore<typeof L>>[] = [];
  const values: WeakRef<object>[] = [];

  // Everything the rows touch is created in here, so no local keeps them alive.
  (() => {
    for (let i = 0; i < 200; i++) {
      const row = lines.append({ sku: `S${i}` });
      const unsubscribe = row.subscribe(L.qty, () => {});
      row.set(L.qty, 2, { origin: "user" });
      row.set(L.sku, "taken", { origin: "user" }); // starts an async run
      row.set(L.sku.focusTarget, { focus() {} });
      stores.push(new WeakRef(row));
      values.push(new WeakRef(row.get(L) as object));
      unsubscribe();
    }
    for (const row of [...lines.items()]) lines.remove(row);
  })();

  await collectGarbage();
  const aliveStores = stores.filter((r) => r.deref() !== undefined).length;
  const aliveValues = values.filter((r) => r.deref() !== undefined).length;
  expect(lines.items().length).toBe(0);
  expect(aliveStores, "row stores still reachable").toBe(0);
  expect(aliveValues, "row values still reachable").toBe(0);
});

it.skipIf(!gc)("a row removed while its subscription is still active is collectable too", async () => {
  const s = createStore(shape, { lines: [] });
  const lines = s.substore(shape.lines);
  const refs: WeakRef<object>[] = [];
  (() => {
    for (let i = 0; i < 50; i++) {
      const row = lines.append();
      row.subscribe(L.sku, () => {}); // never unsubscribed, e.g. a leaked listener
      refs.push(new WeakRef(row));
    }
    for (const row of [...lines.items()]) lines.remove(row);
  })();
  await collectGarbage();
  expect(refs.filter((r) => r.deref() !== undefined).length).toBe(0);
});

it.skipIf(!gc)("a removed row whose own behaviors were disposed is collectable", async () => {
  const s = createStore(shape, { lines: [] });
  const lines = s.substore(shape.lines);
  const refs: WeakRef<object>[] = [];
  (() => {
    for (let i = 0; i < 50; i++) {
      const row = lines.append();
      const dispose = row.addBehavior(
        defineBehavior({ triggers: [L.qty], writes: [L.lineTotal], run: (c) => c.set(L.lineTotal, c.get(L.qty) * 2) })
      );
      refs.push(new WeakRef(row));
      dispose();
    }
    for (const row of [...lines.items()]) lines.remove(row);
  })();
  await collectGarbage();
  expect(refs.filter((r) => r.deref() !== undefined).length).toBe(0);
});
