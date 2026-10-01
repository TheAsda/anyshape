// ------------------------------------------------------------
// Stage 4 — Derived values.
// Nights and the estimated budget are declared as calculate()
// behaviors: they recompute whenever their sources change and
// can never drift out of sync. Nobody writes to them by hand.
// ------------------------------------------------------------

import { useState } from "react";
import { form, object, field, type InferValue, defineBehaviors } from "form-lib";
import { control, submission, required, minLength, calculate } from "form-lib/recipes";
import { StoreProvider, useForm, useValue } from "form-lib/react";
import { TextField, NumberField, ReadonlyRow, ResultCard, SubmitButton } from "../../ui";

const DAY_MS = 86_400_000;

const shape = form(
  object({
    destination: field<string>().meta(control()),
    startDate: field<string>().meta(control()),
    endDate: field<string>().meta(control()),
    nightlyRate: field<number | undefined>().meta(control()),
    notes: field<string>().meta(control()),
    // Derived, never edited by hand:
    nights: field<number | undefined>(),
    estimatedBudget: field<number | undefined>(),
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
  b.add(calculate(s.estimatedBudget, [s.nights, s.nightlyRate], (nights, rate) =>
    nights !== undefined && rate !== undefined && nights >= 0
      ? Math.round(nights * rate * 100) / 100
      : undefined,
  ));
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
        <SubmitButton label="Plan it" />
      </form>
      {submitted && <ResultCard title="The server receives:" values={submitted} />}
    </StoreProvider>
  );
}
