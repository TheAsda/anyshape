// ------------------------------------------------------------
// Stage 3 — Rules.
// Validation is behaviors: defined next to the shape, added
// per field, and run by the store. handleSubmit(onValid) only
// fires when every rule passes; a failing submit reveals all
// errors and focuses the first one.
// ------------------------------------------------------------

import { useState } from "react";
import {
  form, object, field, type InferValue, control, submission,
  defineBehaviors, required, minLength,
} from "form-lib";
import { StoreProvider, useForm } from "form-lib/react";
import { TextField, ResultCard, SubmitButton } from "../../ui";

const shape = form(
  object({
    destination: field<string>().meta(control()),
    startDate: field<string>().meta(control()),
    endDate: field<string>().meta(control()),
    notes: field<string>().meta(control()),
  }).meta(submission()),
);

const initialValues: InferValue<typeof shape> = {
  destination: "",
  startDate: "",
  endDate: "",
  notes: "",
};

export const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(required(s.destination), minLength(s.destination, 2));
  b.add(required(s.startDate));
  b.add(required(s.endDate));
  // notes stays optional
});

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
        <TextField node={shape.notes} label="Notes" />
        <SubmitButton label="Plan it" />
      </form>
      {submitted && <ResultCard title="The server receives:" values={submitted} />}
    </StoreProvider>
  );
}
