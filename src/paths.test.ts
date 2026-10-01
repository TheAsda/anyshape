// O · Paths: resolvePath, and setting server errors through it.

import { MetaRef, createStore, countIn } from "./index";
import { test as base, describe, expect } from "vitest";
import * as limits from "./test/fixtures/limits";

describe("O · Paths", () => {
  const { shape, L, initial } = limits;
  const test = base
    .extend("store", () => createStore(shape, initial()))
    .extend("lines", ({ store }) => store.substore(shape.lines));

  test("resolvePath: fields, rows, nested rows, meta keys", ({ store: s, lines }) => {
    const a = s.resolvePath("name")!;
    expect(a.store).toBe(s);
    expect(a.ref).toBe(shape.name);
    const b = s.resolvePath("lines[1].qty")!;
    expect(b.store).toBe(lines.itemAt(1));
    expect(b.ref).toBe(L.qty);
    const c = s.resolvePath("lines[1].notes[0].text#error")!;
    expect(c.store).toBe(lines.itemAt(1).substore(L.notes).itemAt(0));
    expect(c.ref instanceof MetaRef).toBe(true);
    expect((c.ref as MetaRef<any>).key).toBe("error");
    const root = s.resolvePath("")!;
    expect(root.ref).toBe(shape);
    expect(s.resolvePath("#submitting")!.ref instanceof MetaRef).toBe(true);
  });

  test("resolvePath: unknown paths are undefined", ({ store: s }) => {
    for (const p of ["nope", "lines[9].qty", "lines[1].nope", "lines..qty", "lines[x].qty", "name[0]", "lines[1].qty#nokey", ".name", "name."]) {
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
      const target = s.resolvePath(`${path}#error`);
      if (target) target.store.set(target.ref as MetaRef<string | undefined>, message);
    }
    expect(s.substore(shape.lines).itemAt(1).get(L.qty.error)).toBe("Out of stock");
    expect(s.get(countIn(shape, "error"))).toBe(2);
  });
});
