// A user form with plain (static) meta, a reused `address`
// block and rows with nested rows. Used by the shape and store tests.
import { form, object, array, field, type InferValue } from "../../../src/index";

export const address = object({
  street: field<string>(),
  city: field<string>().meta({ required: true, label: "City", error: undefined as string | undefined }),
});

export const lineShape = object({
  sku: field<string>().meta({ required: true, touched: false, error: undefined as string | undefined }),
  qty: field<number>(),
  notes: array(object({ text: field<string>() })),
}).meta({ rowError: undefined as string | undefined });

export const userShape = form(
  object({
    name: field<string>().meta({ required: true, label: "Full name" }),
    shipping: address.meta({ collapsed: false }),
    billing: address,
    items: array(lineShape).meta({ maxItems: 10 }),
  }).meta({ title: "User" })
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
