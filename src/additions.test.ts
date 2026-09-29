import {
  form, object, array, field, metaKey, createStore, countIn, initialOf, defineBehavior, rule,
  control, submission, disableable, max, minLength,
  type InferValue, type FocusTarget, MetaRef,
} from "./index";
import { it, expect } from "vitest";
import { sleep, deferred } from "./test/harness";

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
it("countIn and initialOf return the same instance per (node, key)", () => {
  expect(countIn(shape, "error")).toBe(countIn(shape, "error"));
  expect(countIn(shape, "error") === countIn(shape, "dirty")).toBe(false);
  expect(countIn(shape.lines, "error") === countIn(shape, "error")).toBe(false);
  expect(initialOf(shape.name)).toBe(initialOf(shape.name));
  expect(initialOf(shape.name) === initialOf(shape.code)).toBe(false);
});

// ---------------------------------------------------------------------------
// keepOnReset
it("keepOnReset keys survive reset(); other meta does not", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(1);
  row.set(L.qty.maxQty, 3);
  row.set(L.qty.hint, "tip");
  s.set(shape.name.note, "n");
  s.reset();
  expect(row.get(L.qty.maxQty)).toBe(3);
  expect(row.get(L.qty.hint)).toBe("");
  expect(s.get(shape.name.note)).toBe("");
});

// ---------------------------------------------------------------------------
// Reference limits
it("max with a reference limit: follows the reference, undefined passes", () => {
  const s = createStore(shape, initial(), { behaviors: max(L.qty, L.qty.maxQty) });
  const row = s.substore(shape.lines).itemAt(1);
  expect(row.get(L.qty.error), "no limit yet").toBe(undefined);
  row.set(L.qty.maxQty, 3);
  expect(row.get(L.qty.error), "re-validated when the limit arrives").toBe("Must be at most 3");
  row.set(L.qty.maxQty, 10);
  expect(row.get(L.qty.error)).toBe(undefined);
  s.reset();
  expect(row.get(L.qty.maxQty), "kept by reset").toBe(10);
  row.set(L.qty, 11, { origin: "user" });
  expect(row.get(L.qty.error)).toBe("Must be at most 10");
});

it("minLength with a reference from an enclosing scope-less key", () => {
  const s = createStore(shape, initial(), { behaviors: minLength(shape.code, shape.code.minCode, { message: "Too short" }) });
  expect(s.get(shape.code.error)).toBe(undefined);
  s.set(shape.code.minCode, 3);
  expect(s.get(shape.code.error)).toBe("Too short");
});

it("number limits keep working", () => {
  const s = createStore(shape, initial(), { behaviors: max(L.qty, 4) });
  expect(s.substore(shape.lines).itemAt(1).get(L.qty.error)).toBe("Must be at most 4");
});

// ---------------------------------------------------------------------------
// Atomic replacement
it("replacing a rule: one notification, straight to the new error", () => {
  const s = createStore(shape, initial());
  const h = s.addBehavior(rule(shape.name, () => "A"));
  const seen: (string | undefined)[] = [];
  s.subscribe(shape.name.error, () => seen.push(s.get(shape.name.error)));
  s.replaceBehavior(h, rule(shape.name, () => "B"));
  expect(seen).toEqual(["B"]);
});

it("replacing a behavior that writes the same meta: no notification", () => {
  const s = createStore(shape, initial());
  const lock = (name: string) =>
    defineBehavior({ name, triggers: [shape.name], writes: [shape.flag.disabled], run: (c) => c.set(shape.flag.disabled, true) });
  const h = s.addBehavior(lock("a"));
  expect(s.get(shape.flag.disabled)).toBe(true);
  let calls = 0;
  s.subscribe(shape.flag.disabled, () => calls++);
  const h2 = s.replaceBehavior(h, lock("b"));
  expect(calls, "reset to default and set again inside one batch").toBe(0);
  expect(s.get(shape.flag.disabled)).toBe(true);
  h2();
  expect(s.get(shape.flag.disabled)).toBe(false);
  expect(calls).toBe(1);
});

it("a failing replacement keeps the previous registration", () => {
  const s = createStore(shape, initial());
  s.addBehavior(defineBehavior({ name: "other", triggers: [shape.name], writes: [shape.flag.disabled], run: (c) => c.set(shape.flag.disabled, true) }));
  const h = s.addBehavior(
    defineBehavior({ name: "mine", triggers: [shape.name], writes: [shape.name.note], run: (c) => c.set(shape.name.note, c.get(shape.name)) })
  );
  const clash = defineBehavior({ name: "next", triggers: [shape.name], writes: [shape.flag.disabled], run: () => {} });
  expect(() => s.replaceBehavior(h, clash)).toThrow(/already written by "other"/);
  s.set(shape.name, "Kim");
  expect(s.get(shape.name.note), "previous behavior still runs").toBe("Kim");
  const h2 = s.replaceBehavior(h, []);
  s.set(shape.name, "Lee");
  expect(s.get(shape.name.note), "replaced by nothing: removed, meta reset").toBe("");
  h2();
});

it("handles: old handle is inert after replace; replacing twice throws", () => {
  const s = createStore(shape, initial());
  const h = s.addBehavior(rule(shape.name, () => "A"));
  const h2 = s.replaceBehavior(h, rule(shape.name, () => "B"));
  h();
  expect(s.get(shape.name.error), "disposing the old handle does nothing").toBe("B");
  expect(() => s.replaceBehavior(h, [])).toThrow(/already disposed or replaced/);
  h2();
  expect(s.get(shape.name.error)).toBe(undefined);
  expect(() => s.replaceBehavior(h2, [])).toThrow(/already disposed or replaced/);
});

it("replacement on a row store stays on that row", () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  const h = a.addBehavior(max(L.qty, 0));
  expect(a.get(L.qty.error)).toBe("Must be at most 0");
  a.replaceBehavior(h, max(L.qty, 2));
  expect(a.get(L.qty.error)).toBe(undefined);
  expect(b.get(L.qty.error)).toBe(undefined);
  b.set(L.qty, 50);
  expect(b.get(L.qty.error), "row b never had the rule").toBe(undefined);
});

// ---------------------------------------------------------------------------
// Focus order
function targets(s: ReturnType<typeof createStore<typeof shape>>, order: Record<string, number>, focused: string[]) {
  const make = (id: string): FocusTarget & { id: string } => ({ id, focus: () => focused.push(id) });
  s.set(shape.name.focusTarget, make("name"));
  s.set(shape.code.focusTarget, make("code"));
  return (a: FocusTarget, b: FocusTarget) => order[(a as any).id] - order[(b as any).id];
}

it("focusFirst: shape order by default, compare to reorder", () => {
  const s = createStore(shape, initial());
  const focused: string[] = [];
  const compare = targets(s, { name: 2, code: 1 }, focused);
  const entries = [
    { path: "name", ref: shape.name, store: s },
    { path: "code", ref: shape.code, store: s },
  ];
  expect(s.focusFirst(entries)?.path).toBe("name");
  expect(s.focusFirst(entries, { compare })?.path).toBe("code");
  expect(focused).toEqual(["name", "code"]);
});

it("focusOrder store option is used by submit", async () => {
  const focused: string[] = [];
  const order = { name: 2, code: 1 };
  const s = createStore(shape, initial(), {
    behaviors: [rule(shape.name, () => "bad"), rule(shape.code, () => "bad")],
    focusOrder: (a, b) => order[(a as any).id as "name"] - order[(b as any).id as "name"],
  });
  targets(s, order, focused);
  await s.submit();
  expect(focused).toEqual(["code"]);
  await s.submit(undefined, undefined, { focus: false });
  expect(focused, "focus: false").toEqual(["code"]);
});

// ---------------------------------------------------------------------------
// submit / handleSubmit
it("handleSubmit: preventDefault, onValid with values", async () => {
  const s = createStore(shape, initial());
  let prevented = 0;
  const got: string[] = [];
  const handler = s.handleSubmit((values) => void got.push(values.name));
  const r = await handler({ preventDefault: () => prevented++ });
  expect(r.valid).toBe(true);
  expect(prevented).toBe(1);
  expect(got).toEqual(["Ann"]);
  await handler(); // no event
  expect(got.length).toBe(2);
});

it("onInvalid receives the result after focusing", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, () => "bad") });
  const seen: string[] = [];
  s.set(shape.name.focusTarget, { focus: () => seen.push("focus") });
  await s.handleSubmit(
    () => seen.push("valid"),
    (result) => void seen.push(`invalid:${result.errors.length}`)
  )();
  expect(seen).toEqual(["focus", "invalid:1"]);
});

it("a second submit while one is running returns the same promise", async () => {
  const s = createStore(shape, initial());
  const gate = deferred<void>();
  let calls = 0;
  const onValid = async () => {
    calls++;
    await gate.promise;
  };
  const p1 = s.submit(onValid);
  const p2 = s.handleSubmit(onValid)();
  expect(p1).toBe(p2);
  await sleep(0);
  expect(s.get(shape.submitting)).toBe(true);
  gate.resolve();
  await p1;
  expect(calls).toBe(1);
  expect(s.get(shape.submitCount)).toBe(1);
  await s.submit(onValid);
  expect(calls, "a new submit after completion").toBe(2);
});

it("an error in onValid rejects and resets submitting", async () => {
  const s = createStore(shape, initial());
  let caught: unknown;
  try {
    await s.submit(() => {
      throw new Error("save failed");
    });
  } catch (e) {
    caught = e;
  }
  expect((caught as Error).message).toBe("save failed");
  expect(s.get(shape.submitting)).toBe(false);
  const r = await s.submit();
  expect(r.valid, "not stuck").toBe(true);
});

// ---------------------------------------------------------------------------
// resolvePath
it("resolvePath: fields, rows, nested rows, meta keys", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const a = s.resolvePath("name")!;
  expect(a.store).toBe(s);
  expect(a.ref).toBe(shape.name);
  const b = s.resolvePath("lines[1].qty")!;
  expect(b.store).toBe(lines.itemAt(1));
  expect(b.ref).toBe(L.qty);
  const c = s.resolvePath("lines[1].notes[0].text#error")!;
  expect(c.store).toBe(lines.itemAt(1).substore(L.notes).itemAt(0));
  expect(c.ref instanceof MetaRef).toBe(true);
  expect((c.ref as MetaRef<any>).key).toBe("error");
  const root = s.resolvePath("")!;
  expect(root.ref).toBe(shape);
  expect(s.resolvePath("#submitCount")!.ref instanceof MetaRef).toBe(true);
});

it("resolvePath: unknown paths are undefined", () => {
  const s = createStore(shape, initial());
  for (const p of ["nope", "lines[9].qty", "lines[1].nope", "lines..qty", "lines[x].qty", "name[0]", "lines[1].qty#nokey", ".name", "name."]) {
    expect(s.resolvePath(p), p).toBe(undefined);
  }
});

it("resolvePath works from a row store (paths are from the form root)", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  expect(row.resolvePath("name")!.store).toBe(s);
});

it("server errors: resolve and set", () => {
  const s = createStore(shape, initial());
  const server = { "lines[1].qty": "Out of stock", name: "Taken" };
  for (const [path, message] of Object.entries(server)) {
    const target = s.resolvePath(`${path}#error`);
    if (target) target.store.set(target.ref as MetaRef<string | undefined>, message);
  }
  expect(s.substore(shape.lines).itemAt(1).get(L.qty.error)).toBe("Out of stock");
  expect(s.get(countIn(shape, "error"))).toBe(2);
});

// ---------------------------------------------------------------------------
// reset() re-runs behaviors (found by the React tests)
it("reset re-validates: a kept limit still applies to the reset value", () => {
  const s = createStore(shape, { ...initial(), lines: [{ qty: 5, notes: [] }] }, { behaviors: max(L.qty, L.qty.maxQty) });
  const row = s.substore(shape.lines).itemAt(0);
  row.set(L.qty.maxQty, 3);
  expect(row.get(L.qty.error)).toBe("Must be at most 3");
  s.reset();
  expect(row.get(L.qty.error), "not cleared by reset").toBe("Must be at most 3");
});

it("reset: rule errors match the initial values again", () => {
  const s = createStore(shape, { ...initial(), name: "" }, { behaviors: rule(shape.name, (v) => (v ? undefined : "Required")) });
  expect(s.get(shape.name.error)).toBe("Required");
  s.set(shape.name, "Bob", { origin: "user" });
  expect(s.get(shape.name.error)).toBe(undefined);
  let notified = 0;
  s.subscribe(shape.name.error, () => notified++);
  s.reset();
  expect(s.get(shape.name.error)).toBe("Required");
  expect(s.get(shape.name.touched), "touched stays cleared (it does not run on init)").toBe(false);
  expect(notified).toBe(1);
});

it("reset: behavior-written meta is recomputed, without flicker", () => {
  const s = createStore(shape, { ...initial(), name: "" }, {
    behaviors: defineBehavior({ triggers: [shape.name], writes: [shape.flag.disabled], run: (c) => c.set(shape.flag.disabled, c.get(shape.name) === "") }),
  });
  expect(s.get(shape.flag.disabled)).toBe(true);
  let notified = 0;
  s.subscribe(shape.flag.disabled, () => notified++);
  s.reset();
  expect(s.get(shape.flag.disabled), "the condition still holds").toBe(true);
  expect(notified, "reset to default and recomputed in one batch").toBe(0);
});

it("resetting one row re-runs only that row's instances", () => {
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
  expect(runs).toEqual(["5"]);
  expect(a.get(L.qty.hint)).toBe("q1");
  expect(b.get(L.qty.hint)).toBe("q5");
});


// ---------------------------------------------------------------------------
// Reset of an object section
it("reset of a section: only its values and meta, and only behaviors writing inside it re-run", () => {
  const f = form(
    object({
      a: object({ x: field<string>().meta(control()), locked: field<boolean>().meta(disableable()) }),
      b: field<string>().meta(control()),
      flag: field<boolean>(),
    })
  );
  const lockA = defineBehavior({
    name: "lockA", triggers: [f.flag], writes: [f.a.locked.disabled],
    run: (c) => c.set(f.a.locked.disabled, c.get(f.flag)),
  });
  let outsideRuns = 0;
  const outside = defineBehavior({
    name: "outside", triggers: [f.flag], writes: [f.b],
    run: (c) => (outsideRuns++, c.set(f.b, c.get(f.flag) ? "on" : "off")),
  });
  const s = createStore(f, { a: { x: "", locked: false }, b: "", flag: true }, { behaviors: [lockA, outside] });
  s.set(f.a.x, "typed", { origin: "user" });
  s.set(f.b, "typed b", { origin: "user" });
  expect(s.get(f.a.locked.disabled)).toBe(true);
  outsideRuns = 0;

  s.reset(f.a);
  expect(s.get(f.a.x)).toBe("");
  expect(s.get(f.a.x.touched)).toBe(false);
  expect(s.get(f.a.locked.disabled), "recomputed, not left at its default: flag is still true").toBe(true);
  expect(s.get(f.b), "outside the section: kept").toBe("typed b");
  expect(s.get(f.b.touched)).toBe(true);
  expect(outsideRuns, "a behavior writing outside the section is not re-run").toBe(0);
});

// ---------------------------------------------------------------------------
// A count as a rule limit
it("a count as a rule limit: re-checked whenever the count changes", () => {
  const f = form({
    wanted: field<number>().meta(control()),
    rows: array(object({ v: field<string>().meta(control()) }), { create: () => ({ v: "" }) }),
  });
  const s = createStore(f, { wanted: 2, rows: [] }, { behaviors: max(f.wanted, countIn(f.rows, "dirty")) });
  const rows = s.substore(f.rows);
  expect(s.get(f.wanted.error)).toBe("Must be at most 0");
  rows.append(); // a new row's field starts dirty
  const second = rows.append();
  expect(s.get(f.wanted.error)).toBe(undefined);
  rows.remove(second);
  expect(s.get(f.wanted.error), "the message uses the current limit").toBe("Must be at most 1");
});

// ---------------------------------------------------------------------------
// Server errors vs validation
it("a server error stays until the field's next validation run", () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, (v) => (v ? undefined : "Required")) });
  const target = s.resolvePath("name#error")!;
  target.store.set(target.ref as never, "Taken on the server" as never);
  expect(s.get(shape.name.error)).toBe("Taken on the server");
  s.set(shape.code, "XY");
  expect(s.get(shape.name.error), "unrelated changes don't clear it").toBe("Taken on the server");
  s.set(shape.name, "Bob", { origin: "user" });
  expect(s.get(shape.name.error), "the field's next validation replaces it").toBe(undefined);
});

// ---------------------------------------------------------------------------
// Focus
it("focus(node): false without a target; focus() then scrollIntoView() with one", () => {
  const s = createStore(shape, initial());
  expect(s.focus(shape.name)).toBe(false);
  expect(s.focus(shape.flag), "a node without focusable()").toBe(false);
  const calls: string[] = [];
  s.set(shape.name.focusTarget, { focus: () => calls.push("focus"), scrollIntoView: () => calls.push("scroll") });
  expect(s.focus(shape.name)).toBe(true);
  expect(calls).toEqual(["focus", "scroll"]);
});

it("focusFirst skips entries whose row was removed", () => {
  const s = createStore(shape, initial(), { behaviors: rule(L.qty, () => "bad") });
  const lines = s.substore(shape.lines);
  const [a, b] = lines.items();
  const focused: string[] = [];
  a.set(L.qty.focusTarget, { focus: () => focused.push("a") });
  b.set(L.qty.focusTarget, { focus: () => focused.push("b") });
  const entries = s.collect(shape, "error");
  lines.remove(a);
  expect(s.focusFirst(entries)?.store).toBe(b);
  expect(focused).toEqual(["b"]);
});
