// A form with limits kept across reset (minCode, maxQty), a `disabled` flag,
// nested rows and submission(). Used by reset, submit, limit and replacement tests.
import {
  form, object, array, field, metaKey, createStore, type InferValue,
} from "form-lib";
import { registerFocus, type FocusTarget } from "../../focus";
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

/** Registers focus targets on `name` and `code`; returns a comparator for `order`. */
export function targets(s: ReturnType<typeof createStore<typeof shape>>, order: Record<string, number>, focused: string[]) {
  const make = (id: string): FocusTarget & { id: string } => ({ id, focus: () => focused.push(id) });
  registerFocus(s, shape.name, make("name"));
  registerFocus(s, shape.code, make("code"));
  return (a: FocusTarget, b: FocusTarget) => order[(a as any).id] - order[(b as any).id];
}
