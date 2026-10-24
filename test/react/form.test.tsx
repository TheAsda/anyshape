import { Component, useState, StrictMode, type ReactNode } from "react";
import { describe, test, expect } from "vitest";

import {
  form,
  object,
  array,
  field,
  metaKey,
  countIn,
  initialOf,
  createStore,
  defineBehavior,
  type InferValue,
  type RootStore,
} from "../../src/index";
import { StoreProvider, useForm, useSync, useField, useValue, type UseFormOptions } from "../../src/react/index";

type BehaviorList = UseFormOptions<any>["behaviors"];
import { control, submission, error, dirty } from "../support/features";
import { rule, max } from "../support/rules";
import { render, settle, captureWarnings } from "../support/test-utils";

const shape = form(
  object({
    name: field<string>().meta(control()),
    code: field<string>().meta(control()),
    note: field<string>().meta(control(), { hint: metaKey("") }),
    lines: array(
      object({
        qty: field<number>().meta(control(), { maxQty: metaKey<number | undefined>(undefined, { keepOnReset: true }) }),
      }),
    ),
  }).meta(submission()),
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

test("useForm passes behaviors", async () => {
  function App() {
    const f = useForm(shape, empty(), { behaviors: rule(shape.name, (v) => (v ? undefined : "Required")) });
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
});

// ---------------------------------------------------------------------------
// useForm: hot reload. An edit under Fast Refresh re-runs the module that
// declares the shape or the behaviors, so the next render passes new objects
// built from the same (or an edited) definition, and React keeps useForm's state.
describe("hot reload", () => {
  const before = form(
    object({
      one: object({ a: field<string>().meta(control()) }),
      rows: array(object({ q: field<number>().meta(control()) })),
      kind: field<string>().meta(control()),
      pair: field<{ x: string }>().meta(control()),
      list: field<{ y: number }[]>().meta(control()),
      tags: array(object({ t: field<string>() })).meta({ dirty }),
      gone: field<string>().meta(control()),
    }),
  );
  const after = form(
    object({
      one: object({ a: field<string>().meta(control()) }),
      rows: array(object({ q: field<number>().meta(control()), added: field<string>().meta(control()) })),
      kind: object({ x: field<string>().meta(control()) }),
      pair: object({ x: field<string>().meta(control()) }),
      list: array(object({ y: field<number>().meta(control()) })),
      tags: array(object({ t: field<string>() })).meta({ dirty }),
      added: field<string>().meta(control()),
    }),
  );
  type After = InferValue<typeof after>;
  const initialBefore = {
    one: { a: "" },
    rows: [{ q: 1 }, { q: 2 }],
    kind: "k",
    pair: { x: "old" },
    list: [{ y: 1 }, { y: 2 }],
    tags: [{ t: "a" }],
    gone: "g",
  };
  const initialAfter = (): After => ({
    one: { a: "" },
    rows: [
      { q: 1, added: "r0" },
      { q: 2, added: "r1" },
    ],
    kind: { x: "x" },
    pair: { x: "init" },
    list: [{ y: 9 }],
    tags: [{ t: "a" }],
    added: "new",
  });

  test("a new shape keeps each value whose path and kind are still there, with its baseline", async () => {
    let live = before as unknown as typeof after;
    let f!: RootStore<typeof after>;
    let reload!: () => void;
    function App() {
      const [, set] = useState(0);
      reload = () => {
        live = after;
        set(1);
      };
      f = useForm(live, live === after ? initialAfter() : (initialBefore as unknown as After));
      return (
        <StoreProvider store={f}>
          <Shown />
        </StoreProvider>
      );
    }
    function Shown() {
      return <span data-testid="a">{useValue(live.one.a)}</span>;
    }
    const screen = await render(<App />);
    const old = f as unknown as RootStore<typeof before>;
    await settle(() => old.set(before.one.a, "typed", { origin: "user" }));
    await settle(() => old.substore(before.rows).itemAt(0).set(before.rows.item.q, 5, { origin: "user" }));

    await settle(() => reload());
    await expect
      .element(screen.getByTestId("a"), { message: "nodes of the new shape resolve" })
      .toHaveTextContent("typed");
    expect(f.node).toBe(after);
    expect(f.get(after)).toEqual({
      one: { a: "typed" },
      rows: [
        { q: 5, added: "r0" },
        { q: 2, added: "r1" },
      ],
      kind: { x: "x" },
      pair: { x: "init" },
      list: [{ y: 9 }],
      tags: [{ t: "a" }],
      added: "new",
    });
    expect(f.get(after.one.a.dirty), "the baseline came along").toBe(true);
    expect(f.get(after.added.dirty)).toBe(false);
    expect(f.get(after.tags.dirty), "an unedited array still is its baseline").toBe(false);
    expect(f.get(after.rows)[1], "an unedited row still is its baseline row").toBe(f.get(initialOf(after.rows))[1]);

    await settle(() => f.reset());
    expect(f.get(after)).toEqual(initialAfter());
  });

  test("new behaviors replace the registered ones and keep the values", async () => {
    const v1 = rule(shape.name, (v) => (v === "ok" ? undefined : "Required"));
    const v2 = rule(shape.name, (v) => (v === "ok" ? undefined : "Needed"));
    let live = v1;
    let f!: RootStore<typeof shape>;
    let reload!: () => void;
    function App() {
      const [, set] = useState(0);
      reload = () => {
        live = v2;
        set(1);
      };
      f = useForm(shape, empty(), { behaviors: live });
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
    await settle(() => f.set(shape.code, "kept", { origin: "user" }));
    const store = f;
    await settle(() => reload());
    await expect.element(screen.getByTestId("err")).toHaveTextContent("Needed");
    expect(f, "the same store").toBe(store);
    expect(f.get(shape.code)).toBe("kept");
  });

  /** The App of the tests below: `reload()` swaps in `after` and its behaviors, as an edit does. */
  function reloadable(behaviorsOf: (s: typeof after) => BehaviorList | undefined = () => undefined) {
    let live = before as unknown as typeof after;
    let behaviors = behaviorsOf(live);
    let f!: RootStore<typeof after>;
    let set!: (n: number) => void;
    const reload = () => {
      live = after;
      behaviors = behaviorsOf(after);
      set(1);
    };
    function App() {
      const [, setN] = useState(0);
      set = setN;
      f = useForm(live, live === after ? initialAfter() : (initialBefore as unknown as After), { behaviors });
      return <StoreProvider store={f}>{null}</StoreProvider>;
    }
    return { store: () => f, reload, App };
  }

  test("the carried values are a program write: meta starts over and rows are new", async () => {
    const { store, reload, App } = reloadable();
    await render(<App />);
    const old = store() as unknown as RootStore<typeof before>;
    await settle(() => old.set(before.one.a, "typed", { origin: "user" }));
    expect(old.get(before.one.a.touched)).toBe(true);
    const oldRow = old.substore(before.rows).itemAt(0).stableId;

    await settle(() => reload());
    expect(store().get(after.one.a)).toBe("typed");
    expect(store().get(after.one.a.touched), "meta is not carried, and the write is not a user write").toBe(false);
    expect(store().substore(after.rows).itemAt(0).stableId, "rows are new").not.toBe(oldRow);
  });

  test("the old store's behaviors are removed", async () => {
    const { store, reload, App } = reloadable((s) => rule(s.one.a, () => "bad"));
    await render(<App />);
    const old = store() as unknown as RootStore<typeof before>;
    expect(old.get(before.one.a.error)).toBe("bad");
    await settle(() => reload());
    expect(store().get(after.one.a.error)).toBe("bad");
    expect(old.get(before.one.a.error), "removed from the old store").toBeUndefined();
  });

  test("behaviors kept from the previous shape throw a hint", async () => {
    const kept = rule(before.one.a, () => undefined);
    const { reload, App } = reloadable(() => kept);
    let caught: unknown;
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error: unknown) {
        caught = error;
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    const { restore } = captureWarnings();
    const quiet = console.error;
    console.error = () => {};
    await render(
      <Boundary>
        <App />
      </Boundary>,
    );
    await settle(() => reload());
    console.error = quiet;
    restore();
    expect(String(caught)).toMatch(/declared for the previous shape/);
  });

  test("a hot reload under StrictMode carries the values and does not warn", async () => {
    const { warnings, restore } = captureWarnings();
    const { store, reload, App } = reloadable((s) => rule(s.one.a, () => undefined));
    await render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const old = store() as unknown as RootStore<typeof before>;
    await settle(() => old.set(before.one.a, "typed", { origin: "user" }));
    await settle(() => reload());
    restore();
    expect(store().node).toBe(after);
    expect(store().get(after.one.a)).toBe("typed");
    expect(warnings).toEqual([]);
  });

  test("a single new shape or behaviors does not warn", async () => {
    const { warnings, restore } = captureWarnings();
    let live = before as unknown as typeof after;
    let behaviors = rule(before.one.a, () => undefined);
    let reload!: () => void;
    let rerender!: () => void;
    function App() {
      const [n, set] = useState(0);
      reload = () => {
        live = after;
        behaviors = rule(after.one.a, () => undefined);
        set(1);
      };
      rerender = () => set(n + 1);
      const f = useForm(live, live === after ? initialAfter() : (initialBefore as unknown as After), { behaviors });
      return <StoreProvider store={f}>{null}</StoreProvider>;
    }
    await render(<App />);
    await settle(() => reload());
    await settle(() => rerender());
    restore();
    expect(warnings).toEqual([]);
  });

  test("a shape or behaviors created in the component warns", async () => {
    const { warnings, restore } = captureWarnings();
    let rerender!: () => void;
    function App() {
      const [n, set] = useState(0);
      rerender = () => set(n + 1);
      const inline = form(object({ name: field<string>().meta(control()) }));
      const f = useForm(inline, { name: "Ann" }, { behaviors: rule(inline.name, () => undefined) });
      return <span data-testid="name">{f.get(inline.name)}</span>;
    }
    const screen = await render(<App />);
    await settle(() => rerender());
    await settle(() => rerender());
    restore();
    await expect.element(screen.getByTestId("name")).toHaveTextContent("Ann");
    expect(warnings.filter((w) => /`shape` is a new object on every render/.test(w))).toHaveLength(1);
    expect(warnings.filter((w) => /`behaviors` is a new object on every render/.test(w))).toHaveLength(1);
  });
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
    const dirty = useValue(shape.name.dirty);
    return <span data-testid="name">{`${c.value}|${dirty}`}</span>;
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
  expect(f.get(initialOf(shape.name))).toBe("Ready");
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
  f.subscribe(countIn(shape, error), () => writes++);
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

test("useSync warns for meta keys without keepOnReset", async () => {
  const { warnings, restore } = captureWarnings();
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
    useSync(shape.note.hint, "from component");
    return null;
  }
  await render(<App />);
  restore();
  expect(f.get(shape.note.hint)).toBe("from component");
  expect(warnings.some((w) => /keepOnReset/.test(w))).toBe(true);
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
    useSync(shape.name, "synced");
    return null;
  }
  const { restore } = captureWarnings();
  await render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  restore();
  expect(f.get(shape.name)).toBe("synced");
});

// ---------------------------------------------------------------------------
// useSync on a value node, and under a row provider
test("useSync on a value node writes it; the value stays after unmount", async () => {
  const s = createStore(shape, { ...empty(), note: "from the server" });
  function Sync({ value }: { value: string }) {
    useSync(shape.note, value);
    return null;
  }
  const screen = await render(
    <StoreProvider store={s}>
      <Sync value="synced" />
    </StoreProvider>,
  );
  expect(s.get(shape.note)).toBe("synced");
  await screen.unmount();
  expect(s.get(shape.note), "kept after unmount").toBe("synced");
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

// ---------------------------------------------------------------------------
// A key whose start is known at creation: the first render shows it
// (docs/guide/behaviors.md, "Starting a key with a value known at creation").
test("the first render shows the start the behaviors wrote", async () => {
  const doc = form(object({ title: field<string>() }).meta({ mode: metaKey<"create" | "edit">("create") }));
  const startMode = defineBehavior({
    name: "startMode",
    writes: [doc.mode],
    run: (ctx) => ctx.set(doc.mode, "edit"),
  });
  function Mode() {
    return <span data-testid="mode">{useValue(doc.mode)}</span>;
  }
  function App() {
    const f = useForm(doc, { title: "Hello" }, { behaviors: startMode });
    return (
      <StoreProvider store={f}>
        <Mode />
      </StoreProvider>
    );
  }
  const screen = await render(<App />);
  await expect.element(screen.getByTestId("mode")).toHaveTextContent("edit");
});

test("a behavior's first run sees a useSync key's default, not the synced value", async () => {
  const doc = form(object({ title: field<string>() }).meta({ limit: metaKey(0, { keepOnReset: true }) }));
  const seen: number[] = [];
  const watch = defineBehavior({
    name: "watch",
    triggers: [doc.title],
    reads: [doc.limit],
    run: (ctx) => {
      seen.push(ctx.get(doc.limit));
    },
  });
  function App() {
    const f = useForm(doc, { title: "" }, { behaviors: watch });
    return (
      <StoreProvider store={f}>
        <Sync />
      </StoreProvider>
    );
  }
  function Sync() {
    useSync(doc.limit, 5);
    return <span data-testid="limit">{useValue(doc.limit)}</span>;
  }
  const screen = await render(<App />);
  await expect.element(screen.getByTestId("limit")).toHaveTextContent("5");
  expect(seen, "the creation run saw the default").toEqual([0]);
});
