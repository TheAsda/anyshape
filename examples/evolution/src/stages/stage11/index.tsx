// ------------------------------------------------------------
// Stage 11 — Extract and reuse.
// The rental car needs its own date pair (pickup / dropoff) —
// same structure as the trip dates, same autofill behavior,
// just a shorter gap. Instead of duplicating the inline
// behavior from the previous stage, we extract it into a
// function that takes the nodes and the gap, and apply it to
// both pairs.
// ------------------------------------------------------------

import { useState } from "react";
import {
  form, object, field, type InferValue, array, control, submission, visibility,
  defineBehaviors, defineBehavior, required, minLength, calculate,
  visibleWhen, clearWhen, type FieldNode,
} from "form-lib";
import { StoreProvider, useForm, useArray, useValue } from "form-lib/react";
import { TextField, NumberField, CheckboxField, ReadonlyRow, ResultCard, SubmitButton } from "../../ui";

const DAY_MS = 86_400_000;

/** ISO date (YYYY-MM-DD) shifted by `days`. */
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The extracted behavior: a date pair where picking one end
 * while the other is empty fills it `shiftDays` later. The
 * nodes are parameters — the same function works for any pair
 * and any gap. */
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

const shape = form(
  object({
    destination: field<string>().meta(control()),
    startDate: field<string>().meta(control()),
    endDate: field<string>().meta(control()),
    nightlyRate: field<number | undefined>().meta(control()),
    notes: field<string>().meta(control()),
    nights: field<number | undefined>(),
    estimatedBudget: field<number | undefined>(),
    rentingCar: field<boolean>().meta(control()),
    car: object({
      license: field<string>().meta(control()),
      licenseExpiry: field<string>().meta(control()),
      pickupOn: field<string>().meta(control()),
      dropoffOn: field<string>().meta(control()),
    }).meta(visibility()),
    travelers: array(
      object({
        name: field<string>().meta(control()),
        passport: field<string>().meta(control()),
      }),
      { create: () => ({ name: "", passport: "" }) },
    ),
  }).meta(submission()),
);

const initialValues: InferValue<typeof shape> = {
  destination: "",
  startDate: "",
  endDate: "",
  nightlyRate: undefined,
  notes: "",
  nights: undefined,
  estimatedBudget: undefined,
  rentingCar: false,
  car: { license: "", licenseExpiry: "", pickupOn: "", dropoffOn: "" },
  travelers: [],
};

export const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(required(s.destination), minLength(s.destination, 2));
  b.add(required(s.startDate));
  b.add(required(s.endDate));
  b.add(calculate(s.nights, [s.startDate, s.endDate], (start, end) =>
    start !== "" && end !== ""
      ? Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS)
      : undefined,
  ));
  b.add(calculate(
    s.estimatedBudget,
    [s.nights, s.nightlyRate, s.travelers],
    (nights, rate, travelers) =>
      nights !== undefined && rate !== undefined && nights >= 0
        ? Math.round(nights * rate * travelers.length * 100) / 100
        : undefined,
  ));
  b.add(visibleWhen(s.car, [s.rentingCar], (renting) => renting));
  // One writer per field: clearWhen(car, …) would claim the
  // dates too and the store rejects two owners — so the clearing
  // is scoped to the license fields, and twoDates owns the pair.
  // Hidden date values linger in the form; they are never
  // submitted, because hidden fields are stripped.
  const hidden = (visible: boolean) => !visible;
  b.add(clearWhen(s.car.license, [s.car.visible], hidden), clearWhen(s.car.licenseExpiry, [s.car.visible], hidden));
  b.add(required(s.car.license), minLength(s.car.license, 3));
  b.add(required(s.car.licenseExpiry));
  b.each(s.travelers, (b, t) => {
    b.add(required(t.name));
  });

  // One factory, two pairs: the trip suggests a week, the
  // rental suggests a long weekend. The gap is data.
  b.add(
    twoDates(s.startDate, s.endDate, 7),
    twoDates(s.car.pickupOn, s.car.dropoffOn, 3),
  );
});

function Derived() {
  const nights = useValue(shape.nights);
  const budget = useValue(shape.estimatedBudget);
  return (
    <div className="field-group">
      <ReadonlyRow label="Nights" value={nights === undefined ? "—" : String(nights)} />
      <ReadonlyRow
        label="Estimated budget"
        value={budget === undefined ? "—" : `€${budget.toFixed(2)}`}
      />
    </div>
  );
}

function CarGroup() {
  const visible = useValue(shape.car.visible);
  if (!visible) return null;
  return (
    <fieldset className="field-group">
      <legend>Car</legend>
      <TextField node={shape.car.license} label="Driver's license number" placeholder="B 1234 5678" />
      <TextField node={shape.car.licenseExpiry} label="License valid until" type="date" />
      <TextField node={shape.car.pickupOn} label="Pick up on" type="date" />
      <TextField node={shape.car.dropoffOn} label="Drop off on" type="date" />
    </fieldset>
  );
}

// The row template: the same node drives every row; the row
// store it renders with tells them apart.
const traveler = shape.travelers.item;

function Travelers() {
  const { items, append, remove } = useArray(shape.travelers);
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

export function Stage() {
  const form = useForm(shape, initialValues, { behaviors });
  const [submitted, setSubmitted] = useState<object | null>(null);
  return (
    <StoreProvider store={form}>
      <form
        className="stage-form"
        onSubmit={form.handleSubmit((values) => setSubmitted(values))}
      >
        <TextField node={shape.destination} label="Destination" placeholder="Lisbon" />
        <TextField node={shape.startDate} label="Departure" type="date" />
        <TextField node={shape.endDate} label="Return" type="date" />
        <NumberField node={shape.nightlyRate} label="Budget per night (€)" placeholder="80" />
        <TextField node={shape.notes} label="Notes" />
        <Derived />
        <Travelers />
        <CheckboxField node={shape.rentingCar} label="Renting a car" />
        <CarGroup />
        <SubmitButton label="Plan it" />
      </form>
      {submitted && <ResultCard title="The server receives:" values={submitted} />}
    </StoreProvider>
  );
}
