// G · Origins, baselines (initial values) and reset.

import {
  form, object, array, field, meta, createStore, countIn, initialOf, defineBehavior, rule, control,
  touched, disableable, max, type Origin, type FocusTarget,
} from "./index";
import { describe, it, expect } from "vitest";
import * as company from "./test/fixtures/company";
import * as limits from "./test/fixtures/limits";

describe('G · origins, baselines and reset', () => {
  const { shape, L, initial, originsOf } = company;

  it("reactions receive the origin of the write", () => {
    const s = createStore(shape, initial());
    const seen = originsOf((rec) => s.react(shape.name, (_n, _p, info) => rec(info.origins)));
    s.set(shape.name, "U", { origin: "user" });
    s.set(shape.name, "P");
    s.set(shape.name, "I", { as: "initial" });
    expect(seen).toEqual([["user"], ["program"], ["initial"]]);
  });

  it("origins are tracked per target within one batch", () => {
    const s = createStore(shape, initial());
    const name: Origin[][] = [];
    const email: Origin[][] = [];
    s.react(shape.name, (_n, _p, i) => name.push([...i.origins]));
    s.react(shape.email, (_n, _p, i) => email.push([...i.origins]));
    s.batch(() => {
      s.set(shape.name, "U", { origin: "user" });
      s.set(shape.email, "p@x.io");
    });
    expect(name).toEqual([["user"]]);
    expect(email).toEqual([["program"]]);
  });

  it("origins cross scopes in both directions", () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
    const row = lines.itemAt(0);
    const toRoot: Origin[][] = [];
    const toRow: Origin[][] = [];
    s.react(shape.lines, (_n, _p, i) => toRoot.push([...i.origins]));
    row.react(L.sku, (_n, _p, i) => toRow.push([...i.origins]));

    row.set(L.sku, "Z", { origin: "user" });              // row → enclosing array
    expect(toRoot).toEqual([["user"]]);
    expect(toRow).toEqual([["user"]]);

    const current = s.getValues().lines;
    s.set(shape.lines, [current[1]]);                      // array write detaches the row
    expect(toRow.at(-1)).toEqual(["program"]);
  });

  it("a write in one row is not an origin for another row", () => {
    const s = createStore(shape, initial());
    const [a, b] = s.substore(shape.lines).items();
    let bCalls = 0;
    b.react(L.sku, () => bCalls++);
    a.set(L.sku, "Z", { origin: "user" });
    expect(bCalls).toBe(0);
  });

  it("meta reactions receive origins", () => {
    const s = createStore(shape, initial());
    const seen: Origin[][] = [];
    s.react(shape.name.error, (_n, _p, i) => seen.push([...i.origins]));
    s.set(shape.name.error, "x", { origin: "behavior:required" });
    expect(seen).toEqual([["behavior:required"]]);
  });

  // ---------------------------------------------------------------------------
  // Initial values
  it("getInitial and { as: 'initial' }", () => {
    const s = createStore(shape, initial());
    s.set(shape.name, "Bob");
    expect(s.getInitial(shape.name)).toBe("Ann");
    s.set(shape.name, "Cid", { as: "initial" });
    expect(s.getInitial(shape.name)).toBe("Cid");
    expect(s.get(shape.name)).toBe("Cid");
  });

  it("rows keep their own initial value through edits and reordering", () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
    const [a, b] = lines.items();
    a.set(L.qty, 9);
    expect(a.getInitial(L.qty)).toBe(1);
    lines.move(a, 1);
    expect(lines.itemAt(1)).toBe(a);
    expect(a.getInitial(L.qty)).toBe(1);
    expect(b.getInitial(L.sku)).toBe("B");
  });

  it("new rows start from {}", () => {
    const s = createStore(shape, initial());
    const row = s.substore(shape.lines).append();
    expect(row.getInitial(L.sku)).toBe(undefined);
    expect(row.get(L.qty)).toBe(1);
  });

  it("a baseline write on the array makes current rows initial", () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
    const row = lines.append({ sku: "N" });
    expect(row.getInitial(L.sku)).toBe(undefined);
    s.set(shape.lines, lines.current().slice(), { as: "initial" });
    expect(row.getInitial(L.sku)).toBe("N");
  });

  it("reset restores values and meta, keeps rows and focus targets", () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
    const row = lines.itemAt(0);
    const target: FocusTarget = { focus() {} };
    s.set(shape.name, "Bob");
    s.set(shape.name.error, "x");
    s.set(shape.name.focusTarget, target);
    row.set(L.qty, 5);
    row.set(L.sku.error, "bad");
    lines.append();

    s.reset();

    expect(s.get(shape.name)).toBe("Ann");
    expect(s.get(shape.name.error)).toBe(undefined);
    expect(s.get(shape.name.focusTarget), "focus target kept").toBe(target);
    expect(lines.items().length).toBe(2);
    expect(lines.itemAt(0), "same row store after reset").toBe(row);
    expect(row.get(L.qty)).toBe(1);
    expect(row.get(L.sku.error)).toBe(undefined);
    expect(s.get(countIn(shape, "error"))).toBe(0);
  });

  it("reset of one row", () => {
    const s = createStore(shape, initial());
    const row = s.substore(shape.lines).itemAt(1);
    row.set(L.sku, "Z");
    row.set(L.sku.touched, true);
    row.reset();
    expect(row.get(L.sku)).toBe("B");
    expect(row.get(L.sku.touched)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Write options and read-only references
  it("setMeta rejects { as: 'initial' }: baselines are for values", () => {
    const s = createStore(shape, initial());
    expect(() => s.setMeta(shape.name, { touched: true }, { as: "initial" })).toThrow(/applies to values only/);
  });

  it("initial values and counts can't be set directly", () => {
    const s = createStore(shape, initial());
    expect(() => s.set(initialOf(shape.name) as never, "x" as never)).toThrow(/Initial values are written with \{ as: "initial" \}/);
    expect(() => s.set(countIn(shape, "error") as never, 1 as never)).toThrow(/Counts are read-only/);
  });

  it("saving (a root baseline write) makes every current row clean; rows added later start dirty", () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
    const added = lines.append({ sku: "N" });
    const [a] = lines.items();
    a.set(L.sku, "A2");
    expect(a.get(L.sku.dirty)).toBe(true);
    expect(added.get(L.sku.dirty)).toBe(true);

    s.setValues(s.getValues(), { as: "initial" });
    expect(a.get(L.sku.dirty)).toBe(false);
    expect(added.get(L.sku.dirty), "the added row is part of the new baseline").toBe(false);
    expect(s.get(countIn(shape, "dirty"))).toBe(0);
    expect(added.get(initialOf(L.sku))).toBe("N");

    const later = lines.append({ sku: "L" });
    expect(later.get(L.sku.dirty)).toBe(true);
    s.reset();
    expect(lines.items().map((r) => r.get(L.sku)), "reset goes back to the saved rows").toEqual(["A2", "B", "N"]);
  });

  // ---------------------------------------------------------------------------
  it("reset writes with origin \"initial\": reactions see it, touched does not flip", () => {
    const s = createStore(shape, initial());
    s.set(shape.name, "Bob");
    const origins: Origin[][] = [];
    s.react(shape.name, (_n, _p, info) => origins.push([...info.origins]));
    s.reset();
    expect(s.get(shape.name)).toBe("Ann");
    expect(origins).toEqual([["initial"]]);
    expect(s.get(shape.name.touched)).toBe(false);
  });
});

describe('G · reset re-runs behaviors and keeps limits', () => {
  const { shape, L, initial, targets } = limits;

  // ---------------------------------------------------------------------------
  // keepOnReset
  it("keepOnReset keys survive reset(); other meta does not", () => {
    const s = createStore(shape, initial());
    const row = s.substore(shape.lines).itemAt(1);
    row.set(L.qty.maxQty, 3);
    row.set(L.qty.hint, "tip");
    s.set(shape.name.note, "n");
    s.reset();
    expect(row.get(L.qty.maxQty)).toBe(3);
    expect(row.get(L.qty.hint)).toBe("");
    expect(s.get(shape.name.note)).toBe("");
  });

  // ---------------------------------------------------------------------------
  // reset() re-runs behaviors (found by the React tests)
  it("reset re-validates: a kept limit still applies to the reset value", () => {
    const s = createStore(shape, { ...initial(), lines: [{ qty: 5, notes: [] }] }, { behaviors: max(L.qty, L.qty.maxQty) });
    const row = s.substore(shape.lines).itemAt(0);
    row.set(L.qty.maxQty, 3);
    expect(row.get(L.qty.error)).toBe("Must be at most 3");
    s.reset();
    expect(row.get(L.qty.error), "not cleared by reset").toBe("Must be at most 3");
  });

  it("reset: rule errors match the initial values again", () => {
    const s = createStore(shape, { ...initial(), name: "" }, { behaviors: rule(shape.name, (v) => (v ? undefined : "Required")) });
    expect(s.get(shape.name.error)).toBe("Required");
    s.set(shape.name, "Bob", { origin: "user" });
    expect(s.get(shape.name.error)).toBe(undefined);
    let notified = 0;
    s.subscribe(shape.name.error, () => notified++);
    s.reset();
    expect(s.get(shape.name.error)).toBe("Required");
    expect(s.get(shape.name.touched), "touched stays cleared (it does not run on init)").toBe(false);
    expect(notified).toBe(1);
  });

  it("reset: behavior-written meta is recomputed, without flicker", () => {
    const s = createStore(shape, { ...initial(), name: "" }, {
      behaviors: defineBehavior({ triggers: [shape.name], writes: [shape.flag.disabled], run: (c) => c.set(shape.flag.disabled, c.get(shape.name) === "") }),
    });
    expect(s.get(shape.flag.disabled)).toBe(true);
    let notified = 0;
    s.subscribe(shape.flag.disabled, () => notified++);
    s.reset();
    expect(s.get(shape.flag.disabled), "the condition still holds").toBe(true);
    expect(notified, "reset to default and recomputed in one batch").toBe(0);
  });

  it("resetting one row re-runs only that row's instances", () => {
    let runs: string[] = [];
    const s = createStore(shape, initial(), {
      behaviors: defineBehavior({
        name: "rowHint",
        triggers: [L.qty],
        writes: [L.qty.hint],
        run: (c) => {
          runs.push(String(c.get(L.qty)));
          c.set(L.qty.hint, `q${c.get(L.qty)}`);
        },
      }),
    });
    const [a, b] = s.substore(shape.lines).items();
    runs = [];
    b.reset();
    expect(runs).toEqual(["5"]);
    expect(a.get(L.qty.hint)).toBe("q1");
    expect(b.get(L.qty.hint)).toBe("q5");
  });

  // ---------------------------------------------------------------------------
  // Reset of an object section
  it("reset of a section: only its values and meta, and only behaviors writing inside it re-run", () => {
    const f = form(
      object({
        a: object({ x: field<string>().meta(control()), locked: field<boolean>().meta(disableable()) }),
        b: field<string>().meta(control()),
        flag: field<boolean>(),
      })
    );
    const lockA = defineBehavior({
      name: "lockA", triggers: [f.flag], writes: [f.a.locked.disabled],
      run: (c) => c.set(f.a.locked.disabled, c.get(f.flag)),
    });
    let outsideRuns = 0;
    const outside = defineBehavior({
      name: "outside", triggers: [f.flag], writes: [f.b],
      run: (c) => (outsideRuns++, c.set(f.b, c.get(f.flag) ? "on" : "off")),
    });
    const s = createStore(f, { a: { x: "", locked: false }, b: "", flag: true }, { behaviors: [lockA, outside] });
    s.set(f.a.x, "typed", { origin: "user" });
    s.set(f.b, "typed b", { origin: "user" });
    expect(s.get(f.a.locked.disabled)).toBe(true);
    outsideRuns = 0;

    s.reset(f.a);
    expect(s.get(f.a.x)).toBe("");
    expect(s.get(f.a.x.touched)).toBe(false);
    expect(s.get(f.a.locked.disabled), "recomputed, not left at its default: flag is still true").toBe(true);
    expect(s.get(f.b), "outside the section: kept").toBe("typed b");
    expect(s.get(f.b.touched)).toBe(true);
    expect(outsideRuns, "a behavior writing outside the section is not re-run").toBe(0);
  });
});
