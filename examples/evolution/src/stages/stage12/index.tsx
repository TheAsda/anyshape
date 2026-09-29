// ------------------------------------------------------------
// Stage 12 — Async rules, cross-field rules, and the server.
// The finale: the return date is validated against the
// departure (a rule that READS another field), the destination
// is checked against a restricted list asynchronously
// (debounced), and the server rejects with field errors
// addressed by path — mapped back onto fields with
// resolvePath. The date pairs carry the twoDates behavior
// extracted in stage 11.
// ------------------------------------------------------------

import { useState } from "react";
import {
  form, object, field, type InferValue, array, control, submission, visibility,
  defineBehaviors, defineBehavior, required, minLength, calculate, rule, asyncRule,
  visibleWhen, clearWhenHidden, type FieldNode,
} from "form-lib";
import { StoreProvider, useForm, useArray, useValue } from "form-lib/react";
import { TextField, NumberField, CheckboxField, ReadonlyRow, ResultCard, SubmitButton } from "../../ui";

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

const RESTRICTED = new Set(["antarctica", "north korea", "mars"]);

/** Pretend server round-trip for the async rule. */
async function checkDestination(value: string): Promise<string | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return RESTRICTED.has(value.trim().toLowerCase())
    ? "We don't book trips to there (yet)"
    : undefined;
}

/** A server-side rejection: field errors addressed by path, as the server sees them. */
class ServerRejection extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super("The server rejected this trip.");
  }
}

/** Pretend to save; the demo dates are fully booked there. */
async function save(values: { startDate: string }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (values.startDate === "2026-07-10") {
    throw new ServerRejection({
      startDate: "Fully booked for these dates – shift by a day",
    });
  }
}

export const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(required(s.destination), minLength(s.destination, 2));
  // Async errors are just rules; sync ones pass first, then this runs debounced.
  b.add(asyncRule(s.destination, checkDestination, { debounce: 400 }));
  b.add(required(s.startDate));
  b.add(required(s.endDate));
  // Cross-field: re-validated whenever the START date changes, too.
  b.add(
    rule(
      s.endDate,
      (end, ctx) => {
        const start = ctx.get(s.startDate);
        return end !== "" && start !== "" && end <= start
          ? "The return must be after the departure"
          : undefined;
      },
      { triggers: [s.startDate] },
    ),
  );
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
  // One writer per field: the clearing is scoped to the license
  // fields; twoDates owns the date pair (see stage 11).
  b.add(clearWhenHidden(s.car.license), clearWhenHidden(s.car.licenseExpiry));
  b.add(required(s.car.license), minLength(s.car.license, 3));
  b.add(required(s.car.licenseExpiry));
  b.each(s.travelers, (b, t) => {
    b.add(required(t.name));
  });
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
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await save(values);
            setSubmitted(values);
          } catch (e) {
            if (e instanceof ServerRejection) {
              // Plant each server error onto its field, by path.
              for (const [path, message] of Object.entries(e.fieldErrors)) {
                const target = form.resolvePath(`${path}#error`);
                if (target) target.store.set(target.ref, message);
              }
            }
          }
        })}
      >
        <TextField node={shape.destination} label="Destination" placeholder="Lisbon (try antarctica)" />
        <TextField node={shape.startDate} label="Departure" type="date" />
        <TextField node={shape.endDate} label="Return" type="date" />
        <NumberField node={shape.nightlyRate} label="Budget per night (€)" placeholder="80" />
        <TextField node={shape.notes} label="Notes" />
        <Derived />
        <Travelers />
        <CheckboxField node={shape.rentingCar} label="Renting a car" />
        <CarGroup />
        <SubmitButton label="Book it" />
      </form>
      {submitted && <ResultCard title="Booked! The server received:" values={submitted} />}
    </StoreProvider>
  );
}
