// O · Paths: resolvePath, and setting server errors through it.

import { createStore, countIn } from "./index";
import { error } from "./test/features";
import { test as base, describe, expect } from "vitest";
import * as limits from "./test/fixtures/limits";

describe("O · Paths", () => {
  const { shape, L, initial } = limits;
  const test = base
    .extend("store", () => createStore(shape, initial()))
    .extend("lines", ({ store }) => store.substore(shape.lines));

  test("resolvePath: fields, rows, nested rows", ({ store: s, lines }) => {
    const a = s.resolvePath("name")!;
    expect(a.store).toBe(s);
    expect(a.ref).toBe(shape.name);
    const b = s.resolvePath("lines[1].qty")!;
    expect(b.store).toBe(lines.itemAt(1));
    expect(b.ref).toBe(L.qty);
    const c = s.resolvePath("lines[1].notes[0].text")!;
    expect(c.store).toBe(lines.itemAt(1).substore(L.notes).itemAt(0));
    expect(c.ref).toBe(L.notes.item.text);
    const root = s.resolvePath("")!;
    expect(root.ref).toBe(shape);
  });

  test("resolvePath takes value paths only: a meta key is reached by its definition", ({ store: s }) => {
    for (const p of ["name#error", "lines[1].qty#error", "#submitting"]) expect(s.resolvePath(p), p).toBe(undefined);
  });

  test("resolvePath: unknown paths are undefined", ({ store: s }) => {
    for (const p of ["nope", "lines[9].qty", "lines[1].nope", "lines..qty", "lines[x].qty", "name[0]", ".name", "name."]) {
      expect(s.resolvePath(p), p).toBe(undefined);
    }
  });

  test("resolvePath works from a row store (paths are from the form root)", ({ store: s }) => {
    const row = s.substore(shape.lines).itemAt(0);
    expect(row.resolvePath("name")!.store).toBe(s);
  });

  test("server errors: resolve and set", ({ store: s }) => {
    const server = { "lines[1].qty": "Out of stock", name: "Taken" };
    for (const [path, message] of Object.entries(server)) {
      const t = s.resolvePath(path);
      const e = t && t.store.collect(t.ref, error).find((e) => e.ref.node === t.ref);
      if (e) e.store.set(e.ref, message);
    }
    expect(s.substore(shape.lines).itemAt(1).get(L.qty.error)).toBe("Out of stock");
    expect(s.get(countIn(shape, error))).toBe(2);
  });
});
