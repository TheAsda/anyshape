// A form with a nested company section (`visible` and `disabled` at several
// levels), rows with nested rows and `touched`, and a root `disabled`.
// Used by reference-API, origin, baseline, count and inheritance tests.
import { form, object, array, field, type InferValue, type Origin } from "../../index";
import { control, validation, touched, visible, disabled, revealed } from "../features";

export const shape = form(
  object({
    name: field<string>().meta(control()),
    email: field<string>().meta(control()),
    company: object({
      vat: field<string>().meta(validation(), { visible, disabled }),
      address: object({ city: field<string>().meta({ visible, disabled }) }).meta({ visible }),
    }).meta({ visible, disabled }),
    lines: array(
      object({
        sku: field<string>().meta(control(), { disabled }),
        qty: field<number>(),
        notes: array(object({ text: field<string>().meta(validation(), { revealed }) })),
      }).meta({ touched }),
      { create: () => ({ sku: "", qty: 1, notes: [] }) }
    ).meta({ disabled }),
    tags: array(object({ text: field<string>() })),
  }).meta({ disabled })
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
