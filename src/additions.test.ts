// Run: npx tsx src/additions.test.ts   (type assertions: npx tsc)
import {
  form, object, array, field, metaKey, createStore, countIn, initialOf, defineBehavior, rule,
  control, submission, disableable, max, minLength,
  type InferValue, type FocusTarget, MetaRef,
} from "./index";
import { test, testAsync, runAsync, eq, deepEq, throws, deferred, sleep } from "./test/harness";

const shape = form(
  object({
    name: field<string>().meta(control(), { note: "" }),
    code: field<string>().meta(control(), { minCode: metaKey<number | undefined>(undefined, { keepOnReset: true }) }),
    flag: field<boolean>().meta(disableable()),
    lines: array(
      object({
        qty: field<number>().meta(control(), {
          maxQty: metaKey<number | undefined>(undefined, { keepOnReset: true }),
          hint: "",
        }),
        notes: array(object({ text: field<string>().meta(control()) })),
      })
    ),
  }).meta(submission())
);
type Values = InferValue<typeof shape>;
const L = shape.lines.item;

function initial(): Values {
  return {
    name: "Ann", code: "AB", flag: false,
    lines: [
      { qty: 1, notes: [] },
      { qty: 5, notes: [{ text: "x" }] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Stable references
test("countIn and initialOf return the same instance per (node, key)", () => {
  eq(countIn(shape, "error"), countIn(shape, "error"));
  eq(countIn(shape, "error") === countIn(shape, "dirty"), false);
  eq(countIn(shape.lines, "error") === countIn(shape, "error"), false);
  eq(initialOf(shape.name), initialOf(shape.name));
  eq(initialOf(shape.name) === initialOf(shape.code), false);
});

// ---------------------------------------------------------------------------
// keepOnReset
test("keepOnReset keys survive reset(); other meta does not", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(1);
  row.set(L.qty.maxQty, 3);
  row.set(L.qty.hint, "tip");
  s.set(shape.name.note, "n");
  s.reset();
  eq(row.get(L.qty.maxQty), 3);
  eq(row.get(L.qty.hint), "");
  eq(s.get(shape.name.note), "");
});

// ---------------------------------------------------------------------------
// Reference limits
test("max with a reference limit: follows the reference, undefined passes", () => {
  const s = createStore(shape, initial(), { behaviors: max(L.qty, L.qty.maxQty) });
  const row = s.substore(shape.lines).itemAt(1);
  eq(row.get(L.qty.error), undefined, "no limit yet");
  row.set(L.qty.maxQty, 3);
  eq(row.get(L.qty.error), "Must be at most 3", "re-validated when the limit arrives");
  row.set(L.qty.maxQty, 10);
  eq(row.get(L.qty.error), undefined);
  s.reset();
  eq(row.get(L.qty.maxQty), 10, "kept by reset");
  row.set(L.qty, 11, { origin: "user" });
  eq(row.get(L.qty.error), "Must be at most 10");
});

test("minLength with a reference from an enclosing scope-less key", () => {
  const s = createStore(shape, initial(), { behaviors: minLength(shape.code, shape.code.minCode, { message: "Too short" }) });
  eq(s.get(shape.code.error), undefined);
  s.set(shape.code.minCode, 3);
  eq(s.get(shape.code.error), "Too short");
});

test("number limits keep working", () => {
  const s = createStore(shape, initial(), { behaviors: max(L.qty, 4) });
  eq(s.substore(shape.lines).itemAt(1).get(L.qty.error), "Must be at most 4");
});

// ---------------------------------------------------------------------------
// Atomic replacement
test("replacing a rule: one notification, straight to the new error", () => {
  const s = createStore(shape, initial());
  const h = s.addBehavior(rule(shape.name, () => "A"));
  const seen: (string | undefined)[] = [];
  s.subscribe(shape.name.error, () => seen.push(s.get(shape.name.error)));
  s.replaceBehavior(h, rule(shape.name, () => "B"));
  deepEq(seen, ["B"]);
});

test("replacing a behavior that writes the same meta: no notification", () => {
  const s = createStore(shape, initial());
  const lock = (name: string) =>
    defineBehavior({ name, triggers: [shape.name], writes: [shape.flag.disabled], run: (c) => c.set(shape.flag.disabled, true) });
  const h = s.addBehavior(lock("a"));
  eq(s.get(shape.flag.disabled), true);
  let calls = 0;
  s.subscribe(shape.flag.disabled, () => calls++);
  const h2 = s.replaceBehavior(h, lock("b"));
  eq(calls, 0, "reset to default and set again inside one batch");
  eq(s.get(shape.flag.disabled), true);
  h2();
  eq(s.get(shape.flag.disabled), false);
  eq(calls, 1);
});

test("a failing replacement keeps the previous registration", () => {
  const s = createStore(shape, initial());
  s.addBehavior(defineBehavior({ name: "other", triggers: [shape.name], writes: [shape.flag.disabled], run: (c) => c.set(shape.flag.disabled, true) }));
  const h = s.addBehavior(
    defineBehavior({ name: "mine", triggers: [shape.name], writes: [shape.name.note], run: (c) => c.set(shape.name.note, c.get(shape.name)) })
  );
  const clash = defineBehavior({ name: "next", triggers: [shape.name], writes: [shape.flag.disabled], run: () => {} });
  throws(() => s.replaceBehavior(h, clash), /already written by "other"/);
  s.set(shape.name, "Kim");
  eq(s.get(shape.name.note), "Kim", "previous behavior still runs");
  const h2 = s.replaceBehavior(h, []);
  s.set(shape.name, "Lee");
  eq(s.get(shape.name.note), "", "replaced by nothing: removed, meta reset");
  h2();
});

test("handles: old handle is inert after replace; replacing twice throws", () => {
  const s = createStore(shape, initial());
  const h = s.addBehavior(rule(shape.name, () => "A"));
  const h2 = s.replaceBehavior(h, rule(shape.name, () => "B"));
  h();
  eq(s.get(shape.name.error), "B", "disposing the old handle does nothing");
  throws(() => s.replaceBehavior(h, []), /already disposed or replaced/);
  h2();
  eq(s.get(shape.name.error), undefined);
  throws(() => s.replaceBehavior(h2, []), /already disposed or replaced/);
});

test("replacement on a row store stays on that row", () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  const h = a.addBehavior(max(L.qty, 0));
  eq(a.get(L.qty.error), "Must be at most 0");
  a.replaceBehavior(h, max(L.qty, 2));
  eq(a.get(L.qty.error), undefined);
  eq(b.get(L.qty.error), undefined);
  b.set(L.qty, 50);
  eq(b.get(L.qty.error), undefined, "row b never had the rule");
});

// ---------------------------------------------------------------------------
// Focus order
function targets(s: ReturnType<typeof createStore<typeof shape>>, order: Record<string, number>, focused: string[]) {
  const make = (id: string): FocusTarget & { id: string } => ({ id, focus: () => focused.push(id) });
  s.set(shape.name.focusTarget, make("name"));
  s.set(shape.code.focusTarget, make("code"));
  return (a: FocusTarget, b: FocusTarget) => order[(a as any).id] - order[(b as any).id];
}

test("focusFirst: shape order by default, compare to reorder", () => {
  const s = createStore(shape, initial());
  const focused: string[] = [];
  const compare = targets(s, { name: 2, code: 1 }, focused);
  const entries = [
    { path: "name", ref: shape.name, store: s },
    { path: "code", ref: shape.code, store: s },
  ];
  eq(s.focusFirst(entries)?.path, "name");
  eq(s.focusFirst(entries, { compare })?.path, "code");
  deepEq(focused, ["name", "code"]);
});

testAsync("focusOrder store option is used by submit", async () => {
  const focused: string[] = [];
  const order = { name: 2, code: 1 };
  const s = createStore(shape, initial(), {
    behaviors: [rule(shape.name, () => "bad"), rule(shape.code, () => "bad")],
    focusOrder: (a, b) => order[(a as any).id as "name"] - order[(b as any).id as "name"],
  });
  targets(s, order, focused);
  await s.submit();
  deepEq(focused, ["code"]);
  await s.submit(undefined, undefined, { focus: false });
  deepEq(focused, ["code"], "focus: false");
});

// ---------------------------------------------------------------------------
// submit / handleSubmit
testAsync("handleSubmit: preventDefault, onValid with values", async () => {
  const s = createStore(shape, initial());
  let prevented = 0;
  const got: string[] = [];
  const handler = s.handleSubmit((values) => void got.push(values.name));
  const r = await handler({ preventDefault: () => prevented++ });
  eq(r.valid, true);
  eq(prevented, 1);
  deepEq(got, ["Ann"]);
  await handler(); // no event
  eq(got.length, 2);
});

testAsync("onInvalid receives the result after focusing", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, () => "bad") });
  const seen: string[] = [];
  s.set(shape.name.focusTarget, { focus: () => seen.push("focus") });
  await s.handleSubmit(
    () => seen.push("valid"),
    (result) => void seen.push(`invalid:${result.errors.length}`)
  )();
  deepEq(seen, ["focus", "invalid:1"]);
});

testAsync("a second submit while one is running returns the same promise", async () => {
  const s = createStore(shape, initial());
  const gate = deferred<void>();
  let calls = 0;
  const onValid = async () => {
    calls++;
    await gate.promise;
  };
  const p1 = s.submit(onValid);
  const p2 = s.handleSubmit(onValid)();
  eq(p1, p2);
  await sleep(0);
  eq(s.get(shape.submitting), true);
  gate.resolve();
  await p1;
  eq(calls, 1);
  eq(s.get(shape.submitCount), 1);
  await s.submit(onValid);
  eq(calls, 2, "a new submit after completion");
});

testAsync("an error in onValid rejects and resets submitting", async () => {
  const s = createStore(shape, initial());
  let caught: unknown;
  try {
    await s.submit(() => {
      throw new Error("save failed");
    });
  } catch (e) {
    caught = e;
  }
  eq((caught as Error).message, "save failed");
  eq(s.get(shape.submitting), false);
  const r = await s.submit();
  eq(r.valid, true, "not stuck");
});

// ---------------------------------------------------------------------------
// resolvePath
test("resolvePath: fields, rows, nested rows, meta keys", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const a = s.resolvePath("name")!;
  eq(a.store, s);
  eq(a.ref, shape.name);
  const b = s.resolvePath("lines[1].qty")!;
  eq(b.store, lines.itemAt(1));
  eq(b.ref, L.qty);
  const c = s.resolvePath("lines[1].notes[0].text#error")!;
  eq(c.store, lines.itemAt(1).substore(L.notes).itemAt(0));
  eq(c.ref instanceof MetaRef, true);
  eq((c.ref as MetaRef<any>).key, "error");
  const root = s.resolvePath("")!;
  eq(root.ref, shape);
  eq(s.resolvePath("#submitCount")!.ref instanceof MetaRef, true);
});

test("resolvePath: unknown paths are undefined", () => {
  const s = createStore(shape, initial());
  for (const p of ["nope", "lines[9].qty", "lines[1].nope", "lines..qty", "lines[x].qty", "name[0]", "lines[1].qty#nokey", ".name", "name."]) {
    eq(s.resolvePath(p), undefined, p);
  }
});

test("resolvePath works from a row store (paths are from the form root)", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  eq(row.resolvePath("name")!.store, s);
});

test("server errors: resolve and set", () => {
  const s = createStore(shape, initial());
  const server = { "lines[1].qty": "Out of stock", name: "Taken" };
  for (const [path, message] of Object.entries(server)) {
    const target = s.resolvePath(`${path}#error`);
    if (target) target.store.set(target.ref as MetaRef<string | undefined>, message);
  }
  eq(s.substore(shape.lines).itemAt(1).get(L.qty.error), "Out of stock");
  eq(s.get(countIn(shape, "error")), 2);
});

// ---------------------------------------------------------------------------
// reset() re-runs behaviors (found by the React tests)
test("reset re-validates: a kept limit still applies to the reset value", () => {
  const s = createStore(shape, { ...initial(), lines: [{ qty: 5, notes: [] }] }, { behaviors: max(L.qty, L.qty.maxQty) });
  const row = s.substore(shape.lines).itemAt(0);
  row.set(L.qty.maxQty, 3);
  eq(row.get(L.qty.error), "Must be at most 3");
  s.reset();
  eq(row.get(L.qty.error), "Must be at most 3", "not cleared by reset");
});

test("reset: rule errors match the initial values again", () => {
  const s = createStore(shape, { ...initial(), name: "" }, { behaviors: rule(shape.name, (v) => (v ? undefined : "Required")) });
  eq(s.get(shape.name.error), "Required");
  s.set(shape.name, "Bob", { origin: "user" });
  eq(s.get(shape.name.error), undefined);
  let notified = 0;
  s.subscribe(shape.name.error, () => notified++);
  s.reset();
  eq(s.get(shape.name.error), "Required");
  eq(s.get(shape.name.touched), false, "touched stays cleared (it does not run on init)");
  eq(notified, 1);
});

test("reset: behavior-written meta is recomputed, without flicker", () => {
  const s = createStore(shape, { ...initial(), name: "" }, {
    behaviors: defineBehavior({ triggers: [shape.name], writes: [shape.flag.disabled], run: (c) => c.set(shape.flag.disabled, c.get(shape.name) === "") }),
  });
  eq(s.get(shape.flag.disabled), true);
  let notified = 0;
  s.subscribe(shape.flag.disabled, () => notified++);
  s.reset();
  eq(s.get(shape.flag.disabled), true, "the condition still holds");
  eq(notified, 0, "reset to default and recomputed in one batch");
});

test("resetting one row re-runs only that row's instances", () => {
  let runs: string[] = [];
  const s = createStore(shape, initial(), {
    behaviors: defineBehavior({
      name: "rowHint",
      triggers: [L.qty],
      writes: [L.qty.hint],
      run: (c) => {
        runs.push(String(c.get(L.qty)));
        c.set(L.qty.hint, `q${c.get(L.qty)}`);
      },
    }),
  });
  const [a, b] = s.substore(shape.lines).items();
  runs = [];
  b.reset();
  deepEq(runs, ["5"]);
  eq(a.get(L.qty.hint), "q1");
  eq(b.get(L.qty.hint), "q5");
});

runAsync("additions.test.ts");
