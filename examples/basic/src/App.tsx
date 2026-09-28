// ============================================================
// The app: useForm creates the store (once per mount), the
// StoreProvider shares it with the field components, and every
// live value is read by the component that displays it.
// ============================================================

import { useState } from "react";
import { countIn, type RootStore, type ValidationResult } from "form-lib";
import { StoreProvider, useForm, useStore, useValue } from "form-lib/react";
import { shape, initialValues, behaviors, type Values } from "./form";
import { TextField, NumberField, SelectField, CheckboxField } from "./fields";
import { SkillsSection } from "./SkillsSection";

/** What submit() hands back: hidden fields (company) become optional. */
type Submitted = ValidationResult<typeof shape>["values"];

const sample: Values = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  accountType: "company",
  company: "Analytical Engines Ltd",
  age: 36,
  newsletter: true,
  skills: [
    { name: "TypeScript", level: 5 },
    { name: "Zod", level: 3 },
  ],
};

/** Pretend to talk to a server. */
async function save(values: Submitted): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  console.log("Saved:", values);
}

export function App() {
  // Behaviors (rules) are passed here; the shape is created once, outside React.
  const form = useForm(shape, initialValues, { behaviors });
  return (
    <StoreProvider store={form}>
      <RegistrationForm />
    </StoreProvider>
  );
}

function RegistrationForm() {
  const form = useStore<RootStore<typeof shape>>();
  const [result, setResult] = useState<Submitted | null>(null);

  // The form itself subscribes to nothing live: dirty flags, validation and
  // even `submitting` are read in the small components that display them, so
  // metadata churn never re-renders this tree. Only a successful submit does
  // (it sets `result`).
  return (
    <div className="page">
      <header className="page__header">
        <h1>form-lib — basic example</h1>
        <p>
          Submit the empty form to see validation and error focusing, type an email to see the async
          check (<code>admin@example.com</code> is taken), switch to a company account to reveal a
          conditional field, and edit the skills list to see array rows.
        </p>
      </header>

      <div className="page__grid">
        <form
          className="card"
          noValidate
          onSubmit={form.handleSubmit(async (values) => {
            await save(values);
            setResult(values);
          })}
        >
          <div className="toolbar">
            <button type="button" className="btn btn--ghost" onClick={() => form.setValues(sample)}>
              Load sample data
            </button>
          </div>

          <TextField node={shape.name} label="Full name" autoComplete="name" placeholder="Ada Lovelace" />
          <TextField
            node={shape.email}
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="ada@example.com"
          />
          <SelectField
            node={shape.accountType}
            label="Account type"
            options={[
              { value: "personal", label: "Personal" },
              { value: "company", label: "Company" },
            ]}
          />
          <CompanyField />
          <NumberField node={shape.age} label="Age" min={13} max={120} placeholder="36" />
          <CheckboxField node={shape.newsletter} label="Send me product updates" />

          <SkillsSection />

          <div className="form-actions">
            <SubmitButton />
            <button type="button" className="btn btn--ghost" onClick={() => form.reset()}>
              Reset
            </button>
          </div>
        </form>

        <aside className="card side">
          <FormStatePanel />
          <SubmittedValues result={result} />
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Live panels: each one subscribes to the values it shows, so a
// field turning dirty or a validation starting re-renders only
// the panel – the form above does not re-render at all.
// ------------------------------------------------------------

function FormStatePanel() {
  const errorCount = useValue(countIn(shape, "error"));
  const validatingCount = useValue(countIn(shape, "validating"));
  const dirtyCount = useValue(countIn(shape, "dirty"));
  const submitCount = useValue(shape.submitCount);

  return (
    <>
      <h2>Form state</h2>
      <dl className="stats">
        <div className="stat">
          <dt>Fields with errors</dt>
          <dd className={errorCount > 0 ? "stat__value--bad" : undefined}>{errorCount}</dd>
        </div>
        <div className="stat">
          <dt>Fields validating</dt>
          <dd>{validatingCount}</dd>
        </div>
        <div className="stat">
          <dt>Dirty fields</dt>
          <dd>{dirtyCount}</dd>
        </div>
        <div className="stat">
          <dt>Submit attempts</dt>
          <dd>{submitCount}</dd>
        </div>
      </dl>
    </>
  );
}

function SubmittedValues({ result }: { result: Submitted | null }) {
  return (
    <>
      <h2>Submitted values</h2>
      {result ? (
        <pre className="result">{JSON.stringify(result, null, 2)}</pre>
      ) : (
        <p className="side__hint">Nothing yet. A successful submit prints the values here.</p>
      )}
    </>
  );
}

function SubmitButton() {
  const submitting = useValue(shape.submitting);
  return (
    <button type="submit" className="btn btn--primary" disabled={submitting}>
      {submitting ? "Saving…" : "Sign up"}
    </button>
  );
}

/** Reads its own visibility: switching account types re-renders only this branch. */
function CompanyField() {
  const visible = useValue(shape.company.visible);
  if (!visible) return null;
  return <TextField node={shape.company} label="Company" autoComplete="organization" />;
}
