// ============================================================
// Integration: one realistic form exercising the layers together.
// A trip booking: a reused `person` block, traveler rows with a per-row
// computed flag, a calculated pricing chain with a budget rule, a seat
// count limited by a value synced from outside, a visa section shown for
// some destinations, and promo code / voucher exclusivity.
// ============================================================

import {
  form, object, array, field, metaKey, createStore, countIn,
  control, visibility, disableable, submission,
  defineBehaviors, asyncRule, required, email, pattern, max,
  calculate, visibleWhen, clearWhenHidden, exclusive,
  type InferValue,
} from "./index";
import { it, expect } from "vitest";

const person = object({
  name: field<string>().meta(control()),
  email: field<string>().meta(control()),
});

const trip = form(
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
type Trip = InferValue<typeof trip>;
const T = trip.travelers.item;

// ---------------------------------------------------------------------------
// Helpers
const DAY = 86_400_000;
const nightsBetween = (from: string, to: string) =>
  from && to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY)) : undefined;
const isAdultOn = (birth: string, on: string) =>
  !birth || !on || (Date.parse(on) - Date.parse(birth)) / (365.25 * DAY) >= 18;
const needsVisa = (country: string) => ["IN", "CN", "BR"].includes(country);

/** The passport service: "X0000000" is reported lost. */
async function checkPassport(value: string) {
  await new Promise((r) => setTimeout(r, 1));
  return value === "X0000000" ? "This passport is reported lost" : undefined;
}

/** The trip's logic. `runs` counts how often each calculation ran. */
function tripBehaviors(runs: Record<string, number> = {}) {
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

const emptyPerson = () => ({ name: "", email: "" });
function emptyTrip(): Trip {
  return {
    contact: emptyPerson(), emergencyContact: emptyPerson(),
    destination: "", departDate: "", returnDate: "", nights: undefined,
    travelers: [], seats: 0, pricePerNight: 100, price: undefined, budget: undefined, total: undefined,
    visa: { number: "", expires: "" }, promo: "", voucher: "",
  };
}
function savedBooking(): Trip {
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
const quiet = { onError: () => {} };

// ---------------------------------------------------------------------------
// INT1
it("INT1 loading a saved booking: clean, sync errors present, async checks deferred to validate()", async () => {
  const s = createStore(trip, emptyTrip(), { behaviors: tripBehaviors(), ...quiet });
  s.setValues(savedBooking(), { as: "initial" });
  const [ada, tim] = s.substore(trip.travelers).items();

  expect(s.get(countIn(trip, "dirty")), "loaded data is the baseline").toBe(0);
  expect(s.get(countIn(trip, "touched"))).toBe(0);
  expect(s.get(trip.nights), "calculations ran on the loaded data").toBe(7);
  expect(tim.get(T.passport.error), "sync rules ran on load").toBe("Required");
  expect(ada.get(T.passport.error), "async rules don't run on load").toBe(undefined);
  expect(ada.get(T.passport.validating)).toBe(false);

  const result = await s.validate();
  expect(result.valid).toBe(false);
  expect(result.errors.map((e) => [e.path, e.error])).toEqual([
    ["travelers[0].passport", "This passport is reported lost"],
    ["travelers[1].passport", "Required"],
  ]);
});

// ---------------------------------------------------------------------------
// INT2
it("INT2 one user edit runs the pricing chain once each, in order, and the budget rule sees the final total", () => {
  const runs: Record<string, number> = {};
  const s = createStore(trip, savedBooking(), { behaviors: tripBehaviors(runs), ...quiet });
  s.set(trip.budget, 1500);
  expect(s.get(trip.total)).toBe(7 * 100 * 2);
  expect(s.get(trip.total.error)).toBe(undefined);
  for (const k of Object.keys(runs)) delete runs[k];

  const seen: (number | undefined)[] = [];
  s.subscribe(trip.total.error, () => seen.push(s.get(trip.total)));
  s.set(trip.returnDate, "2026-10-11", { origin: "user" });

  expect(runs, "each calculation ran exactly once").toEqual({ nights: 1, price: 1, total: 1 });
  expect(s.get(trip.nights)).toBe(10);
  expect(s.get(trip.total)).toBe(10 * 100 * 2);
  expect(s.get(trip.total.error)).toBe("Over budget");
  expect(seen, "the UI saw the error once, with the final total").toEqual([2000]);
  expect(s.get(trip.returnDate.touched)).toBe(true);
});

// ---------------------------------------------------------------------------
// INT3
it("INT3 the visa section: shown and required for some destinations, cleared and omitted when hidden", async () => {
  const s = createStore(trip, savedBooking(), { behaviors: tripBehaviors(), ...quiet });
  expect(s.get(trip.visa.visible)).toBe(false);
  expect(s.get(trip.visa.number.error), "hidden: not validated").toBe(undefined);

  s.set(trip.destination, "IN", { origin: "user" });
  expect(s.get(trip.visa.visible)).toBe(true);
  expect(s.get(trip.visa.number.error)).toBe("Required");
  s.set(trip.visa.number, "V123", { origin: "user" });
  s.set(trip.visa.expires, "2030-01-01", { origin: "user" });
  expect(s.get(trip.visa.number.error)).toBe(undefined);

  s.set(trip.destination, "DE", { origin: "user" });
  expect(s.get(trip.visa.visible)).toBe(false);
  expect(s.get(trip.visa), "cleared back to its initial value").toEqual({ number: "", expires: "" });
  expect(s.get(trip.visa.number.error)).toBe(undefined);
  const r = await s.validate();
  expect("visa" in r.values, "omitted from the submitted values").toBe(false);

  s.set(trip.destination, "IN", { origin: "user" });
  expect(s.get(trip.visa.number.error), "required again, since the values were cleared").toBe("Required");
});

// ---------------------------------------------------------------------------
// INT4
it("INT4 traveler rows: append, edit, remove, undo keep identity, per-row meta and counts", () => {
  const s = createStore(trip, savedBooking(), { behaviors: tripBehaviors(), ...quiet });
  const travelers = s.substore(trip.travelers);
  const [ada, tim] = travelers.items();
  const ids = travelers.items().map((r) => r.stableId);
  expect(tim.get(T.isAdult)).toBe(false);
  expect(s.get(trip.seats)).toBe(2);

  // A new row is computed before any UI listener sees it.
  const seenAtNotification: boolean[] = [];
  const offItems = travelers.subscribeItems(() => {
    const newest = travelers.items().at(-1)!;
    seenAtNotification.push(newest.get(T.isAdult));
  });
  const zoe = travelers.append({ name: "Zoe", birthDate: "2012-01-01" });
  offItems();
  expect(seenAtNotification, "isAdult was computed before the UI was told").toEqual([false]);
  expect(zoe.get(T.name.dirty), "a new row is unsaved data").toBe(true);
  expect(s.get(trip.seats)).toBe(3);

  // Editing a middle row keeps its store, id and meta.
  tim.set(T.passport, "ab", { origin: "user" });
  expect(travelers.items()[1]).toBe(tim);
  expect(tim.get(T.passport.error)).toBe("8 letters or digits");
  expect(tim.get(T.passport.touched)).toBe(true);
  expect(ada.get(T.passport.touched), "other rows untouched").toBe(false);
  const errorsBefore = s.get(countIn(trip, "error"));

  // Removing the first row detaches it and takes its errors out of the counts.
  const before = s.get(trip.travelers);
  travelers.remove(ada);
  expect(ada.isAttached()).toBe(false);
  expect(travelers.items()).toEqual([tim, zoe]);
  expect(s.get(trip.seats)).toBe(2);

  // Undo: the same objects come back with their stores and meta.
  s.set(trip.travelers, before);
  expect(ada.isAttached()).toBe(true);
  expect(travelers.items()).toEqual([ada, tim, zoe]);
  expect(travelers.items().map((r) => r.stableId).slice(0, 2)).toEqual(ids);
  expect(tim.get(T.passport.error), "meta survived").toBe("8 letters or digits");
  expect(s.get(countIn(trip, "error"))).toBe(errorsBefore);
});

// ---------------------------------------------------------------------------
// INT5
it("INT5 a limit synced from outside: error while exceeded; reset keeps the limit and recomputes", () => {
  const s = createStore(trip, savedBooking(), { behaviors: tripBehaviors(), ...quiet });
  expect(s.get(trip.seats.error), "no limit yet").toBe(undefined);

  s.set(trip.seats.seatsLeft, 1); // e.g. written by useSync from a flight query
  expect(s.get(trip.seats.error)).toBe("Not enough seats left");

  s.substore(trip.travelers).append({ name: "Zoe" });
  s.set(trip.seats.seatsLeft, 5);
  expect(s.get(trip.seats.error)).toBe(undefined);
  s.set(trip.seats.seatsLeft, 2);
  expect(s.get(trip.seats.error)).toBe("Not enough seats left");

  s.reset(); // back to the two loaded travelers
  expect(s.get(trip.seats.seatsLeft), "keepOnReset").toBe(2);
  expect(s.get(trip.seats)).toBe(2);
  expect(s.get(trip.seats.error), "recomputed from the reset values and the kept limit").toBe(undefined);
  s.set(trip.seats.seatsLeft, 1);
  expect(s.get(trip.seats.error)).toBe("Not enough seats left");
  s.reset();
  expect(s.get(trip.seats.error), "still exceeded after reset: the error is recomputed, not just cleared").toBe(
    "Not enough seats left"
  );
});
