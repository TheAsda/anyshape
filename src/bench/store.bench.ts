// ============================================================
// Performance baselines (NF3). Run with `npm run bench`.
// Numbers are tracked over time, not asserted: compare runs on the same machine.
// ============================================================

import { test, describe } from "vitest";
import { form, object, array, field, createStore, defineBehavior, countIn, rule } from "../index";
import { control, revealed } from "../test/features";

// ---------------------------------------------------------------------------
// A flat form: 500 fields on the root, each with a UI listener
const FLAT = 500;
const flat = form(object(Object.fromEntries(Array.from({ length: FLAT }, (_, i) => [`f${i}`, field<string>().meta(control())]))));
const flatNodes = flat as unknown as Record<string, any>;
const flatValues = () => Object.fromEntries(Array.from({ length: FLAT }, (_, i) => [`f${i}`, ""])) as never;

describe("flat form, 500 fields", () => {
  const s = createStore(flat, flatValues());
  for (let i = 0; i < FLAT; i++) s.subscribe(flatNodes[`f${i}`], () => {});
  let n = 0;
  test("flat form", async ({ bench }) => {
    await bench.compare(
      bench("keystroke (user write, touched/dirty behaviors)", () => {
        s.set(flatNodes.f250, `v${n++}`, { origin: "user" });
      }),
      bench("createStore", () => {
        createStore(flat, flatValues());
      })
    );
  });
});

// ---------------------------------------------------------------------------
// An order: 200 rows, a per-row calculation, a total over the array, a rule per row
const ROWS = 200;
const order = form({
  lines: array(
    object({
      sku: field<string>().meta(control()),
      price: field<number>(),
      qty: field<number>().meta(control()),
      lineTotal: field<number>(),
    }),
    { create: () => ({ sku: "", price: 1, qty: 1, lineTotal: 1 }) }
  ),
  total: field<number>(),
});
const O = order.lines.item;
const orderBehaviors = [
  defineBehavior({
    name: "lineTotal", triggers: [O.price, O.qty], writes: [O.lineTotal],
    run: (c) => c.set(O.lineTotal, c.get(O.price) * c.get(O.qty)),
  }),
  defineBehavior({
    name: "total", triggers: [order.lines], writes: [order.total],
    run: (c) => c.set(order.total, c.get(order.lines).reduce((s, l) => s + l.lineTotal, 0)),
  }),
  rule(O.qty, (v) => (v > 0 ? undefined : "Must be positive")),
];
const orderValues = () => ({
  lines: Array.from({ length: ROWS }, (_, i) => ({ sku: `S${i}`, price: 2, qty: 1, lineTotal: 2 })),
  total: ROWS * 2,
});

describe("200 rows", () => {
  const s = createStore(order, orderValues(), { behaviors: orderBehaviors });
  const lines = s.substore(order.lines);
  for (const row of lines.items()) row.subscribe(O.qty, () => {});
  lines.subscribeItems(() => {});
  const middle = lines.itemAt(100);
  let n = 1;
  test("rows", async ({ bench }) => {
    await bench.compare(
      bench("edit one row (row calc + total + rule)", () => {
        middle.set(O.qty, (n++ % 5) + 1, { origin: "user" });
      }),
      bench("append + remove a row", () => {
        const row = lines.append();
        lines.remove(row);
      }),
      bench("createStore with behaviors", () => {
        createStore(order, orderValues(), { behaviors: orderBehaviors });
      })
    );
  });
});

describe("200 rows, one error", () => {
  const s = createStore(order, orderValues(), { behaviors: orderBehaviors });
  s.substore(order.lines).itemAt(150).set(O.qty, 0);
  const errors = countIn(order, "error");
  test("errors", async ({ bench }) => {
    await bench.compare(
      bench("collect(root, revealed): every row's sku", () => {
        s.collect(order, revealed);
      }),
      bench("get(countIn(root, 'error'))", () => {
        s.get(errors);
      })
    );
  });
});
