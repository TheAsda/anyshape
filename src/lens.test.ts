import { propLens, composeLens, identityLens } from "./lens";
import { it, expect } from "vitest";

// ---------------------------------------------------------------------------
// propLens
it("propLens.get tolerates a missing parent", () => {
  const lens = propLens("a");
  expect(lens.get(undefined)).toBe(undefined);
  expect(lens.get(null)).toBe(undefined);
  expect(lens.get({ a: 1 })).toBe(1);
});

it("propLens.set returns the source when the value is Object.is-equal", () => {
  const lens = propLens("a");
  const nan = { a: NaN, b: {} };
  expect(lens.set(nan, NaN), "NaN is equal to itself").toBe(nan);
  const same = { a: "x", b: {} };
  expect(lens.set(same, "x")).toBe(same);
  const zero = { a: 0 };
  const signed = lens.set(zero, -0);
  expect(signed, "+0 and -0 differ under Object.is").not.toBe(zero);
  expect(Object.is(signed.a, -0)).toBe(true);
});

it("propLens.set copies the object and keeps sibling references", () => {
  const lens = propLens("a");
  const sibling = { deep: true };
  const source = { a: 1, b: sibling };
  const next = lens.set(source, 2);
  expect(next).not.toBe(source);
  expect(next).toEqual({ a: 2, b: sibling });
  expect(next.b).toBe(sibling);
  expect(source.a, "the source is never mutated").toBe(1);
});

it("propLens.set on a missing parent creates the object", () => {
  expect(propLens("a").set(undefined, 1)).toEqual({ a: 1 });
});

// ---------------------------------------------------------------------------
// identityLens and composition
it("identityLens reads the source and replaces it on write", () => {
  const source = { a: 1 };
  expect(identityLens.get(source)).toBe(source);
  const next = { a: 2 };
  expect(identityLens.set(source, next)).toBe(next);
});

it("composing with identityLens as the outer lens returns the inner lens", () => {
  const inner = propLens("a");
  expect(composeLens(identityLens, inner)).toBe(inner);
});

it("composeLens: a no-op write returns the outer source at every depth", () => {
  const deep = composeLens(composeLens(propLens("a"), propLens("b")), propLens("c"));
  const source = { a: { b: { c: 1 } }, x: {} };
  expect(deep.get(source)).toBe(1);
  expect(deep.set(source, 1)).toBe(source);
});

it("composeLens: a changed write copies only the path to the leaf", () => {
  const lens = composeLens(composeLens(propLens("a"), propLens("b")), propLens("c"));
  const other = { untouched: true };
  const bSibling = { keep: true };
  const source = { a: { b: { c: 1 }, bs: bSibling }, other };
  const next = lens.set(source, 2);
  expect(next.a.b.c).toBe(2);
  expect(next).not.toBe(source);
  expect(next.a).not.toBe(source.a);
  expect(next.a.b).not.toBe(source.a.b);
  expect(next.other, "a sibling of the path keeps its reference").toBe(other);
  expect(next.a.bs, "a sibling one level down keeps its reference").toBe(bSibling);
  expect(source.a.b.c, "the source is never mutated").toBe(1);
});
