import { createElement as h, act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  form, object, array, field, createStore, countIn, rule, control, type InferValue, type Origin, type ItemStore,
} from "../index";
import { StoreProvider, useStore, useValue, useField, useControl, useArray, fromInput, fromCheckbox, resolveStore } from "./index";
import "./test-setup";
import { it, expect } from "vitest";

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
it("useValue: values, meta keys and counts; only affected components re-render", async () => {
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
  expect(text("name")).toBe("Ann");
  expect(text("errors")).toBe("0:-");
  c.reset();

  await run(() => s.set(shape.name, "Bob"));
  expect(text("name")).toBe("Bob");
  expect(c.counts, "age and errors did not re-render").toEqual({ name: 1 });

  await run(() => s.set(shape.name, ""));
  expect(text("errors")).toBe("1:Required");
  expect(c.counts).toEqual({ name: 2, errors: 1 });
  await unmount();
});

it("hooks subscribe per reference, not to the whole store", async () => {
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
  expect(calls.length > 0).toBe(true);
  expect(calls.every((n) => n === 2), "every subscription names a reference").toBe(true);
  await unmount();
});

it("useValue with a selector re-renders only when the result changes", async () => {
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
  expect(c.counts, "a row edit changes neither the length nor the skus").toEqual({});
  await run(() => lines.itemAt(0).set(L.sku, "Z"));
  expect(c.counts).toEqual({ skus: 1 });
  expect(text("skus")).toBe("Z,B");
  await run(() => lines.append({ sku: "C" }));
  expect(text("count")).toBe("3");
  expect(c.counts).toEqual({ skus: 2, count: 1 });
  await unmount();
});

// ---------------------------------------------------------------------------
// Resolution
it("row provider: template refs resolve to the row, root refs to the root", async () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(1);
  function Row() {
    const qty = useValue(L.qty);
    const discount = useValue(shape.discount);
    return h("span", { id: "row" }, `${qty}/${discount}`);
  }
  await mount(h(StoreProvider, { store: s }, h(StoreProvider, { store: row }, h(Row, {}))));
  expect(text("row")).toBe("2/0.1");
  await run(() => s.set(shape.discount, 0.2));
  expect(text("row")).toBe("2/0.2");
  await unmount();
});

it("object substore provider and an explicit store", async () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  function Both() {
    const city = useValue(shape.shipping.city);
    const name = useValue(shape.name);
    const other = useValue(L.sku, { store: b });
    return h("span", { id: "both" }, `${city}/${name}/${other}`);
  }
  await mount(h(StoreProvider, { store: a }, h(StoreProvider, { store: s.substore(shape.shipping) }, h(Both, {}))));
  expect(text("both"), "the explicit store wins over the provider").toBe("Riga/Ann/B");
  await unmount();
});

it("resolution errors", async () => {
  const s = createStore(shape, initial());
  const other = form({ x: field<string>() });
  expect(() => resolveStore(s, L.qty)).toThrow(/inside a row that the provided store cannot reach/);
  expect(() => resolveStore(s, other.x)).toThrow(/not part of this form/);
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
  expect(/No store/.test((caught as Error).message)).toBe(true);
  await unmount();
});

// ---------------------------------------------------------------------------
// useField / useControl
it("useField: value, onChange (origin user), own meta", async () => {
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
  expect(text("f")).toBe("L:tip");
  expect(bare.meta).toEqual({});
  const first = field.onChange;
  await run(() => field.onChange("M"));
  expect(text("f")).toBe("M:tip");
  expect(origins).toEqual([["user"]]);
  expect(field.onChange, "onChange is stable").toBe(first);
  await run(() => s.set(shape.label.hint, "new"));
  expect(text("f")).toBe("M:new");
  await unmount();
});

it("useControl: state, user writes set touched/dirty, errors", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, (v) => (v.length > 2 ? undefined : "Too short")) });
  let c!: ReturnType<typeof useControl<typeof shape.name>>;
  function C() {
    c = useControl(shape.name);
    return h("span", { id: "c" }, `${c.value}|${c.error ?? "-"}|${c.touched}|${c.dirty}`);
  }
  await mount(h(StoreProvider, { store: s }, h(C, {})));
  expect(text("c")).toBe("Ann|-|false|false");
  await run(() => c.onChange("Al"));
  expect(text("c")).toBe("Al|Too short|true|true");
  await run(() => s.reset());
  expect(text("c")).toBe("Ann|-|false|false");
  await unmount();
});

it("focusRef registers the element, focus() and submit use it, unmount clears it", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, () => "bad") });
  function Input() {
    const c = useControl(shape.name);
    return h("input", { id: "in", ref: c.focusRef, value: c.value, onChange: fromInput(c.onChange) });
  }
  await mount(h(StoreProvider, { store: s }, h(Input, {})));
  const input = document.getElementById("in") as HTMLInputElement;
  expect(s.get(shape.name.focusTarget)).toBe(input);
  await act(async () => void (await s.submit()));
  expect(document.activeElement, "submit focused the first error").toBe(input);
  await unmount();
  expect(s.get(shape.name.focusTarget), "cleared on unmount").toBe(undefined);
});

// ---------------------------------------------------------------------------
// Native adapters with real DOM events
it("fromInput / fromCheckbox with real events; handlers are cached", async () => {
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
  expect(s.get(shape.name)).toBe("Zoe");
  expect(s.get(shape.name.touched), "written as the user").toBe(true);
  expect((document.getElementById("name") as HTMLInputElement).value).toBe("Zoe");
  await run(() => (document.getElementById("agree") as HTMLInputElement).click());
  expect(s.get(shape.agree)).toBe(true);
  expect(fromInput(nameOnChange)).toBe(fromInput(nameOnChange));
  await unmount();
});

// ---------------------------------------------------------------------------
// useArray
it("useArray: the list re-renders on structure only; a row edit re-renders that row", async () => {
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
  expect(text("list")).toBe("A=1B=2");
  c.reset();

  await run(() => s.substore(shape.lines).itemAt(1).set(L.qty, 7));
  expect(text("list")).toBe("A=1B=7");
  expect(c.counts, "only row B re-rendered").toEqual({ "row:B": 1 });

  const origins: Origin[][] = [];
  s.react(shape.lines, (_n, _p, info) => origins.push([...info.origins]));
  await run(() => void lines.append({ sku: "C" }));
  expect(text("list")).toBe("A=1B=7C=1");
  expect(origins, "helpers write as the user").toEqual([["user"]]);
  c.reset();

  await run(() => lines.move(lines.items[2], 0));
  expect(text("list")).toBe("C=1A=1B=7");
  expect(c.counts.list).toBe(1);
  expect(c.counts.mount, "no row was remounted: keyed by stableId").toBe(undefined);

  await run(() => lines.remove(lines.items[1]));
  expect(text("list")).toBe("C=1B=7");
  await unmount();
});

it("useArray inside a row provider resolves nested arrays", async () => {
  const f = form({ groups: array(object({ items: array(object({ v: field<string>() })) })) });
  const s = createStore(f, { groups: [{ items: [{ v: "a" }, { v: "b" }] }] });
  const group = s.substore(f.groups).itemAt(0);
  function Items() {
    const items = useArray(f.groups.item.items);
    return h("span", { id: "n" }, String(items.items.length));
  }
  await mount(h(StoreProvider, { store: group }, h(Items, {})));
  expect(text("n")).toBe("2");
  await unmount();
});
