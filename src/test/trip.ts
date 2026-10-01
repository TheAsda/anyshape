// ============================================================
// The trip booking used by the integration suites (core and React).
// A reused `person` block, traveler rows with a per-row computed flag, a
// calculated pricing chain with a budget rule, a seat count limited by a
// value synced from outside, a visa section shown for some destinations,
// and promo code / voucher exclusivity.
// ============================================================

import {
  form, object, array, field, metaKey, defineBehaviors, defineBehavior, rule, asyncRule, initialOf,
  type InferValue, type AnyNode, type AnyRef, type RefValue,
} from "../index";
import { control, visible, disabled, submission } from "./features";
import { required, email, pattern, max } from "./rules";

export const person = object({
  name: field<string>().meta(control()),
  email: field<string>().meta(control()),
});

export const trip = form(
  object({
    contact: person,
    emergencyContact: person,
    destination: field<string>().meta(control()),
    departDate: field<string>().meta(control()),
    returnDate: field<string>().meta(control()),
    nights: field<number | undefined>(),
    travelers: array(
      object({
        name: field<string>().meta(control()),
        birthDate: field<string>().meta(control()),
        passport: field<string>().meta(control()),
        isAdult: field<boolean>(),
      }),
      { create: () => ({ name: "", birthDate: "", passport: "", isAdult: true }) }
    ),
    seats: field<number>().meta(control(), {
      seatsLeft: metaKey<number | undefined>(undefined, { keepOnReset: true }),
    }),
    pricePerNight: field<number>(),
    price: field<number | undefined>(),
    budget: field<number | undefined>(),
    total: field<number | undefined>().meta(control()),
    visa: object({
      number: field<string>().meta(control()),
      expires: field<string>().meta(control()),
    }).meta({ visible }),
    promo: field<string>().meta(control(), { disabled }),
    voucher: field<string>().meta(control(), { disabled }),
  }).meta(submission())
);
export type Trip = InferValue<typeof trip>;
export const T = trip.travelers.item;

// ---------------------------------------------------------------------------
// Helpers
export const DAY = 86_400_000;
export const nightsBetween = (from: string, to: string) =>
  from && to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY)) : undefined;
export const isAdultOn = (birth: string, on: string) =>
  !birth || !on || (Date.parse(on) - Date.parse(birth)) / (365.25 * DAY) >= 18;
export const needsVisa = (country: string) => ["IN", "CN", "BR"].includes(country);

/** The passport service: "X0000000" is reported lost. */
export async function checkPassport(value: string) {
  await new Promise((r) => setTimeout(r, 1));
  return value === "X0000000" ? "This passport is reported lost" : undefined;
}

/** target = fn(...sources), recalculated when a source changes. */
function calculate<N extends AnyNode, const Rs extends readonly AnyRef[]>(
  target: N,
  sources: Rs,
  fn: (...values: { -readonly [K in keyof Rs]: RefValue<Rs[K]> }) => InferValue<N>
) {
  return defineBehavior({
    name: `calculate(${target.path})`,
    triggers: sources,
    writes: [target],
    run: (ctx) => ctx.set(target, fn(...(sources.map((r) => ctx.get(r)) as any))),
  });
}

/** The trip's logic. `runs` counts how often each calculation ran. */
export function tripBehaviors(runs: Record<string, number> = {}) {
  const count = (k: string) => (runs[k] = (runs[k] ?? 0) + 1);
  return defineBehaviors(trip, (b, t) => {
    b.add(required(t.contact.name), required(t.contact.email), email(t.contact.email));
    b.add(required(t.destination), required(t.departDate), required(t.returnDate));

    b.each(t.travelers, (b, p) => {
      b.add(required(p.name), required(p.passport));
      b.add(pattern(p.passport, /^[A-Z0-9]{8}$/, { message: "8 letters or digits" }));
      b.add(asyncRule(p.passport, checkPassport));
      b.add(calculate(p.isAdult, [p.birthDate, t.departDate], (birth, dep) => (count("isAdult"), isAdultOn(birth, dep))));
    });

    b.add(calculate(t.nights, [t.departDate, t.returnDate], (a, z) => (count("nights"), nightsBetween(a, z))));
    b.add(calculate(t.price, [t.nights, t.pricePerNight, t.travelers], (n, ppn, ts) =>
      (count("price"), n === undefined ? undefined : n * ppn * ts.length)));
    b.add(calculate(t.total, [t.price], (p) => (count("total"), p)));
    b.add(max(t.total, t.budget, { message: "Over budget" }));

    b.add(calculate(t.seats, [t.travelers], (ts) => ts.length));
    b.add(max(t.seats, t.seats.seatsLeft, { message: "Not enough seats left" }));

    // The visa section is shown for some destinations, and reset to its initial value while hidden.
    const visaInitial = initialOf(t.visa);
    b.add(defineBehavior({
      name: "visa.visible",
      triggers: [t.destination],
      writes: [t.visa.visible],
      run: (ctx) => ctx.set(t.visa.visible, needsVisa(ctx.get(t.destination))),
    }));
    b.add(defineBehavior({
      name: "visa cleared while hidden",
      triggers: [t.visa.visible, t.visa],
      reads: [visaInitial],
      writes: [t.visa],
      run(ctx) {
        if (ctx.get(t.visa.visible) || Object.is(ctx.get(t.visa), ctx.get(visaInitial))) return;
        ctx.set(t.visa, ctx.get(visaInitial));
      },
    }));
    b.add(required(t.visa.number), required(t.visa.expires));

    // At most one of promo and voucher: filling one disables the other; both filled is an error on each.
    b.add(defineBehavior({
      name: "promo or voucher",
      triggers: [t.promo, t.voucher],
      writes: [t.promo.disabled, t.voucher.disabled],
      run(ctx) {
        const promo = ctx.get(t.promo) !== "", voucher = ctx.get(t.voucher) !== "";
        ctx.set(t.promo.disabled, voucher && !promo);
        ctx.set(t.voucher.disabled, promo && !voucher);
      },
    }));
    for (const [self, other] of [[t.promo, t.voucher], [t.voucher, t.promo]] as const) {
      b.add(rule(self, (v, ctx) => (v !== "" && ctx.get(other) !== "" ? "Only one of promo, voucher can be set" : undefined), {
        name: `only one:${self.path}`,
        triggers: [other],
      }));
    }
  });
}

export const emptyPerson = () => ({ name: "", email: "" });
export function emptyTrip(): Trip {
  return {
    contact: emptyPerson(), emergencyContact: emptyPerson(),
    destination: "", departDate: "", returnDate: "", nights: undefined,
    travelers: [], seats: 0, pricePerNight: 100, price: undefined, budget: undefined, total: undefined,
    visa: { number: "", expires: "" }, promo: "", voucher: "",
  };
}
export function savedBooking(): Trip {
  return {
    ...emptyTrip(),
    contact: { name: "Ada", email: "ada@example.com" },
    destination: "DE", departDate: "2026-10-01", returnDate: "2026-10-08",
    // a saved booking stores its calculated values too, consistent with its data
    nights: 7, seats: 2, price: 1400, total: 1400,
    travelers: [
      { name: "Ada", birthDate: "1990-01-01", passport: "X0000000", isAdult: true },
      { name: "Tim", birthDate: "2015-05-05", passport: "", isAdult: false },
    ],
  };
}
export const quiet = { onError: () => {} };
