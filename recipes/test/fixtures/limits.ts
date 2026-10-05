// A form with limits kept across reset (minCode, maxQty), a `disabled` flag,
// nested rows and submission(). Used by reset, submit, limit and replacement tests.
import {
  form, object, array, field, metaKey, createStore, type InferValue,
} from "form-lib";
import { control, submission, disabled } from "../../index";

export const shape = form(
  object({
    name: field<string>().meta(control(), { note: "" }),
    code: field<string>().meta(control(), { minCode: metaKey<number | undefined>(undefined, { keepOnReset: true }) }),
    flag: field<boolean>().meta({ disabled }),
    lines: array(
      object({
        qty: field<number>().meta(control(), {
          maxQty: metaKey<number | undefined>(undefined, { keepOnReset: true }),
          hint: "",
        }),
        notes: array(object({ text: field<string>().meta(control()) })),
      })
    ),
  }).meta(submission())
);
export type Values = InferValue<typeof shape>;
export const L = shape.lines.item;

export function initial(): Values {
  return {
    name: "Ann", code: "AB", flag: false,
    lines: [
      { qty: 1, notes: [] },
      { qty: 5, notes: [{ text: "x" }] },
    ],
  };
}
