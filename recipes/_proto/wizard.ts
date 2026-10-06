// ============================================================
// PROTOTYPE(#128) – throwaway. The delivery-type wizard: step 1 picks
// `deliveryType`, step 2 loads SKUs for it, submit sends the order.
// Each step is a section that declares submission(), so its Next button is
// handleSubmit on the step's substore.
// ============================================================

import { form, object, array, field, defineBehavior, type InferValue } from "anyshape";

import { control } from "../features";
import { submission } from "../submit";
import { defined } from "../validation";

export type DeliveryType = "Electronic" | "Printed";

export const order = form(
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

export type OrderValue = InferValue<typeof order>;

export const empty = (): OrderValue => ({
  delivery: { deliveryType: undefined, email: "" },
  items: { sku: undefined, note: undefined, lines: [] },
});

export const skusFor = (type: DeliveryType) => (type === "Electronic" ? ["E-1", "E-2"] : ["P-1"]);

/** Step 2's behavior: reads the stored type, so it branches on the empty case itself. */
export const loadSkus = (fetchSkus: (type: DeliveryType, signal: AbortSignal) => Promise<readonly string[]>) =>
  defineBehavior({
    name: "loadSkus",
    triggers: [order.delivery.deliveryType],
    writes: [order.items.sku.skuOptions],
    async run(ctx) {
      const type = ctx.get(order.delivery.deliveryType); // DeliveryType | undefined
      ctx.set(order.items.sku.skuOptions, type === undefined ? [] : await fetchSkus(type, ctx.signal));
    },
  });
