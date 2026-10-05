// ------------------------------------------------------------
// Stage 8 — Rules with guards.
// Stays longer than 30 nights need a justification. The notes
// field is ALWAYS visible — only its REQUIRED-ness toggles,
// live, as the dates change. A guard makes the rules inside
// it live only while its condition holds.
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
  exclusive,
} from "../../../../../recipes";
import { TextField, NumberField, CheckboxField, ReadonlyRow, ResultCard, SubmitButton } from "../../ui";

const DAY_MS = 86_400_000;

const shape = form(
  object({
    destination: field<string>().meta(control()),
    startDate: field<string>().meta(control()),
    endDate: field<string>().meta(control()),
    nightlyRate: field<number | undefined>().meta(control(), { disabled }),
    employerPays: field<boolean>().meta(control()),
    loyaltyNumber: field<string>().meta(control(), { disabled }),
    promoCode: field<string>().meta(control(), { disabled }),
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
  b.add(
    ...exclusive([s.loyaltyNumber, s.promoCode], {
      required: true,
      message: {
        tooMany: "Only one discount can be applied",
        missing: "Pick one: loyalty number or promo code",
      },
    }),
  );
  // The guard: while it holds, required(notes) is live. The
  // source is a COMPUTED value — dragging the return date
  // past 30 nights is enough to switch it on.
  b.when(
    [s.nights],
    (n) => n !== undefined && n > 30,
    (b) => {
      b.add(required(s.notes));
    },
  );
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

function Discount() {
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
      <form className="stage-form" onSubmit={handleSubmit(form, (values) => setSubmitted(values))}>
        <TextField node={shape.destination} label="Destination" placeholder="Lisbon" />
        <TextField node={shape.startDate} label="Departure" type="date" />
        <TextField node={shape.endDate} label="Return" type="date" />
        <NumberField node={shape.nightlyRate} label="Budget per night (€)" placeholder="80" disabled={rateLocked} />
        <CheckboxField node={shape.employerPays} label="Employer pays for lodging" />
        <Discount />
        <TextField node={shape.notes} label="Notes (required for stays over 30 nights)" />
        <Derived />
        <CheckboxField node={shape.rentingCar} label="Renting a car" />
        <CarGroup />
        <SubmitButton label="Plan it" />
      </form>
      {submitted && <ResultCard title="The server receives:" values={submitted} />}
    </StoreProvider>
  );
}
