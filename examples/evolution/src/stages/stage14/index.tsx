// ------------------------------------------------------------
// Stage 14 — Steps.
// The booking splits in two: the trip, then the extras. Each
// step is a section with submission(), so its Next button is
// handleSubmit(form.substore(step), fn): it reveals and
// validates that step only. The room type has no sensible
// default, so it STARTS EMPTY and its type says so:
// RoomType | undefined. { defined } makes it required, and
// Next's fn gets the CHECKED type: roomType is a RoomType there.
// ------------------------------------------------------------

import {
  form,
  object,
  field,
  type InferValue,
  type AnyNode,
  array,
  defineBehaviors,
  defineBehavior,
  countIn,
  pendingIn,
  type FieldNode,
} from "anyshape";
import { StoreProvider, useForm, useArray, useValue } from "anyshape/react";
import { useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import {
  control,
  submission,
  handleSubmit,
  visible,
  required,
  minLength,
  calculate,
  visibleWhen,
  clearWhen,
  rule,
  asyncRule,
  error,
  defined,
  focusFirst,
} from "../../../../../recipes";
import { TextField, NumberField, CheckboxField, SelectField, ReadonlyRow, ResultCard } from "../../ui";

const DAY_MS = 86_400_000;

/** ISO date (YYYY-MM-DD) shifted by `days`. */
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Extracted in stage 11: fill the empty end of a date pair. */
function twoDates(start: FieldNode<string>, end: FieldNode<string>, shiftDays: number) {
  return defineBehavior({
    name: `twoDates(${start.path}, +${shiftDays}d)`,
    triggers: [start, end],
    writes: [start, end],
    origins: ["user"],
    runOn: { init: false },
    run: (ctx) => {
      const from = ctx.get(start);
      const to = ctx.get(end);
      if (ctx.changed(start) && from !== "" && to === "") {
        ctx.set(end, addDays(from, shiftDays));
      }
    },
  });
}

type RoomType = "single" | "double" | "suite";

const ROOMS: Record<RoomType, string> = { single: "Single room", double: "Double room", suite: "Suite" };

const shape = form(
  object({
    // Step 1: the trip.
    trip: object({
      destination: field<string>().meta(control()),
      startDate: field<string>().meta(control()),
      endDate: field<string>().meta(control()),
      // Starts empty: nobody has chosen yet. { defined } requires a choice.
      roomType: field<RoomType | undefined>().meta(control(), { defined }),
      nightlyRate: field<number | undefined>().meta(control()),
      nights: field<number | undefined>(),
    }).meta(submission()),
    // Step 2: the extras.
    extras: object({
      rentingCar: field<boolean>().meta(control()),
      car: object({
        license: field<string>().meta(control()),
        licenseExpiry: field<string>().meta(control()),
        pickupOn: field<string>().meta(control()),
        dropoffOn: field<string>().meta(control()),
      }).meta({ visible }),
      travelers: array(
        object({
          name: field<string>().meta(control()),
          passport: field<string>().meta(control()),
        }),
        { create: () => ({ name: "", passport: "" }) },
      ),
      notes: field<string>().meta(control()),
      // Computed from the travelers too, so it lives with them on step 2.
      estimatedBudget: field<number | undefined>(),
    }).meta(submission()),
  }).meta(submission()),
);

const initialValues: InferValue<typeof shape> = {
  trip: {
    destination: "",
    startDate: "",
    endDate: "",
    roomType: undefined,
    nightlyRate: undefined,
    nights: undefined,
  },
  extras: {
    rentingCar: false,
    car: { license: "", licenseExpiry: "", pickupOn: "", dropoffOn: "" },
    travelers: [],
    notes: "",
    estimatedBudget: undefined,
  },
};

const RESTRICTED = new Set(["antarctica", "north korea", "mars"]);

/** Pretend server round-trip for the async rule. */
async function checkDestination(value: string): Promise<string | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return RESTRICTED.has(value.trim().toLowerCase()) ? "We don't book trips to there (yet)" : undefined;
}

/** A server-side rejection: field errors addressed by path, as the server sees them. */
class ServerRejection extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super("The server rejected this trip.");
  }
}

/** Pretend to save; the demo dates are fully booked there. */
async function save(values: { trip: { startDate: string } }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (values.trip.startDate === "2026-07-10") {
    throw new ServerRejection({
      "trip.startDate": "Fully booked for these dates – shift by a day",
    });
  }
}

export const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(required(s.trip.destination), minLength(s.trip.destination, 2));
  b.add(asyncRule(s.trip.destination, checkDestination, { debounce: 400 }));
  b.add(required(s.trip.startDate));
  b.add(required(s.trip.endDate));
  b.add(
    rule(
      s.trip.endDate,
      (end, ctx) => {
        const start = ctx.get(s.trip.startDate);
        return end !== "" && start !== "" && end <= start ? "The return must be after the departure" : undefined;
      },
      { triggers: [s.trip.startDate] },
    ),
  );
  b.add(
    calculate(s.trip.nights, [s.trip.startDate, s.trip.endDate], (start, end) =>
      start !== "" && end !== "" ? Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) : undefined,
    ),
  );
  b.add(
    calculate(
      s.extras.estimatedBudget,
      [s.trip.nights, s.trip.nightlyRate, s.extras.travelers],
      (nights, rate, travelers) =>
        nights !== undefined && rate !== undefined && nights >= 0
          ? Math.round(nights * rate * travelers.length * 100) / 100
          : undefined,
    ),
  );
  const car = s.extras.car;
  b.add(visibleWhen(car, [s.extras.rentingCar], (renting) => renting));
  const hidden = (visible: boolean) => !visible;
  b.add(clearWhen(car.license, [car.visible], hidden), clearWhen(car.licenseExpiry, [car.visible], hidden));
  // The car rules apply only while the group is shown.
  b.when(
    [car.visible],
    (v) => v,
    (b) => {
      b.add(required(car.license), minLength(car.license, 3));
      b.add(required(car.licenseExpiry));
    },
  );
  b.each(s.extras.travelers, (b, t) => {
    b.add(required(t.name));
  });
  b.add(twoDates(s.trip.startDate, s.trip.endDate, 7), twoDates(car.pickupOn, car.dropoffOn, 3));
});

function Derived() {
  const nights = useValue(shape.trip.nights);
  const budget = useValue(shape.extras.estimatedBudget);
  return (
    <div className="field-group">
      <ReadonlyRow label="Nights" value={nights === undefined ? "—" : String(nights)} />
      <ReadonlyRow label="Estimated budget" value={budget === undefined ? "—" : `€${budget.toFixed(2)}`} />
    </div>
  );
}

/** Step 2 reads the STORED type: the user can go back and clear the room type. */
function TripSummary() {
  const destination = useValue(shape.trip.destination);
  const roomType = useValue(shape.trip.roomType); // RoomType | undefined
  return <span>{roomType === undefined ? "No room chosen" : `${ROOMS[roomType]} in ${destination}`}</span>;
}

function CarGroup() {
  const car = shape.extras.car;
  const visible = useValue(car.visible);
  if (!visible) return null;
  return (
    <fieldset className="field-group">
      <legend>Car</legend>
      <TextField node={car.license} label="Driver's license number" placeholder="B 1234 5678" />
      <TextField node={car.licenseExpiry} label="License valid until" type="date" />
      <TextField node={car.pickupOn} label="Pick up on" type="date" />
      <TextField node={car.dropoffOn} label="Drop off on" type="date" />
    </fieldset>
  );
}

const traveler = shape.extras.travelers.item;

function Travelers() {
  const { items, append, remove } = useArray(shape.extras.travelers);
  return (
    <fieldset className="field-group">
      <legend>Travelers</legend>
      {items.map((row) => (
        <StoreProvider store={row} key={row.stableId}>
          <div className="row">
            <TextField node={traveler.name} label="Name" placeholder="Ada" />
            <TextField node={traveler.passport} label="Passport number" />
            <button type="button" className="button button--link" onClick={() => remove(row)}>
              Remove
            </button>
          </div>
        </StoreProvider>
      ))}
      <button type="button" className="button" onClick={() => append()}>
        Add traveler
      </button>
    </fieldset>
  );
}

/** Stage 13's status, counted over one section: the step, or the whole form. */
function StepSubmit({ section, label }: { section: AnyNode; label: string }) {
  const checking = useValue(pendingIn(section, error));
  const errors = useValue(countIn(section, error));
  return (
    <div className="smart-submit">
      {errors > 0 && (
        <span className="chip chip--error">
          {errors} field{errors === 1 ? "" : "s"} to fix
        </span>
      )}
      <button type="submit" className="button button--primary" disabled={checking > 0}>
        {checking > 0 ? `Checking… (${checking})` : label}
      </button>
    </div>
  );
}

export function Stage() {
  const form = useForm(shape, initialValues, { behaviors });
  const [step, setStep] = useState<1 | 2>(1);
  const [submitted, setSubmitted] = useState<object | null>(null);

  // Next submits step 1 alone. Its fn gets the trip's CHECKED type
  // (roomType: RoomType, no undefined); all it does is advance.
  const next = handleSubmit(form.substore(shape.trip), () => setStep(2));

  // Book submits the whole form, step 1 included.
  const submitAll = handleSubmit(form, async (values) => {
    try {
      await save(values);
      setSubmitted(values);
    } catch (e) {
      if (e instanceof ServerRejection) {
        // Plant each server error onto its field: resolve the
        // path to the field, then find its error key by definition.
        for (const [path, message] of Object.entries(e.fieldErrors)) {
          const t = form.resolvePath(path);
          const target = t && t.store.collect(t.ref, error).find((e) => e.ref.node === t.ref);
          if (target) target.store.set(target.ref, message);
        }
      }
    }
  });

  // An error on step 1, from the checks or the server, is out of sight
  // on step 2: go back, then focus the first one.
  const book = async (event: FormEvent) => {
    event.preventDefault();
    await submitAll();
    const tripErrors = form.collect(shape.trip, error).filter((e) => e.store.get(e.ref) !== undefined);
    if (tripErrors.length === 0) return;
    flushSync(() => setStep(1));
    focusFirst(tripErrors);
  };

  return (
    <StoreProvider store={form}>
      <form className="stage-form" onSubmit={step === 1 ? next : book}>
        {step === 1 ? (
          <>
            <TextField node={shape.trip.destination} label="Destination" placeholder="Lisbon (try antarctica)" />
            <TextField node={shape.trip.startDate} label="Departure" type="date" />
            <TextField node={shape.trip.endDate} label="Return" type="date" />
            <SelectField node={shape.trip.roomType} label="Room type" options={ROOMS} />
            <NumberField node={shape.trip.nightlyRate} label="Budget per night (€)" placeholder="80" />
            <StepSubmit section={shape.trip} label="Next →" />
          </>
        ) : (
          <>
            <div className="smart-submit">
              <TripSummary />
              <button type="button" className="button button--link" onClick={() => setStep(1)}>
                ← Back to the trip
              </button>
            </div>
            <Travelers />
            <CheckboxField node={shape.extras.rentingCar} label="Renting a car" />
            <CarGroup />
            <TextField node={shape.extras.notes} label="Notes" />
            <Derived />
            <StepSubmit section={shape} label="Book it" />
          </>
        )}
      </form>
      {submitted && <ResultCard title="Booked! The server received:" values={submitted} />}
    </StoreProvider>
  );
}
