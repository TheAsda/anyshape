import {
  form, object, array, field, createStore, defineBehavior, when, initialOf, countIn, metaKey, type InferValue, type BehaviorErrorInfo, type StoreOptions, type Origin, type BehaviorContext, type WritableRef,
} from "./index";
import { control, visible, disabled, touched, dirty } from "./test/features";
import { rule, max } from "./test/rules";
import { test as base, describe, expect } from "vitest";
import * as limits from "./test/fixtures/limits";

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
  vat: field<string>().meta({ visible, disabled, note: "" }),
  lines: array(
    object({
      price: field<number>(),
      qty: field<number>().meta(control()),
      lineTotal: field<number>().meta(control()),
      sku: field<string>().meta({ disabled, hint: "" }),
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

const test = base
  .extend("store", () => createStore(shape, initial()))
  .extend("lines", ({ store }) => store.substore(shape.lines));

describe("K · Ordering and init", () => {
  test("init: every instance runs once on creation, in dependency order", () => {
    const runs: Record<string, number> = {};
    const s = createStore(shape, initial(), { behaviors: pricing(runs) });
    expect(runs).toEqual({ lineTotal: 2, subtotal: 1, tax: 1, total: 1 });
    expect(s.get(shape.subtotal)).toBe(50);
    expect(s.get(shape.total)).toBe(60);
  });

  test("a change runs each affected behavior once, upstream first", () => {
    const runs: Record<string, number> = {};
    const s = createStore(shape, initial(), { behaviors: pricing(runs) });
    for (const k in runs) delete runs[k];
    s.substore(shape.lines).itemAt(0).set(L.qty, 3, { origin: "user" });
    expect(runs).toEqual({ lineTotal: 1, subtotal: 1, tax: 1, total: 1 });
    expect(s.get(shape.total)).toBe(84);
  });

  test("an enclosing-scope trigger re-runs every row", () => {
    const runs: Record<string, number> = {};
    const s = createStore(shape, initial(), { behaviors: pricing(runs) });
    for (const k in runs) delete runs[k];
    s.set(shape.discount, 0.5);
    expect(runs).toEqual({ lineTotal: 2, subtotal: 1, tax: 1, total: 1 });
    expect(s.get(shape.subtotal)).toBe(25);
  });

  test("UI listeners fire once, on the settled state", () => {
    const s = createStore(shape, initial(), { behaviors: pricing({}) });
    const seen: number[] = [];
    s.subscribe(shape.total, () => seen.push(s.get(shape.total)));
    s.substore(shape.lines).itemAt(1).set(L.price, 30);
    expect(seen).toEqual([84]);
  });

  test("new rows get an instance and an init run before the UI sees them", () => {
    const s = createStore(shape, initial(), { behaviors: pricing({}) });
    let seenTotal = -1;
    s.substore(shape.lines).subscribeItems(() => (seenTotal = s.get(shape.total)));
    const row = s.substore(shape.lines).append({ price: 5, qty: 2 });
    expect(row.get(L.lineTotal)).toBe(10);
    expect(seenTotal).toBe(72);
  });

  test("runOn: { init: false } skips the creation run", () => {
    let runs = 0;
    createStore(shape, initial(), {
      behaviors: defineBehavior({ triggers: [shape.title], runOn: { init: false }, run: () => void runs++ }),
    });
    expect(runs).toBe(0);
  });
});

describe("K · Own writes, two-way links, state", () => {
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
    expect(s.get(shape.end)).toBe(12);
    s.set(shape.end, 20, { origin: "user" });
    expect(s.get(shape.start)).toBe(18);
    expect(runs).toBe(2);
    s.batch(() => {
      s.set(shape.start, 1);
      s.set(shape.end, 7);
    });
    expect(s.get(shape.start)).toBe(1);
    expect(s.get(shape.end)).toBe(7);
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
    expect(s.get(shape.slug)).toBe("big-news");
    s.set(shape.slug, "custom", { origin: "user" });
    s.set(shape.title, "Other", { origin: "user" });
    expect(s.get(shape.slug)).toBe("custom");
  });

  /** Three lines whose row behavior "share" sets each line's percentage of the total price; `spy` sees every run. */
  function shares(spy: (ctx: BehaviorContext) => void) {
    const f = form({ lines: array(object({ price: field<number>(), share: field<number>() })) });
    const R = f.lines.item;
    const share = defineBehavior({
      name: "share", triggers: [f.lines], reads: [R.price], writes: [R.share],
      run: (ctx) => {
        spy(ctx);
        const sum = ctx.get(f.lines).reduce((s, l) => s + l.price, 0);
        ctx.set(R.share, sum ? Math.round((ctx.get(R.price) / sum) * 100) : 0);
      },
    });
    const s = createStore(f, { lines: [{ price: 10, share: 0 }, { price: 30, share: 0 }, { price: 60, share: 0 }] }, { behaviors: share });
    return { R, lines: s.substore(f.lines), values: () => s.get(f.lines).map((l) => l.share) };
  }

  test("a row behavior triggered by its whole array: siblings' writes do not re-trigger it", () => {
    let runs = 0;
    const { R, lines, values } = shares(() => runs++);
    expect(runs, "init: once per row").toBe(3);
    expect(values()).toEqual([10, 30, 60]);
    runs = 0;
    lines.itemAt(0).set(R.price, 40, { origin: "user" });
    expect(runs, "an edit: once per row").toBe(3);
    expect(values()).toEqual([31, 23, 46]);
  });

  test("a change mixing siblings' writes with another origin still runs it, with only that origin", () => {
    const seen: string[][] = [];
    const { R, lines, values } = shares((ctx) => seen.push([...ctx.origins]));
    seen.length = 0;
    // A reaction to the user's edit writes in the same round as the share runs:
    // the next change of the array carries both the program's and the siblings' origins.
    lines.itemAt(0).react(R.price, () => void lines.itemAt(2).set(R.price, 50));
    lines.itemAt(0).set(R.price, 40, { origin: "user" });
    expect(seen).toEqual([["user"], ["user"], ["user"], ["program"], ["program"], ["program"]]);
    expect(values()).toEqual([33, 25, 42]);
  });
});

describe("L · Origins and guards", () => {
  test("origins: reset the city only when the user changes the country", () => {
    const s = createStore(shape, initial(), {
      behaviors: defineBehavior({
        triggers: [shape.country], writes: [shape.city], origins: ["user"], runOn: { init: false },
        run: (ctx) => ctx.set(shape.city, ""),
      }),
    });
    s.set(shape.country, "EE");
    expect(s.get(shape.city), "program write ignored").toBe("Riga");
    s.set(shape.country, "LT", { as: "initial" });
    expect(s.get(shape.city), "initial write ignored").toBe("Riga");
    s.set(shape.country, "FI", { origin: "user" });
    expect(s.get(shape.city)).toBe("");
  });

  test("ctx.origins lists what caused the run", () => {
    const seen: Origin[][] = [];
    const s = createStore(shape, initial(), {
      behaviors: defineBehavior({ triggers: [shape.title], runOn: { init: false }, run: (ctx) => void seen.push([...ctx.origins]) }),
    });
    s.set(shape.title, "x", { origin: "user" });
    expect(seen).toEqual([["user"]]);
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
    expect(s.get(shape.vat.note), "person: init skipped").toBe("");
    s.set(shape.vat, "LV1");
    expect(s.get(shape.vat.note)).toBe("");
    s.set(shape.type, "company");          // guard ref is a trigger
    expect(s.get(shape.vat.note)).toBe("VAT: LV1");
    s.set(shape.type, "person");
    expect(s.get(shape.vat.note), "writes stay when the guard turns false").toBe("VAT: LV1");
  });
});

describe("L · Errors and access", () => {
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
    expect(s.get(shape.slug), "no partial writes").toBe("hello");
    expect(s.get(shape.subtotal), "other behaviors still ran").toBe(3);
    expect(list.length).toBe(1);
    expect((list[0].error as Error).message).toBe("nope");
    expect(list[0].info).toEqual({ behavior: "boom", scope: "" });
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
    expect(list[0].info).toEqual({ behavior: "rowBoom", scope: "lines[1]" });
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
    expect(list.map((e) => (e.error as Error).message.replace(/ in .*/, ""))).toEqual([
      'Behavior "r": "city" is not declared',
      'Behavior "w": "city" is not declared',
    ]);
  });
});

describe("J · Registration checks", () => {
  test("one writer per target", () => {
    const w = (name: string, target: any) => defineBehavior({ name, triggers: [shape.title], writes: [target], run: () => {} });
    expect(() => createStore(shape, initial(), { behaviors: [w("a", shape.city), w("b", shape.city)] })).toThrow(/already written by "a"/);
    expect(() => createStore(shape, initial(), { behaviors: [w("a", shape.lines), w("b", L.qty)] })).toThrow(/already written by "a"/);
    expect(() => createStore(shape, initial(), { behaviors: [w("a", shape.vat.note), w("b", shape.vat.note)] })).toThrow(/already written/);
    createStore(shape, initial(), { behaviors: [w("a", shape.vat.note), w("b", shape.vat.disabled)] });
  });

  test("a key's default behavior is its one writer; a key without one is free for a behavior", () => {
    const setTrue = (target: any) => defineBehavior({ name: "w", triggers: [shape.title], writes: [target], run: (c) => c.set(target, true) });
    expect(() => createStore(shape, initial(), { behaviors: setTrue(shape.name.touched) })).toThrow(/"name#touched" is already written by "name#touched"/);
    const s = createStore(shape, initial(), { behaviors: setTrue(shape.name.revealed) });
    s.set(shape.title, "changed");
    expect(s.get(shape.name.revealed)).toBe(true);
  });

  test("cycles are rejected at registration, nothing is registered", ({ store: s }) => {
    const a = defineBehavior({ name: "a", triggers: [shape.city], writes: [shape.slug], run: (c) => c.set(shape.slug, c.get(shape.city)) });
    const b = defineBehavior({ name: "b", triggers: [shape.slug], writes: [shape.city], run: (c) => c.set(shape.city, c.get(shape.slug)) });
    expect(() => s.addBehavior([a, b])).toThrow(/cycle: "a", "b"/);
    s.set(shape.city, "X");
    expect(s.get(shape.slug), "neither was registered").toBe("hello");
  });

  test("scope rules", ({ store: s }) => {
    expect(() => s.addBehavior(defineBehavior({ triggers: [L.qty], writes: [shape.total], run: () => {} }))).toThrow(/behaviors write only their own scope/);
    expect(() => s.addBehavior(defineBehavior({ triggers: [L.qty, shape.other.item.x], run: () => {} }))).toThrow(/unrelated row scope/);
    const row = s.substore(shape.lines).itemAt(0);
    expect(() => row.addBehavior(defineBehavior({ triggers: [shape.title], writes: [shape.city], run: () => {} }))).toThrow(/add it to an outer store/);
    const address = object({ city: field<string>() });
    expect(() => s.addBehavior(defineBehavior({ triggers: [address.city], run: () => {} }))).toThrow(/not part of this form/);
  });
});

describe("L · Rows", () => {
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
    expect(a.get(L.sku)).toBe("Q5");
    expect(b.get(L.sku)).toBe("B");
    expect(runs).toBe(1);

    const snapshot = lines.current().slice();
    lines.remove(a);
    expect(runs, "removal does not run it").toBe(1);
    s.set(shape.lines, snapshot);                        // undo
    expect(lines.itemAt(0)).toBe(a);
    a.set(L.qty, 6);
    expect(a.get(L.sku), "resumed after restore").toBe("Q6");
  });

  test("nested rows", () => {
    const s = createStore(shape, initial(), {
      behaviors: defineBehavior({
        triggers: [N.text], writes: [N.len], run: (ctx) => ctx.set(N.len, ctx.get(N.text).length),
      }),
    });
    const row = s.substore(shape.lines).itemAt(0);
    const note = row.substore(L.notes).itemAt(0);
    expect(note.get(N.len), "init run in an existing nested row").toBe(2);
    const added = s.substore(shape.lines).itemAt(1).substore(L.notes).append({ text: "hello", len: 0 });
    expect(added.get(N.len), "init run in a new nested row").toBe(5);
  });
});

describe("L · Runtime registration", () => {
  test("addBehavior on a row applies to that row only; dispose cleans up", ({ store: s }) => {
    const [a, b] = s.substore(shape.lines).items();
    const off = a.addBehavior(
      defineBehavior({
        name: "lock", triggers: [L.qty], writes: [L.sku.disabled],
        run: (ctx) => ctx.set(L.sku.disabled, ctx.get(L.qty) > 1),
      })
    );
    a.set(L.qty, 2);
    expect(a.get(L.sku.disabled)).toBe(true);
    b.set(L.qty, 5);
    expect(b.get(L.sku.disabled)).toBe(false);

    off();
    expect(a.get(L.sku.disabled), "meta reset to default on dispose").toBe(false);
    a.set(L.qty, 3);
    expect(a.get(L.sku.disabled), "no longer runs").toBe(false);
  });

  test("row-level writers: separate rows are fine, a template writer conflicts", ({ store: s }) => {
    const [a, b] = s.substore(shape.lines).items();
    const hint = (name: string) => defineBehavior({ name, triggers: [L.qty], writes: [L.sku.hint], run: () => {} });
    a.addBehavior(hint("rowA"));
    b.addBehavior(hint("rowB"));
    expect(() => s.addBehavior(hint("all"))).toThrow(/already written by "rowA"/);
    expect(() => a.addBehavior(hint("rowA2"))).toThrow(/already written by "rowA"/);
  });

  test("one writer between the root and a row, either registered first", ({ store: s }) => {
    const [a, b] = s.substore(shape.lines).items();
    const hint = (name: string) => defineBehavior({ name, triggers: [L.qty], writes: [L.sku.hint], run: () => {} });
    const off = s.addBehavior(hint("all"));
    expect(() => b.addBehavior(hint("rowB"))).toThrow('Behavior "rowB": "lines[].sku#hint" is already written by "all" – one writer per target');
    off();
    b.addBehavior(hint("rowB"));
    expect(() => s.addBehavior(hint("all"))).toThrow('Behavior "all": "lines[].sku#hint" is already written by "rowB" – one writer per target');
    a.addBehavior(hint("rowA"));
  });

  test("one writer between a row and the rows nested in it, not across sibling rows", ({ store: s }) => {
    const [a, b] = s.substore(shape.lines).items();
    const note = a.substore(L.notes).itemAt(0);
    const other = b.substore(L.notes).append({ text: "x", len: 0 });
    const len = (name: string) => defineBehavior({ name, triggers: [N.text], writes: [N.len], run: () => {} });
    const offAll = s.addBehavior(len("all"));
    expect(() => note.addBehavior(len("note"))).toThrow('Behavior "note": "lines[].notes[].len" is already written by "all" – one writer per target');
    offAll();
    const off = a.addBehavior(len("line"));
    expect(() => note.addBehavior(len("note"))).toThrow('Behavior "note": "lines[].notes[].len" is already written by "line" – one writer per target');
    other.addBehavior(len("otherNote"));
    off();
    note.addBehavior(len("note"));
    expect(() => a.addBehavior(len("line"))).toThrow('Behavior "line": "lines[].notes[].len" is already written by "note" – one writer per target');
    expect(() => s.addBehavior(len("all"))).toThrow('Behavior "all": "lines[].notes[].len" is already written by "otherNote" – one writer per target');
  });

  test("among conflicts in rows, the earliest registration is reported, then its first write", ({ store: s }) => {
    const [a, b] = s.substore(shape.lines).items();
    const w = (name: string, writes: WritableRef[]) => defineBehavior({ name, triggers: [L.price], writes, run: () => {} });
    b.addBehavior(w("disB", [L.sku.disabled]));
    a.addBehavior(w("hintA", [L.sku.hint]));
    a.addBehavior(w("disA", [L.sku.disabled]));
    expect(() => s.addBehavior(w("all", [L.sku.hint, L.sku.disabled]))).toThrow(
      'Behavior "all": "lines[].sku#disabled" is already written by "disB" – one writer per target'
    );
  });

  test("a value write to the list conflicts with value writes in its rows, not with meta writes", ({ store: s }) => {
    const [a, b] = s.substore(shape.lines).items();
    const w = (name: string, writes: WritableRef[]) => defineBehavior({ name, triggers: [L.price], writes, run: () => {} });
    a.addBehavior(w("disA", [L.sku.disabled]));
    const row = s.substore(shape.lines).append({ price: 0, qty: 1, lineTotal: 0, sku: "", notes: [] });
    row.addBehavior(w("qty", [L.qty]));
    b.addBehavior(w("totals", [L.lineTotal, L.qty]));
    expect(() => s.addBehavior(defineBehavior({ name: "list", triggers: [shape.title], writes: [shape.lines], run: () => {} }))).toThrow(
      'Behavior "list": "lines" is already written by "qty" (via "lines[].qty") – one writer per target'
    );
  });

  test("root registration later: rows present and future", ({ store: s }) => {
    const off = s.addBehavior(defineBehavior({ triggers: [L.qty], writes: [L.sku.hint], run: (c) => c.set(L.sku.hint, `x${c.get(L.qty)}`) }));
    const lines = s.substore(shape.lines);
    expect(lines.itemAt(1).get(L.sku.hint)).toBe("x2");
    expect(lines.append({ qty: 7 }).get(L.sku.hint)).toBe("x7");
    off();
    expect(lines.itemAt(2).get(L.sku.hint), "reset in every row").toBe("");
  });
});

describe("L · Default behaviors: touched, dirty", () => {
  test("touched: only user changes", () => {
    const s = createStore(shape, initial(), { behaviors: pricing({}) });
    s.set(shape.name, "Bob");
    expect(s.get(shape.name.touched), "program").toBe(false);
    s.set(shape.name, "Cid", { as: "initial" });
    expect(s.get(shape.name.touched), "initial").toBe(false);
    s.set(shape.name, "Ann", { origin: "user" });
    expect(s.get(shape.name.touched)).toBe(true);
    s.set(shape.name, "Cid", { origin: "user" });
    expect(s.get(shape.name.touched), "stays true when changed back").toBe(true);
    const row = s.substore(shape.lines).itemAt(0);
    row.set(L.qty, 4, { origin: "user" });
    expect(row.get(L.qty.touched)).toBe(true);
    expect(row.get(L.lineTotal.touched), "calculated by a behavior").toBe(false);
    s.reset();
    expect(s.get(shape.name.touched), "reset clears it").toBe(false);
  });

  test("dirty: follows the baseline", ({ store: s }) => {
    expect(s.get(shape.name.dirty)).toBe(false);
    s.set(shape.name, "Bob", { origin: "user" });
    expect(s.get(shape.name.dirty)).toBe(true);
    s.set(shape.name, "Ann", { origin: "user" });
    expect(s.get(shape.name.dirty), "changed back").toBe(false);
    s.set(shape.name, "Bob");
    s.set(shape.name, "Bob", { as: "initial" });           // saved: baseline catches up, value unchanged
    expect(s.get(shape.name.dirty)).toBe(false);
  });

  test("dirty: new rows are dirty, counts aggregate", ({ store: s }) => {
    expect(s.get(countIn(shape, dirty))).toBe(0);
    const row = s.substore(shape.lines).append();
    expect(row.get(L.qty.dirty)).toBe(true);
    expect(s.get(countIn(shape, dirty)), "qty and lineTotal of the new row").toBe(2);
    s.substore(shape.lines).remove(row);
    expect(s.get(countIn(shape, dirty))).toBe(0);
  });

  test("dirty and touched after reset", ({ store: s }) => {
    const row = s.substore(shape.lines).itemAt(0);
    row.set(L.qty, 9, { origin: "user" });
    expect(row.get(L.qty.dirty)).toBe(true);
    s.reset();
    expect(row.get(L.qty.dirty)).toBe(false);
    expect(row.get(L.qty.touched)).toBe(false);
  });

  test("touched and dirty work on their own, without control()", () => {
    const f = form({ a: field<string>().meta({ touched, dirty }) });
    const s = createStore(f, { a: "" });
    s.set(f.a, "x", { origin: "user" });
    expect(s.get(f.a.touched)).toBe(true);
    expect(s.get(f.a.dirty)).toBe(true);
    expect(s.get(initialOf(f.a))).toBe("");
  });

  test("a default behavior writes the name its key is declared under", () => {
    const f = form({ a: field<string>().meta({ wasEdited: touched, changed: dirty, alsoChanged: dirty }) });
    const s = createStore(f, { a: "" });
    s.set(f.a, "x", { origin: "user" });
    expect(s.get(f.a.wasEdited)).toBe(true);
    expect(s.get(f.a.changed)).toBe(true);
    expect(s.get(f.a.alsoChanged), "each name gets its own behavior").toBe(true);
    s.set(f.a, "");
    expect(s.get(f.a.changed), "back to the initial value").toBe(false);
    expect(s.get(f.a.alsoChanged)).toBe(false);
  });
});

describe("K · Rows created by the helpers while behaviors edit them", () => {
  test("append / insert return the new row when a behavior edits it in the same flush", () => {
    const lineTotal = pricing({})[3];
    const s = createStore(shape, initial(), { behaviors: [lineTotal] });
    const lines = s.substore(shape.lines);

    const appended = lines.append({ price: 5, qty: 2 });
    expect(appended.isAttached(), "the returned store is live").toBe(true);
    expect(appended.get(L.lineTotal), "the init run edited the new row").toBe(10);
    expect(lines.items()[2]).toBe(appended);

    const inserted = lines.insert(0, { price: 3, qty: 3 });
    expect(inserted.isAttached()).toBe(true);
    expect(inserted.get(L.lineTotal)).toBe(9);
    expect(lines.items()[0]).toBe(inserted);
    inserted.set(L.qty, 4);
    expect(inserted.get(L.lineTotal), "the returned store keeps working").toBe(12);
  });
});

describe("J · Feature default behaviors", () => {
  test("a feature's default behavior may only use its own node", () => {
    let other: unknown;
    const mirror = () => ({
      mirror: metaKey("").behavior((self, key) => ({
        triggers: [self],
        reads: [other as typeof self],
        writes: [key],
        run: () => {},
      })),
    });
    const f = form({ a: field<string>(), b: field<string>().meta(mirror()) });
    other = f.a;
    expect(() => createStore(f, { a: "", b: "" })).toThrow(/default behaviors may only use their own node \("b"\), got "a"/);
  });
});

describe("L · Counts as triggers", () => {
  test("a count as a trigger re-runs when the count changes, including on row removal", () => {
    const dirtyCount = countIn(shape, dirty);
    const mirror = defineBehavior({
      name: "dirtyCount", triggers: [dirtyCount], writes: [shape.subtotal],
      run: (ctx) => ctx.set(shape.subtotal, ctx.get(dirtyCount)),
    });
    const s = createStore(shape, initial(), { behaviors: mirror });
    expect(s.get(shape.subtotal)).toBe(0);
    const row = s.substore(shape.lines).itemAt(0);
    row.set(L.qty, 9);
    expect(s.get(shape.subtotal), "the row's qty is dirty").toBe(1);
    s.substore(shape.lines).remove(row);
    expect(s.get(shape.subtotal), "the removed row left the count").toBe(0);
  });
});

describe("J · More registration checks", () => {
  test("only values and meta keys can be written", () => {
    const writeCount = defineBehavior({ name: "c", writes: [countIn(shape, dirty) as never], run: () => {} });
    const writeInitial = defineBehavior({ name: "i", writes: [initialOf(shape.total) as never], run: () => {} });
    expect(() => createStore(shape, initial(), { behaviors: writeCount })).toThrow(/only values and meta keys are writable/);
    expect(() => createStore(shape, initial(), { behaviors: writeInitial })).toThrow(/only values and meta keys are writable/);
  });

  test("behaviors can't be added to a detached row", ({ store: s, lines }) => {
    const row = lines.itemAt(0);
    lines.remove(row);
    expect(() => row.addBehavior(defineBehavior({ triggers: [L.qty], run: () => {} }))).toThrow(/detached row/);
  });
});

describe("K · Ordering edges", () => {
  test("container edge: a row writer runs before a root behavior reading the whole array", () => {
    const log: string[] = [];
    const perRow = defineBehavior({
      name: "row", triggers: [L.qty], writes: [L.lineTotal],
      run: (c) => (log.push("row"), c.set(L.lineTotal, c.get(L.qty) * 10)),
    });
    const sum = defineBehavior({
      name: "sum", triggers: [shape.lines], writes: [shape.subtotal],
      run: (c) => (log.push("sum"), c.set(shape.subtotal, c.get(shape.lines).reduce((t, l) => t + l.lineTotal, 0))),
    });
    const s = createStore(shape, initial(), { behaviors: [sum, perRow] }); // registered downstream-first
    expect(s.get(shape.subtotal)).toBe(10 + 20);
    log.length = 0;
    s.substore(shape.lines).itemAt(0).set(L.qty, 3);
    expect(log).toEqual(["row", "sum"]);
    expect(s.get(shape.subtotal)).toBe(30 + 20);
  });

  test("disposing a middle behavior keeps the remaining chain in order", () => {
    const runs: Record<string, number> = {};
    const [total, tax, subtotal, lineTotal] = pricing(runs);
    const s = createStore(shape, initial(), { behaviors: [total, subtotal, lineTotal] });
    const dispose = s.addBehavior(tax);
    dispose();
    for (const k of Object.keys(runs)) delete runs[k];
    s.set(shape.discount, 0.5);
    expect(runs, "each ran once: ranks were recomputed without tax").toEqual({ lineTotal: 2, subtotal: 1, total: 1 });
    expect(s.get(shape.subtotal)).toBe(5 + 20);
    expect(s.get(shape.total), "subtotal + the tax value left behind").toBe(25 + s.get(shape.tax));
  });
});

describe("K · Run order across registration changes", () => {
  type NumberField = typeof shape.start;
  // A behavior that logs its runs and writes `to` from its first trigger.
  const step = (log: string[], name: string, triggers: NumberField[], to: NumberField) =>
    defineBehavior({
      name, triggers, writes: [to],
      run: (c) => (log.push(name), c.set(to, c.get(triggers[0]) + 1)),
    });

  test("a behavior added upstream of a chain runs first, and the whole chain after it, each once", () => {
    const log: string[] = [];
    // `c` is registered before `b`, which it depends on.
    const c = step(log, "c", [shape.end, shape.discount], shape.total);
    const b = step(log, "b", [shape.start, shape.discount], shape.end);
    const s = createStore(shape, initial(), { behaviors: [c, b] });
    s.addBehavior(step(log, "a", [shape.discount], shape.start));
    log.length = 0;
    s.set(shape.discount, 1);
    expect(log).toEqual(["a", "b", "c"]);
  });

  test("a disposed upstream behavior lets its dependent run in registration order again", () => {
    const log: string[] = [];
    const a = step(log, "a", [shape.end, shape.discount], shape.total);
    const b = step(log, "b", [shape.discount], shape.subtotal);
    const s = createStore(shape, initial(), { behaviors: [a, b] });
    const dispose = s.addBehavior(step(log, "x", [shape.start], shape.end));
    log.length = 0;
    s.set(shape.discount, 1);
    expect(log, "a depends on x: after b").toEqual(["b", "a"]);
    dispose();
    log.length = 0;
    s.set(shape.discount, 2);
    expect(log, "independent again: registration order").toEqual(["a", "b"]);
  });

  test("disposing a link of a dependent's longest chain leaves it after the next longest", () => {
    const log: string[] = [];
    // `a` is registered first: with too low a rank it would run before `s2`.
    const s = createStore(shape, initial(), { behaviors: step(log, "a", [shape.discount, shape.subtotal, shape.tax], shape.total) });
    s.addBehavior(step(log, "p0", [shape.start], shape.discount));
    s.addBehavior(step(log, "s1", [shape.start], shape.end));
    s.addBehavior(step(log, "s2", [shape.end], shape.subtotal));
    const dispose = s.addBehavior(step(log, "g", [shape.subtotal], shape.tax));
    dispose();
    log.length = 0;
    s.batch(() => {
      s.set(shape.discount, 1);
      s.set(shape.end, 1);
    });
    expect(log, "a still waits for s2").toEqual(["s2", "a"]);
  });

  test("replacing a behavior checks cycles without it: the reverse link replaces it", () => {
    const log: string[] = [];
    const s = createStore(shape, initial());
    const h = s.addBehavior(step(log, "forward", [shape.start], shape.end));
    s.replaceBehavior(h, step(log, "back", [shape.end], shape.start));
    s.set(shape.end, 10);
    expect(s.get(shape.start)).toBe(11);
    s.set(shape.start, 0);
    expect(s.get(shape.end), "forward is gone").toBe(10);
  });

  test("a replacement that forms a cycle is rejected; the previous one keeps its place", () => {
    const log: string[] = [];
    const s = createStore(shape, initial(), { behaviors: step(log, "after", [shape.end], shape.total) });
    const h = s.addBehavior(step(log, "mine", [shape.start], shape.end));
    expect(() => s.replaceBehavior(h, step(log, "loop", [shape.total], shape.end))).toThrow(/form a cycle/);
    log.length = 0;
    s.set(shape.start, 5);
    expect(log).toEqual(["mine", "after"]);
    expect(s.get(shape.total)).toBe(7);
  });

  test("a contribution's trigger moves its owner after the trigger's writer", () => {
    const log: string[] = [];
    const s = createStore(shape, initial(), { behaviors: rule(shape.name, () => void log.push("owner")) });
    s.addBehavior(
      defineBehavior({ name: "w", triggers: [shape.title], writes: [shape.country], run: (c) => (log.push("w"), c.set(shape.country, c.get(shape.title))) })
    );
    const dispose = s.addBehavior(rule(shape.name, () => "Not x", { when: when([shape.country], (c) => c !== "x") }));
    log.length = 0;
    s.batch(() => {
      s.set(shape.title, "x");
      s.set(shape.name, "Bo");
    });
    expect(log, "the owner, registered before w, now runs after it, once").toEqual(["w", "owner"]);
    expect(s.get(shape.name.error)).toBe(undefined);

    dispose();
    log.length = 0;
    s.batch(() => {
      s.set(shape.title, "y");
      s.set(shape.name, "Al");
    });
    expect(log, "without the contribution: independent again, registration order").toEqual(["owner", "w"]);
  });
});

describe("K · Run order between scope hosts", () => {
  // Each reader is registered before its writer: without an edge it would run first.
  const logged = (log: string[], name: string, triggers: any[], to: any, value: (c: BehaviorContext) => unknown) =>
    defineBehavior({ name, triggers, writes: [to], run: (c) => (log.push(name), c.set(to, value(c))) });

  test("a root writer runs before a row reader", ({ store: s, lines }) => {
    const log: string[] = [];
    const a = lines.itemAt(0);
    a.addBehavior(logged(log, "row", [L.qty, shape.discount], L.lineTotal, (c) => c.get(L.qty) * (1 - c.get(shape.discount))));
    s.addBehavior(logged(log, "root", [shape.start], shape.discount, (c) => c.get(shape.start) / 10));
    log.length = 0;
    s.batch(() => {
      a.set(L.qty, 4);
      s.set(shape.start, 5);
    });
    expect(log).toEqual(["root", "row"]);
    expect(a.get(L.lineTotal)).toBe(2);
  });

  test("a row writer runs before a root reader that reads every row", ({ store: s, lines }) => {
    const log: string[] = [];
    const a = lines.itemAt(0);
    s.addBehavior(logged(log, "sum", [shape.lines], shape.subtotal, (c) => c.get(shape.lines).reduce((t: number, l: Values["lines"][number]) => t + l.lineTotal, 0)));
    a.addBehavior(logged(log, "row", [L.qty], L.lineTotal, (c) => c.get(L.qty) * 10));
    log.length = 0;
    a.set(L.qty, 3);
    expect(log).toEqual(["row", "sum"]);
    expect(s.get(shape.subtotal), "row 1's lineTotal is 0").toBe(30 + 0);
  });

  test("through nested rows: an enclosing writer runs before a nested reader, a nested writer before an enclosing reader", ({ store: s, lines }) => {
    const log: string[] = [];
    const a = lines.itemAt(0);
    const note = a.substore(L.notes).itemAt(0);
    note.addBehavior(logged(log, "note", [N.text, L.lineTotal, shape.discount], N.len, (c) => c.get(N.text).length + c.get(L.lineTotal) + c.get(shape.discount)));
    a.addBehavior(logged(log, "line", [L.qty], L.lineTotal, (c) => c.get(L.qty)));
    s.addBehavior(logged(log, "root", [shape.start], shape.discount, (c) => c.get(shape.start)));
    log.length = 0;
    s.batch(() => {
      note.set(N.text, "abc");
      a.set(L.qty, 4);
      s.set(shape.start, 5);
    });
    expect(log, "the line, one host up, and the root, two up, in registration order, then the note").toEqual(["line", "root", "note"]);
    expect(note.get(N.len)).toBe(3 + 4 + 5);

    const b = lines.itemAt(1);
    const other = b.substore(L.notes).append({ text: "x", len: 0 });
    b.addBehavior(logged(log, "lens", [L.notes], L.sku, (c) => c.get(L.notes).map((n) => n.len).join(",")));
    other.addBehavior(logged(log, "len", [N.text], N.len, (c) => c.get(N.text).length));
    log.length = 0;
    other.set(N.text, "hello");
    expect(log).toEqual(["len", "lens"]);
    expect(b.get(L.sku)).toBe("5");
  });

  test("sibling rows don't order each other: each runs in registration order", ({ store: s, lines }) => {
    const log: string[] = [];
    const [a, b] = lines.items();
    b.addBehavior(logged(log, "reader", [L.lineTotal], L.sku.hint, (c) => String(c.get(L.lineTotal))));
    a.addBehavior(logged(log, "writer", [L.qty], L.lineTotal, (c) => c.get(L.qty) * 10));
    log.length = 0;
    s.batch(() => {
      a.set(L.qty, 4);
      b.set(L.lineTotal, 7);
    });
    expect(log, "the writer's lineTotal is another row's").toEqual(["reader", "writer"]);
    expect(b.get(L.sku.hint)).toBe("7");

    // A row's behavior on its nested rows, against a sibling row's nested row.
    const note = a.substore(L.notes).itemAt(0);
    const other = b.substore(L.notes).append({ text: "x", len: 0 });
    a.addBehavior(logged(log, "notes", [N.len], N.text, (c) => `#${c.get(N.len)}`));
    other.addBehavior(logged(log, "len", [N.text], N.len, (c) => c.get(N.text).length));
    log.length = 0;
    s.batch(() => {
      note.set(N.len, 4);
      other.set(N.text, "hello");
    });
    expect(log, "the len is another row's note's").toEqual(["notes", "len"]);
    expect(note.get(N.text)).toBe("#4");
  });

  test("a row reader of the whole list runs after a sibling row's writer", ({ lines }) => {
    const log: string[] = [];
    const [a, b] = lines.items();
    a.addBehavior(logged(log, "reader", [shape.lines], L.sku, (c) => c.get(shape.lines).map((l) => l.lineTotal).join(",")));
    b.addBehavior(logged(log, "writer", [L.qty], L.lineTotal, (c) => c.get(L.qty) * 10));
    log.length = 0;
    b.set(L.qty, 5);
    expect(log, "the list holds the writer's row").toEqual(["writer", "reader"]);
    expect(a.get(L.sku)).toBe("0,50");
  });

  test("sibling rows that each write from the whole list form a cycle", ({ lines }) => {
    const [a, b] = lines.items();
    const fromList = (name: string) =>
      defineBehavior({ name, triggers: [shape.lines], writes: [L.qty], run: (c) => c.set(L.qty, c.get(shape.lines).length) });
    a.addBehavior(fromList("a"));
    expect(() => b.addBehavior(fromList("b"))).toThrow(
      'Behaviors form a cycle: "lines[].qty#touched", "lines[].qty#dirty", "a", "b" – merge them into one behavior (see link())'
    );
  });

  test("behaviors on sibling rows that would form a cycle only through their own fields are no cycle: each row runs its own", ({ store: s }) => {
    const [a, b] = s.substore(shape.lines).items();
    a.addBehavior(defineBehavior({ name: "qtyFromPrice", triggers: [L.price], writes: [L.qty], run: (c) => c.set(L.qty, c.get(L.price)) }));
    b.addBehavior(defineBehavior({ name: "priceFromQty", triggers: [L.qty], writes: [L.price], run: (c) => c.set(L.price, c.get(L.qty)) }));
    expect([a.get(L.qty), b.get(L.price)], "init runs").toEqual([10, 2]);
    a.set(L.price, 7);
    b.set(L.qty, 3);
    expect([a.get(L.qty), a.get(L.price), b.get(L.qty), b.get(L.price)]).toEqual([7, 7, 3, 3]);
  });

  test("a cycle through a row and the root is reported with what follows it; nothing is registered", ({ store: s, lines }) => {
    const [a, b] = lines.items();
    s.addBehavior(defineBehavior({ name: "sum", triggers: [shape.lines], writes: [shape.discount], run: () => {} }));
    s.addBehavior(defineBehavior({ name: "after", triggers: [shape.discount], writes: [shape.total], run: () => {} }));
    // Meta writes: not part of the list's value, so not read by "sum".
    b.addBehavior(defineBehavior({ name: "hint", triggers: [shape.discount], writes: [L.sku.hint], run: () => {} }));
    b.addBehavior(defineBehavior({ name: "unrelated", triggers: [L.price], writes: [L.sku.disabled], run: () => {} }));
    const qty = defineBehavior({ name: "qty", triggers: [shape.discount], writes: [L.qty], run: (c) => c.set(L.qty, c.get(shape.discount)) });
    expect(() => a.addBehavior(qty)).toThrow(
      'Behaviors form a cycle: "lines[].qty#touched", "lines[].qty#dirty", "sum", "after", "hint", "qty" – merge them into one behavior (see link())'
    );
    s.set(shape.discount, 9);
    expect(a.get(L.qty), "not registered").toBe(1);
  });
});

describe("L · The run context", () => {
  test("ctx.changed is false on the init run and true only for triggers that changed", () => {
    const seen: string[] = [];
    const b = defineBehavior({
      name: "c", triggers: [shape.start, shape.end], writes: [shape.total],
      run: (ctx) => {
        seen.push(`${ctx.isInit}:${ctx.changed(shape.start)}:${ctx.changed(shape.end)}`);
        ctx.set(shape.total, 0);
      },
    });
    const s = createStore(shape, initial(), { behaviors: b });
    s.set(shape.end, 5);
    s.batch(() => {
      s.set(shape.start, 2);
      s.set(shape.end, 6);
    });
    expect(seen).toEqual(["true:false:false", "false:false:true", "false:true:true"]);
  });

  test("within one run the last ctx.set wins, and ctx.get sees the pending write", () => {
    let readBack: number | undefined;
    const b = defineBehavior({
      name: "w", triggers: [shape.start], writes: [shape.total],
      run: (ctx) => {
        ctx.set(shape.total, 1);
        readBack = ctx.get(shape.total);
        ctx.set(shape.total, 2);
      },
    });
    const s = createStore(shape, initial(), { behaviors: b });
    expect(readBack).toBe(1);
    expect(s.get(shape.total)).toBe(2);
  });

  test("ctx.initial needs initialOf(node) to be declared", () => {
    const e = errors();
    const undeclared = defineBehavior({
      name: "undeclared", triggers: [shape.title], writes: [shape.slug],
      run: (ctx) => ctx.set(shape.slug, ctx.initial(shape.title)),
    });
    createStore(shape, initial(), { behaviors: undeclared, onError: e.onError });
    expect(String(e.list[0]?.error)).toMatch(/"title#initial" is not declared in triggers, reads, writes or when/);

    const declared = defineBehavior({
      name: "declared", triggers: [shape.start], reads: [initialOf(shape.title)], writes: [shape.slug],
      run: (ctx) => ctx.set(shape.slug, ctx.initial(shape.title) + "!"),
    });
    const s = createStore(shape, initial(), { behaviors: declared });
    expect(s.get(shape.slug)).toBe("Hello!");
  });
});

describe("J · Handles and the default onError", () => {
  test("replaceBehavior rejects a handle of another store and a disposed handle", () => {
    const s1 = createStore(shape, initial());
    const s2 = createStore(shape, initial());
    const make = () => defineBehavior({ triggers: [shape.title], writes: [shape.slug], run: (c) => c.set(shape.slug, c.get(shape.title)) });
    const h1 = s1.addBehavior(make());
    expect(() => s2.replaceBehavior(h1, make())).toThrow("replace(): not a handle of this store");
    const h2 = s1.replaceBehavior(h1, make());
    expect(() => s1.replaceBehavior(h1, make()), "replaced").toThrow("replace(): the handle was already disposed or replaced");
    h2();
    expect(() => s1.replaceBehavior(h2, make()), "disposed").toThrow("replace(): the handle was already disposed or replaced");
  });

  test("the default onError logs the behavior name and scope via console.error", () => {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      const boom = new Error("boom");
      createStore(shape, initial(), {
        behaviors: defineBehavior({ name: "exploding", triggers: [L.qty], writes: [L.lineTotal], run: () => { throw boom; } }),
      });
      expect(logged.map((a) => a[0])).toEqual([
        '[form] "exploding" failed at "lines[0]"',
        '[form] "exploding" failed at "lines[1]"',
      ]);
      expect((logged[0][1] as Error).cause, "in dev: located where the behavior was defined").toBe(boom);
    } finally {
      console.error = original;
    }
  });
});

describe("J · Atomic replacement", () => {
  const { shape, L, initial } = limits;
  const test = base
    .extend("store", () => createStore(shape, initial()));

  // ---------------------------------------------------------------------------
  // Atomic replacement
  test("replacing a rule: one notification, straight to the new error", ({ store: s }) => {
    const h = s.addBehavior(rule(shape.name, () => "A"));
    const seen: (string | undefined)[] = [];
    s.subscribe(shape.name.error, () => seen.push(s.get(shape.name.error)));
    s.replaceBehavior(h, rule(shape.name, () => "B"));
    expect(seen).toEqual(["B"]);
  });

  test("replacing a behavior that writes the same meta: no notification", ({ store: s }) => {
    const lock = (name: string) =>
      defineBehavior({ name, triggers: [shape.name], writes: [shape.flag.disabled], run: (c) => c.set(shape.flag.disabled, true) });
    const h = s.addBehavior(lock("a"));
    expect(s.get(shape.flag.disabled)).toBe(true);
    let calls = 0;
    s.subscribe(shape.flag.disabled, () => calls++);
    const h2 = s.replaceBehavior(h, lock("b"));
    expect(calls, "reset to default and set again inside one batch").toBe(0);
    expect(s.get(shape.flag.disabled)).toBe(true);
    h2();
    expect(s.get(shape.flag.disabled)).toBe(false);
    expect(calls).toBe(1);
  });

  test("a failing replacement keeps the previous registration", ({ store: s }) => {
    s.addBehavior(defineBehavior({ name: "other", triggers: [shape.name], writes: [shape.flag.disabled], run: (c) => c.set(shape.flag.disabled, true) }));
    const h = s.addBehavior(
      defineBehavior({ name: "mine", triggers: [shape.name], writes: [shape.name.note], run: (c) => c.set(shape.name.note, c.get(shape.name)) })
    );
    const clash = defineBehavior({ name: "next", triggers: [shape.name], writes: [shape.flag.disabled], run: () => {} });
    expect(() => s.replaceBehavior(h, clash)).toThrow(/already written by "other"/);
    s.set(shape.name, "Kim");
    expect(s.get(shape.name.note), "previous behavior still runs").toBe("Kim");
    const h2 = s.replaceBehavior(h, []);
    s.set(shape.name, "Lee");
    expect(s.get(shape.name.note), "replaced by nothing: removed, meta reset").toBe("");
    h2();
  });

  test("handles: old handle is inert after replace; replacing twice throws", ({ store: s }) => {
    const h = s.addBehavior(rule(shape.name, () => "A"));
    const h2 = s.replaceBehavior(h, rule(shape.name, () => "B"));
    h();
    expect(s.get(shape.name.error), "disposing the old handle does nothing").toBe("B");
    expect(() => s.replaceBehavior(h, [])).toThrow(/already disposed or replaced/);
    h2();
    expect(s.get(shape.name.error)).toBe(undefined);
    expect(() => s.replaceBehavior(h2, [])).toThrow(/already disposed or replaced/);
  });

  test("replacement on a row store stays on that row", ({ store: s }) => {
    const [a, b] = s.substore(shape.lines).items();
    const h = a.addBehavior(max(L.qty, 0));
    expect(a.get(L.qty.error)).toBe("Must be at most 0");
    a.replaceBehavior(h, max(L.qty, 2));
    expect(a.get(L.qty.error)).toBe(undefined);
    expect(b.get(L.qty.error)).toBe(undefined);
    b.set(L.qty, 50);
    expect(b.get(L.qty.error), "row b never had the rule").toBe(undefined);
  });
});
