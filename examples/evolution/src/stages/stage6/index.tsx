// ------------------------------------------------------------
// Stage 6 — Disabled.
// The employer covers the lodging: the nightly budget stays
// visible but locked. Like visibility, `disabled` is plain
// metadata: the locked rate is still submitted, and its VALUE
// stays in the store and keeps feeding derived state (watch the
// budget). A rule that should apply only while unlocked would be
// guarded on it, as the car rules are on visibility.
// ------------------------------------------------------------

import { form, object, field, type InferValue, defineBehaviors } from "anyshape";
import { StoreProvider, useForm, useValue } from "anyshape/react";
import { useState } from "react";

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
  disabled,
  disableWhen,
} from "../../../../../recipes";
import { TextField, NumberField, CheckboxField, ReadonlyRow, ResultCard, SubmitButton } from "../../ui";

const DAY_MS = 86_400_000;

const shape = form(
  object({
    destination: field<string>().meta(control()),
    startDate: field<string>().meta(control()),
    endDate: field<string>().meta(control()),
    // { disabled } adds the `disabled` key this field can now carry.
    nightlyRate: field<number | undefined>().meta(control(), { disabled }),
    employerPays: field<boolean>().meta(control()),
    notes: field<string>().meta(control()),
    nights: field<number | undefined>(),
    estimatedBudget: field<number | undefined>(),
    rentingCar: field<boolean>().meta(control()),
    car: object({
      license: field<string>().meta(control()),
      licenseExpiry: field<string>().meta(control()),
    }).meta({ visible }),
  }).meta(submission()),
);

const initialValues: InferValue<typeof shape> = {
  destination: "",
  startDate: "",
  endDate: "",
  nightlyRate: undefined,
  employerPays: false,
  notes: "",
  nights: undefined,
  estimatedBudget: undefined,
  rentingCar: false,
  car: { license: "", licenseExpiry: "" },
};

export const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(required(s.destination), minLength(s.destination, 2));
  b.add(required(s.startDate));
  b.add(required(s.endDate));
  // The rate locks while the employer pays; unlock by unchecking.
  b.add(disableWhen(s.nightlyRate, [s.employerPays], (pays) => pays));
  b.add(
    calculate(s.nights, [s.startDate, s.endDate], (start, end) =>
      start !== "" && end !== "" ? Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) : undefined,
    ),
  );
  b.add(
    calculate(s.estimatedBudget, [s.nights, s.nightlyRate], (nights, rate) =>
      nights !== undefined && rate !== undefined && nights >= 0 ? Math.round(nights * rate * 100) / 100 : undefined,
    ),
  );
  b.add(visibleWhen(s.car, [s.rentingCar], (renting) => renting));
  b.add(clearWhen(s.car, [s.car.visible], (visible) => !visible));
  // The car rules apply only while the group is shown.
  b.when(
    [s.car.visible],
    (v) => v,
    (b) => {
      b.add(required(s.car.license), minLength(s.car.license, 3));
      b.add(required(s.car.licenseExpiry));
    },
  );
});

function Derived() {
  const nights = useValue(shape.nights);
  const budget = useValue(shape.estimatedBudget);
  return (
    <div className="field-group">
      <ReadonlyRow label="Nights" value={nights === undefined ? "—" : String(nights)} />
      <ReadonlyRow label="Estimated budget" value={budget === undefined ? "—" : `€${budget.toFixed(2)}`} />
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

export function Stage() {
  const form = useForm(shape, initialValues, { behaviors });
  const [submitted, setSubmitted] = useState<object | null>(null);
  // `disabled` is ordinary metadata; outside the provider the store is passed explicitly.
  const rateLocked = useValue(shape.nightlyRate.disabled, { store: form });
  return (
    <StoreProvider store={form}>
      <form className="stage-form" onSubmit={handleSubmit(form, (values) => setSubmitted(values))}>
        <TextField node={shape.destination} label="Destination" placeholder="Lisbon" />
        <TextField node={shape.startDate} label="Departure" type="date" />
        <TextField node={shape.endDate} label="Return" type="date" />
        <NumberField node={shape.nightlyRate} label="Budget per night (€)" placeholder="80" disabled={rateLocked} />
        <CheckboxField node={shape.employerPays} label="Employer pays for lodging" />
        <TextField node={shape.notes} label="Notes" />
        <Derived />
        <CheckboxField node={shape.rentingCar} label="Renting a car" />
        <CarGroup />
        <SubmitButton label="Plan it" />
      </form>
      {submitted && <ResultCard title="The server receives:" values={submitted} />}
    </StoreProvider>
  );
}
