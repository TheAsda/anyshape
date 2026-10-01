import { useEffect } from "react";
import { test, expect } from "vitest";
import {
  form, object, array, field, createStore, countIn, rule, type InferValue, type Origin,
  type ItemStore,
} from "../index";
import { control } from "../test/features";
import { StoreProvider, useStore, useValue, useField, useControl, useArray, fromInput, fromCheckbox, resolveStore } from "./index";
import { render, settle, renders } from "./test-utils";

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
test("useValue: values, meta keys and counts; only affected components re-render", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, (v) => (v ? undefined : "Required")) });
  const c = renders();
  function Name() {
    c.hit("name");
    return <span data-testid="name">{useValue(shape.name)}</span>;
  }
  function Age() {
    c.hit("age");
    return <span data-testid="age">{String(useValue(shape.age))}</span>;
  }
  function Errors() {
    c.hit("errors");
    const count = useValue(countIn(shape, "error"));
    const error = useValue(shape.name.error);
    return <span data-testid="errors">{`${count}:${error ?? "-"}`}</span>;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <Name />
      <Age />
      <Errors />
    </StoreProvider>
  );
  await expect.element(screen.getByTestId("name")).toHaveTextContent("Ann");
  await expect.element(screen.getByTestId("errors")).toHaveTextContent("0:-");
  c.reset();

  await settle(() => s.set(shape.name, "Bob"));
  await expect.element(screen.getByTestId("name")).toHaveTextContent("Bob");
  expect(c.counts, "age and errors did not re-render").toEqual({ name: 1 });

  await settle(() => s.set(shape.name, ""));
  await expect.element(screen.getByTestId("errors")).toHaveTextContent("1:Required");
  expect(c.counts).toEqual({ name: 2, errors: 1 });
});

test("hooks subscribe per reference, not to the whole store", async () => {
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
  await render(
    <StoreProvider store={s}>
      <C />
    </StoreProvider>
  );
  expect(calls.length > 0).toBe(true);
  expect(calls.every((n) => n === 2), "every subscription names a reference").toBe(true);
});

test("useValue with a selector re-renders only when the result changes", async () => {
  const s = createStore(shape, initial());
  const c = renders();
  function Count() {
    c.hit("count");
    return <span data-testid="count">{String(useValue(shape.lines, (lines) => lines.length))}</span>;
  }
  function Skus() {
    c.hit("skus");
    const skus = useValue(shape.lines, (lines) => lines.map((l) => l.sku), {
      equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
    });
    return <span data-testid="skus">{skus.join(",")}</span>;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <Count />
      <Skus />
    </StoreProvider>
  );
  c.reset();
  const lines = s.substore(shape.lines);
  await settle(() => lines.itemAt(0).set(L.qty, 9));
  expect(c.counts, "a row edit changes neither the length nor the skus").toEqual({});
  await settle(() => lines.itemAt(0).set(L.sku, "Z"));
  expect(c.counts).toEqual({ skus: 1 });
  await expect.element(screen.getByTestId("skus")).toHaveTextContent("Z,B");
  await settle(() => lines.append({ sku: "C" }));
  await expect.element(screen.getByTestId("count")).toHaveTextContent("3");
  expect(c.counts).toEqual({ skus: 2, count: 1 });
});

// ---------------------------------------------------------------------------
// Resolution
test("row provider: template refs resolve to the row, root refs to the root", async () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(1);
  function Row() {
    const qty = useValue(L.qty);
    const discount = useValue(shape.discount);
    return <span data-testid="row">{`${qty}/${discount}`}</span>;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <StoreProvider store={row}>
        <Row />
      </StoreProvider>
    </StoreProvider>
  );
  await expect.element(screen.getByTestId("row")).toHaveTextContent("2/0.1");
  await settle(() => s.set(shape.discount, 0.2));
  await expect.element(screen.getByTestId("row")).toHaveTextContent("2/0.2");
});

test("object substore provider and an explicit store", async () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  function Both() {
    const city = useValue(shape.shipping.city);
    const name = useValue(shape.name);
    const other = useValue(L.sku, { store: b });
    return <span data-testid="both">{`${city}/${name}/${other}`}</span>;
  }
  const screen = await render(
    <StoreProvider store={a}>
      <StoreProvider store={s.substore(shape.shipping)}>
        <Both />
      </StoreProvider>
    </StoreProvider>
  );
  await expect.element(screen.getByTestId("both"), { message: "the explicit store wins over the provider" }).toHaveTextContent("Riga/Ann/B");
});

test("resolution errors", async () => {
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
  await render(<NoProvider />);
  expect(/No store/.test((caught as Error).message)).toBe(true);
});

// ---------------------------------------------------------------------------
// useField / useControl
test("useField: value, onChange (origin user), own meta", async () => {
  const s = createStore(shape, initial());
  const origins: Origin[][] = [];
  s.react(shape.label, (_n, _p, info) => origins.push([...info.origins]));
  let field!: ReturnType<typeof useField<typeof shape.label>>;
  let bare!: ReturnType<typeof useField<typeof shape.note>>;
  function F() {
    field = useField(shape.label);
    bare = useField(shape.note);
    return <span data-testid="f">{`${field.value}:${field.meta.hint}`}</span>;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <F />
    </StoreProvider>
  );
  const f = screen.getByTestId("f");
  await expect.element(f).toHaveTextContent("L:tip");
  expect(bare.meta).toEqual({});
  const first = field.onChange;
  await settle(() => field.onChange("M"));
  await expect.element(f).toHaveTextContent("M:tip");
  expect(origins).toEqual([["user"]]);
  expect(field.onChange, "onChange is stable").toBe(first);
  await settle(() => s.set(shape.label.hint, "new"));
  await expect.element(f).toHaveTextContent("M:new");
});

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
  expect(row.getMeta(L.sku).revealed, "nothing was written").toBe(false);
});

test("StoreProvider showError: a custom policy, inherited by nested row providers", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(L.sku, () => "bad") });
  const row = s.substore(shape.lines).items()[0];
  function Sku() {
    const c = useControl(L.sku);
    return <span data-testid="sku">{String(c.showError)}</span>;
  }
  const screen = await render(
    <StoreProvider store={s} showError={(st) => st.error !== undefined}>
      <StoreProvider store={row}>
        <Sku />
      </StoreProvider>
    </StoreProvider>
  );
  await expect.element(screen.getByTestId("sku")).toHaveTextContent("true");
});

test("focusRef registers the element, focus() and submit use it, unmount clears it", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, () => "bad") });
  function Input() {
    const c = useControl(shape.name);
    return <input data-testid="in" ref={c.focusRef} value={c.value} onChange={fromInput(c.onChange)} />;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <Input />
    </StoreProvider>
  );
  const input = screen.getByTestId("in");
  expect(s.get(shape.name.focusTarget)).toBe(input.element());
  await settle(() => s.submit());
  await expect.element(input, { message: "submit focused the first error" }).toHaveFocus();
  await screen.unmount();
  expect(s.get(shape.name.focusTarget), "cleared on unmount").toBe(undefined);
});

// ---------------------------------------------------------------------------
// Native adapters with real browser events
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

// ---------------------------------------------------------------------------
// useArray
test("useArray: the list re-renders on structure only; a row edit re-renders that row", async () => {
  const s = createStore(shape, initial());
  const c = renders();
  function Line() {
    const qty = useControl(L.qty);
    const sku = useValue(L.sku);
    c.hit(`row:${sku}`);
    useEffect(() => c.hit("mount"), []);
    return <li>{`${sku}=${qty.value}`}</li>;
  }
  let lines!: ReturnType<typeof useArray<typeof shape.lines>>;
  function List() {
    lines = useArray(shape.lines);
    c.hit("list");
    return (
      <ul data-testid="list">
        {lines.items.map((row: ItemStore<typeof L>) => (
          <StoreProvider key={row.stableId} store={row}>
            <Line />
          </StoreProvider>
        ))}
      </ul>
    );
  }
  const screen = await render(
    <StoreProvider store={s}>
      <List />
    </StoreProvider>
  );
  const list = screen.getByTestId("list");
  await expect.element(list).toHaveTextContent("A=1B=2");
  c.reset();

  await settle(() => s.substore(shape.lines).itemAt(1).set(L.qty, 7));
  await expect.element(list).toHaveTextContent("A=1B=7");
  expect(c.counts, "only row B re-rendered").toEqual({ "row:B": 1 });

  const origins: Origin[][] = [];
  s.react(shape.lines, (_n, _p, info) => origins.push([...info.origins]));
  await settle(() => void lines.append({ sku: "C" }));
  await expect.element(list).toHaveTextContent("A=1B=7C=1");
  expect(origins, "helpers write as the user").toEqual([["user"]]);
  c.reset();

  await settle(() => lines.move(lines.items[2], 0));
  await expect.element(list).toHaveTextContent("C=1A=1B=7");
  expect(c.counts.list).toBe(1);
  expect(c.counts.mount, "no row was remounted: keyed by stableId").toBe(undefined);

  await settle(() => lines.remove(lines.items[1]));
  await expect.element(list).toHaveTextContent("C=1B=7");
});

test("useArray inside a row provider resolves nested arrays", async () => {
  const f = form({ groups: array(object({ items: array(object({ v: field<string>() })) })) });
  const s = createStore(f, { groups: [{ items: [{ v: "a" }, { v: "b" }] }] });
  const group = s.substore(f.groups).itemAt(0);
  function Items() {
    const items = useArray(f.groups.item.items);
    return <span data-testid="n">{String(items.items.length)}</span>;
  }
  const screen = await render(
    <StoreProvider store={group}>
      <Items />
    </StoreProvider>
  );
  await expect.element(screen.getByTestId("n")).toHaveTextContent("2");
});

// ---------------------------------------------------------------------------
// focusRef: two inputs for one field
test("focusRef: unmounting one of two inputs keeps the other's registration", async () => {
  const s = createStore(shape, initial());
  function Input({ id }: { id: string }) {
    const c = useControl(shape.name);
    return <input data-testid={id} ref={c.focusRef} value={c.value} onChange={fromInput(c.onChange)} />;
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
  const b = screen.getByTestId("b").element();
  expect(s.get(shape.name.focusTarget), "the last one mounted wins").toBe(b);
  await screen.rerender(app(false));
  expect(s.get(shape.name.focusTarget)).toBe(b);
  await screen.unmount();
  expect(s.get(shape.name.focusTarget)).toBe(undefined);
});

// ---------------------------------------------------------------------------
// useValue with an explicit store and a selector
test("useValue with { store } and a selector reads that store, not the provider's", async () => {
  const provided = createStore(shape, initial());
  const other = createStore(shape, { ...initial(), lines: [] });
  const c = renders();
  function Count() {
    c.hit("count");
    return <span data-testid="count">{String(useValue(shape.lines, (lines) => lines.length, { store: other }))}</span>;
  }
  const screen = await render(
    <StoreProvider store={provided}>
      <Count />
    </StoreProvider>
  );
  await expect.element(screen.getByTestId("count")).toHaveTextContent("0");
  c.reset();
  await settle(() => void provided.substore(shape.lines).append());
  expect(c.counts, "the provider's store is not subscribed").toEqual({});
  await settle(() => void other.substore(shape.lines).append());
  await expect.element(screen.getByTestId("count")).toHaveTextContent("1");
});

// ---------------------------------------------------------------------------
// useArray helpers and origins
test("useArray: insert and move through the hook; an explicit origin replaces the user default", async () => {
  const s = createStore(shape, initial());
  let lines!: ReturnType<typeof useArray<typeof shape.lines>>;
  function List() {
    lines = useArray(shape.lines);
    return (
      <ul data-testid="list">
        {lines.items.map((row) => (
          <li key={row.stableId}>{row.get(L.sku) || "-"}</li>
        ))}
      </ul>
    );
  }
  const origins: Origin[][] = [];
  s.react(shape.lines, (_n, _p, info) => origins.push([...info.origins]));
  const screen = await render(
    <StoreProvider store={s}>
      <List />
    </StoreProvider>
  );
  const list = screen.getByTestId("list");

  await settle(() => void lines.insert(1));
  await expect.element(list).toHaveTextContent("A-B");
  await settle(() => void lines.insert(0, { sku: "Z" }, { origin: "program" }));
  await expect.element(list).toHaveTextContent("ZA-B");
  await settle(() => lines.move(lines.items[0], 3, { origin: "program" }));
  await expect.element(list).toHaveTextContent("A-BZ");
  await settle(() => lines.remove(lines.items[1]));
  await expect.element(list).toHaveTextContent("ABZ");
  expect(origins).toEqual([["user"], ["program"], ["program"], ["user"]]);
});

// ---------------------------------------------------------------------------
test("useField on a node without meta: meta is {}, onChange writes as the user", async () => {
  const s = createStore(shape, initial());
  let field!: ReturnType<typeof useField<typeof shape.note>>;
  function Note() {
    field = useField(shape.note);
    return <span data-testid="note">{field.value}</span>;
  }
  const origins: Origin[][] = [];
  s.react(shape.note, (_n, _p, info) => origins.push([...info.origins]));
  const screen = await render(
    <StoreProvider store={s}>
      <Note />
    </StoreProvider>
  );
  expect(field.meta).toEqual({});
  await settle(() => field.onChange("hello"));
  await expect.element(screen.getByTestId("note")).toHaveTextContent("hello");
  expect(origins).toEqual([["user"]]);
});
