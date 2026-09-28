// Run: node scripts/browser-test.mjs src/react/react.test.ts   (types: npx tsc)
import { createElement as h, act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  form, object, array, field, createStore, countIn, rule, control, type InferValue, type Origin, type ItemStore,
} from "../index";
import { StoreProvider, useStore, useValue, useField, useControl, useArray, fromInput, fromCheckbox, resolveStore } from "./index";
import { testAsync, runAsyncAndSignal, eq, deepEq, throws } from "../test/harness";

const shape = form({
  name: field<string>().meta(control()),
  agree: field<boolean>().meta(control()),
  age: field<number>().meta(control()),
  note: field<string>(),
  label: field<string>().meta({ hint: "tip" }),
  discount: field<number>(),
  shipping: object({ city: field<string>().meta(control()) }),
  lines: array(object({ sku: field<string>().meta(control()), qty: field<number>().meta(control()) }), {
    create: () => ({ sku: "", qty: 1 }),
  }),
});
type Values = InferValue<typeof shape>;
const L = shape.lines.item;

function initial(): Values {
  return {
    name: "Ann", agree: false, age: 30, note: "", label: "L", discount: 0.1,
    shipping: { city: "Riga" },
    lines: [{ sku: "A", qty: 1 }, { sku: "B", qty: 2 }],
  };
}

// ---------------------------------------------------------------------------
// Rendering helpers
let root: Root | undefined;
async function mount(node: ReactNode) {
  if (root) await unmount(); // a failed test may have left its root mounted
  const container = document.getElementById("root")!;
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}
async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}
async function run(fn: () => void) {
  await act(async () => fn());
}
function counter() {
  const counts: Record<string, number> = {};
  return { counts, hit: (k: string) => void (counts[k] = (counts[k] ?? 0) + 1), reset: () => Object.keys(counts).forEach((k) => delete counts[k]) };
}
const text = (id: string) => document.getElementById(id)?.textContent;

/** Types a value into a controlled input the way a user would (React listens to 'input'). */
function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
  const n: number = useValue(countIn(shape, "error"));
  const e: string | undefined = useValue(shape.name.error);
  const len: number = useValue(shape.lines, (lines) => lines.length);
  const hint: string = useField(shape.label).meta.hint;
  return [n, e, len, hint];
}

// ---------------------------------------------------------------------------
// useValue
testAsync("useValue: values, meta keys and counts; only affected components re-render", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, (v) => (v ? undefined : "Required")) });
  const c = counter();
  function Name() {
    c.hit("name");
    return h("span", { id: "name" }, useValue(shape.name));
  }
  function Age() {
    c.hit("age");
    return h("span", { id: "age" }, String(useValue(shape.age)));
  }
  function Errors() {
    c.hit("errors");
    const count = useValue(countIn(shape, "error"));
    const error = useValue(shape.name.error);
    return h("span", { id: "errors" }, `${count}:${error ?? "-"}`);
  }
  await mount(h(StoreProvider, { store: s }, h(Name, {}), h(Age, {}), h(Errors, {})));
  eq(text("name"), "Ann");
  eq(text("errors"), "0:-");
  c.reset();

  await run(() => s.set(shape.name, "Bob"));
  eq(text("name"), "Bob");
  deepEq(c.counts, { name: 1 }, "age and errors did not re-render");

  await run(() => s.set(shape.name, ""));
  eq(text("errors"), "1:Required");
  deepEq(c.counts, { name: 2, errors: 1 });
  await unmount();
});

testAsync("hooks subscribe per reference, not to the whole store", async () => {
  const s = createStore(shape, initial());
  const calls: number[] = [];
  const original = s.subscribe.bind(s) as (...args: any[]) => () => void;
  (s as any).subscribe = (...args: any[]) => {
    calls.push(args.length);
    return original(...args);
  };
  function C() {
    useValue(shape.name);
    useControl(shape.age);
    useArray(shape.lines);
    return null;
  }
  await mount(h(StoreProvider, { store: s }, h(C, {})));
  eq(calls.length > 0, true);
  eq(calls.every((n) => n === 2), true, "every subscription names a reference");
  await unmount();
});

testAsync("useValue with a selector re-renders only when the result changes", async () => {
  const s = createStore(shape, initial());
  const c = counter();
  function Count() {
    c.hit("count");
    return h("span", { id: "count" }, String(useValue(shape.lines, (lines) => lines.length)));
  }
  function Skus() {
    c.hit("skus");
    const skus = useValue(shape.lines, (lines) => lines.map((l) => l.sku), {
      equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
    });
    return h("span", { id: "skus" }, skus.join(","));
  }
  await mount(h(StoreProvider, { store: s }, h(Count, {}), h(Skus, {})));
  c.reset();
  const lines = s.substore(shape.lines);
  await run(() => lines.itemAt(0).set(L.qty, 9));
  deepEq(c.counts, {}, "a row edit changes neither the length nor the skus");
  await run(() => lines.itemAt(0).set(L.sku, "Z"));
  deepEq(c.counts, { skus: 1 });
  eq(text("skus"), "Z,B");
  await run(() => lines.append({ sku: "C" }));
  eq(text("count"), "3");
  deepEq(c.counts, { skus: 2, count: 1 });
  await unmount();
});

// ---------------------------------------------------------------------------
// Resolution
testAsync("row provider: template refs resolve to the row, root refs to the root", async () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(1);
  function Row() {
    const qty = useValue(L.qty);
    const discount = useValue(shape.discount);
    return h("span", { id: "row" }, `${qty}/${discount}`);
  }
  await mount(h(StoreProvider, { store: s }, h(StoreProvider, { store: row }, h(Row, {}))));
  eq(text("row"), "2/0.1");
  await run(() => s.set(shape.discount, 0.2));
  eq(text("row"), "2/0.2");
  await unmount();
});

testAsync("object substore provider and an explicit store", async () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  function Both() {
    const city = useValue(shape.shipping.city);
    const name = useValue(shape.name);
    const other = useValue(L.sku, { store: b });
    return h("span", { id: "both" }, `${city}/${name}/${other}`);
  }
  await mount(h(StoreProvider, { store: a }, h(StoreProvider, { store: s.substore(shape.shipping) }, h(Both, {}))));
  eq(text("both"), "Riga/Ann/B", "the explicit store wins over the provider");
  await unmount();
});

testAsync("resolution errors", async () => {
  const s = createStore(shape, initial());
  const other = form({ x: field<string>() });
  throws(() => resolveStore(s, L.qty), /inside a row that the provided store cannot reach/);
  throws(() => resolveStore(s, other.x), /not part of this form/);
  let caught: unknown;
  function NoProvider() {
    try {
      useStore();
    } catch (e) {
      caught = e;
    }
    return null;
  }
  await mount(h(NoProvider, {}));
  eq(/No store/.test((caught as Error).message), true);
  await unmount();
});

// ---------------------------------------------------------------------------
// useField / useControl
testAsync("useField: value, onChange (origin user), own meta", async () => {
  const s = createStore(shape, initial());
  const origins: Origin[][] = [];
  s.react(shape.label, (_n, _p, info) => origins.push([...info.origins]));
  let field!: ReturnType<typeof useField<typeof shape.label>>;
  let bare!: ReturnType<typeof useField<typeof shape.note>>;
  function F() {
    field = useField(shape.label);
    bare = useField(shape.note);
    return h("span", { id: "f" }, `${field.value}:${field.meta.hint}`);
  }
  await mount(h(StoreProvider, { store: s }, h(F, {})));
  eq(text("f"), "L:tip");
  deepEq(bare.meta, {});
  const first = field.onChange;
  await run(() => field.onChange("M"));
  eq(text("f"), "M:tip");
  deepEq(origins, [["user"]]);
  eq(field.onChange, first, "onChange is stable");
  await run(() => s.set(shape.label.hint, "new"));
  eq(text("f"), "M:new");
  await unmount();
});

testAsync("useControl: state, user writes set touched/dirty, errors", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, (v) => (v.length > 2 ? undefined : "Too short")) });
  let c!: ReturnType<typeof useControl<typeof shape.name>>;
  function C() {
    c = useControl(shape.name);
    return h("span", { id: "c" }, `${c.value}|${c.error ?? "-"}|${c.touched}|${c.dirty}`);
  }
  await mount(h(StoreProvider, { store: s }, h(C, {})));
  eq(text("c"), "Ann|-|false|false");
  await run(() => c.onChange("Al"));
  eq(text("c"), "Al|Too short|true|true");
  await run(() => s.reset());
  eq(text("c"), "Ann|-|false|false");
  await unmount();
});

testAsync("focusRef registers the element, focus() and submit use it, unmount clears it", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, () => "bad") });
  function Input() {
    const c = useControl(shape.name);
    return h("input", { id: "in", ref: c.focusRef, value: c.value, onChange: fromInput(c.onChange) });
  }
  await mount(h(StoreProvider, { store: s }, h(Input, {})));
  const input = document.getElementById("in") as HTMLInputElement;
  eq(s.get(shape.name.focusTarget), input);
  await act(async () => void (await s.submit()));
  eq(document.activeElement, input, "submit focused the first error");
  await unmount();
  eq(s.get(shape.name.focusTarget), undefined, "cleared on unmount");
});

// ---------------------------------------------------------------------------
// Native adapters with real DOM events
testAsync("fromInput / fromCheckbox with real events; handlers are cached", async () => {
  const s = createStore(shape, initial());
  let nameOnChange!: (v: string) => void;
  function Inputs() {
    const name = useControl(shape.name);
    const agree = useControl(shape.agree);
    nameOnChange = name.onChange;
    return h(
      "div",
      {},
      h("input", { id: "name", value: name.value, onChange: fromInput(name.onChange) }),
      h("input", { id: "agree", type: "checkbox", checked: agree.value, onChange: fromCheckbox(agree.onChange) })
    );
  }
  await mount(h(StoreProvider, { store: s }, h(Inputs, {})));
  await run(() => typeInto(document.getElementById("name") as HTMLInputElement, "Zoe"));
  eq(s.get(shape.name), "Zoe");
  eq(s.get(shape.name.touched), true, "written as the user");
  eq((document.getElementById("name") as HTMLInputElement).value, "Zoe");
  await run(() => (document.getElementById("agree") as HTMLInputElement).click());
  eq(s.get(shape.agree), true);
  eq(fromInput(nameOnChange), fromInput(nameOnChange));
  await unmount();
});

// ---------------------------------------------------------------------------
// useArray
testAsync("useArray: the list re-renders on structure only; a row edit re-renders that row", async () => {
  const s = createStore(shape, initial());
  const c = counter();
  function Line() {
    const qty = useControl(L.qty);
    const sku = useValue(L.sku);
    c.hit(`row:${sku}`);
    useEffect(() => c.hit("mount"), []);
    return h("li", {}, `${sku}=${qty.value}`);
  }
  let lines!: ReturnType<typeof useArray<typeof shape.lines>>;
  function List() {
    lines = useArray(shape.lines);
    c.hit("list");
    return h(
      "ul",
      { id: "list" },
      lines.items.map((row: ItemStore<typeof L>) => h(StoreProvider, { key: row.stableId, store: row }, h(Line, {})))
    );
  }
  await mount(h(StoreProvider, { store: s }, h(List, {})));
  eq(text("list"), "A=1B=2");
  c.reset();

  await run(() => s.substore(shape.lines).itemAt(1).set(L.qty, 7));
  eq(text("list"), "A=1B=7");
  deepEq(c.counts, { "row:B": 1 }, "only row B re-rendered");

  const origins: Origin[][] = [];
  s.react(shape.lines, (_n, _p, info) => origins.push([...info.origins]));
  await run(() => void lines.append({ sku: "C" }));
  eq(text("list"), "A=1B=7C=1");
  deepEq(origins, [["user"]], "helpers write as the user");
  c.reset();

  await run(() => lines.move(lines.items[2], 0));
  eq(text("list"), "C=1A=1B=7");
  eq(c.counts.list, 1);
  eq(c.counts.mount, undefined, "no row was remounted: keyed by stableId");

  await run(() => lines.remove(lines.items[1]));
  eq(text("list"), "C=1B=7");
  await unmount();
});

testAsync("useArray inside a row provider resolves nested arrays", async () => {
  const f = form({ groups: array(object({ items: array(object({ v: field<string>() })) })) });
  const s = createStore(f, { groups: [{ items: [{ v: "a" }, { v: "b" }] }] });
  const group = s.substore(f.groups).itemAt(0);
  function Items() {
    const items = useArray(f.groups.item.items);
    return h("span", { id: "n" }, String(items.items.length));
  }
  await mount(h(StoreProvider, { store: group }, h(Items, {})));
  eq(text("n"), "2");
  await unmount();
});

runAsyncAndSignal("react.test.ts");
