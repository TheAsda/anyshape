// A profile form with a field for each ready-made rule and behavior: string,
// array and number values, a `visible` section, `disabled` fields for
// exclusive, and rows. Used by the rule and behavior recipe tests.
import { form, object, array, field, type InferValue } from "form-lib";
import { control, visible, disabled } from "../../index";

export const shape = form({
  type: field<"person" | "company">(),
  name: field<string>().meta(control(), { label: "Full name" }),
  tags: field<string[]>().meta(control()),
  age: field<number | undefined>().meta(control()),
  email: field<string>().meta(control()),
  zip: field<string>().meta(control()),
  taxId: field<string>().meta(control(), { required: false }),
  personalId: field<string>().meta(control()),
  title: field<string>(),
  slug: field<string>(),
  start: field<number>(),
  end: field<number>(),
  plain: field<string>(),
  company: object({ vat: field<string>().meta(control()), phone: field<string>() }).meta({ visible }),
  price: field<number | undefined>().meta(control(), { disabled, label: "Price" }),
  discount: field<number | undefined>().meta(control(), { disabled, label: "Discount" }),
  promo: field<string>().meta(control(), { disabled, label: "Promo code" }),
  note: field<string>().meta({ hint: "", disabled }),
  lines: array(object({ qty: field<number>().meta(control()), sku: field<string>().meta(control()) })),
});
export type Values = InferValue<typeof shape>;
export const L = shape.lines.item;

export function initial(): Values {
  return {
    type: "person", name: "Ann", tags: ["a"], age: 30, email: "ann@x.io", zip: "LV-1010",
    taxId: "", personalId: "", title: "Hello", slug: "hello", start: 1, end: 3, plain: "",
    company: { vat: "", phone: "" }, price: undefined, discount: undefined, promo: "", note: "",
    lines: [{ qty: 1, sku: "A" }, { qty: 2, sku: "B" }],
  };
}
