// Run: npx tsx src/behaviors.test.ts   (type assertions: npx tsc)
import {
  form, object, array, field, createStore, defineBehavior, when, initialOf, countIn,
  control, visibility, disableable, touched, dirty,
  type InferValue, type BehaviorErrorInfo, type StoreOptions, type Origin,
} from "./index";
import { test, eq, deepEq, throws, report } from "./test/harness";

const shape = form({
  country: field<string>(),
  city: field<string>(),
  title: field<string>(),
  slug: field<string>(),
  start: field<number>(),
  end: field<number>(),
  discount: field<number>(),
  subtotal: field<number>(),
  tax: field<number>(),
  total: field<number>(),
  name: field<string>().meta(control()),
  type: field<"person" | "company">(),
  vat: field<string>().meta(visibility(), disableable(), { note: "" }),
  lines: array(
    object({
      price: field<number>(),
      qty: field<number>().meta(control()),
      lineTotal: field<number>().meta(control()),
      sku: field<string>().meta(disableable(), { hint: "" }),
      notes: array(object({ text: field<string>(), len: field<number>() })),
    }),
    { create: () => ({ price: 0, qty: 1, lineTotal: 0, sku: "", notes: [] }) }
  ),
  other: array(object({ x: field<number>() })),
});
type Values = InferValue<typeof shape>;
const L = shape.lines.item;
const N = L.notes.item;

function initial(): Values {
  return {
    country: "LV", city: "Riga", title: "Hello", slug: "hello",
    start: 1, end: 3, discount: 0, subtotal: 0, tax: 0, total: 0,
    name: "Ann", type: "person", vat: "",
    lines: [
      { price: 10, qty: 1, lineTotal: 0, sku: "A", notes: [{ text: "ab", len: 0 }] },
      { price: 20, qty: 2, lineTotal: 0, sku: "B", notes: [] },
    ],
    other: [],
  };
}

function errors() {
  const list: { error: unknown; info: BehaviorErrorInfo }[] = [];
  const onError: StoreOptions["onError"] = (error, info) => list.push({ error, info });
  return { list, onError };
}

// A pricing chain, deliberately registered downstream-first.
function pricing(runs: Record<string, number>) {
  const count = (k: string) => (runs[k] = (runs[k] ?? 0) + 1);
  return [
    defineBehavior({
      name: "total", triggers: [shape.subtotal, shape.tax], writes: [shape.total],
      run: (ctx) => { count("total"); ctx.set(shape.total, ctx.get(shape.subtotal) + ctx.get(shape.tax)); },
    }),
    defineBehavior({
      name: "tax", triggers: [shape.subtotal], writes: [shape.tax],
      run: (ctx) => { count("tax"); ctx.set(shape.tax, ctx.get(shape.subtotal) * 0.2); },
    }),
    defineBehavior({
      name: "subtotal", triggers: [shape.lines], writes: [shape.subtotal],
      run: (ctx) => { count("subtotal"); ctx.set(shape.subtotal, ctx.get(shape.lines).reduce((s, l) => s + l.lineTotal, 0)); },
    }),
    defineBehavior({
      name: "lineTotal", triggers: [L.price, L.qty, shape.discount], writes: [L.lineTotal],
      run: (ctx) => { count("lineTotal"); ctx.set(L.lineTotal, ctx.get(L.price) * ctx.get(L.qty) * (1 - ctx.get(shape.discount))); },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Ordering and init
test("init: every instance runs once on creation, in dependency order", () => {
  const runs: Record<string, number> = {};
  const s = createStore(shape, initial(), { behaviors: pricing(runs) });
  deepEq(runs, { lineTotal: 2, subtotal: 1, tax: 1, total: 1 });
  eq(s.get(shape.subtotal), 50);
  eq(s.get(shape.total), 60);
});

test("a change runs each affected behavior once, upstream first", () => {
  const runs: Record<string, number> = {};
  const s = createStore(shape, initial(), { behaviors: pricing(runs) });
  for (const k in runs) delete runs[k];
  s.substore(shape.lines).itemAt(0).set(L.qty, 3, { origin: "user" });
  deepEq(runs, { lineTotal: 1, subtotal: 1, tax: 1, total: 1 });
  eq(s.get(shape.total), 84);
});

test("an enclosing-scope trigger re-runs every row", () => {
  const runs: Record<string, number> = {};
  const s = createStore(shape, initial(), { behaviors: pricing(runs) });
  for (const k in runs) delete runs[k];
  s.set(shape.discount, 0.5);
  deepEq(runs, { lineTotal: 2, subtotal: 1, tax: 1, total: 1 });
  eq(s.get(shape.subtotal), 25);
});

test("UI listeners fire once, on the settled state", () => {
  const s = createStore(shape, initial(), { behaviors: pricing({}) });
  const seen: number[] = [];
  s.subscribe(shape.total, () => seen.push(s.get(shape.total)));
  s.substore(shape.lines).itemAt(1).set(L.price, 30);
  deepEq(seen, [84]);
});

test("new rows get an instance and an init run before the UI sees them", () => {
  const s = createStore(shape, initial(), { behaviors: pricing({}) });
  let seenTotal = -1;
  s.substore(shape.lines).subscribeItems(() => (seenTotal = s.get(shape.total)));
  const row = s.substore(shape.lines).append({ price: 5, qty: 2 });
  eq(row.get(L.lineTotal), 10);
  eq(seenTotal, 72);
});

test("runOn: { init: false } skips the creation run", () => {
  let runs = 0;
  createStore(shape, initial(), {
    behaviors: defineBehavior({ triggers: [shape.title], runOn: { init: false }, run: () => void runs++ }),
  });
  eq(runs, 0);
});

// ---------------------------------------------------------------------------
// Own writes, two-way links, state
test("a two-way link: own writes do not re-trigger it", () => {
  let runs = 0;
  const s = createStore(shape, initial(), {
    behaviors: defineBehavior({
      name: "dates",
      triggers: [shape.start, shape.end],
      writes: [shape.start, shape.end],
      runOn: { init: false },
      run(ctx) {
        runs++;
        const s1 = ctx.changed(shape.start), e1 = ctx.changed(shape.end);
        if (s1 && e1) return; // both from outside: assume consistent
        if (s1) ctx.set(shape.end, ctx.get(shape.start) + 2);
        if (e1) ctx.set(shape.start, ctx.get(shape.end) - 2);
      },
    }),
  });
  s.set(shape.start, 10, { origin: "user" });
  eq(s.get(shape.end), 12);
  s.set(shape.end, 20, { origin: "user" });
  eq(s.get(shape.start), 18);
  eq(runs, 2);
  s.batch(() => {
    s.set(shape.start, 1);
    s.set(shape.end, 7);
  });
  eq(s.get(shape.start), 1);
  eq(s.get(shape.end), 7);
});

test("ctx.state: derived until the user edits it", () => {
  const s = createStore(shape, initial(), {
    behaviors: defineBehavior({
      name: "slug",
      triggers: [shape.title, shape.slug],
      writes: [shape.slug],
      run(ctx) {
        if (ctx.changed(shape.slug) && ctx.origins.has("user")) ctx.state.overridden = true;
        if (ctx.state.overridden) return;
        ctx.set(shape.slug, ctx.get(shape.title).toLowerCase().replace(/\s+/g, "-"));
      },
    }),
  });
  s.set(shape.title, "Big News", { origin: "user" });
  eq(s.get(shape.slug), "big-news");
  s.set(shape.slug, "custom", { origin: "user" });
  s.set(shape.title, "Other", { origin: "user" });
  eq(s.get(shape.slug), "custom");
});

// ---------------------------------------------------------------------------
// Origins and guards
test("origins: reset the city only when the user changes the country", () => {
  const s = createStore(shape, initial(), {
    behaviors: defineBehavior({
      triggers: [shape.country], writes: [shape.city], origins: ["user"], runOn: { init: false },
      run: (ctx) => ctx.set(shape.city, ""),
    }),
  });
  s.set(shape.country, "EE");
  eq(s.get(shape.city), "Riga", "program write ignored");
  s.set(shape.country, "LT", { as: "initial" });
  eq(s.get(shape.city), "Riga", "initial write ignored");
  s.set(shape.country, "FI", { origin: "user" });
  eq(s.get(shape.city), "");
});

test("ctx.origins lists what caused the run", () => {
  const seen: Origin[][] = [];
  const s = createStore(shape, initial(), {
    behaviors: defineBehavior({ triggers: [shape.title], runOn: { init: false }, run: (ctx) => void seen.push([...ctx.origins]) }),
  });
  s.set(shape.title, "x", { origin: "user" });
  deepEq(seen, [["user"]]);
});

test("when: skipped while false, guard references trigger", () => {
  const s = createStore(shape, initial(), {
    behaviors: defineBehavior({
      name: "vatNote",
      triggers: [shape.vat],
      writes: [shape.vat.note],
      when: when([shape.type], (type) => type === "company"),
      run: (ctx) => ctx.set(shape.vat.note, `VAT: ${ctx.get(shape.vat)}`),
    }),
  });
  eq(s.get(shape.vat.note), "", "person: init skipped");
  s.set(shape.vat, "LV1");
  eq(s.get(shape.vat.note), "");
  s.set(shape.type, "company");          // guard ref is a trigger
  eq(s.get(shape.vat.note), "VAT: LV1");
  s.set(shape.type, "person");
  eq(s.get(shape.vat.note), "VAT: LV1", "writes stay when the guard turns false");
});

// ---------------------------------------------------------------------------
// Errors and access
test("a throwing behavior: writes dropped, error reported, form keeps running", () => {
  const { list, onError } = errors();
  const s = createStore(shape, initial(), {
    onError,
    behaviors: [
      defineBehavior({
        name: "boom", triggers: [shape.title], writes: [shape.slug, shape.city], runOn: { init: false },
        run(ctx) {
          ctx.set(shape.slug, "half");
          throw new Error("nope");
        },
      }),
      defineBehavior({
        name: "fine", triggers: [shape.title], writes: [shape.subtotal], runOn: { init: false },
        run: (ctx) => ctx.set(shape.subtotal, ctx.get(shape.title).length),
      }),
    ],
  });
  s.set(shape.title, "abc");
  eq(s.get(shape.slug), "hello", "no partial writes");
  eq(s.get(shape.subtotal), 3, "other behaviors still ran");
  eq(list.length, 1);
  eq((list[0].error as Error).message, "nope");
  deepEq(list[0].info, { behavior: "boom", scope: "" });
});

test("errors in rows report the concrete scope", () => {
  const { list, onError } = errors();
  const s = createStore(shape, initial(), {
    onError,
    behaviors: defineBehavior({
      name: "rowBoom", triggers: [L.qty], runOn: { init: false },
      run: () => { throw new Error("x"); },
    }),
  });
  s.substore(shape.lines).itemAt(1).set(L.qty, 9);
  deepEq(list[0].info, { behavior: "rowBoom", scope: "lines[1]" });
});

test("undeclared reads and writes are errors", () => {
  const { list, onError } = errors();
  createStore(shape, initial(), {
    onError,
    behaviors: [
      defineBehavior({ name: "r", triggers: [shape.title], run: (ctx) => void ctx.get(shape.city) }),
      defineBehavior({ name: "w", triggers: [shape.title], run: (ctx) => ctx.set(shape.city, "x") }),
    ],
  });
  deepEq(list.map((e) => (e.error as Error).message.replace(/ in .*/, "")), [
    'Behavior "r": "city" is not declared',
    'Behavior "w": "city" is not declared',
  ]);
});

test("async behaviors are reported (stage 4)", () => {
  const { list, onError } = errors();
  createStore(shape, initial(), {
    onError,
    behaviors: defineBehavior({ name: "a", triggers: [shape.title], run: (async () => {}) as any }),
  });
  eq(/not supported yet/.test((list[0].error as Error).message), true);
});

// ---------------------------------------------------------------------------
// Registration checks
test("one writer per target", () => {
  const w = (name: string, target: any) => defineBehavior({ name, triggers: [shape.title], writes: [target], run: () => {} });
  throws(() => createStore(shape, initial(), { behaviors: [w("a", shape.city), w("b", shape.city)] }), /already written by "a"/);
  throws(() => createStore(shape, initial(), { behaviors: [w("a", shape.lines), w("b", L.qty)] }), /already written by "a"/);
  throws(() => createStore(shape, initial(), { behaviors: [w("a", shape.vat.note), w("b", shape.vat.note)] }), /already written/);
  createStore(shape, initial(), { behaviors: [w("a", shape.vat.note), w("b", shape.vat.disabled)] });
});

test("feature-owned keys cannot be written by behaviors", () => {
  throws(
    () => createStore(shape, initial(), {
      behaviors: defineBehavior({ triggers: [shape.title], writes: [shape.name.touched], run: () => {} }),
    }),
    /owned by its feature/
  );
});

test("cycles are rejected at registration, nothing is registered", () => {
  const s = createStore(shape, initial());
  const a = defineBehavior({ name: "a", triggers: [shape.city], writes: [shape.slug], run: (c) => c.set(shape.slug, c.get(shape.city)) });
  const b = defineBehavior({ name: "b", triggers: [shape.slug], writes: [shape.city], run: (c) => c.set(shape.city, c.get(shape.slug)) });
  throws(() => s.addBehavior([a, b]), /cycle: "a", "b"/);
  s.set(shape.city, "X");
  eq(s.get(shape.slug), "hello", "neither was registered");
});

test("scope rules", () => {
  const s = createStore(shape, initial());
  throws(
    () => s.addBehavior(defineBehavior({ triggers: [L.qty], writes: [shape.total], run: () => {} })),
    /behaviors write only their own scope/
  );
  throws(
    () => s.addBehavior(defineBehavior({ triggers: [L.qty, shape.other.item.x], run: () => {} })),
    /unrelated row scope/
  );
  const row = s.substore(shape.lines).itemAt(0);
  throws(
    () => row.addBehavior(defineBehavior({ triggers: [shape.title], writes: [shape.city], run: () => {} })),
    /add it to an outer store/
  );
  const address = object({ city: field<string>() });
  throws(() => s.addBehavior(defineBehavior({ triggers: [address.city], run: () => {} })), /not part of this form/);
});

// ---------------------------------------------------------------------------
// Rows
test("row instances are independent and pause while the row is removed", () => {
  let runs = 0;
  const s = createStore(shape, initial(), {
    behaviors: defineBehavior({
      name: "sku", triggers: [L.qty], writes: [L.sku], runOn: { init: false },
      run: (ctx) => { runs++; ctx.set(L.sku, `Q${ctx.get(L.qty)}`); },
    }),
  });
  const lines = s.substore(shape.lines);
  const [a, b] = lines.items();
  a.set(L.qty, 5);
  eq(a.get(L.sku), "Q5");
  eq(b.get(L.sku), "B");
  eq(runs, 1);

  const snapshot = lines.current().slice();
  lines.remove(a);
  eq(runs, 1, "removal does not run it");
  s.set(shape.lines, snapshot);                        // undo
  eq(lines.itemAt(0), a);
  a.set(L.qty, 6);
  eq(a.get(L.sku), "Q6", "resumed after restore");
});

test("nested rows", () => {
  const s = createStore(shape, initial(), {
    behaviors: defineBehavior({
      triggers: [N.text], writes: [N.len], run: (ctx) => ctx.set(N.len, ctx.get(N.text).length),
    }),
  });
  const row = s.substore(shape.lines).itemAt(0);
  const note = row.substore(L.notes).itemAt(0);
  eq(note.get(N.len), 2, "init run in an existing nested row");
  const added = s.substore(shape.lines).itemAt(1).substore(L.notes).append({ text: "hello", len: 0 });
  eq(added.get(N.len), 5, "init run in a new nested row");
});

// ---------------------------------------------------------------------------
// Runtime registration
test("addBehavior on a row applies to that row only; dispose cleans up", () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  const off = a.addBehavior(
    defineBehavior({
      name: "lock", triggers: [L.qty], writes: [L.sku.disabled],
      run: (ctx) => ctx.set(L.sku.disabled, ctx.get(L.qty) > 1),
    })
  );
  a.set(L.qty, 2);
  eq(a.get(L.sku.disabled), true);
  b.set(L.qty, 5);
  eq(b.get(L.sku.disabled), false);

  off();
  eq(a.get(L.sku.disabled), false, "meta reset to default on dispose");
  a.set(L.qty, 3);
  eq(a.get(L.sku.disabled), false, "no longer runs");
});

test("row-level writers: separate rows are fine, a template writer conflicts", () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  const hint = (name: string) => defineBehavior({ name, triggers: [L.qty], writes: [L.sku.hint], run: () => {} });
  a.addBehavior(hint("rowA"));
  b.addBehavior(hint("rowB"));
  throws(() => s.addBehavior(hint("all")), /already written by "rowA"/);
  throws(() => a.addBehavior(hint("rowA2")), /already written by "rowA"/);
});

test("root registration later: rows present and future", () => {
  const s = createStore(shape, initial());
  const off = s.addBehavior(defineBehavior({ triggers: [L.qty], writes: [L.sku.hint], run: (c) => c.set(L.sku.hint, `x${c.get(L.qty)}`) }));
  const lines = s.substore(shape.lines);
  eq(lines.itemAt(1).get(L.sku.hint), "x2");
  eq(lines.append({ qty: 7 }).get(L.sku.hint), "x7");
  off();
  eq(lines.itemAt(2).get(L.sku.hint), "", "reset in every row");
});

// ---------------------------------------------------------------------------
// Default behaviors: touched, dirty
test("touched: only user changes", () => {
  const s = createStore(shape, initial(), { behaviors: pricing({}) });
  s.set(shape.name, "Bob");
  eq(s.get(shape.name.touched), false, "program");
  s.set(shape.name, "Cid", { as: "initial" });
  eq(s.get(shape.name.touched), false, "initial");
  s.set(shape.name, "Ann", { origin: "user" });
  eq(s.get(shape.name.touched), true);
  s.set(shape.name, "Cid", { origin: "user" });
  eq(s.get(shape.name.touched), true, "stays true when changed back");
  const row = s.substore(shape.lines).itemAt(0);
  row.set(L.qty, 4, { origin: "user" });
  eq(row.get(L.qty.touched), true);
  eq(row.get(L.lineTotal.touched), false, "calculated by a behavior");
  s.reset();
  eq(s.get(shape.name.touched), false, "reset clears it");
});

test("dirty: follows the baseline", () => {
  const s = createStore(shape, initial());
  eq(s.get(shape.name.dirty), false);
  s.set(shape.name, "Bob", { origin: "user" });
  eq(s.get(shape.name.dirty), true);
  s.set(shape.name, "Ann", { origin: "user" });
  eq(s.get(shape.name.dirty), false, "changed back");
  s.set(shape.name, "Bob");
  s.set(shape.name, "Bob", { as: "initial" });           // saved: baseline catches up, value unchanged
  eq(s.get(shape.name.dirty), false);
});

test("dirty: new rows are dirty, counts aggregate", () => {
  const s = createStore(shape, initial());
  eq(s.get(countIn(shape, "dirty")), 0);
  const row = s.substore(shape.lines).append();
  eq(row.get(L.qty.dirty), true);
  eq(s.get(countIn(shape, "dirty")), 2, "qty and lineTotal of the new row");
  s.substore(shape.lines).remove(row);
  eq(s.get(countIn(shape, "dirty")), 0);
});

test("dirty and touched after reset", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  row.set(L.qty, 9, { origin: "user" });
  eq(row.get(L.qty.dirty), true);
  s.reset();
  eq(row.get(L.qty.dirty), false);
  eq(row.get(L.qty.touched), false);
});

test("touched and dirty work on their own, without control()", () => {
  const f = form({ a: field<string>().meta(touched(), dirty()) });
  const s = createStore(f, { a: "" });
  s.set(f.a, "x", { origin: "user" });
  eq(s.get(f.a.touched), true);
  eq(s.get(f.a.dirty), true);
  eq(s.get(initialOf(f.a)), "");
});

report("behaviors.test.ts");
