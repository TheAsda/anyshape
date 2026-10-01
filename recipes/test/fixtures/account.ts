// An account form for validation: person/company type, password confirmation,
// a hidden-able company section (one field validates while hidden), a
// disableable promo, disableable rows and submission().
import {
  form, object, array, field, rule, type InferValue, type BehaviorErrorInfo,
} from "form-lib";
import { control, validation, visibility, disableable, submission } from "../../index";
import { deferred } from "../harness";

export const shape = form(
  object({
    type: field<"person" | "company">(),
    name: field<string>().meta(control()),
    email: field<string>().meta(control()),
    password: field<string>().meta(control()),
    confirm: field<string>().meta(control()),
    taxId: field<string>().meta(control()),
    note: field<string>(),
    company: object({
      vat: field<string>().meta(control()),
      secret: field<string>().meta(control({ validateHidden: true })),
    }).meta(visibility()),
    promo: field<string>().meta(control(), disableable()),
    lines: array(
      object({
        sku: field<string>().meta(control()),
        qty: field<number>().meta(control()),
        total: field<number>().meta(validation()),
      }),
      { create: () => ({ sku: "", qty: 1, total: 0 }) }
    ).meta(disableable()),
  }).meta(submission())
);
export type Values = InferValue<typeof shape>;
export const L = shape.lines.item;

export function initial(): Values {
  return {
    type: "person", name: "Ann", email: "ann@x.io", password: "secret", confirm: "secret",
    taxId: "", note: "", company: { vat: "", secret: "" }, promo: "",
    lines: [
      { sku: "A", qty: 1, total: 0 },
      { sku: "B", qty: 2, total: 0 },
    ],
  };
}

export const required = <N extends typeof shape.name>(n: N, name = "required") =>
  rule(n, (v) => (v ? undefined : "Required"), { name });
export const minLength = (n: typeof shape.name, min: number) =>
  rule(n, (v) => (v.length >= min ? undefined : `At least ${min}`), { name: "minLength" });

/** An onError that collects what behaviors reported. */
export function errors() {
  const list: { error: unknown; info: BehaviorErrorInfo }[] = [];
  return { list, onError: (error: unknown, info: BehaviorErrorInfo) => list.push({ error, info }) };
}

/** An async check whose calls are resolved by the test (`calls[i].d.resolve(...)`). */
export function lookup() {
  const calls: { value: string; signal: AbortSignal; d: ReturnType<typeof deferred<string | undefined>> }[] = [];
  const check = (value: string, ctx: { signal: AbortSignal }) => {
    const d = deferred<string | undefined>();
    calls.push({ value, signal: ctx.signal, d });
    return d.promise;
  };
  return { calls, check };
}
