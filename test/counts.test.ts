// H · Counts: countIn, collect, aggregate keys, counts across rows.

import {
  form, object, array, field, metaKey, createStore, countIn, initialOf, when,
} from "../src/index";
import { control, revealed, dirty, error } from "./support/features";
import { test, test as base, describe, expect, vi } from "vitest";
import * as company from "./support/fixtures/company";
import * as limits from "./support/fixtures/limits";

describe("H · Counts and collect", () => {
  const { shape, L, initial, originsOf } = company;
  const test = base
    .extend("store", () => createStore(shape, initial()))
    .extend("lines", ({ store }) => store.substore(shape.lines));

  test("counts are read-only", ({ store: s }) => {
    expect(() => s.set(countIn(shape, error) as any, 1 as never)).toThrow(/read-only/);
  });

  // ---------------------------------------------------------------------------
  // Counts and collect
  test("counts across fields, objects and rows", ({ store: s, lines }) => {
    const [a, b] = lines.items();
    s.set(shape.name.error, "x");
    s.set(shape.company.vat.error, "y");
    a.set(L.sku.error, "z");
    b.set(L.sku.error, "w");
    expect(s.get(countIn(shape, error))).toBe(4);
    expect(s.get(countIn(shape.company, error))).toBe(1);
    expect(s.get(countIn(shape.lines, error))).toBe(2);
    expect(a.get(countIn(L, error))).toBe(1);
    a.set(L.sku.error, undefined);
    expect(s.get(countIn(shape, error))).toBe(3);
  });

  test("removing and restoring rows moves their counts", ({ store: s, lines }) => {
    const row = lines.itemAt(0);
    row.set(L.sku.error, "z");
    const note = row.substore(L.notes).itemAt(0);
    note.set(L.notes.item.text.error, "n");
    expect(s.get(countIn(shape, error))).toBe(2);

    const before = lines.current().slice();
    s.set(shape.lines, [before[1]]);
    expect(s.get(countIn(shape, error)), "detached row no longer counts").toBe(0);
    s.set(shape.lines, before);
    expect(s.get(countIn(shape, error)), "restored row counts again").toBe(2);
  });

  test("a row write that drops its nested rows moves their counts before the reactions run", () => {
    // No behaviors: the count is the only thing that changes for the reactions.
    const flaggedKey = metaKey(false).aggregate((v) => v);
    const f = form(object({ rows: array(object({ notes: array(object({ text: field<string>().meta({ flagged: flaggedKey }) })) })) }));
    const s = createStore(f, { rows: [{ notes: [{ text: "" }] }, { notes: [] }] });
    const row = s.substore(f.rows).itemAt(0);
    const note = row.substore(f.rows.item.notes).itemAt(0);
    note.set(f.rows.item.notes.item.text.flagged, true);
    note.set(f.rows.item.notes.item.text, "n");   // a flush that walks the rows first
    const seen: number[] = [];
    s._react(countIn(f, flaggedKey), (next) => seen.push(next));
    row.set(f.rows.item.notes, []);
    expect(seen).toEqual([0]);
  });

  test("count subscriptions fire on changes and row removal", ({ store: s }) => {
    const seen: number[] = [];
    s.subscribe(countIn(shape, error), () => seen.push(s.get(countIn(shape, error))));
    const row = s.substore(shape.lines).itemAt(1);
    row.set(L.sku.error, "z");
    s.set(shape.name.error, "x");
    s.substore(shape.lines).remove(row);
    expect(seen).toEqual([1, 2, 1]);
  });

  test("collect(node, def) lists every instance that declares the definition, whatever its value or name", () => {
    const marked = metaKey(false);
    const f = form(object({
      a: field<string>().meta({ marked }),
      b: field<string>().meta({ other: metaKey(false) }),
      rows: array(object({ c: field<string>().meta({ flag: marked }) })),
      d: field<string>().meta({ marked }),
    }));
    const s = createStore(f, { a: "", b: "", rows: [{ c: "" }, { c: "" }], d: "" });
    const rows = s.substore(f.rows);
    rows.itemAt(1).set(f.rows.item.c.flag, true);

    const found = s.collect(f, marked);
    expect(found.map((e) => e.path)).toEqual(["a", "rows[0].c", "rows[1].c", "d"]);
    expect(found[0].ref).toBe(f.a.marked);
    expect(found[2].ref).toBe(f.rows.item.c.flag);
    expect(found[2].store).toBe(rows.itemAt(1));
    expect(found.map((e) => e.store.get(e.ref))).toEqual([false, false, true, false]);
  });

  test("aggregate must be false for the default", async () => {
    const { metaKey } = await import("../src/meta");
    expect(() => metaKey(true).aggregate((v) => v)).toThrow(/default value/);
  });

  test(".aggregate() is declared once: a second call throws instead of replacing the first", () => {
    expect(() => metaKey(0).aggregate((v) => v > 0).aggregate((v) => v < 0)).toThrow(/\.aggregate\(\) is declared once/);
  });

  test("collect on a row store: paths from the root, only that row; nested rows", ({ store: s }) => {
    const [a, b] = s.substore(shape.lines).items();
    a.substore(L.notes).itemAt(0).set(L.notes.item.text.revealed, true);
    expect(b.collect(L, revealed).map((e) => e.path)).toEqual(["lines[1].sku"]);
    const inA = a.collect(L, revealed);
    expect(inA.map((e) => e.path)).toEqual(["lines[0].sku", "lines[0].notes[0].text"]);
    expect(inA[1].ref).toBe(L.notes.item.text.revealed);
    expect(inA[1].store.get(inA[1].ref)).toBe(true);
  });

  test("a custom counted key written by application code counts like the built-in ones", () => {
    const flaggedKey = metaKey(false).aggregate((v) => v);
    const f = form(object({
      a: field<string>().meta({ flagged: flaggedKey }),
      rows: array(object({ b: field<string>().meta({ flagged: flaggedKey }) })),
    }));
    const s = createStore(f, { a: "", rows: [{ b: "" }, { b: "" }] });
    const flagged = countIn(f, flaggedKey);
    s.set(f.a.flagged, true);
    const rows = s.substore(f.rows);
    rows.itemAt(1).set(f.rows.item.b.flagged, true);
    expect(s.get(flagged)).toBe(2);
    expect(s.get(countIn(f.rows, flaggedKey))).toBe(1);
    rows.remove(rows.itemAt(1));
    expect(s.get(flagged)).toBe(1);
    expect(s.collect(f, flaggedKey).filter((e) => e.store.get(e.ref)).map((e) => e.path)).toEqual(["a"]);
  });
});

describe("H · Counts by definition", () => {
  test("countIn counts a key definition, whatever name a node declares it under", () => {
    const flagged = metaKey(false).aggregate((v) => v);
    const other = metaKey(false).aggregate((v) => v);
    const f = form(object({
      a: field<string>().meta({ flagged }),
      b: field<string>().meta({ marked: flagged, flagged: other }),
      rows: array(object({ c: field<string>().meta({ flagged }) })),
    }));
    const s = createStore(f, { a: "", b: "", rows: [{ c: "" }, { c: "" }] });
    s.set(f.a.flagged, true);
    s.set(f.b.marked, true);
    s.set(f.b.flagged, true);
    s.substore(f.rows).itemAt(1).set(f.rows.item.c.flagged, true);
    expect(s.get(countIn(f, flagged))).toBe(3);
    expect(s.get(countIn(f.rows, flagged))).toBe(1);
    expect(s.get(countIn(f, other)), "another definition under the same name").toBe(1);
    expect(countIn(f, flagged)).toBe(countIn(f, flagged));
    expect(countIn(f, flagged) === countIn(f, other)).toBe(false);
  });
});

describe.each(["development", "production"])("H · countIn rejects a key it can't count (%s)", (mode) => {
  const flag = metaKey(false);
  const counted = metaKey(false).aggregate((v) => v);
  const f = form(
    object({
      a: field<string>().meta({ counted }),
      b: field<boolean>().meta({ flag }),
      rows: array(object({ c: field<string>().meta({ inRow: counted }) })),
      other: object({ d: field<string>() }),
    })
  );
  const test = base.extend("warn", ({}, { onCleanup }) => {
    vi.stubEnv("NODE_ENV", mode);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onCleanup(() => {
      warn.mockRestore();
      vi.unstubAllEnvs();
    });
    return warn;
  });

  test("a key without aggregate throws, naming the node and the key", ({ warn }) => {
    // @ts-expect-error countIn takes only a key declared with .aggregate()
    expect(() => countIn(f, flag)).toThrow(
      'countIn on "<root>": key "flag" on "b" has no aggregate – its count would always be 0. Counted keys are declared with metaKey(value).aggregate(…).'
    );
    // @ts-expect-error countIn takes only a key declared with .aggregate()
    expect(() => countIn(f, flag), "a failed call caches nothing").toThrow(/has no aggregate/);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a key no node in the subtree declares throws, naming the node", ({ warn }) => {
    expect(() => countIn(f.other, counted)).toThrow(
      'countIn on "other": no node in the subtree declares the key – its count would always be 0. Counted keys are declared with metaKey(value).aggregate(…).'
    );
    expect(() => countIn(f.other, counted), "a failed call caches nothing").toThrow(/no node in the subtree declares the key/);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a counted key declared in the subtree, by a field or a row template, does not throw", ({ warn }) => {
    const s = createStore(f, { a: "", b: false, rows: [{ c: "" }], other: { d: "" } });
    s.substore(f.rows).itemAt(0).set(f.rows.item.c.inRow, true);
    expect(s.get(countIn(f, counted))).toBe(1);
    expect(s.get(countIn(f.rows, counted)), "declared only by the row template").toBe(1);
    expect(s.get(countIn(f.a, counted))).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("H · Stable count references", () => {
  const { shape, L, initial } = limits;

  // ---------------------------------------------------------------------------
  // Stable references
  test("countIn and initialOf return the same instance per (node, key)", () => {
    expect(countIn(shape, error)).toBe(countIn(shape, error));
    expect(countIn(shape, error) === countIn(shape, dirty)).toBe(false);
    expect(countIn(shape.lines, error) === countIn(shape, error)).toBe(false);
    expect(initialOf(shape.name)).toBe(initialOf(shape.name));
    expect(initialOf(shape.name) === initialOf(shape.code)).toBe(false);
  });
});
