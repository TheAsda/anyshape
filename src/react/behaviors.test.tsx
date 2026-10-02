import { useState, StrictMode, Component, type ReactNode } from "react";
import { test, expect } from "vitest";
import { cleanup } from "vitest-browser-react";
import {
  form, object, array, field, rule, defineBehavior, countIn, createStore, contribute, metaKey, type InferValue,
  type RootStore, type BaseStore,
} from "../index";
import { control, disabled } from "../test/features";
import { required, pattern, max } from "../test/rules";
import { StoreProvider, useBehaviors, useValue } from "./index";
import { render, settle, captureWarnings } from "./test-utils";

/** A combined key: the payloads of its active contributions. */
const tags = metaKey<readonly string[], string>([], {
  combine: (self, key) => ({ triggers: [self], writes: [key], run: (ctx) => ctx.set(key, ctx.parts.map((p) => p.payload)) }),
});

const shape = form({
  tagged: field<string>().meta({ tags }),
  type: field<"person" | "company">(),
  name: field<string>().meta(control(), { hint: "" }),
  phone: field<string>().meta(control()),
  vat: field<string>().meta(control()),
  note: field<string>().meta({ disabled }),
  lines: array(object({ qty: field<number>().meta(control(), { hint: "" }) })),
});
type Values = InferValue<typeof shape>;
const L = shape.lines.item;
const initial = (): Values => ({
  tagged: "", type: "person", name: "", phone: "12-34", vat: "", note: "",
  lines: [{ qty: 5 }, { qty: 1 }],
});

// ---------------------------------------------------------------------------
/** Renders with React's uncaught errors collected into `uncaught`. */
let uncaught: unknown[] = [];
function mount(ui: ReactNode) {
  uncaught = [];
  return render(ui, { createRootOptions: { onUncaughtError: (e) => void uncaught.push(e) } });
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
test("registers on mount, before paint; removed on unmount", async () => {
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
  const screen = await mount(
    <StoreProvider store={s}>
      <Rules />
      <Show />
    </StoreProvider>
  );
  expect(s.get(shape.name.error)).toBe("Required");
  expect(paintedError).toBe("Required");
  await screen.unmount();
  expect(s.get(shape.name.error), "the rule left with the component").toBe(undefined);
});

test("under a row provider the behaviors apply to that row only", async () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  function RowRules() {
    useBehaviors((b) => b.add(max(L.qty, 3)), []);
    return null;
  }
  await mount(
    <StoreProvider store={s}>
      <StoreProvider store={a}>
        <RowRules />
      </StoreProvider>
    </StoreProvider>
  );
  expect(a.get(L.qty.error)).toBe("Must be at most 3");
  await settle(() => b.set(L.qty, 9));
  expect(b.get(L.qty.error)).toBe(undefined);
});

test("deps: props choose the behaviors; the swap is atomic", async () => {
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
  const app = (strict: boolean) => (
    <StoreProvider store={s}>
      <Phone strict={strict} />
    </StoreProvider>
  );
  const screen = await mount(app(false));
  expect(s.get(shape.phone.error)).toBe(undefined);
  const seen: (string | undefined)[] = [];
  s.subscribe(shape.phone.error, () => seen.push(s.get(shape.phone.error)));
  await screen.rerender(app(true));
  expect(seen, "straight to the new error").toEqual(["Use +digits"]);
  await screen.rerender(app(true));
  expect(calls, "same deps: no re-registration").toEqual({ add: 1, replace: 1 });
  await screen.rerender(app(false));
  expect(seen).toEqual(["Use +digits", undefined]);
});

test("latest props reach run without re-registering", async () => {
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
  const app = (suffix: string) => (
    <StoreProvider store={s}>
      <Hint suffix={suffix} />
    </StoreProvider>
  );
  const screen = await mount(app("!"));
  expect(s.get(shape.name.hint)).toBe("!");
  await screen.rerender(app("?"));
  expect(s.get(shape.name.hint), "not re-run by a prop change (not in deps)").toBe("!");
  await settle(() => s.set(shape.name, "Ann", { origin: "user" }));
  expect(s.get(shape.name.hint), "the next run uses the latest props").toBe("Ann?");
  expect(calls).toEqual({ add: 1, replace: 0 });
});

test("latest props reach rule checks and guards too", async () => {
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
  const app = (limit: number, active: boolean) => (
    <StoreProvider store={s}>
      <Limit limit={limit} active={active} />
    </StoreProvider>
  );
  const screen = await mount(app(10, true));
  await screen.rerender(app(2, true));
  await settle(() => s.set(shape.name, "Abc", { origin: "user" }));
  expect(s.get(shape.name.error)).toBe("Too long");
  await screen.rerender(app(2, false));
  await settle(() => s.set(shape.name, "Abcd", { origin: "user" }));
  expect(s.get(shape.name.error), "the latest guard says inactive").toBe(undefined);
});

test("declarations changing without deps: kept, with a warning", async () => {
  const s = createStore(shape, initial());
  const { warnings, restore } = captureWarnings();
  function Bad(props: { strict: boolean }) {
    useBehaviors((b) => (props.strict ? b.add(required(shape.vat)) : b.add(required(shape.phone))), []);
    return null;
  }
  const app = (strict: boolean) => (
    <StoreProvider store={s}>
      <Bad strict={strict} />
    </StoreProvider>
  );
  const screen = await mount(app(false));
  await settle(() => s.set(shape.phone, ""));
  expect(s.get(shape.phone.error)).toBe("Required");
  await screen.rerender(app(true));
  restore();
  expect(s.get(shape.vat.error), "not re-registered").toBe(undefined);
  expect(warnings.filter((w) => /without a deps change/.test(w)).length).toBe(1);
});

test("builder features: when / otherwise with a shared target", async () => {
  const s = createStore(shape, initial());
  const lock = (value: boolean) =>
    defineBehavior({ triggers: [shape.name], writes: [shape.note.disabled], run: (c) => c.set(shape.note.disabled, value) });
  function Rules() {
    useBehaviors((b) => {
      b.when([shape.type], (t) => t === "company", (b) => b.add(required(shape.vat), lock(true))).otherwise((b) => b.add(lock(false)));
    }, []);
    return null;
  }
  await mount(
    <StoreProvider store={s}>
      <Rules />
    </StoreProvider>
  );
  expect(s.get(shape.note.disabled)).toBe(false);
  expect(s.get(shape.vat.error)).toBe(undefined);
  await settle(() => s.set(shape.type, "company"));
  expect(s.get(shape.note.disabled)).toBe(true);
  expect(s.get(shape.vat.error)).toBe("Required");
});

test("StrictMode: registered once, removed on unmount", async () => {
  const s = createStore(shape, initial());
  function Lock() {
    // a plain behavior: registering it twice would violate one-writer-per-target
    useBehaviors(
      (b) => b.add(defineBehavior({ triggers: [shape.name], writes: [shape.note.disabled], run: (c) => c.set(shape.note.disabled, true) })),
      []
    );
    return null;
  }
  const screen = await mount(
    <StrictMode>
      <StoreProvider store={s}>
        <Lock />
      </StoreProvider>
    </StrictMode>
  );
  expect(uncaught).toEqual([]);
  expect(s.get(shape.note.disabled)).toBe(true);
  await screen.unmount();
  expect(s.get(shape.note.disabled)).toBe(false);
});

test("the same component twice: a writer conflict with a hint to declare it once", async () => {
  const s = createStore(shape, initial());
  const lock = () =>
    defineBehavior({ triggers: [shape.name], writes: [shape.note.disabled], run: (c) => c.set(shape.note.disabled, true) });
  function Unkeyed() {
    useBehaviors((b) => b.add(lock()), []);
    return null;
  }
  let thrown: unknown;
  try {
    await mount(
      <StoreProvider store={s}>
        <Unkeyed />
        <Unkeyed />
      </StoreProvider>
    );
  } catch (e) {
    thrown = e; // act() may rethrow errors from effects
  }
  const error = (thrown ?? uncaught[0]) as Error;
  expect(/already written by/.test(error.message)).toBe(true);
  expect(error.message, "the message carries the hint").toMatch(/declare it once, in createStore or a common parent/);
  await cleanup();
  expect(s.get(shape.note.disabled), "nothing left registered").toBe(false);
});

test("changing the provided store moves the registration", async () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  function RowRules() {
    useBehaviors((bb) => bb.add(max(L.qty, 0)), []);
    return null;
  }
  const app = (row: BaseStore<any>) => (
    <StoreProvider store={s}>
      <StoreProvider store={row}>
        <RowRules />
      </StoreProvider>
    </StoreProvider>
  );
  const screen = await mount(app(a));
  expect(a.get(L.qty.error)).toBe("Must be at most 0");
  expect(b.get(L.qty.error)).toBe(undefined);
  await screen.rerender(app(b));
  expect(a.get(L.qty.error)).toBe(undefined);
  expect(b.get(L.qty.error)).toBe("Must be at most 0");
  expect(s.get(countIn(shape, "error"))).toBe(1);
});

test("explicit { store } option", async () => {
  const s: RootStore<typeof shape> = createStore(shape, initial());
  function Rules() {
    useBehaviors((b) => b.add(required(shape.name)), [], { store: s });
    return null;
  }
  await mount(<Rules />);
  expect(s.get(shape.name.error)).toBe("Required");
});

// ---------------------------------------------------------------------------
test("a deps change whose new registration fails keeps the old one and surfaces the error with the hint", async () => {
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
  const app = (mode: "rule" | "lock") => (
    <StoreProvider store={s}>
      <Static />
      <Boundary>
        <Switching mode={mode} />
      </Boundary>
    </StoreProvider>
  );
  const screen = await mount(app("rule"));
  expect(s.get(shape.vat.error)).toBe("Required");
  await screen.rerender(app("lock"));
  expect(atError.message).toMatch(/already written by/);
  expect(atError.message).toMatch(/declare it once/);
  expect(atError.vatError, "the old registration was still active").toBe("Required");
  expect(s.get(shape.vat.error), "removed once its component left").toBe(undefined);
  expect(s.get(shape.note.disabled), "the other component's registration is untouched").toBe(true);
});

// ---------------------------------------------------------------------------
test("contributions: a deps change keeps their place among later ones; the latest payload is used without re-registering", async () => {
  const s = createStore(shape, initial());
  const calls = spyRegistrations(s);
  function First({ mode, label }: { mode: string; label: string }) {
    useBehaviors((b) => b.add(contribute(shape.tagged.tags, `${mode} ${label}`)), [mode]);
    return null;
  }
  function Second() {
    useBehaviors((b) => b.add(contribute(shape.tagged.tags, "second")), []);
    return null;
  }
  const app = (mode: string, label: string) => (
    <StoreProvider store={s}>
      <First mode={mode} label={label} />
      <Second />
    </StoreProvider>
  );
  const screen = await mount(app("a", "one"));
  expect(s.get(shape.tagged.tags)).toEqual(["a one", "second"]);
  await screen.rerender(app("b", "one"));
  expect(s.get(shape.tagged.tags), "replaced in place, not moved behind Second").toEqual(["b one", "second"]);
  await screen.rerender(app("b", "two"));
  expect(calls).toEqual({ add: 2, replace: 1 });
  await settle(() => s.set(shape.tagged, "x"));
  expect(s.get(shape.tagged.tags), "the next run reads the latest payload").toEqual(["b two", "second"]);
  await screen.unmount();
  expect(s.get(shape.tagged.tags)).toEqual([]);
});
