// ------------------------------------------------------------
// Stage 2 — Control.
// The same fields, now with .meta(control()): validation state,
// touched/dirty tracking and a focus target. This is the
// plumbing every input needs; rules arrive in stage 3.
// ------------------------------------------------------------

import { useState } from "react";
import { form, object, field, type InferValue } from "anyshape";
import { control } from "../../../../../recipes";
import { StoreProvider, useForm, useValue } from "anyshape/react";
import { TextField, ResultCard, SubmitButton } from "../../ui";

const shape = form(
  object({
    destination: field<string>().meta(control()),
    startDate: field<string>().meta(control()),
    endDate: field<string>().meta(control()),
    notes: field<string>().meta(control()),
  }),
);

const initialValues: InferValue<typeof shape> = {
  destination: "",
  startDate: "",
  endDate: "",
  notes: "",
};

export function Stage() {
  const form = useForm(shape, initialValues);
  const values = useValue(shape, { store: form });
  const [submitted, setSubmitted] = useState<typeof values | null>(null);
  return (
    <StoreProvider store={form}>
      <form className="stage-form" onSubmit={(e) => { e.preventDefault(); setSubmitted(values); }}>
        <TextField node={shape.destination} label="Destination" placeholder="Lisbon" />
        <TextField node={shape.startDate} label="Departure" type="date" />
        <TextField node={shape.endDate} label="Return" type="date" />
        <TextField node={shape.notes} label="Notes" />
        <SubmitButton label="Plan it" />
      </form>
      {submitted && <ResultCard title="You'd send this to the server:" values={submitted} />}
    </StoreProvider>
  );
}
