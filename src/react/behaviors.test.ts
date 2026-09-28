// Run: node scripts/browser-test.mjs src/react/behaviors.test.ts   (types: npx tsc)
import { createElement as h, act, useState, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  form, object, array, field, rule, defineBehavior, required, pattern, max, control, disableable, countIn,
  createStore, type InferValue, type RootStore, type BaseStore,
} from "../index";
import { StoreProvider, useBehaviors, useValue } from "./index";
import { testAsync, runAsyncAndSignal, eq, deepEq } from "../test/harness";

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
testAsync("registers on mount, before paint; removed on unmount", async () => {
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
  eq(s.get(shape.name.error), "Required");
  eq(paintedError, "Required");
  await unmount();
  eq(s.get(shape.name.error), undefined, "the rule left with the component");
});

testAsync("under a row provider the behaviors apply to that row only", async () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  function RowRules() {
    useBehaviors((b) => b.add(max(L.qty, 3)), []);
    return null;
  }
  await mount(h(StoreProvider, { store: s }, h(StoreProvider, { store: a }, h(RowRules, {}))));
  eq(a.get(L.qty.error), "Must be at most 3");
  await run(() => b.set(L.qty, 9));
  eq(b.get(L.qty.error), undefined);
  await unmount();
});

testAsync("deps: props choose the behaviors; the swap is atomic", async () => {
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
  eq(s.get(shape.phone.error), undefined);
  const seen: (string | undefined)[] = [];
  s.subscribe(shape.phone.error, () => seen.push(s.get(shape.phone.error)));
  await rerender(app(true));
  deepEq(seen, ["Use +digits"], "straight to the new error");
  await rerender(app(true));
  deepEq(calls, { add: 1, replace: 1 }, "same deps: no re-registration");
  await rerender(app(false));
  deepEq(seen, ["Use +digits", undefined]);
  await unmount();
});

testAsync("latest props reach run without re-registering", async () => {
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
  eq(s.get(shape.name.hint), "!");
  await rerender(app("?"));
  eq(s.get(shape.name.hint), "!", "not re-run by a prop change (not in deps)");
  await run(() => s.set(shape.name, "Ann", { origin: "user" }));
  eq(s.get(shape.name.hint), "Ann?", "the next run uses the latest props");
  deepEq(calls, { add: 1, replace: 0 });
  await unmount();
});

testAsync("latest props reach rule checks and guards too", async () => {
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
  eq(s.get(shape.name.error), "Too long");
  await rerender(app(2, false));
  await run(() => s.set(shape.name, "Abcd", { origin: "user" }));
  eq(s.get(shape.name.error), undefined, "the latest guard says inactive");
  await unmount();
});

testAsync("declarations changing without deps: kept, with a warning", async () => {
  const s = createStore(shape, initial());
  const { warnings, restore } = captureWarnings();
  function Bad(props: { strict: boolean }) {
    useBehaviors((b) => (props.strict ? b.add(required(shape.vat)) : b.add(required(shape.phone))), []);
    return null;
  }
  const app = (strict: boolean) => h(StoreProvider, { store: s }, h(Bad, { strict }));
  await mount(app(false));
  await run(() => s.set(shape.phone, ""));
  eq(s.get(shape.phone.error), "Required");
  await rerender(app(true));
  restore();
  eq(s.get(shape.vat.error), undefined, "not re-registered");
  eq(warnings.filter((w) => /without a deps change/.test(w)).length, 1);
  await unmount();
});

testAsync("builder features: when / otherwise with a shared target", async () => {
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
  eq(s.get(shape.note.disabled), false);
  eq(s.get(shape.vat.error), undefined);
  await run(() => s.set(shape.type, "company"));
  eq(s.get(shape.note.disabled), true);
  eq(s.get(shape.vat.error), "Required");
  await unmount();
});

testAsync("StrictMode: registered once, removed on unmount", async () => {
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
  deepEq(uncaught, []);
  eq(s.get(shape.note.disabled), true);
  await unmount();
  eq(s.get(shape.note.disabled), false);
});

testAsync("the same component twice: conflict with a hint; { key } shares one registration", async () => {
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
  eq(/already written by/.test(error.message), true);
  eq(/pass \{ key \}/.test(error.message), true, "the message carries the hint");
  await unmount();
  eq(s.get(shape.note.disabled), false, "nothing left registered");

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
  deepEq(uncaught, []);
  eq(s.get(shape.note.disabled), true);
  await run(() => show(1));
  eq(s.get(shape.note.disabled), true, "still held by the other instance");
  await run(() => show(0));
  eq(s.get(shape.note.disabled), false, "removed with the last holder");
  await unmount();
});

testAsync("changing the provided store moves the registration", async () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  function RowRules() {
    useBehaviors((bb) => bb.add(max(L.qty, 0)), []);
    return null;
  }
  const app = (row: BaseStore<any>) => h(StoreProvider, { store: s }, h(StoreProvider, { store: row }, h(RowRules, {})));
  await mount(app(a));
  eq(a.get(L.qty.error), "Must be at most 0");
  eq(b.get(L.qty.error), undefined);
  await rerender(app(b));
  eq(a.get(L.qty.error), undefined);
  eq(b.get(L.qty.error), "Must be at most 0");
  eq(s.get(countIn(shape, "error")), 1);
  await unmount();
});

testAsync("explicit { store } option", async () => {
  const s: RootStore<typeof shape> = createStore(shape, initial());
  function Rules() {
    useBehaviors((b) => b.add(required(shape.name)), [], { store: s });
    return null;
  }
  await mount(h(Rules, {}));
  eq(s.get(shape.name.error), "Required");
  await unmount();
});

runAsyncAndSignal("behaviors.test.ts");
