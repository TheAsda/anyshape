// ============================================================
// React recipes in a real browser: useControl, the error display policy,
// the native adapters. The core is reached only through its entries.
// ============================================================

import { test, expect } from "vitest";
import { form, object, array, field, createStore, rule, type InferValue } from "form-lib";
import { StoreProvider } from "form-lib/react";
import { control } from "../features";
import { useControl } from "./index";
import { render, settle } from "./test-utils";

const shape = form({
  name: field<string>().meta(control()),
  agree: field<boolean>().meta(control()),
  age: field<number>().meta(control()),
  note: field<string>(),
  lines: array(object({ sku: field<string>().meta(control()), qty: field<number>().meta(control()) }), {
    create: () => ({ sku: "", qty: 1 }),
  }),
});
type Values = InferValue<typeof shape>;
const L = shape.lines.item;

function initial(): Values {
  return { name: "Ann", agree: false, age: 30, note: "", lines: [{ sku: "A", qty: 1 }, { sku: "B", qty: 2 }] };
}

test("useControl: state, user writes set touched/dirty, errors", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, (v) => (v.length > 2 ? undefined : "Too short")) });
  let c!: ReturnType<typeof useControl<typeof shape.name>>;
  function C() {
    c = useControl(shape.name);
    return <span data-testid="c">{`${c.value}|${c.error ?? "-"}|${c.touched}|${c.dirty}`}</span>;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <C />
    </StoreProvider>
  );
  const state = screen.getByTestId("c");
  await expect.element(state).toHaveTextContent("Ann|-|false|false");
  await settle(() => c.onChange("Al"));
  await expect.element(state).toHaveTextContent("Al|Too short|true|true");
  await settle(() => s.reset());
  await expect.element(state).toHaveTextContent("Ann|-|false|false");
});
