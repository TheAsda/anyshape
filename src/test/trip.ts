// ============================================================
// The trip booking used by the integration suites (core and React).
// A reused `person` block, traveler rows with a per-row computed flag, a
// calculated pricing chain with a budget rule, a seat count limited by a
// value synced from outside, a visa section shown for some destinations,
// and promo code / voucher exclusivity.
// ============================================================

import {
  form, object, array, field, metaKey,
  control, visibility, disableable, submission,
  defineBehaviors, asyncRule, required, email, pattern, max,
  calculate, visibleWhen, clearWhenHidden, exclusive,
  type InferValue,
} from "../index";

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
    }).meta(visibility()),
    promo: field<string>().meta(control(), disableable()),
    voucher: field<string>().meta(control(), disableable()),
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

    b.add(visibleWhen(t.visa, [t.destination], needsVisa));
    b.add(clearWhenHidden(t.visa));
    b.add(required(t.visa.number), required(t.visa.expires));

    b.add(exclusive([t.promo, t.voucher]));
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
