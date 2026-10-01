// Submit and focus in a real DOM: document order, and handleSubmit on a <form>.

import { test, expect } from "vitest";
import { form, object, field, rule, type InferValue, type RootStore } from "form-lib";
import { StoreProvider, useForm } from "form-lib/react";
import { control } from "../features";
import { domOrder } from "../focus";
import { handleSubmit, submission } from "../submit";
import { useControl } from "./index";
import { render, settle } from "./test-utils";

const shape = form(
  object({
    name: field<string>().meta(control()),
    code: field<string>().meta(control()),
  }).meta(submission())
);
type Values = InferValue<typeof shape>;
const empty = (): Values => ({ name: "", code: "" });

/** An input registered as its node's focus target. */
function Field(props: { node: typeof shape.name | typeof shape.code; id: string }) {
  const c = useControl(props.node);
  return <input data-testid={props.id} ref={c.focusRef} value={c.value} onChange={(e) => c.onChange(e.target.value)} />;
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

test("domOrder: nodes by document position, other targets equal", async () => {
  const a = document.createElement("i");
  const b = document.createElement("b");
  document.body.append(a, b);
  expect(domOrder(a, b)).toBe(-1);
  expect(domOrder(b, a)).toBe(1);
  expect(domOrder(a, { focus() {} })).toBe(0);
  a.remove();
  b.remove();
});
