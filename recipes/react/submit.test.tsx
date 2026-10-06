// Submit and focus in a real DOM: document order, handleSubmit on a <form>, and
// a form in steps whose Next button submits the step.

import {
  form,
  object,
  field,
  createStore,
  countIn,
  pendingIn,
  type AnyBehavior,
  type InferValue,
  type RootStore,
} from "anyshape";
import { StoreProvider, useForm, useValue } from "anyshape/react";
import { useMemo, useState } from "react";
import { describe, test, expect, expectTypeOf } from "vitest";

import { control } from "../features";
import { focusFirst, registerFocus } from "../focus";
import { handleSubmit, submission } from "../submit";
import * as order from "../test/fixtures/order";
import type { DeliveryType } from "../test/fixtures/order";
import { error, rule } from "../validation";
import { useControl } from "./index";
import { render, settle } from "./test-utils";

const shape = form(
  object({
    name: field<string>().meta(control()),
    code: field<string>().meta(control()),
  }).meta(submission()),
);
type Values = InferValue<typeof shape>;
const empty = (): Values => ({ name: "", code: "" });

/** An input registered as its node's focus target. */
function Field(props: { node: typeof shape.name | typeof shape.code; id: string }) {
  const { control, focusRef } = useControl(props.node);
  return (
    <input
      data-testid={props.id}
      ref={focusRef}
      value={control.value}
      onChange={(e) => control.onChange(e.target.value)}
    />
  );
}

test("a submit focuses the first error in DOM order, not shape order", async () => {
  let f!: RootStore<typeof shape>;
  function App() {
    f = useForm(shape, empty(), { behaviors: [rule(shape.name, () => "bad"), rule(shape.code, () => "bad")] });
    // code is rendered before name, but name comes first in the shape
    return (
      <StoreProvider store={f}>
        <Field node={shape.code} id="code" />
        <Field node={shape.name} id="name" />
      </StoreProvider>
    );
  }
  const screen = await render(<App />);
  await settle(() => handleSubmit(f, async () => {})());
  await expect.element(screen.getByTestId("code")).toHaveFocus();
});

test("handleSubmit on a real <form>: default prevented, fn gets the values", async () => {
  const saved: string[] = [];
  function App() {
    const f = useForm(shape, { ...empty(), name: "Ann" });
    return (
      <StoreProvider store={f}>
        <form data-testid="form" onSubmit={handleSubmit(f, async (formData) => void saved.push(formData.name))}>
          <button data-testid="go" type="submit">
            Save
          </button>
        </form>
      </StoreProvider>
    );
  }
  const screen = await render(<App />);
  // React handles the event at its root container; a document listener runs after it.
  let defaultPrevented: boolean | undefined;
  const onSubmit = (e: Event) => (defaultPrevented = e.defaultPrevented);
  document.addEventListener("submit", onSubmit);
  await screen.getByTestId("go").click();
  document.removeEventListener("submit", onSubmit);
  await expect.poll(() => saved).toEqual(["Ann"]);
  expect(defaultPrevented).toBe(true);
});

test("focusFirst: a DOM element and a custom focus handle keep the entries' order", async () => {
  const s = createStore(shape, empty());
  const input = document.createElement("input");
  document.body.append(input);
  const focused: string[] = [];
  registerFocus(s, shape.name, { focus: () => focused.push("handle") });
  registerFocus(s, shape.code, input);
  const name = { path: "name", ref: shape.name.error, store: s };
  const code = { path: "code", ref: shape.code.error, store: s };
  expect(focusFirst([name, code])?.path).toBe("name");
  expect(focusFirst([code, name])?.path).toBe("code");
  expect(document.activeElement).toBe(input);
  expect(focused).toEqual(["handle"]);
  input.remove();
});

describe("Forms in steps", () => {
  const { shape: steps, D, initial: start, loadSkus, skusFor } = order;
  const make = (behaviors: AnyBehavior[] = []) =>
    createStore(steps, start(), { behaviors: [loadSkus(async (t) => skusFor(t)), ...behaviors] });

  function DeliveryStep(props: { onNext?: () => void }) {
    const { control: type, focusRef } = useControl(D.deliveryType);
    const { control: email } = useControl(D.email);
    return (
      <div>
        <select
          aria-label="Delivery type"
          ref={focusRef}
          value={type.value ?? ""}
          onChange={(e) => type.onChange((e.target.value || undefined) as DeliveryType | undefined)}
          onBlur={type.onBlur}
        >
          <option value="">–</option>
          <option>Electronic</option>
          <option>Printed</option>
        </select>
        {type.showError && <p role="alert">{type.error}</p>}
        <input aria-label="Email" value={email.value} onChange={(e) => email.onChange(e.target.value)} />
        {props.onNext && <button onClick={props.onNext}>Next</button>}
      </div>
    );
  }

  /** Step 2: gated on step 1's checks, and narrowing the stored type itself. */
  function SkuStep() {
    const errors = useValue(countIn(D, error));
    const pending = useValue(pendingIn(D, error));
    const type = useValue(D.deliveryType);
    expectTypeOf(type).toEqualTypeOf<DeliveryType | undefined>();
    const skus = useValue(steps.items.sku.skuOptions);
    if (errors > 0 || pending > 0 || type === undefined) return <p>Choose a delivery type first</p>;
    return <p>{`SKUs for ${type}: ${skus.join(", ")}`}</p>;
  }

  function Wizard(props: { store: RootStore<typeof steps>; sent: unknown[] }) {
    const [step, setStep] = useState(1);
    const next = useMemo(
      () =>
        handleSubmit(props.store.substore(D), (delivery) => {
          props.sent.push(delivery);
          setStep(2);
        }),
      [props.store, props.sent],
    );
    return step === 1 ? <DeliveryStep onNext={() => void next()} /> : <SkuStep />;
  }

  test("Next reveals and focuses the empty field, then advances once it's filled", async () => {
    const store = make();
    const sent: unknown[] = [];
    const screen = await render(
      <StoreProvider store={store}>
        <Wizard store={store} sent={sent} />
      </StoreProvider>,
    );
    await screen.getByRole("button", { name: "Next" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Required");
    await expect.element(screen.getByLabelText("Delivery type")).toHaveFocus();
    await screen.getByLabelText("Delivery type").selectOptions("Printed");
    await screen.getByRole("button", { name: "Next" }).click();
    await expect.element(screen.getByText(/SKUs for Printed/)).toHaveTextContent("SKUs for Printed: P-1");
    expect(sent).toEqual([{ deliveryType: "Printed", email: "" }]);
  });

  test("with both steps shown, step 2 falls back when step 1 is cleared, or when an unrelated rule fails", async () => {
    const store = make([rule(D.email, (v) => (v.endsWith("!") ? "No bangs" : undefined))]);
    const screen = await render(
      <StoreProvider store={store}>
        <DeliveryStep />
        <SkuStep />
      </StoreProvider>,
    );
    await expect.element(screen.getByText("Choose a delivery type first")).toBeVisible();
    await screen.getByLabelText("Delivery type").selectOptions("Electronic");
    await expect.element(screen.getByText(/SKUs for/)).toHaveTextContent("SKUs for Electronic: E-1, E-2");
    await screen.getByLabelText("Email").fill("a!");
    await expect.element(screen.getByText("Choose a delivery type first")).toBeVisible();
    await screen.getByLabelText("Email").fill("a");
    await expect.element(screen.getByText(/SKUs for/)).toBeVisible();
    await settle(() => store.set(D.deliveryType, undefined));
    await expect.element(screen.getByText("Choose a delivery type first")).toBeVisible();
  });
});
