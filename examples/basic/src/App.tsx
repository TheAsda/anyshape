// ============================================================
// The app: useForm creates the store (once per mount), the
// StoreProvider shares it with the field components, and the
// sidebar shows live form state read through useValue.
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

  // Every value below is its own subscription: only this panel re-renders
  // when (and only when) that particular value changes.
  const submitting = useValue(shape.submitting);
  const submitCount = useValue(shape.submitCount);
  const errorCount = useValue(countIn(shape, "error"));
  const dirtyCount = useValue(countIn(shape, "dirty"));
  const validatingCount = useValue(countIn(shape, "validating"));
  const companyVisible = useValue(shape.company.visible);

  // After the first submit attempt, errors show on untouched fields too.
  const showErrors = submitCount > 0;

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

          <TextField node={shape.name} label="Full name" showErrors={showErrors} autoComplete="name" placeholder="Ada Lovelace" />
          <TextField
            node={shape.email}
            label="Email"
            type="email"
            showErrors={showErrors}
            autoComplete="email"
            placeholder="ada@example.com"
          />
          <SelectField
            node={shape.accountType}
            label="Account type"
            showErrors={showErrors}
            options={[
              { value: "personal", label: "Personal" },
              { value: "company", label: "Company" },
            ]}
          />
          {companyVisible && (
            <TextField node={shape.company} label="Company" showErrors={showErrors} autoComplete="organization" />
          )}
          <NumberField node={shape.age} label="Age" showErrors={showErrors} min={13} max={120} placeholder="36" />
          <CheckboxField node={shape.newsletter} label="Send me product updates" showErrors={showErrors} />

          <SkillsSection showErrors={showErrors} />

          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? "Saving…" : "Sign up"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => form.reset()}>
              Reset
            </button>
          </div>
        </form>

        <aside className="card side">
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

          <h2>Submitted values</h2>
          {result ? (
            <pre className="result">{JSON.stringify(result, null, 2)}</pre>
          ) : (
            <p className="side__hint">Nothing yet. A successful submit prints the values here.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
