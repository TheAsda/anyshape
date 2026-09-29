// A form with a nested company section (visibility and disableable at several
// levels), rows with nested rows and touched(), and a root disableable().
// Used by reference-API, origin, baseline, count and inheritance tests.
import {
  form, object, array, field, control, validation, touched, visibility, disableable,
  type InferValue, type Origin,
} from "../../index";

export const shape = form(
  object({
    name: field<string>().meta(control()),
    email: field<string>().meta(control()),
    company: object({
      vat: field<string>().meta(validation(), visibility(), disableable()),
      address: object({ city: field<string>().meta(visibility(), disableable()) }).meta(visibility()),
    }).meta(visibility(), disableable()),
    lines: array(
      object({
        sku: field<string>().meta(control(), disableable()),
        qty: field<number>(),
        notes: array(object({ text: field<string>().meta(validation()) })),
      }).meta(touched()),
      { create: () => ({ sku: "", qty: 1, notes: [] }) }
    ).meta(disableable()),
    tags: array(object({ text: field<string>() })),
  }).meta(disableable())
);
export type Values = InferValue<typeof shape>;
export const L = shape.lines.item;

export function initial(): Values {
  return {
    name: "Ann",
    email: "ann@x.io",
    company: { vat: "", address: { city: "Riga" } },
    lines: [
      { sku: "A", qty: 1, notes: [{ text: "a1" }] },
      { sku: "B", qty: 2, notes: [] },
    ],
    tags: [],
  };
}

/** Collects the origin sets passed to `record`, each sorted. */
export function originsOf(fn: (record: (o: ReadonlySet<Origin>) => void) => void): Origin[][] {
  const seen: Origin[][] = [];
  fn((o) => seen.push([...o].sort()));
  return seen;
}
