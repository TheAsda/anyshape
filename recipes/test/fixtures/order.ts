// An order placed in steps, for fields that start empty: step 1 picks a
// delivery type ({ defined }), step 2 a SKU from the options loaded for it.
// Each step is a section with submission(), so its Next button is
// handleSubmit on the step's substore. Rows ({ defined } on their sku) are
// created empty. Used by the `defined`, submit and checked-type tests.
import { form, object, array, field, defineBehavior, type InferValue } from "anyshape";

import { control, submission, defined } from "../../index";

export type DeliveryType = "Electronic" | "Printed";

export const shape = form(
  object({
    delivery: object({
      deliveryType: field<DeliveryType | undefined>().meta(control(), { defined }),
      email: field<string>().meta(control()),
    }).meta(submission()),
    items: object({
      sku: field<string | undefined>().meta(control(), { defined, skuOptions: [] as readonly string[] }),
      note: field<string | undefined>().meta(control()),
      lines: array(
        object({
          sku: field<string | undefined>().meta(control(), { defined }),
          qty: field<number>().meta(control()),
        }),
        { create: () => ({ sku: undefined, qty: 1 }) },
      ),
    }).meta(submission()),
  }).meta(submission()),
);
export type Values = InferValue<typeof shape>;
export const D = shape.delivery;
export const L = shape.items.lines.item;

export function initial(): Values {
  return {
    delivery: { deliveryType: undefined, email: "" },
    items: { sku: undefined, note: undefined, lines: [] },
  };
}

export const skusFor = (type: DeliveryType) => (type === "Electronic" ? ["E-1", "E-2"] : ["P-1"]);

/** Step 2's options: reads the stored type, so it handles the empty case itself. */
export const loadSkus = (fetchSkus: (type: DeliveryType, signal: AbortSignal) => Promise<readonly string[]>) =>
  defineBehavior({
    name: "loadSkus",
    triggers: [shape.delivery.deliveryType],
    writes: [shape.items.sku.skuOptions],
    async run(ctx) {
      const type = ctx.get(shape.delivery.deliveryType);
      ctx.set(shape.items.sku.skuOptions, type === undefined ? [] : await fetchSkus(type, ctx.signal));
    },
  });
