// ------------------------------------------------------------
// Stage 10 — A custom behavior.
// Picking a departure while the return is empty should suggest
// a sensible return: departure + a week. Nothing built-in does
// this, so we write a behavior — the same primitive every
// helper so far (required, calculate, visibleWhen) is made of.
// ------------------------------------------------------------

import { useState } from "react";
import {
  form, object, field, type InferValue, array, control, submission, visibility,
  defineBehaviors, defineBehavior, required, minLength, calculate,
  visibleWhen, clearWhen,
} from "form-lib";
import { StoreProvider, useForm, useArray, useValue } from "form-lib/react";
import { TextField, NumberField, CheckboxField, ReadonlyRow, ResultCard, SubmitButton } from "../../ui";

const DAY_MS = 86_400_000;

/** ISO date (YYYY-MM-DD) shifted by `days`. */
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);
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
  car: { license: "", licenseExpiry: "" },
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
  b.add(clearWhen(s.car, [s.car.visible], (visible) => !visible));
  b.add(required(s.car.license), minLength(s.car.license, 3));
  b.add(required(s.car.licenseExpiry));
  b.each(s.travelers, (b, t) => {
    b.add(required(t.name));
  });

  // Suggest a one-week trip: picking the departure while the
  // return is empty fills it seven days later. A behavior says
  // WHICH writes it watches (triggers), WHAT it may write
  // (writes), WHO causes it (origins: user edits, not loads)
  // and WHEN (never on init).
  b.add(
    defineBehavior({
      name: "suggestReturnDate",
      triggers: [s.startDate, s.endDate],
      writes: [s.endDate],
      origins: ["user"],
      runOn: { init: false },
      run: (ctx) => {
        const start = ctx.get(s.startDate);
        const end = ctx.get(s.endDate);
        if (ctx.changed(s.startDate) && start !== "" && end === "") {
          ctx.set(s.endDate, addDays(start, 7));
        }
      },
    }),
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
