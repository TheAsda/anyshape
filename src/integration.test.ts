// ============================================================
// Integration: one realistic form exercising the layers together.
// The trip booking lives in ./test/trip.ts (shared with the React suite).
// ============================================================

import { createStore, countIn } from "./index";
import { trip, T, tripBehaviors, emptyTrip, savedBooking, quiet } from "./test/trip";
import { test, expect } from "vitest";

// ---------------------------------------------------------------------------
// INT1
test("INT1 loading a saved booking: clean, sync errors present, async checks deferred to validate()", async () => {
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
test("INT2 one user edit runs the pricing chain once each, in order, and the budget rule sees the final total", () => {
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
test("INT3 the visa section: shown and required for some destinations, cleared when hidden", () => {
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

  s.set(trip.destination, "IN", { origin: "user" });
  expect(s.get(trip.visa.number.error), "required again, since the values were cleared").toBe("Required");
});

// ---------------------------------------------------------------------------
// INT4
test("INT4 traveler rows: append, edit, remove, undo keep identity, per-row meta and counts", () => {
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
test("INT5 a limit synced from outside: error while exceeded; reset keeps the limit and recomputes", () => {
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

// ---------------------------------------------------------------------------
// INT6
test("INT6 loaded data with both promo and voucher: both enabled and in error until one is cleared", () => {
  const s = createStore(trip, { ...savedBooking(), promo: "SUMMER", voucher: "V-100" }, { behaviors: tripBehaviors(), ...quiet });
  expect([s.get(trip.promo.disabled), s.get(trip.voucher.disabled)]).toEqual([false, false]);
  expect(s.get(trip.promo.error)).toBe("Only one of promo, voucher can be set");
  expect(s.get(trip.voucher.error)).toBe("Only one of promo, voucher can be set");

  s.set(trip.promo, "", { origin: "user" });
  expect([s.get(trip.promo.disabled), s.get(trip.voucher.disabled)]).toEqual([true, false]);
  expect([s.get(trip.promo.error), s.get(trip.voucher.error)]).toEqual([undefined, undefined]);
});

// ---------------------------------------------------------------------------
// INT7
test("INT7 validate() waits for passport checks; a server rejection is mapped onto its row", async () => {
  const s = createStore(trip, savedBooking(), { behaviors: tripBehaviors(), ...quiet });
  const [ada, tim] = s.substore(trip.travelers).items();
  tim.set(T.passport, "AB123456", { origin: "user" });

  const first = await s.validate();
  expect(first.valid, "the async check ran and failed").toBe(false);
  expect(first.errors.map((e) => [e.path, e.error])).toEqual([["travelers[0].passport", "This passport is reported lost"]]);
  expect(first.errors[0].store).toBe(ada);

  ada.set(T.passport, "CD123456", { origin: "user" });
  expect((await s.validate()).valid).toBe(true);

  const rejected = { "travelers[1].passport": "Already booked on this trip" };
  for (const [path, message] of Object.entries(rejected)) {
    const target = s.resolvePath(`${path}#error`)!;
    target.store.set(target.ref as never, message as never);
  }
  expect(tim.get(T.passport.error), "mapped onto the second traveler").toBe("Already booked on this trip");
  expect(ada.get(T.passport.error)).toBe(undefined);
  expect(s.get(countIn(trip, "error"))).toBe(1);
});

// ---------------------------------------------------------------------------
// INT8
test("INT8 validating a step section: only its errors, each with the error's ref", async () => {
  const s = createStore(trip, emptyTrip(), { behaviors: tripBehaviors(), ...quiet });
  const step = s.substore(trip.contact);

  const r = await step.validate();
  expect(r.valid).toBe(false);
  expect(r.errors.map((e) => e.path)).toEqual(["contact.name", "contact.email"]);
  expect(r.errors.map((e) => e.ref)).toEqual([trip.contact.name.error, trip.contact.email.error]);
  expect(r.errors[0].store.get(r.errors[0].ref)).toBe("Required");
  expect(s.get(trip.destination.error), "errors elsewhere exist but are not the step's").toBe("Required");
  expect("values" in r, "submitted values are the store's value, not part of the result").toBe(false);

  s.set(trip.contact.name, "Ada", { origin: "user" });
  s.set(trip.contact.email, "ada@example.com", { origin: "user" });
  expect((await step.validate()).valid).toBe(true);
});
