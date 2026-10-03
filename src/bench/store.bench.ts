// ============================================================
// Performance baselines (NF3). Run with `npm run bench`.
// Timings are tracked over time, not asserted: compare runs on the same machine.
// ============================================================

import { test, describe, expect, vi } from "vitest";
import { form, object, array, field, createStore as createDevStore, defineBehavior, countIn, metaKey, contribute } from "../index";
import { control, revealed, error } from "../test/features";
import { rule } from "../test/rules";

// Vitest runs with NODE_ENV=test, where createStore installs the dev
// diagnostics probe. The benches measure the library: their stores are
// created in production, except in "dev diagnostics overhead".
const createStore: typeof createDevStore = (...args) => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    return createDevStore(...args);
  } finally {
    vi.unstubAllEnvs();
  }
};

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

// Dev diagnostics (#17): the same edits on a store created in production
// (no probe) and in dev (budget check and DevTools tracks). Vitest's console
// has no timeStamp: a no-op one stands in for Chrome's while the dev stores
// are created (they keep the function they found), so they also build every
// entry's label.
describe("dev diagnostics overhead", () => {
  const prodFlat = createStore(flat, flatValues());
  const prodOrder = createStore(order, orderValues(), { behaviors: orderBehaviors });
  const timeStamp = Object.getOwnPropertyDescriptor(console, "timeStamp");
  console.timeStamp ??= () => {};
  const devFlat = createDevStore(flat, flatValues());
  const devOrder = createDevStore(order, orderValues(), { behaviors: orderBehaviors });
  if (timeStamp) Object.defineProperty(console, "timeStamp", timeStamp);
  else delete (console as Partial<Console>).timeStamp;
  expect([prodFlat._probe, prodOrder._probe, devFlat._probe && devOrder._probe].map(Boolean)).toEqual([false, false, true]);
  const prodRow = prodOrder.substore(order.lines).itemAt(100);
  const devRow = devOrder.substore(order.lines).itemAt(100);
  let n = 0;
  test("keystroke", async ({ bench }) => {
    await bench.compare(
      bench("keystroke, production", () => prodFlat.set(flatNodes.f250, `v${n++}`, { origin: "user" })),
      bench("keystroke, dev diagnostics", () => devFlat.set(flatNodes.f250, `v${n++}`, { origin: "user" }))
    );
  });
  test("row edit", async ({ bench }) => {
    await bench.compare(
      bench("edit one of 200 rows, production", () => prodRow.set(O.qty, (n++ % 5) + 1, { origin: "user" })),
      bench("edit one of 200 rows, dev diagnostics", () => devRow.set(O.qty, (n++ % 5) + 1, { origin: "user" }))
    );
  });
});

describe("200 rows, one error", () => {
  const s = createStore(order, orderValues(), { behaviors: orderBehaviors });
  s.substore(order.lines).itemAt(150).set(O.qty, 0);
  const errors = countIn(order, error);
  test("errors", async ({ bench }) => {
    await bench.compare(
      bench("collect(root, revealed): every row's sku", () => {
        s.collect(order, revealed);
      }),
      bench("get(countIn(root, error))", () => {
        s.get(errors);
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Row-by-row contribution mounts: each row adds its own contribution to a row
// key, as a row component's useBehaviors does. Each mount reruns only its row.
let ownerRuns = 0;
const mounted = metaKey<readonly string[], string>([]).combine((self, key) => ({
  triggers: [self],
  writes: [key],
  run: (ctx) => {
    ownerRuns++;
    ctx.set(key, ctx.parts.map((p) => p.payload));
  },
}));
const grid = form({ rows: array(object({ v: field<string>().meta({ mounted }) })) });
const G = grid.rows.item;

function mountRowByRow(rows: number): void {
  const s = createStore(grid, { rows: Array.from({ length: rows }, () => ({ v: "" })) });
  s.substore(grid.rows).items().forEach((row, i) => row.addBehavior(contribute(G.v.mounted, `row ${i}`)));
}

describe("row-by-row contribution mounts", () => {
  test("mounts", async ({ bench }) => {
    for (const rows of [400, 800]) {
      ownerRuns = 0;
      mountRowByRow(rows);
      expect(ownerRuns, `${rows} rows: one owner run per mount`).toBe(rows);
    }
    await bench.compare(
      bench("400 rows", () => mountRowByRow(400)),
      bench("800 rows", () => mountRowByRow(800))
    );
  });
});

// ---------------------------------------------------------------------------
// Row-by-row behavior mounts: each row adds its own plain behavior (a per-row
// calculation), as a row component's useBehaviors does. One registration per
// row, so ranking cost per mount shows here. Few samples: before #6 an 800-row
// mount took seconds.
const sheet = form({ rows: array(object({ a: field<number>(), b: field<number>() })) });
const S = sheet.rows.item;
const double = () =>
  defineBehavior({ name: "double", triggers: [S.a], writes: [S.b], run: (c) => c.set(S.b, c.get(S.a) * 2) });

function calculateRowByRow(rows: number): void {
  const s = createStore(sheet, { rows: Array.from({ length: rows }, (_, i) => ({ a: i, b: 0 })) });
  s.substore(sheet.rows).items().forEach((row) => row.addBehavior(double()));
}

describe("row-by-row behavior mounts", () => {
  test("behaviors", async ({ bench }) => {
    await bench.compare(
      bench("200 rows", () => calculateRowByRow(200)),
      bench("400 rows", () => calculateRowByRow(400)),
      bench("800 rows", () => calculateRowByRow(800)),
      bench("1600 rows", () => calculateRowByRow(1600)),
      { time: 500, iterations: 5, warmupTime: 0, warmupIterations: 1 }
    );
  });
});

// ---------------------------------------------------------------------------
// Row-by-row chained mounts: each row adds a → b and b → c, then every row
// unmounts. The behaviors are per template node, so every row's a → b ranks
// before every row's b → c. Values are already consistent: the init runs
// write nothing, so only registration and disposal show.
const chain = form({ rows: array(object({ a: field<number>(), b: field<number>(), c: field<number>() })) });
const C = chain.rows.item;
const chained = () => [
  defineBehavior({ name: "b", triggers: [C.a], writes: [C.b], run: (c) => c.set(C.b, c.get(C.a) * 2) }),
  defineBehavior({ name: "c", triggers: [C.b], writes: [C.c], run: (c) => c.set(C.c, c.get(C.b) + 1) }),
];

function chainRowByRow(rows: number): void {
  const s = createStore(chain, { rows: Array.from({ length: rows }, (_, i) => ({ a: i, b: i * 2, c: i * 2 + 1 })) });
  const handles = s.substore(chain.rows).items().flatMap((row) => chained().map((b) => row.addBehavior(b)));
  for (const dispose of handles) dispose();
}

describe("row-by-row chained mounts", () => {
  test("chained", async ({ bench }) => {
    await bench.compare(
      bench("100 rows", () => chainRowByRow(100)),
      bench("200 rows", () => chainRowByRow(200)),
      bench("400 rows", () => chainRowByRow(400)),
      { time: 500, iterations: 5, warmupTime: 0, warmupIterations: 1 }
    );
  });
});
