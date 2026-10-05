// ============================================================
// React recipes in a real browser: useControl, the error display policy,
// the native adapters. The core is reached only through its entries.
// ============================================================

import { test, expect } from "vitest";
import { form, object, array, field, createStore, type InferValue } from "form-lib";
import { StoreProvider } from "form-lib/react";
import { control } from "../features";
import { rule, asyncRule } from "../validation";
import { handleSubmit, submission } from "../submit";
import { focus } from "../focus";
import { useControl, ErrorDisplayProvider, fromInput, fromCheckbox } from "./index";
import { render, settle } from "./test-utils";

const shape = form(
  object({
    name: field<string>().meta(control()),
    agree: field<boolean>().meta(control()),
    age: field<number>().meta(control()),
    note: field<string>(),
    lines: array(object({ sku: field<string>().meta(control()), qty: field<number>().meta(control()) }), {
      create: () => ({ sku: "", qty: 1 }),
    }),
  }).meta(submission())
);
type Values = InferValue<typeof shape>;
const L = shape.lines.item;

function initial(): Values {
  return { name: "Ann", agree: false, age: 30, note: "", lines: [{ sku: "A", qty: 1 }, { sku: "B", qty: 2 }] };
}

// Compile-time only – never called.
export function typeOnlyChecks() {
  // @ts-expect-error – `note` has no control() keys
  useControl(shape.note);
  const age = useControl(shape.age);
  // @ts-expect-error – fromInput needs an onChange for strings
  fromInput(age.onChange);
  const agree = useControl(shape.agree);
  // @ts-expect-error – fromCheckbox needs an onChange for booleans
  fromCheckbox(useControl(shape.name).onChange);
  fromCheckbox(agree.onChange);
  const value: string = useControl(shape.name).value;
  return value;
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

test("useControl: onBlur reveals, showError follows the default policy", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, (v) => (v.length > 2 ? undefined : "Too short")) });
  let c!: ReturnType<typeof useControl<typeof shape.name>>;
  function C() {
    c = useControl(shape.name);
    return <span data-testid="c">{`${c.error ?? "-"}|${c.revealed}|${c.showError}`}</span>;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <C />
    </StoreProvider>
  );
  const state = screen.getByTestId("c");
  const onBlur = c.onBlur;
  await settle(() => c.onChange("Al"));
  await expect.element(state, { message: "error hidden while typing" }).toHaveTextContent("Too short|false|false");
  expect(c.onBlur, "stable").toBe(onBlur);
  await settle(() => c.onBlur());
  await expect.element(state).toHaveTextContent("Too short|true|true");
  await settle(() => c.onChange("Alice"));
  await expect.element(state, { message: "live once revealed" }).toHaveTextContent("-|true|false");
  await settle(() => s.reset());
  await expect.element(state).toHaveTextContent("-|false|false");
});

/** An async check the test resolves: `resolve(error)`. */
function gate() {
  let resolve!: (error: string | undefined) => void;
  const check = () => new Promise<string | undefined>((r) => (resolve = r));
  return { check, resolve: (error: string | undefined) => resolve(error) };
}

test("useControl: pending while a check runs; by default the error shows when revealed and not pending", async () => {
  const lookup = gate();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.name, lookup.check) });
  let c!: ReturnType<typeof useControl<typeof shape.name>>;
  function C() {
    c = useControl(shape.name);
    return <span data-testid="c">{`${c.pending}|${c.error ?? "-"}|${c.showError}`}</span>;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <C />
    </StoreProvider>
  );
  const state = screen.getByTestId("c");
  await settle(() => c.onBlur());
  await settle(() => c.onChange("Bob"));
  await expect.element(state).toHaveTextContent("true|-|false");
  await settle(() => lookup.resolve("Taken"));
  await expect.element(state).toHaveTextContent("false|Taken|true");
  await settle(() => c.onChange("Bobby"));
  await expect.element(state, { message: "the last result is hidden while a new check runs" }).toHaveTextContent("true|Taken|false");
});

test("useControl: a per-field errorDisplay overrides the policy", async () => {
  const lookup = gate();
  const s = createStore(shape, initial(), { behaviors: [rule(shape.name, (v) => (v.length > 2 ? undefined : "Too short")), asyncRule(shape.name, lookup.check)] });
  let c!: ReturnType<typeof useControl<typeof shape.name>>;
  function C() {
    c = useControl(shape.name, { errorDisplay: (st) => st.error !== undefined });
    return <span data-testid="c">{`${c.error ?? "-"}|${c.showError}`}</span>;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <C />
    </StoreProvider>
  );
  await settle(() => c.onChange("Al"));
  await expect.element(screen.getByTestId("c"), { message: "shown without a reveal" }).toHaveTextContent("Too short|true");
});

test("useControl: onBlur after its row was removed does nothing", async () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.items()[1];
  let c!: ReturnType<typeof useControl<typeof L.sku>>;
  function Sku() {
    c = useControl(L.sku);
    return <span data-testid="sku">{c.value ?? "-"}</span>;
  }
  await render(
    <StoreProvider store={row}>
      <Sku />
    </StoreProvider>
  );
  const onBlur = c.onBlur;
  await settle(() => lines.remove(row)); // e.g. a blur fired while the removed row unmounts
  expect(row.isAttached()).toBe(false);
  expect(() => onBlur()).not.toThrow();
  expect(row.get(L.sku.revealed), "nothing was written").toBe(false);
});

test("ErrorDisplayProvider: a custom policy, inherited by nested row providers", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(L.sku, () => "bad") });
  const row = s.substore(shape.lines).items()[0];
  function Sku() {
    const c = useControl(L.sku);
    return <span data-testid="sku">{String(c.showError)}</span>;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <ErrorDisplayProvider policy={(st) => st.error !== undefined}>
        <StoreProvider store={row}>
          <Sku />
        </StoreProvider>
      </ErrorDisplayProvider>
    </StoreProvider>
  );
  await expect.element(screen.getByTestId("sku"), { message: "not revealed, shown by the custom policy" }).toHaveTextContent("true");
});

test("focusRef registers the element, focus() and submit use it, unmount clears it", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, () => "bad") });
  function Input() {
    const c = useControl(shape.name);
    return <input data-testid="in" ref={c.focusRef} defaultValue={c.value} />;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <Input />
    </StoreProvider>
  );
  const input = screen.getByTestId("in");
  await settle(() => handleSubmit(s, async () => {})());
  await expect.element(input, { message: "submit focused the first error" }).toHaveFocus();
  (input.element() as HTMLElement).blur();
  expect(focus(s, shape.name)).toBe(true);
  await expect.element(input).toHaveFocus();
  await screen.unmount();
  expect(focus(s, shape.name), "cleared on unmount").toBe(false);
});

test("focusRef: unmounting one of two inputs keeps the other's registration", async () => {
  const s = createStore(shape, initial());
  function Input({ id }: { id: string }) {
    const c = useControl(shape.name);
    return <input data-testid={id} ref={c.focusRef} defaultValue={c.value} />;
  }
  function Both({ showFirst }: { showFirst: boolean }) {
    return (
      <div>
        {showFirst ? <Input key="a" id="a" /> : null}
        <Input key="b" id="b" />
      </div>
    );
  }
  const app = (showFirst: boolean) => (
    <StoreProvider store={s}>
      <Both showFirst={showFirst} />
    </StoreProvider>
  );
  const screen = await render(app(true));
  const b = screen.getByTestId("b");
  expect(focus(s, shape.name)).toBe(true);
  await expect.element(b, { message: "the last one mounted wins" }).toHaveFocus();
  (b.element() as HTMLElement).blur();
  await screen.rerender(app(false));
  expect(focus(s, shape.name)).toBe(true);
  await expect.element(b).toHaveFocus();
  await screen.unmount();
  expect(focus(s, shape.name)).toBe(false);
});

test("fromInput / fromCheckbox with real events; handlers are cached", async () => {
  const s = createStore(shape, initial());
  let nameOnChange!: (v: string) => void;
  function Inputs() {
    const name = useControl(shape.name);
    const agree = useControl(shape.agree);
    nameOnChange = name.onChange;
    return (
      <div>
        <input data-testid="name" value={name.value} onChange={fromInput(name.onChange)} />
        <input data-testid="agree" type="checkbox" checked={agree.value} onChange={fromCheckbox(agree.onChange)} />
      </div>
    );
  }
  const screen = await render(
    <StoreProvider store={s}>
      <Inputs />
    </StoreProvider>
  );
  const name = screen.getByTestId("name");
  await name.fill("Zoe");
  expect(s.get(shape.name)).toBe("Zoe");
  expect(s.get(shape.name.touched), "written as the user").toBe(true);
  await expect.element(name).toHaveValue("Zoe");
  await screen.getByTestId("agree").click();
  expect(s.get(shape.agree)).toBe(true);
  await expect.element(screen.getByTestId("agree")).toBeChecked();
  expect(fromInput(nameOnChange)).toBe(fromInput(nameOnChange));
});
