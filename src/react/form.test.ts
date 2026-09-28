// Run: node scripts/browser-test.mjs src/react/form.test.ts   (types: npx tsc)
import { createElement as h, act, useState, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  form, object, array, field, metaKey, rule, max, control, submission, countIn,
  type InferValue, type RootStore,
} from "../index";
import { StoreProvider, useForm, useSync, useControl, useValue, fromInput, domOrder } from "./index";
import { testAsync, runAsyncAndSignal, eq, deepEq } from "../test/harness";

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
let root: Root | undefined;
async function mount(node: ReactNode) {
  if (root) await unmount();
  root = createRoot(document.getElementById("root")!);
  await act(async () => root!.render(node));
}
async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}
async function run(fn: () => unknown) {
  await act(async () => void (await fn()));
}
const text = (id: string) => document.getElementById(id)?.textContent;
function captureWarnings() {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  return { warnings, restore: () => (console.warn = original) };
}

// ---------------------------------------------------------------------------
// useForm
testAsync("useForm creates the store once; later initialValues are ignored", async () => {
  const stores = new Set<RootStore<typeof shape>>();
  let setTick!: (n: number) => void;
  function App() {
    const [tick, set] = useState(0);
    setTick = set;
    const f = useForm(shape, { ...empty(), name: `n${tick}` });
    stores.add(f);
    return h(StoreProvider, { store: f }, h(Name, {}));
  }
  function Name() {
    return h("span", { id: "name" }, useValue(shape.name));
  }
  await mount(h(App, {}));
  await run(() => setTick(1));
  await run(() => setTick(2));
  eq(stores.size, 1);
  eq(text("name"), "n0");
  await unmount();
});

testAsync("useForm passes behaviors and warns when the shape changes", async () => {
  const other = form(object({ name: field<string>().meta(control()) }).meta(submission()));
  const { warnings, restore } = captureWarnings();
  let useOther!: (b: boolean) => void;
  function App() {
    const [flip, set] = useState(false);
    useOther = set;
    const f = useForm((flip ? other : shape) as typeof shape, empty(), {
      behaviors: rule(shape.name, (v) => (v ? undefined : "Required")),
    });
    return h(StoreProvider, { store: f }, h(Err, {}));
  }
  function Err() {
    return h("span", { id: "err" }, useValue(shape.name.error) ?? "-");
  }
  await mount(h(App, {}));
  eq(text("err"), "Required");
  await run(() => useOther(true));
  restore();
  eq(warnings.some((w) => /shape` changed/.test(w)), true);
  await unmount();
});

testAsync("values: loading data becomes the baseline; same object keeps edits; a new object reloads", async () => {
  let setData!: (v: Values | undefined) => void;
  let f!: RootStore<typeof shape>;
  function App() {
    const [data, set] = useState<Values | undefined>(undefined);
    setData = set;
    f = useForm(shape, empty(), { values: data });
    return h(StoreProvider, { store: f }, h(Name, {}));
  }
  function Name() {
    const c = useControl(shape.name);
    return h("span", { id: "name" }, `${c.value}|${c.dirty}`);
  }
  await mount(h(App, {}));
  eq(text("name"), "|false", "loading: initialValues");

  const loaded = { ...empty(), name: "Loaded" };
  await run(() => setData(loaded));
  eq(text("name"), "Loaded|false", "loaded as the baseline: not dirty");

  await run(() => f.set(shape.name, "Edited", { origin: "user" }));
  await run(() => setData(loaded)); // same object: nothing happens
  eq(text("name"), "Edited|true");

  await run(() => f.reset());
  eq(text("name"), "Loaded|false", "reset returns to the loaded data");

  await run(() => setData({ ...loaded, name: "Refetched" }));
  eq(text("name"), "Refetched|false");
  await unmount();
});

testAsync("values given on the first render are used at creation", async () => {
  let f!: RootStore<typeof shape>;
  function App() {
    f = useForm(shape, empty(), { values: { ...empty(), name: "Ready" } });
    return null;
  }
  await mount(h(App, {}));
  eq(f.get(shape.name), "Ready");
  eq(f.getInitial(shape.name), "Ready");
  await unmount();
});

// ---------------------------------------------------------------------------
// useSync
testAsync("useSync feeds a limit from React; survives reset; writes only on change", async () => {
  let f!: RootStore<typeof shape>;
  let setMax!: (n: number | undefined) => void;
  function App() {
    f = useForm(shape, { ...empty(), lines: [{ qty: 5 }] }, { behaviors: max(L.qty, L.qty.maxQty) });
    const row = f.substore(shape.lines).itemAt(0);
    return h(StoreProvider, { store: f }, h(StoreProvider, { store: row }, h(Line, {})));
  }
  function Line() {
    const [available, set] = useState<number | undefined>(undefined); // e.g. from a query
    setMax = set;
    useSync(L.qty.maxQty, available);
    const qty = useControl(L.qty);
    return h("span", { id: "line" }, qty.error ?? "ok");
  }
  await mount(h(App, {}));
  eq(text("line"), "ok", "no limit while loading");

  const row = () => f.substore(shape.lines).itemAt(0);
  let writes = 0;
  f.subscribe(countIn(shape, "error"), () => writes++);
  row().subscribe(L.qty.maxQty, () => writes++);

  await run(() => setMax(3));
  eq(text("line"), "Must be at most 3");
  eq(writes, 2, "the key changed once and the error count once");

  await run(() => f.reset());
  eq(row().get(L.qty.maxQty), 3, "kept by reset");
  eq(text("line"), "Must be at most 3");

  await run(() => setMax(10));
  eq(text("line"), "ok");
  await unmount();
});

testAsync("useSync warns for meta keys without keepOnReset; resetOnUnmount", async () => {
  const { warnings, restore } = captureWarnings();
  let f!: RootStore<typeof shape>;
  let show!: (b: boolean) => void;
  function App() {
    const [visible, set] = useState(true);
    show = set;
    f = useForm(shape, empty());
    return h(StoreProvider, { store: f }, visible ? h(Hint, {}) : null);
  }
  function Hint() {
    useSync(shape.note.hint, "from component", { resetOnUnmount: true });
    return null;
  }
  await mount(h(App, {}));
  restore();
  eq(f.get(shape.note.hint), "from component");
  eq(warnings.some((w) => /keepOnReset/.test(w)), true);
  await run(() => show(false));
  eq(f.get(shape.note.hint), "", "reset on unmount");
  await unmount();
});

testAsync("useSync under StrictMode ends with the synced value", async () => {
  let f!: RootStore<typeof shape>;
  function App() {
    f = useForm(shape, empty());
    return h(StoreProvider, { store: f }, h(Hint, {}));
  }
  function Hint() {
    useSync(shape.name, "synced", { resetOnUnmount: true });
    return null;
  }
  const { restore } = captureWarnings();
  await mount(h(StrictMode, {}, h(App, {})));
  restore();
  eq(f.get(shape.name), "synced");
  await unmount();
});

// ---------------------------------------------------------------------------
// DOM order and handleSubmit
function Field(props: { node: typeof shape.name | typeof shape.code; id: string }) {
  const c = useControl(props.node);
  return h("input", { id: props.id, ref: c.focusRef, value: c.value, onChange: fromInput(c.onChange) });
}

testAsync("submit focuses the first error in DOM order, not shape order", async () => {
  let f!: RootStore<typeof shape>;
  function App() {
    f = useForm(shape, empty(), { behaviors: [rule(shape.name, () => "bad"), rule(shape.code, () => "bad")] });
    // code is rendered before name, but name comes first in the shape
    return h(StoreProvider, { store: f }, h(Field, { node: shape.code, id: "code" }), h(Field, { node: shape.name, id: "name" }));
  }
  await mount(h(App, {}));
  await run(() => f.submit());
  eq(document.activeElement?.id, "code");
  await unmount();
});

testAsync("an explicit focusOrder overrides DOM order", async () => {
  let f!: RootStore<typeof shape>;
  function App() {
    f = useForm(shape, empty(), {
      behaviors: [rule(shape.name, () => "bad"), rule(shape.code, () => "bad")],
      focusOrder: () => 0, // keep shape order
    });
    return h(StoreProvider, { store: f }, h(Field, { node: shape.code, id: "code" }), h(Field, { node: shape.name, id: "name" }));
  }
  await mount(h(App, {}));
  await run(() => f.submit());
  eq(document.activeElement?.id, "name");
  await unmount();
});

testAsync("handleSubmit on a real <form>: default prevented, onValid gets values", async () => {
  let f!: RootStore<typeof shape>;
  const saved: string[] = [];
  function App() {
    f = useForm(shape, { ...empty(), name: "Ann" });
    return h(
      StoreProvider,
      { store: f },
      h("form", { id: "form", onSubmit: f.handleSubmit((values) => void saved.push(values.name)) }, h("button", { id: "go", type: "submit" }, "Save"))
    );
  }
  await mount(h(App, {}));
  let defaultPrevented: boolean | undefined;
  document.getElementById("form")!.addEventListener("submit", (e) => queueMicrotask(() => (defaultPrevented = e.defaultPrevented)));
  await run(async () => {
    (document.getElementById("go") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
  });
  deepEq(saved, ["Ann"]);
  eq(defaultPrevented, true);
  eq(f.get(shape.submitCount), 1);
  await unmount();
});

testAsync("domOrder: nodes by document position, other targets equal", async () => {
  const a = document.createElement("i");
  const b = document.createElement("b");
  document.body.append(a, b);
  eq(domOrder(a, b), -1);
  eq(domOrder(b, a), 1);
  eq(domOrder(a, { focus() {} }), 0);
  a.remove();
  b.remove();
});

runAsyncAndSignal("form.test.ts");
