// I · Inherited meta: visible (all), disabled (any), get vs getOwn.

import {
  form, array, createStore, when,
} from "./index";
import { it, expect } from "vitest";
import { shape, L, initial } from "./test/fixtures/company";

// ---------------------------------------------------------------------------
// Inheritance
it("visible: hidden if any ancestor is hidden", () => {
  const s = createStore(shape, initial());
  expect(s.get(shape.company.address.city.visible)).toBe(true);
  s.set(shape.company.visible, false);
  expect(s.get(shape.company.address.city.visible)).toBe(false);
  expect(s.getOwn(shape.company.address.city.visible)).toBe(true);
  s.set(shape.company.visible, true);
  s.set(shape.company.address.visible, false);
  expect(s.get(shape.company.address.city.visible)).toBe(false);
  expect(s.get(shape.company.vat.visible)).toBe(true);
});

it("disabled: inherited from the root and through arrays into rows", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  expect(row.get(L.sku.disabled)).toBe(false);
  s.set(shape.lines.disabled, true);
  expect(row.get(L.sku.disabled)).toBe(true);
  s.set(shape.lines.disabled, false);
  s.set(shape.disabled, true);                  // form-wide read-only
  expect(row.get(L.sku.disabled)).toBe(true);
  expect(s.get(shape.company.vat.disabled)).toBe(true);
});

it("subscriptions to inherited values fire when an ancestor changes", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  const seen: boolean[] = [];
  row.subscribe(L.sku.disabled, () => seen.push(row.get(L.sku.disabled)));
  s.set(shape.disabled, true);
  s.set(shape.lines.disabled, true);           // already effectively disabled: no change
  s.set(shape.disabled, false);                // still disabled via lines
  s.set(shape.lines.disabled, false);
  expect(seen).toEqual([true, false]);
});

// ---------------------------------------------------------------------------
// Inherited keys: effective vs own, across a row boundary
it("get vs getOwn for an inherited `any` key across a row boundary", () => {
  const s = createStore(shape, initial());
  const [first, second] = s.substore(shape.lines).items();
  s.set(shape.lines.disabled, true);
  expect(first.get(L.sku.disabled), "effective: from the array").toBe(true);
  expect(first.getOwn(L.sku.disabled), "own: never written").toBe(false);

  s.set(shape.lines.disabled, false);
  first.set(L.sku.disabled, true);
  expect(first.get(L.sku.disabled)).toBe(true);
  expect(first.getOwn(L.sku.disabled)).toBe(true);
  expect(second.get(L.sku.disabled), "other rows unaffected").toBe(false);
});
