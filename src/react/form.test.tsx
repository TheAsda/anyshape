import { useState, StrictMode } from "react";
import { test, expect } from "vitest";
import {
  form, object, array, field, metaKey, rule, countIn, createStore, type InferValue, type RootStore,
} from "../index";
import { control, submission } from "../test/features";
import { max } from "../test/rules";
import { StoreProvider, useForm, useSync, useField, useValue, domOrder } from "./index";
import { render, settle, captureWarnings } from "./test-utils";

const shape = form(
  object({
    name: field<string>().meta(control()),
    code: field<string>().meta(control()),
    note: field<string>().meta(control(), { hint: "" }),
    lines: array(
      object({
        qty: field<number>().meta(control(), { maxQty: metaKey<number | undefined>(undefined, { keepOnReset: true }) }),
      })
    ),
  }).meta(submission())
);
type Values = InferValue<typeof shape>;
const L = shape.lines.item;
const empty = (): Values => ({ name: "", code: "", note: "", lines: [{ qty: 1 }] });

// ---------------------------------------------------------------------------
// useForm
test("useForm creates the store once; later initialValues are ignored", async () => {
  const stores = new Set<RootStore<typeof shape>>();
  let setTick!: (n: number) => void;
  function App() {
    const [tick, set] = useState(0);
    setTick = set;
    const f = useForm(shape, { ...empty(), name: `n${tick}` });
    stores.add(f);
    return (
      <StoreProvider store={f}>
        <Name />
      </StoreProvider>
    );
  }
  function Name() {
    return <span data-testid="name">{useValue(shape.name)}</span>;
  }
  const screen = await render(<App />);
  await settle(() => setTick(1));
  await settle(() => setTick(2));
  expect(stores.size).toBe(1);
  await expect.element(screen.getByTestId("name")).toHaveTextContent("n0");
});

test("useForm passes behaviors and warns when the shape changes", async () => {
  const other = form(object({ name: field<string>().meta(control()) }).meta(submission()));
  const { warnings, restore } = captureWarnings();
  let useOther!: (b: boolean) => void;
  function App() {
    const [flip, set] = useState(false);
    useOther = set;
    const f = useForm((flip ? other : shape) as typeof shape, empty(), {
      behaviors: rule(shape.name, (v) => (v ? undefined : "Required")),
    });
    return (
      <StoreProvider store={f}>
        <Err />
      </StoreProvider>
    );
  }
  function Err() {
    return <span data-testid="err">{useValue(shape.name.error) ?? "-"}</span>;
  }
  const screen = await render(<App />);
  await expect.element(screen.getByTestId("err")).toHaveTextContent("Required");
  await settle(() => useOther(true));
  restore();
  expect(warnings.some((w) => /shape` changed/.test(w))).toBe(true);
});

test("values: loading data becomes the baseline; same object keeps edits; a new object reloads", async () => {
  let setData!: (v: Values | undefined) => void;
  let f!: RootStore<typeof shape>;
  function App() {
    const [data, set] = useState<Values | undefined>(undefined);
    setData = set;
    f = useForm(shape, empty(), { values: data });
    return (
      <StoreProvider store={f}>
        <Name />
      </StoreProvider>
    );
  }
  function Name() {
    const c = useField(shape.name);
    return <span data-testid="name">{`${c.value}|${c.meta.dirty}`}</span>;
  }
  const screen = await render(<App />);
  const name = screen.getByTestId("name");
  await expect.element(name, { message: "loading: initialValues" }).toHaveTextContent("|false");

  const loaded = { ...empty(), name: "Loaded" };
  await settle(() => setData(loaded));
  await expect.element(name, { message: "loaded as the baseline: not dirty" }).toHaveTextContent("Loaded|false");

  await settle(() => f.set(shape.name, "Edited", { origin: "user" }));
  await settle(() => setData(loaded)); // same object: nothing happens
  await expect.element(name).toHaveTextContent("Edited|true");

  await settle(() => f.reset());
  await expect.element(name, { message: "reset returns to the loaded data" }).toHaveTextContent("Loaded|false");

  await settle(() => setData({ ...loaded, name: "Refetched" }));
  await expect.element(name).toHaveTextContent("Refetched|false");
});

test("values given on the first render are used at creation", async () => {
  let f!: RootStore<typeof shape>;
  function App() {
    f = useForm(shape, empty(), { values: { ...empty(), name: "Ready" } });
    return null;
  }
  await render(<App />);
  expect(f.get(shape.name)).toBe("Ready");
  expect(f.getInitial(shape.name)).toBe("Ready");
});

// ---------------------------------------------------------------------------
// useSync
test("useSync feeds a limit from React; survives reset; writes only on change", async () => {
  let f!: RootStore<typeof shape>;
  let setMax!: (n: number | undefined) => void;
  function App() {
    f = useForm(shape, { ...empty(), lines: [{ qty: 5 }] }, { behaviors: max(L.qty, L.qty.maxQty) });
    const row = f.substore(shape.lines).itemAt(0);
    return (
      <StoreProvider store={f}>
        <StoreProvider store={row}>
          <Line />
        </StoreProvider>
      </StoreProvider>
    );
  }
  function Line() {
    const [available, set] = useState<number | undefined>(undefined); // e.g. from a query
    setMax = set;
    useSync(L.qty.maxQty, available);
    const error = useValue(L.qty.error);
    return <span data-testid="line">{error ?? "ok"}</span>;
  }
  const screen = await render(<App />);
  const line = screen.getByTestId("line");
  await expect.element(line, { message: "no limit while loading" }).toHaveTextContent("ok");

  const row = () => f.substore(shape.lines).itemAt(0);
  let writes = 0;
  f.subscribe(countIn(shape, "error"), () => writes++);
  row().subscribe(L.qty.maxQty, () => writes++);

  await settle(() => setMax(3));
  await expect.element(line).toHaveTextContent("Must be at most 3");
  expect(writes, "the key changed once and the error count once").toBe(2);

  await settle(() => f.reset());
  expect(row().get(L.qty.maxQty), "kept by reset").toBe(3);
  await expect.element(line).toHaveTextContent("Must be at most 3");

  await settle(() => setMax(10));
  await expect.element(line).toHaveTextContent("ok");
});

test("useSync warns for meta keys without keepOnReset; resetOnUnmount", async () => {
  const { warnings, restore } = captureWarnings();
  let f!: RootStore<typeof shape>;
  let show!: (b: boolean) => void;
  function App() {
    const [visible, set] = useState(true);
    show = set;
    f = useForm(shape, empty());
    return <StoreProvider store={f}>{visible ? <Hint /> : null}</StoreProvider>;
  }
  function Hint() {
    useSync(shape.note.hint, "from component", { resetOnUnmount: true });
    return null;
  }
  await render(<App />);
  restore();
  expect(f.get(shape.note.hint)).toBe("from component");
  expect(warnings.some((w) => /keepOnReset/.test(w))).toBe(true);
  await settle(() => show(false));
  expect(f.get(shape.note.hint), "reset on unmount").toBe("");
});

test("useSync under StrictMode ends with the synced value", async () => {
  let f!: RootStore<typeof shape>;
  function App() {
    f = useForm(shape, empty());
    return (
      <StoreProvider store={f}>
        <Hint />
      </StoreProvider>
    );
  }
  function Hint() {
    useSync(shape.name, "synced", { resetOnUnmount: true });
    return null;
  }
  const { restore } = captureWarnings();
  await render(
    <StrictMode>
      <App />
    </StrictMode>
  );
  restore();
  expect(f.get(shape.name)).toBe("synced");
});

// ---------------------------------------------------------------------------
// DOM order and handleSubmit
/** An input registered as its node's focus target. */
function Field(props: { node: typeof shape.name | typeof shape.code; id: string }) {
  const c = useField(props.node);
  const register = (el: HTMLInputElement | null) => void (el && c.store.set(props.node.focusTarget, el));
  return <input data-testid={props.id} ref={register} value={c.value} onChange={(e) => c.onChange(e.target.value)} />;
}

test("submit focuses the first error in DOM order, not shape order", async () => {
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
  await settle(() => f.submit());
  await expect.element(screen.getByTestId("code")).toHaveFocus();
});

test("an explicit focusOrder overrides DOM order", async () => {
  let f!: RootStore<typeof shape>;
  function App() {
    f = useForm(shape, empty(), {
      behaviors: [rule(shape.name, () => "bad"), rule(shape.code, () => "bad")],
      focusOrder: () => 0, // keep shape order
    });
    return (
      <StoreProvider store={f}>
        <Field node={shape.code} id="code" />
        <Field node={shape.name} id="name" />
      </StoreProvider>
    );
  }
  const screen = await render(<App />);
  await settle(() => f.submit());
  await expect.element(screen.getByTestId("name")).toHaveFocus();
});

test("handleSubmit on a real <form>: default prevented, onValid gets values", async () => {
  let f!: RootStore<typeof shape>;
  const saved: string[] = [];
  function App() {
    f = useForm(shape, { ...empty(), name: "Ann" });
    return (
      <StoreProvider store={f}>
        <form data-testid="form" onSubmit={f.handleSubmit((values) => void saved.push(values.name))}>
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
  expect(f.get(shape.submitCount)).toBe(1);
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

// ---------------------------------------------------------------------------
// useSync on a value node, and under a row provider
test("useSync on a value node with resetOnUnmount restores the node's initial value", async () => {
  const s = createStore(shape, { ...empty(), note: "from the server" });
  function Sync({ value }: { value: string }) {
    useSync(shape.note, value, { resetOnUnmount: true });
    return null;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <Sync value="synced" />
    </StoreProvider>
  );
  expect(s.get(shape.note)).toBe("synced");
  await screen.unmount();
  expect(s.get(shape.note), "the initial value, not a meta default").toBe("from the server");
});

test("useSync under a row provider writes that row; after the row is removed it neither writes nor throws", async () => {
  const s = createStore(shape, { ...empty(), lines: [{ qty: 1 }, { qty: 2 }] });
  const lines = s.substore(shape.lines);
  const [first, second] = lines.items();
  function Sync({ limit }: { limit: number }) {
    useSync(L.qty.maxQty, limit);
    return null;
  }
  const tree = (limit: number) => (
    <StoreProvider store={s}>
      <StoreProvider store={second}>
        <Sync limit={limit} />
      </StoreProvider>
    </StoreProvider>
  );
  const screen = await render(tree(5));
  expect(second.get(L.qty.maxQty)).toBe(5);
  expect(first.get(L.qty.maxQty)).toBe(undefined);

  await settle(() => lines.remove(second));
  await screen.rerender(tree(9));
  expect(lines.items().map((r) => r.get(L.qty.maxQty))).toEqual([undefined]);
  expect(second.get(L.qty.maxQty), "the detached row was not written").toBe(5);
});

// Documented caveat: `values` is compared by reference. A refetch that returns
// an equal-but-new object reloads the form and discards the user's edits.
test("caveat: a new values object with identical data replaces the user's edits", async () => {
  let setData!: (v: Values) => void;
  let f!: RootStore<typeof shape>;
  function App() {
    const [data, set] = useState<Values>({ ...empty(), name: "Loaded" });
    setData = set;
    f = useForm(shape, empty(), { values: data });
    return null;
  }
  await render(<App />);
  await settle(() => f.set(shape.name, "Edited", { origin: "user" }));
  await settle(() => setData({ ...empty(), name: "Loaded" }));
  expect(f.get(shape.name)).toBe("Loaded");
  expect(f.get(shape.name.dirty)).toBe(false);
});
