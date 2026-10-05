// ============================================================
// The app: useForm creates the store (once per mount), the
// StoreProvider shares it with the field components, and every
// live value is read by the component that displays it.
//
// The wizard chrome lives here too: Continue is a submit scoped
// to the current step's subtree (reveals + validates + focuses
// just that step), the final submit maps a server rejection's
// per-path errors back onto fields, and jumps to the first one.
// ============================================================

import { countIn, pendingIn, type RootStore } from "anyshape";
import { StoreProvider, useForm, useStore, useValue } from "anyshape/react";
import { useEffect, useRef, useState } from "react";

import { handleSubmit, error, dirty } from "../../../recipes";
import { useControl } from "../../../recipes/react";
import { TextField, TextAreaField, CheckboxField, DateField } from "./fields";
import {
  shape,
  initialValues,
  behaviors,
  save,
  lookupDepartment,
  lookingUp,
  ServerRejection,
  type Submitted,
  type Values,
} from "./form";
import { ItemsSection } from "./ItemsSection";

const sample: Values = {
  step: 0,
  requester: {
    title: "Keyboards for the lab",
    email: "ada@example.com",
    department: "DEP-2201", // being reorganized at save time – the server will say so
    budget: undefined, // filled by the app-side lookup once rendered
  },
  order: {
    items: [
      {
        sku: "SKU-1001",
        name: "Mechanical keyboard",
        qty: 2,
        unitPrice: 129.99,
        lineTotal: 259.98,
      },
      {
        sku: "SKU-9901", // in the catalog, but discontinued at save time
        name: "Osmo action cam",
        qty: 1,
        unitPrice: 389.0,
        lineTotal: 389.0,
      },
    ],
    subtotal: 648.98,
    tax: 123.31,
    total: 772.29,
  },
  logistics: {
    orderedOn: "2026-10-05",
    neededBy: "2026-10-19",
    shipToOffice: true,
    address: { street: "", city: "", zip: "" },
    approval: { approver: "", justification: "" },
  },
};

// Server paths name steps by their root; used to jump to the
// first field the server complained about.
const STEP_OF_PATH: [prefix: string, step: number][] = [
  ["requester", 0],
  ["order", 1],
  ["logistics", 2],
];

export function App() {
  // Behaviors (rules) are passed here; the shape is created once, outside React.
  const form = useForm(shape, initialValues, { behaviors });
  return (
    <StoreProvider store={form}>
      <RequisitionWizard />
    </StoreProvider>
  );
}

function RequisitionWizard() {
  const form = useStore<RootStore<typeof shape>>();
  const step = useValue(shape.step) ?? 0;
  const [result, setResult] = useState<Submitted | undefined>();

  const goTo = (n: number) => form.set(shape.step, n);

  /** Continue = a submit of the current step's store. */
  const continueStep = (n: number) => {
    const stepNode = n === 0 ? shape.requester : n === 1 ? shape.order : shape.logistics;
    void handleSubmit(form.substore(stepNode), () => {
      // Passing the step's validation is what advances the wizard.
      form.set(shape.step, n + 1);
    })();
  };

  const onSubmit = handleSubmit(form, async (values) => {
    // Enter in any input submits the form element; on early steps
    // that should behave like Continue, not like a save attempt. The
    // step is read from the store: it's current when the handler runs.
    const current = form.get(shape.step) ?? 0;
    if (current < 2) {
      continueStep(current);
      return;
    }
    try {
      await save(values);
      setResult(values);
    } catch (e) {
      if (e instanceof ServerRejection) {
        // The server addressed fields by path; resolve each to its
        // field and write the field's own error key, found by its
        // definition. The next validation run for a field replaces
        // whatever lands here.
        let firstStep = 2;
        for (const [path, message] of Object.entries(e.fieldErrors)) {
          const t = form.resolvePath(path);
          const target = t && t.store.collect(t.ref, error).find((e) => e.ref.node === t.ref);
          if (!target) continue;
          target.store.set(target.ref, message);
          const hit = STEP_OF_PATH.find(([prefix]) => path.startsWith(prefix));
          if (hit) firstStep = Math.min(firstStep, hit[1]);
        }
        goTo(firstStep);
      }
    }
  });

  const loadSample = () => {
    setResult(undefined);
    form.set(shape, sample);
  };

  return (
    <div className="page">
      <main className="form-card">
        <h1>Purchase requisition</h1>
        <p className="intro">
          A three-step wizard over one store. <strong>Continue</strong> runs a submit scoped to the visible step;{" "}
          <strong>Submit</strong> saves to a fake server that rejects the sample data by field path – the errors land
          back on their fields and the wizard jumps to the first one. The card on the right lists every way to watch it
          fail.
        </p>
        <ol className="steps">
          {["Requester", "Line items", "Logistics"].map((title, i) => (
            <li
              key={title}
              className={"steps__item" + (i === step ? " steps__item--current" : i < step ? " steps__item--done" : "")}
            >
              {title}
            </li>
          ))}
        </ol>
        <form onSubmit={onSubmit} noValidate>
          {step === 0 && <RequesterSection />}
          {step === 1 && <ItemsSection />}
          {step === 2 && <LogisticsSection />}
          <div className="wizard-nav">
            <button type="button" disabled={step === 0} onClick={() => goTo(step - 1)}>
              Back
            </button>
            {step < 2 ? (
              <button type="button" className="primary" onClick={() => continueStep(step)}>
                Continue
              </button>
            ) : (
              <SubmitButton />
            )}
          </div>
        </form>
      </main>
      <aside className="side">
        <FailureTour />
        <FormStatePanel />
        {result !== undefined && <SubmittedValues values={result} />}
        <button type="button" className="link" onClick={loadSample}>
          Load sample data
        </button>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------
// Step 1
// ------------------------------------------------------------
function RequesterSection() {
  return (
    <section>
      <h2>Requester</h2>
      <TextField
        node={shape.requester.title}
        label="Title"
        placeholder="What is this for?"
        hint="Required, at least 2 characters"
      />
      <TextField
        node={shape.requester.email}
        label="Email"
        type="email"
        placeholder="you@company.example"
        hint="ada@example.com is known; dev@anyshape.dev has an open requisition; anything else is unknown"
      />
      <DepartmentField />
    </section>
  );
}

/**
 * Departments are looked up app-side (async work is not
 * expressible as a behavior yet): a debounce after each change
 * asks the service, writes the budget the budget rule reads, and
 * reports unknown codes straight onto the field's error key.
 */
function DepartmentField() {
  const form = useStore<RootStore<typeof shape>>();
  const { focusRef, ...c } = useControl(shape.requester.department);
  const budget = useValue(shape.requester.budget);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const code = c.value;
    clearTimeout(timer.current);
    if (code === "") {
      form.set(shape.requester.budget, undefined);
      return;
    }
    if (!/^DEP-\d{4}$/.test(code)) return; // the sync format rule owns this case
    form.set(shape.requester.department.lookingUp, "department");
    timer.current = setTimeout(async () => {
      const dep = await lookupDepartment(code);
      form.set(shape.requester.budget, dep ? dep.budget : undefined);
      // Only the error this lookup owns is written here; a success
      // clears nothing – the next validation run replaces errors.
      if (!dep) form.set(shape.requester.department.error, "Unknown department – known: DEP-1100, DEP-2201, DEP-3302");
      form.set(shape.requester.department.lookingUp, undefined);
    }, 600);
  }, [c.value, form]);

  return (
    <div className={c.showError ? "field field--error" : "field"}>
      <label className="field__label" htmlFor="dep">
        Department
      </label>
      <input
        id="dep"
        ref={focusRef}
        className="field__input"
        value={c.value}
        placeholder="DEP-1100"
        onBlur={c.onBlur}
        aria-invalid={c.showError || undefined}
        onChange={(e) => c.onChange(e.target.value)}
      />
      <p className="field__hint">
        DEP-1100 / DEP-2201 / DEP-3302 exist; DEP-2201 turns out to be reorganized at save time. Remaining budget:{" "}
        {budget !== undefined ? `€${budget.toLocaleString("en-US")}` : "not looked up yet"}
      </p>
      {c.showError && <p className="field__error">{c.error}</p>}
      {c.pending && <p className="field__status">Checking…</p>}
    </div>
  );
}

// ------------------------------------------------------------
// Step 3
// ------------------------------------------------------------
function LogisticsSection() {
  return (
    <section>
      <h2>Logistics</h2>
      <div className="field-row">
        <DateField
          node={shape.logistics.orderedOn}
          label="Ordered on"
          hint="Picking this fills needed-by 14 days later"
        />
        <DateField node={shape.logistics.neededBy} label="Needed by" hint="Must be after the order date" />
      </div>
      <CheckboxField
        node={shape.logistics.shipToOffice}
        label="Ship to the office"
        hint="Uncheck to enter an address – toggling back clears it on purpose"
      />
      {/* Inside these groups the fields are only rendered while
          visible; the store still holds the values either way. */}
      {useValue(shape.logistics.address.visible) === true && (
        <fieldset className="subgroup">
          <legend>Shipping address</legend>
          <TextField node={shape.logistics.address.street} label="Street" hint="Required once visible" />
          <TextField node={shape.logistics.address.city} label="City" hint="Required once visible" />
          <TextField node={shape.logistics.address.zip} label="Zip" hint="Required once visible" />
        </fieldset>
      )}
      {useValue(shape.logistics.approval.visible) === true && (
        <fieldset className="subgroup">
          <legend>Approval (total over €10,000)</legend>
          <TextField
            node={shape.logistics.approval.approver}
            label="Approver"
            hint="Required once the total crosses €10,000"
          />
          <TextAreaField
            node={shape.logistics.approval.justification}
            label="Justification"
            placeholder="Why is this order this big?"
            hint="Required once the total crosses €10,000"
          />
        </fieldset>
      )}
    </section>
  );
}

// ------------------------------------------------------------
// Side panels
// ------------------------------------------------------------

/** The demo's contract with the user: every advertised failure. */
function FailureTour() {
  const rows: [step: string, input: string, effect: string][] = [
    ["1", "unknown email", "async rule: Unknown employee"],
    ["1", "dev@anyshape.dev", "async rule: open requisition"],
    ["1", "unknown DEP code", "app lookup: Unknown department"],
    ["1", "Continue with empties", "required + focus jumps to the field"],
    ["2", "a SKU used in another row", "not selectable – each row is unique"],
    ["2", "qty 0 or 100, price 0", "min/max rules"],
    ["2", "DEP-1100 + big order", "total exceeds the €10,000 budget"],
    ["2", "total over €10,000", "step 3 grows an approval group"],
    ["3", "needed-by ≤ ordered-on", "cross-field date rule"],
    ["3", "uncheck ship-to-office", "address appears; toggling back clears it"],
    ["Submit", "the sample as loaded", "server rejects DEP-2201 (reorganized) and SKU-9901 (discontinued) by path"],
  ];
  return (
    <div className="card">
      <h2>How to break it</h2>
      <table className="cheat">
        <thead>
          <tr>
            <th>Step</th>
            <th>Do this</th>
            <th>Watch</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([step, input, effect]) => (
            <tr key={input + effect}>
              <td>{step}</td>
              <td>{input}</td>
              <td>{effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormStatePanel() {
  const errors = useValue(countIn(shape, error));
  const checking = useValue(pendingIn(shape, error));
  const dirtyFields = useValue(countIn(shape, dirty));
  const lookups = useValue(countIn(shape, lookingUp));
  const submitting = useValue(shape.submitting);
  return (
    <div className="card">
      <h2>Live form state</h2>
      <dl className="stats">
        <dt>submitting</dt>
        <dd>{String(submitting)}</dd>
        <dt>fields with errors</dt>
        <dd>{String(errors)}</dd>
        <dt>checks in flight</dt>
        <dd>{String(checking)}</dd>
        <dt>dirty</dt>
        <dd>{String(dirtyFields)}</dd>
        <dt>lookups in flight</dt>
        <dd>{String(lookups)}</dd>
      </dl>
    </div>
  );
}

function SubmittedValues({ values }: { values: Submitted }) {
  return (
    <div className="card">
      <h2>Saved</h2>
      <pre className="submitted">{JSON.stringify(values, null, 2)}</pre>
    </div>
  );
}

function SubmitButton() {
  const submitting = useValue(shape.submitting);
  const lookups = useValue(countIn(shape, lookingUp));
  return (
    <button type="submit" className="primary" disabled={submitting === true || lookups > 0}>
      {submitting === true ? "Saving…" : "Submit requisition"}
    </button>
  );
}
