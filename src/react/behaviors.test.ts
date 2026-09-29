import { createElement as h, act, useState, StrictMode, Component, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  form, object, array, field, rule, defineBehavior, required, pattern, max, control, disableable, countIn,
  createStore, type InferValue, type RootStore, type BaseStore,
} from "../index";
import { StoreProvider, useBehaviors, useValue } from "./index";
import { it, expect } from "vitest";
import "./test-setup";

const shape = form({
  type: field<"person" | "company">(),
  name: field<string>().meta(control(), { hint: "" }),
  phone: field<string>().meta(control()),
  vat: field<string>().meta(control()),
  note: field<string>().meta(disableable()),
  lines: array(object({ qty: field<number>().meta(control(), { hint: "" }) })),
});
type Values = InferValue<typeof shape>;
const L = shape.lines.item;
const initial = (): Values => ({
  type: "person", name: "", phone: "12-34", vat: "", note: "",
  lines: [{ qty: 5 }, { qty: 1 }],
});

// ---------------------------------------------------------------------------
let root: Root | undefined;
let uncaught: unknown[] = [];
async function mount(node: ReactNode) {
  if (root) await unmount();
  uncaught = [];
  root = createRoot(document.getElementById("root")!, { onUncaughtError: (e) => void uncaught.push(e) });
  await act(async () => root!.render(node));
}
async function rerender(node: ReactNode) {
  await act(async () => root!.render(node));
}
async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}
async function run(fn: () => unknown) {
  await act(async () => void (await fn()));
}
function captureWarnings() {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  return { warnings, restore: () => (console.warn = original) };
}
/** Counts registrations made through the store API. */
function spyRegistrations(store: BaseStore<any>) {
  const calls = { add: 0, replace: 0 };
  const add = store.addBehavior.bind(store);
  const replace = store.replaceBehavior.bind(store);
  (store as any).addBehavior = (b: any) => (calls.add++, add(b));
  (store as any).replaceBehavior = (p: any, b: any) => (calls.replace++, replace(p, b));
  return calls;
}

// ---------------------------------------------------------------------------
it("registers on mount, before paint; removed on unmount", async () => {
  const s = createStore(shape, initial());
  let paintedError: string | undefined = "not rendered";
  function Rules() {
    useBehaviors((b) => b.add(required(shape.name)), []);
    return null;
  }
  function Show() {
    paintedError = useValue(shape.name.error);
    return null;
  }
  await mount(h(StoreProvider, { store: s }, h(Rules, {}), h(Show, {})));
  expect(s.get(shape.name.error)).toBe("Required");
  expect(paintedError).toBe("Required");
  await unmount();
  expect(s.get(shape.name.error), "the rule left with the component").toBe(undefined);
});

it("under a row provider the behaviors apply to that row only", async () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  function RowRules() {
    useBehaviors((b) => b.add(max(L.qty, 3)), []);
    return null;
  }
  await mount(h(StoreProvider, { store: s }, h(StoreProvider, { store: a }, h(RowRules, {}))));
  expect(a.get(L.qty.error)).toBe("Must be at most 3");
  await run(() => b.set(L.qty, 9));
  expect(b.get(L.qty.error)).toBe(undefined);
  await unmount();
});

it("deps: props choose the behaviors; the swap is atomic", async () => {
  const s = createStore(shape, initial());
  const calls = spyRegistrations(s);
  function Phone(props: { strict: boolean }) {
    useBehaviors(
      (b) => {
        if (props.strict) b.add(pattern(shape.phone, /^\+\d+$/, { message: "Use +digits" }));
        else b.add(pattern(shape.phone, /^[\d\s-]+$/, { message: "Digits only" }));
      },
      [props.strict]
    );
    return null;
  }
  const app = (strict: boolean) => h(StoreProvider, { store: s }, h(Phone, { strict }));
  await mount(app(false));
  expect(s.get(shape.phone.error)).toBe(undefined);
  const seen: (string | undefined)[] = [];
  s.subscribe(shape.phone.error, () => seen.push(s.get(shape.phone.error)));
  await rerender(app(true));
  expect(seen, "straight to the new error").toEqual(["Use +digits"]);
  await rerender(app(true));
  expect(calls, "same deps: no re-registration").toEqual({ add: 1, replace: 1 });
  await rerender(app(false));
  expect(seen).toEqual(["Use +digits", undefined]);
  await unmount();
});

it("latest props reach run without re-registering", async () => {
  const s = createStore(shape, initial());
  const calls = spyRegistrations(s);
  function Hint(props: { suffix: string }) {
    useBehaviors(
      (b) =>
        b.add(
          defineBehavior({
            triggers: [shape.name],
            writes: [shape.name.hint],
            run: (ctx) => ctx.set(shape.name.hint, `${ctx.get(shape.name)}${props.suffix}`),
          })
        ),
      []
    );
    return null;
  }
  const app = (suffix: string) => h(StoreProvider, { store: s }, h(Hint, { suffix }));
  await mount(app("!"));
  expect(s.get(shape.name.hint)).toBe("!");
  await rerender(app("?"));
  expect(s.get(shape.name.hint), "not re-run by a prop change (not in deps)").toBe("!");
  await run(() => s.set(shape.name, "Ann", { origin: "user" }));
  expect(s.get(shape.name.hint), "the next run uses the latest props").toBe("Ann?");
  expect(calls).toEqual({ add: 1, replace: 0 });
  await unmount();
});

it("latest props reach rule checks and guards too", async () => {
  const s = createStore(shape, initial());
  function Limit(props: { limit: number; active: boolean }) {
    useBehaviors(
      (b) =>
        b.add(
          rule(shape.name, (v) => (v.length > props.limit ? "Too long" : undefined), {
            when: { refs: [shape.type], test: () => props.active },
          })
        ),
      []
    );
    return null;
  }
  const app = (limit: number, active: boolean) => h(StoreProvider, { store: s }, h(Limit, { limit, active }));
  await mount(app(10, true));
  await rerender(app(2, true));
  await run(() => s.set(shape.name, "Abc", { origin: "user" }));
  expect(s.get(shape.name.error)).toBe("Too long");
  await rerender(app(2, false));
  await run(() => s.set(shape.name, "Abcd", { origin: "user" }));
  expect(s.get(shape.name.error), "the latest guard says inactive").toBe(undefined);
  await unmount();
});

it("declarations changing without deps: kept, with a warning", async () => {
  const s = createStore(shape, initial());
  const { warnings, restore } = captureWarnings();
  function Bad(props: { strict: boolean }) {
    useBehaviors((b) => (props.strict ? b.add(required(shape.vat)) : b.add(required(shape.phone))), []);
    return null;
  }
  const app = (strict: boolean) => h(StoreProvider, { store: s }, h(Bad, { strict }));
  await mount(app(false));
  await run(() => s.set(shape.phone, ""));
  expect(s.get(shape.phone.error)).toBe("Required");
  await rerender(app(true));
  restore();
  expect(s.get(shape.vat.error), "not re-registered").toBe(undefined);
  expect(warnings.filter((w) => /without a deps change/.test(w)).length).toBe(1);
  await unmount();
});

it("builder features: when / otherwise with a shared target", async () => {
  const s = createStore(shape, initial());
  const lock = (value: boolean) =>
    defineBehavior({ triggers: [shape.name], writes: [shape.note.disabled], run: (c) => c.set(shape.note.disabled, value) });
  function Rules() {
    useBehaviors((b) => {
      b.when([shape.type], (t) => t === "company", (b) => b.add(required(shape.vat), lock(true))).otherwise((b) => b.add(lock(false)));
    }, []);
    return null;
  }
  await mount(h(StoreProvider, { store: s }, h(Rules, {})));
  expect(s.get(shape.note.disabled)).toBe(false);
  expect(s.get(shape.vat.error)).toBe(undefined);
  await run(() => s.set(shape.type, "company"));
  expect(s.get(shape.note.disabled)).toBe(true);
  expect(s.get(shape.vat.error)).toBe("Required");
  await unmount();
});

it("StrictMode: registered once, removed on unmount", async () => {
  const s = createStore(shape, initial());
  function Lock() {
    // a plain behavior: registering it twice would violate one-writer-per-target
    useBehaviors(
      (b) => b.add(defineBehavior({ triggers: [shape.name], writes: [shape.note.disabled], run: (c) => c.set(shape.note.disabled, true) })),
      []
    );
    return null;
  }
  await mount(h(StrictMode, {}, h(StoreProvider, { store: s }, h(Lock, {}))));
  expect(uncaught).toEqual([]);
  expect(s.get(shape.note.disabled)).toBe(true);
  await unmount();
  expect(s.get(shape.note.disabled)).toBe(false);
});

it("the same component twice: conflict with a hint; { key } shares one registration", async () => {
  const s = createStore(shape, initial());
  const lock = () =>
    defineBehavior({ triggers: [shape.name], writes: [shape.note.disabled], run: (c) => c.set(shape.note.disabled, true) });
  function Unkeyed() {
    useBehaviors((b) => b.add(lock()), []);
    return null;
  }
  let thrown: unknown;
  try {
    await mount(h(StoreProvider, { store: s }, h(Unkeyed, {}), h(Unkeyed, {})));
  } catch (e) {
    thrown = e; // act() rethrows errors from effects
  }
  const error = (thrown ?? uncaught[0]) as Error;
  expect(/already written by/.test(error.message)).toBe(true);
  expect(/pass \{ key \}/.test(error.message), "the message carries the hint").toBe(true);
  await unmount();
  expect(s.get(shape.note.disabled), "nothing left registered").toBe(false);

  let show!: (n: number) => void;
  function Keyed() {
    useBehaviors((b) => b.add(lock()), [], { key: "note-lock" });
    return null;
  }
  function App() {
    const [n, set] = useState(2);
    show = set;
    return h(StoreProvider, { store: s }, n >= 1 ? h(Keyed, {}) : null, n >= 2 ? h(Keyed, {}) : null);
  }
  await mount(h(App, {}));
  expect(uncaught).toEqual([]);
  expect(s.get(shape.note.disabled)).toBe(true);
  await run(() => show(1));
  expect(s.get(shape.note.disabled), "still held by the other instance").toBe(true);
  await run(() => show(0));
  expect(s.get(shape.note.disabled), "removed with the last holder").toBe(false);
  await unmount();
});

it("changing the provided store moves the registration", async () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  function RowRules() {
    useBehaviors((bb) => bb.add(max(L.qty, 0)), []);
    return null;
  }
  const app = (row: BaseStore<any>) => h(StoreProvider, { store: s }, h(StoreProvider, { store: row }, h(RowRules, {})));
  await mount(app(a));
  expect(a.get(L.qty.error)).toBe("Must be at most 0");
  expect(b.get(L.qty.error)).toBe(undefined);
  await rerender(app(b));
  expect(a.get(L.qty.error)).toBe(undefined);
  expect(b.get(L.qty.error)).toBe("Must be at most 0");
  expect(s.get(countIn(shape, "error"))).toBe(1);
  await unmount();
});

it("explicit { store } option", async () => {
  const s: RootStore<typeof shape> = createStore(shape, initial());
  function Rules() {
    useBehaviors((b) => b.add(required(shape.name)), [], { store: s });
    return null;
  }
  await mount(h(Rules, {}));
  expect(s.get(shape.name.error)).toBe("Required");
  await unmount();
});

// ---------------------------------------------------------------------------
it("{ key } is shared per store: the same key on different stores registers twice", async () => {
  const s1 = createStore(shape, initial());
  const s2 = createStore(shape, initial());
  const calls = [spyRegistrations(s1), spyRegistrations(s2)];
  function Keyed() {
    useBehaviors((b) => b.add(required(shape.name)), [], { key: "name-required" });
    return null;
  }
  let show!: (n: number) => void;
  function App() {
    const [n, set] = useState(2);
    show = set;
    return h("div", {}, h(StoreProvider, { store: s1 }, h(Keyed, {})), n >= 2 ? h(StoreProvider, { store: s2 }, h(Keyed, {})) : null);
  }
  await mount(h(App, {}));
  expect(calls.map((c) => c.add)).toEqual([1, 1]);
  expect([s1.get(shape.name.error), s2.get(shape.name.error)]).toEqual(["Required", "Required"]);
  await run(() => show(1));
  expect(s1.get(shape.name.error), "s2's holder leaving does not release s1's").toBe("Required");
  expect(s2.get(shape.name.error)).toBe(undefined);
  await unmount();
});

it("a deps change whose new registration fails keeps the old one and surfaces the error with the hint", async () => {
  const s = createStore(shape, initial());
  const lock = () =>
    defineBehavior({ triggers: [shape.name], writes: [shape.note.disabled], run: (c) => c.set(shape.note.disabled, true) });
  function Static() {
    useBehaviors((b) => b.add(lock()), []);
    return null;
  }
  function Switching({ mode }: { mode: "rule" | "lock" }) {
    useBehaviors((b) => (mode === "rule" ? b.add(required(shape.vat)) : b.add(lock())), [mode]);
    return null;
  }
  const atError: { message?: string; vatError?: string } = {};
  class Boundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError(error: Error) {
      atError.message = error.message;
      atError.vatError = s.get(shape.vat.error); // read before the failed subtree is removed
      return { failed: true };
    }
    render() {
      return this.state.failed ? null : this.props.children;
    }
  }
  const app = (mode: "rule" | "lock") =>
    h(StoreProvider, { store: s }, h(Static, {}), h(Boundary, {}, h(Switching, { mode })));
  await mount(app("rule"));
  expect(s.get(shape.vat.error)).toBe("Required");
  await rerender(app("lock"));
  expect(atError.message).toMatch(/already written by/);
  expect(atError.message).toMatch(/pass \{ key \}/);
  expect(atError.vatError, "the old registration was still active").toBe("Required");
  expect(s.get(shape.vat.error), "removed once its component left").toBe(undefined);
  expect(s.get(shape.note.disabled), "the other component's registration is untouched").toBe(true);
  await unmount();
});
