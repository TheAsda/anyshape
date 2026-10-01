// H · Counts: countIn, collect, aggregate keys, counts across rows.

import {
  form, object, array, field, meta, metaKey, createStore, countIn, initialOf, when,
} from "./index";
import { control } from "./test/features";
import { test, test as base, describe, expect } from "vitest";
import * as company from "./test/fixtures/company";
import * as limits from "./test/fixtures/limits";

describe("H · Counts and collect", () => {
  const { shape, L, initial, originsOf } = company;
  const test = base
    .extend("store", () => createStore(shape, initial()))
    .extend("lines", ({ store }) => store.substore(shape.lines));

  test("counts are read-only", ({ store: s }) => {
    expect(() => s.set(countIn(shape, "error") as any, 1 as never)).toThrow(/read-only/);
  });

  // ---------------------------------------------------------------------------
  // Counts and collect
  test("counts across fields, objects and rows", ({ store: s, lines }) => {
    const [a, b] = lines.items();
    s.set(shape.name.error, "x");
    s.set(shape.company.vat.error, "y");
    a.set(L.sku.error, "z");
    b.set(L.sku.error, "w");
    expect(s.get(countIn(shape, "error"))).toBe(4);
    expect(s.get(countIn(shape.company, "error"))).toBe(1);
    expect(s.get(countIn(shape.lines, "error"))).toBe(2);
    expect(a.get(countIn(L, "error"))).toBe(1);
    a.set(L.sku.error, undefined);
    expect(s.get(countIn(shape, "error"))).toBe(3);
  });

  test("removing and restoring rows moves their counts", ({ store: s, lines }) => {
    const row = lines.itemAt(0);
    row.set(L.sku.error, "z");
    const note = row.substore(L.notes).itemAt(0);
    note.set(L.notes.item.text.error, "n");
    expect(s.get(countIn(shape, "error"))).toBe(2);

    const before = lines.current().slice();
    s.set(shape.lines, [before[1]]);
    expect(s.get(countIn(shape, "error")), "detached row no longer counts").toBe(0);
    s.set(shape.lines, before);
    expect(s.get(countIn(shape, "error")), "restored row counts again").toBe(2);
  });

  test("count subscriptions fire on changes and row removal", ({ store: s }) => {
    const seen: number[] = [];
    s.subscribe(countIn(shape, "error"), () => seen.push(s.get(countIn(shape, "error"))));
    const row = s.substore(shape.lines).itemAt(1);
    row.set(L.sku.error, "z");
    s.set(shape.name.error, "x");
    s.substore(shape.lines).remove(row);
    expect(seen).toEqual([1, 2, 1]);
  });

  test("collect lists matching nodes with row indexes", ({ store: s, lines }) => {
    s.set(shape.email.error, "e");
    lines.itemAt(1).set(L.sku.error, "s");
    lines.itemAt(0).substore(L.notes).itemAt(0).set(L.notes.item.text.error, "n");
    const found = s.collect(shape, "error").map((e) => e.path);
    expect(found).toEqual(["email", "lines[0].notes[0].text", "lines[1].sku"]);
    const entry = s.collect(shape.lines, "error").find((e) => e.path === "lines[1].sku")!;
    expect(entry.store).toBe(lines.itemAt(1));
    expect(entry.ref).toBe(L.sku);
  });

  test("countIn warns when nothing in the subtree can aggregate the key", () => {
    const local = form(
      object({
        a: field<string>().meta(control()),
        b: field<boolean>().meta({ flag: false }),
      })
    );
    const original = console.warn;
    const seen: string[] = [];
    console.warn = (...args: unknown[]) => void seen.push(args.join(" "));
    try {
      expect(countIn(local, "error")).toBeDefined(); // aggregable: silent
      countIn(local, "flag"); // declared, but a plain value: always 0
      countIn(local, "flag"); // cached ref: still one warning
      countIn(local, "nope"); // not declared at all (e.g. a typo)
      expect(countIn(local, "error")).toBe(countIn(local, "error"));
    } finally {
      console.warn = original;
    }
    expect(seen.length).toBe(2);
    expect(seen[0]).toMatch(/"flag"/);
    expect(seen[1]).toMatch(/"nope"/);
  });

  test("aggregate must be false for the default", async () => {
    const { metaKey } = await import("./meta");
    expect(() => metaKey(true, { aggregate: (v) => v })).toThrow(/default value/);
  });

  test("collect on a row store: paths from the root, only that row; nested rows", ({ store: s }) => {
    const [a, b] = s.substore(shape.lines).items();
    a.set(L.sku.error, "bad a");
    b.set(L.sku.error, "bad b");
    a.substore(L.notes).itemAt(0).set(L.notes.item.text.error, "bad note");
    expect(b.collect(L, "error").map((e) => e.path)).toEqual(["lines[1].sku"]);
    const inA = a.collect(L, "error");
    expect(inA.map((e) => e.path)).toEqual(["lines[0].sku", "lines[0].notes[0].text"]);
    expect(inA[1].store.get(L.notes.item.text.error)).toBe("bad note");
  });

  test("a custom counted key written by application code counts like the built-in ones", () => {
    const f = form({
      a: field<string>().meta({ flagged: metaKey<boolean>(false, { aggregate: (v) => v }) }),
      rows: array(object({ b: field<string>().meta({ flagged: metaKey<boolean>(false, { aggregate: (v) => v }) }) })),
    });
    const s = createStore(f, { a: "", rows: [{ b: "" }, { b: "" }] });
    const flagged = countIn(f, "flagged");
    s.set(f.a.flagged, true);
    const rows = s.substore(f.rows);
    rows.itemAt(1).set(f.rows.item.b.flagged, true);
    expect(s.get(flagged)).toBe(2);
    expect(s.get(countIn(f.rows, "flagged"))).toBe(1);
    rows.remove(rows.itemAt(1));
    expect(s.get(flagged)).toBe(1);
    expect(s.collect(f, "flagged").map((e) => e.path)).toEqual(["a"]);
  });
});

describe("H · Stable count references", () => {
  const { shape, L, initial, targets } = limits;

  // ---------------------------------------------------------------------------
  // Stable references
  test("countIn and initialOf return the same instance per (node, key)", () => {
    expect(countIn(shape, "error")).toBe(countIn(shape, "error"));
    expect(countIn(shape, "error") === countIn(shape, "dirty")).toBe(false);
    expect(countIn(shape.lines, "error") === countIn(shape, "error")).toBe(false);
    expect(initialOf(shape.name)).toBe(initialOf(shape.name));
    expect(initialOf(shape.name) === initialOf(shape.code)).toBe(false);
  });
});
