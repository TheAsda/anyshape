// ------------------------------------------------------------
// Stage 7 — Exclusive fields.
// One discount per booking: exactly one of the loyalty number
// or the promo code may be filled. Fill one, and the others
// disable themselves so the mistake can't happen; clear it
// and they come back.
// ------------------------------------------------------------

import { useState } from "react";
import {
  form, object, field, type InferValue, control, submission, visibility,
  defineBehaviors, required, minLength, calculate,
  visibleWhen, clearWhen, disableable, disableWhen, exclusive,
} from "form-lib";
import { StoreProvider, useForm, useValue } from "form-lib/react";
import { TextField, NumberField, CheckboxField, ReadonlyRow, ResultCard, SubmitButton } from "../../ui";

const DAY_MS = 86_400_000;

const shape = form(
  object({
    destination: field<string>().meta(control()),
    startDate: field<string>().meta(control()),
    endDate: field<string>().meta(control()),
    nightlyRate: field<number | undefined>().meta(control(), disableable()),
    employerPays: field<boolean>().meta(control()),
    loyaltyNumber: field<string>().meta(control(), disableable()),
    promoCode: field<string>().meta(control(), disableable()),
    notes: field<string>().meta(control()),
    nights: field<number | undefined>(),
    estimatedBudget: field<number | undefined>(),
    rentingCar: field<boolean>().meta(control()),
    car: object({
      license: field<string>().meta(control()),
      licenseExpiry: field<string>().meta(control()),
    }).meta(visibility()),
  }).meta(submission()),
);

const initialValues: InferValue<typeof shape> = {
  destination: "",
  startDate: "",
  endDate: "",
  nightlyRate: undefined,
  employerPays: false,
  loyaltyNumber: "",
  promoCode: "",
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
  b.add(disableWhen(s.nightlyRate, [s.employerPays], (pays) => pays));
  // Exactly one of the two discount fields must be filled.
  b.add(
    ...exclusive([s.loyaltyNumber, s.promoCode], {
      required: true,
      message: {
        tooMany: "Only one discount can be applied",
        missing: "Pick one: loyalty number or promo code",
      },
    }),
  );
  b.add(calculate(s.nights, [s.startDate, s.endDate], (start, end) =>
    start !== "" && end !== ""
      ? Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS)
      : undefined,
  ));
  b.add(calculate(s.estimatedBudget, [s.nights, s.nightlyRate], (nights, rate) =>
    nights !== undefined && rate !== undefined && nights >= 0
      ? Math.round(nights * rate * 100) / 100
      : undefined,
  ));
  b.add(visibleWhen(s.car, [s.rentingCar], (renting) => renting));
  b.add(clearWhen(s.car, [s.car.visible], (visible) => !visible));
  b.add(required(s.car.license), minLength(s.car.license, 3));
  b.add(required(s.car.licenseExpiry));
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

function Discount() {
  // Reading the `disabled` keys so each half reacts to the other.
  const loyaltyLocked = useValue(shape.loyaltyNumber.disabled);
  const promoLocked = useValue(shape.promoCode.disabled);
  return (
    <fieldset className="field-group">
      <legend>Discount (pick exactly one)</legend>
      <TextField node={shape.loyaltyNumber} label="Loyalty number" placeholder="LX-123456" disabled={loyaltyLocked} />
      <TextField node={shape.promoCode} label="Promo code" placeholder="SUN2026" disabled={promoLocked} />
    </fieldset>
  );
}

export function Stage() {
  const form = useForm(shape, initialValues, { behaviors });
  const [submitted, setSubmitted] = useState<object | null>(null);
  const rateLocked = useValue(shape.nightlyRate.disabled, { store: form });
  return (
    <StoreProvider store={form}>
      <form
        className="stage-form"
        onSubmit={form.handleSubmit((values) => setSubmitted(values))}
      >
        <TextField node={shape.destination} label="Destination" placeholder="Lisbon" />
        <TextField node={shape.startDate} label="Departure" type="date" />
        <TextField node={shape.endDate} label="Return" type="date" />
        <NumberField node={shape.nightlyRate} label="Budget per night (€)" placeholder="80" disabled={rateLocked} />
        <CheckboxField node={shape.employerPays} label="Employer pays for lodging" />
        <Discount />
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
