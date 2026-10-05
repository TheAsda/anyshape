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

// ---------------------------------------------------------------------------
// The run order's indexes (order.ts) by scope host: a disposed registration
// leaves no entry under its own host, the hosts enclosing it or the host it
// reads on, and no edge in the registrations that stay (#63).
const nested = form({
  lines: array(
    object({
      qty: field<number>(),
      total: field<number>(),
      sku: field<string>(),
      notes: array(object({ text: field<string>(), len: field<number>() })),
    }),
    { create: () => ({ qty: 1, total: 0, sku: "", notes: [] }) }
  ),
  sum: field<number>(),
});
const NL = nested.lines.item;
const NN = NL.notes.item;
const lineTotal = () => defineBehavior({ triggers: [NL.qty], writes: [NL.total], run: (c) => c.set(NL.total, c.get(NL.qty) * 2) });
const lineSku = () => defineBehavior({ triggers: [NL.total], writes: [NL.sku], run: (c) => c.set(NL.sku, `T${c.get(NL.total)}`) });

it.skipIf(!gc)("removed nested rows whose own behaviors were disposed are collectable", async () => {
  const s = createStore(nested, { lines: [], sum: 0 });
  const lines = s.substore(nested.lines);
  const refs: WeakRef<object>[] = [];
  (() => {
    for (let i = 0; i < 30; i++) {
      const line = lines.append();
      const handles = [
        line.addBehavior(defineBehavior({ triggers: [NL.notes], writes: [NL.sku], run: (c) => c.set(NL.sku, `${c.get(NL.notes).length}`) })),
      ];
      for (let j = 0; j < 3; j++) {
        const note = line.substore(NL.notes).append({ text: "ab", len: 0 });
        handles.push(note.addBehavior(defineBehavior({ triggers: [NN.text], writes: [NN.len], run: (c) => c.set(NN.len, c.get(NN.text).length) })));
        refs.push(new WeakRef(note));
      }
      refs.push(new WeakRef(line));
      for (const dispose of handles) dispose();
    }
    for (const line of [...lines.items()]) lines.remove(line);
  })();
  await collectGarbage();
  expect(refs.filter((r) => r.deref() !== undefined).length).toBe(0);
});

it.skipIf(!gc)("a removed row whose disposed behavior read the whole list is collectable", async () => {
  const s = createStore(nested, { lines: [], sum: 0 });
  const lines = s.substore(nested.lines);
  const refs: WeakRef<object>[] = [];
  (() => {
    for (let i = 0; i < 50; i++) {
      const row = lines.append();
      // Its input is kept under the root, the host that reads the list.
      const dispose = row.addBehavior(defineBehavior({ triggers: [nested.lines], writes: [NL.sku], run: (c) => c.set(NL.sku, `${c.get(nested.lines).length}`) }));
      refs.push(new WeakRef(row));
      dispose();
    }
    for (const row of [...lines.items()]) lines.remove(row);
  })();
  await collectGarbage();
  expect(refs.filter((r) => r.deref() !== undefined).length).toBe(0);
});

it.skipIf(!gc)("removed rows whose disposed behaviors were linked to a root behavior are collectable", async () => {
  // "sum" stays registered: every row's chain ranks before it.
  const sum = defineBehavior({ triggers: [nested.lines], writes: [nested.sum], run: (c) => c.set(nested.sum, c.get(nested.lines).reduce((t, l) => t + l.total, 0)) });
  const s = createStore(nested, { lines: [], sum: 0 }, { behaviors: sum });
  const lines = s.substore(nested.lines);
  const refs: WeakRef<object>[] = [];
  (() => {
    for (let i = 0; i < 50; i++) {
      const row = lines.append();
      const handles = [row.addBehavior(lineTotal()), row.addBehavior(lineSku())];
      refs.push(new WeakRef(row));
      for (const dispose of handles) dispose();
    }
    for (const row of [...lines.items()]) lines.remove(row);
  })();
  await collectGarbage();
  expect(refs.filter((r) => r.deref() !== undefined).length).toBe(0);
});

it.skipIf(!gc)("a dropped store is collectable with its rows and behaviors", async () => {
  const refs: WeakRef<object>[] = [];
  (() => {
    const s = createStore(nested, { lines: [], sum: 0 }, { behaviors: lineTotal() });
    const lines = s.substore(nested.lines);
    for (let i = 0; i < 20; i++) {
      const row = lines.append();
      row.addBehavior(lineSku()); // never disposed
      row.subscribe(NL.sku, () => {}); // never unsubscribed
      refs.push(new WeakRef(row));
    }
    refs.push(new WeakRef(s));
  })();
  await collectGarbage();
  expect(refs.filter((r) => r.deref() !== undefined).length).toBe(0);
});

// Recorded, not asserted (as the benches): the heap a store with row-by-row
// chained behaviors keeps per row should stay flat as the rows double.
async function keptPerRow(rows: number): Promise<number> {
  await collectGarbage();
  const before = process.memoryUsage().heapUsed;
  const s = createStore(nested, { lines: Array.from({ length: rows }, () => ({ qty: 1, total: 2, sku: "T2", notes: [] })), sum: 0 });
  for (const row of s.substore(nested.lines).items()) {
    row.addBehavior(lineTotal());
    row.addBehavior(lineSku());
  }
  await collectGarbage();
  const kept = Math.round((process.memoryUsage().heapUsed - before) / rows);
  expect(s.substore(nested.lines).items().length).toBe(rows); // keeps the store alive until measured
  return kept;
}

it.skipIf(!gc)("heap kept per row by row-by-row chained behaviors (recorded)", async () => {
  await keptPerRow(400); // leaves out what the first store allocates once
  const kept: string[] = [];
  for (const rows of [200, 400, 800]) kept.push(`${rows} rows ${await keptPerRow(rows)} B`);
  console.log(`heap kept per row, chained behaviors: ${kept.join(", ")}`);
});
