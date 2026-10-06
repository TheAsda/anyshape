// ============================================================
// PROTOTYPE(#128) – throwaway. The delivery-type wizard rendered: Next is
// handleSubmit on step 1's substore; step 2 reads step 1 with useChecked.
// ============================================================

import { createStore, type AnyBehavior, type RootStore } from "anyshape";
import { StoreProvider, useValue } from "anyshape/react";
import { Component, useMemo, useState, type ReactNode } from "react";
import { describe, test, expect, expectTypeOf } from "vitest";

import { order, empty, loadSkus, skusFor, type DeliveryType } from "../../_proto/wizard";
import { handleSubmit } from "../../submit";
import { rule } from "../../validation";
import { useControl } from "../control";
import { render, settle } from "../test-utils";
import { useChecked, useCheckedOrThrow } from "./checked";

type Store = RootStore<typeof order>;
const make = (behaviors: AnyBehavior[] = []) =>
  createStore(order, empty(), { behaviors: [loadSkus(async (t) => skusFor(t)), ...behaviors] });

function DeliveryStep(props: { onNext?: () => void }) {
  const { control: type, focusRef } = useControl(order.delivery.deliveryType);
  const { control: email } = useControl(order.delivery.email);
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

function SkuStep() {
  const delivery = useChecked(order.delivery);
  const skus = useValue(order.items.sku.skuOptions);
  if (!delivery) return <p>Choose a delivery type first</p>;
  expectTypeOf(delivery.deliveryType).toEqualTypeOf<DeliveryType>();
  return <p>{`SKUs for ${delivery.deliveryType}: ${skus.join(", ")}`}</p>;
}

function StrictSkuStep() {
  const delivery = useCheckedOrThrow(order.delivery);
  return <p>{`SKUs for ${delivery.deliveryType}`}</p>;
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>Step 2 crashed</p> : this.props.children;
  }
}

function Wizard(props: { store: Store; sent: unknown[] }) {
  const [step, setStep] = useState(1);
  const next = useMemo(
    () =>
      handleSubmit(props.store.substore(order.delivery), (delivery) => {
        props.sent.push(delivery);
        setStep(2);
      }),
    [props.store, props.sent],
  );
  return step === 1 ? <DeliveryStep onNext={() => void next()} /> : <SkuStep />;
}

describe("one step at a time", () => {
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
});

describe("both steps mounted (accordion)", () => {
  test("R2: step 2 falls back when step 1 is cleared, or when an unrelated rule fails", async () => {
    const store = make([rule(order.delivery.email, (v) => (v.endsWith("!") ? "No bangs" : undefined))]);
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
    await settle(() => store.set(order.delivery.deliveryType, undefined));
    await expect.element(screen.getByText("Choose a delivery type first")).toBeVisible();
  });

  test("R3: the throwing read sends a cleared step 1 to the error boundary", async () => {
    const store = make();
    store.set(order.delivery.deliveryType, "Printed");
    const screen = await render(
      <StoreProvider store={store}>
        <DeliveryStep />
        <Boundary>
          <StrictSkuStep />
        </Boundary>
      </StoreProvider>,
    );
    await expect.element(screen.getByText("SKUs for Printed")).toBeVisible();
    await screen.getByLabelText("Delivery type").selectOptions("");
    await expect.element(screen.getByText("Step 2 crashed")).toBeVisible();
  });
});
