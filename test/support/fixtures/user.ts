// A user form with local key definitions, a reused `address`
// block and rows with nested rows. Used by the shape and store tests.
import { form, object, array, field, metaKey, type InferValue } from "../../../src/index";

export const address = object({
  street: field<string>(),
  city: field<string>().meta({
    required: metaKey(true),
    label: metaKey("City"),
    error: metaKey<string | undefined>(undefined),
  }),
});

export const lineShape = object({
  sku: field<string>().meta({
    required: metaKey(true),
    touched: metaKey(false),
    error: metaKey<string | undefined>(undefined),
  }),
  qty: field<number>(),
  notes: array(object({ text: field<string>() })),
}).meta({ rowError: metaKey<string | undefined>(undefined) });

export const userShape = form(
  object({
    name: field<string>().meta({ required: metaKey(true), label: metaKey("Full name") }),
    shipping: address.meta({ collapsed: metaKey(false) }),
    billing: address,
    items: array(lineShape).meta({ maxItems: metaKey(10) }),
  }).meta({ title: metaKey("User") }),
);

export type User = InferValue<typeof userShape>;

export function initial(): User {
  return {
    name: "Ann",
    shipping: { street: "Main", city: "Riga" },
    billing: { street: "Side", city: "Tallinn" },
    items: [
      { sku: "A", qty: 1, notes: [{ text: "a1" }] },
      { sku: "B", qty: 2, notes: [] },
    ],
  };
}
