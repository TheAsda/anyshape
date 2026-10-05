// ------------------------------------------------------------
// Stage 1 — Just values.
// A form is a shape (field types) plus a store of values.
// No metadata, no validation, no submit machinery: we read the
// whole value with useValue(shape) and stringify it.
// ------------------------------------------------------------

import { useState } from "react";
import { form, object, field, type InferValue } from "anyshape";
import { StoreProvider, useForm, useValue } from "anyshape/react";
import { ValueField, ResultCard, SubmitButton } from "../../ui";

const shape = form(
  object({
    destination: field<string>(),
    startDate: field<string>(),
    endDate: field<string>(),
    notes: field<string>(),
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
  const values = useValue(shape, { store: form }); // the whole value object
  const [submitted, setSubmitted] = useState<typeof values | null>(null);
  return (
    <StoreProvider store={form}>
      <form className="stage-form" onSubmit={(e) => { e.preventDefault(); setSubmitted(values); }}>
        <ValueField node={shape.destination} label="Destination" placeholder="Lisbon" />
        <ValueField node={shape.startDate} label="Departure" type="date" />
        <ValueField node={shape.endDate} label="Return" type="date" />
        <ValueField node={shape.notes} label="Notes" />
        <SubmitButton label="Plan it" />
      </form>
      {submitted && <ResultCard title="You'd send this to the server:" values={submitted} />}
    </StoreProvider>
  );
}
