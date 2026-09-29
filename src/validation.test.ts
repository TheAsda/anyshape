import {
  form, object, array, field, createStore, defineBehavior, when, countIn, rule, asyncRule,
  control, validation, visibility, disableable, submission,
  type InferValue, type BehaviorErrorInfo, type FocusTarget, type SubmitValue,
} from "./index";
import { it, expect } from "vitest";
import { sleep, deferred } from "./test/harness";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

const shape = form(
  object({
    type: field<"person" | "company">(),
    name: field<string>().meta(control()),
    email: field<string>().meta(control()),
    password: field<string>().meta(control()),
    confirm: field<string>().meta(control()),
    taxId: field<string>().meta(control()),
    note: field<string>(),
    company: object({
      vat: field<string>().meta(control()),
      secret: field<string>().meta(control({ validateHidden: true })),
    }).meta(visibility()),
    promo: field<string>().meta(control(), disableable()),
    lines: array(
      object({
        sku: field<string>().meta(control()),
        qty: field<number>().meta(control()),
        total: field<number>().meta(validation()),
      }),
      { create: () => ({ sku: "", qty: 1, total: 0 }) }
    ).meta(disableable()),
  }).meta(submission())
);
type Values = InferValue<typeof shape>;
const L = shape.lines.item;

function initial(): Values {
  return {
    type: "person", name: "Ann", email: "ann@x.io", password: "secret", confirm: "secret",
    taxId: "", note: "", company: { vat: "", secret: "" }, promo: "",
    lines: [
      { sku: "A", qty: 1, total: 0 },
      { sku: "B", qty: 2, total: 0 },
    ],
  };
}

const required = <N extends typeof shape.name>(n: N, name = "required") =>
  rule(n, (v) => (v ? undefined : "Required"), { name });
const minLength = (n: typeof shape.name, min: number) =>
  rule(n, (v) => (v.length >= min ? undefined : `At least ${min}`), { name: "minLength" });

function errors() {
  const list: { error: unknown; info: BehaviorErrorInfo }[] = [];
  return { list, onError: (error: unknown, info: BehaviorErrorInfo) => list.push({ error, info }) };
}

// ---------------------------------------------------------------------------
// Types
type Submit = SubmitValue<typeof shape>;
type _1 = Expect<Equal<Submit["company"], { vat: string; secret: string } | undefined>>;
type _2 = Expect<Equal<Submit["promo"], string | undefined>>;
type _3 = Expect<Equal<Submit["name"], string>>;
type _4 = Expect<Equal<Submit["lines"], { sku: string; qty: number; total: number }[] | undefined>>;

export function typeOnlyChecks() {
  // @ts-expect-error – `note` has no validation() feature
  rule(shape.note, () => undefined);
  // @ts-expect-error – value type is checked
  rule(shape.name, (v: number) => undefined);
}

// ---------------------------------------------------------------------------
// Sync queue
it("queue: rules in order, first error wins, runs on creation", () => {
  const s = createStore(shape, { ...initial(), name: "" }, { behaviors: [required(shape.name), minLength(shape.name, 3)] });
  expect(s.get(shape.name.error), "loaded data is validated on creation").toBe("Required");
  s.set(shape.name, "Jo", { origin: "user" });
  expect(s.get(shape.name.error)).toBe("At least 3");
  s.set(shape.name, "Joe");                                // program writes validate too
  expect(s.get(shape.name.error)).toBe(undefined);
});

it("rules need the validation() feature", () => {
  const s = createStore(shape, initial());
  expect(() => s.addBehavior(rule(shape.note as any, () => undefined))).toThrow(/no validation\(\) feature/);
});

it("guards: conditional rules, guard refs trigger", () => {
  const s = createStore(shape, initial(), {
    behaviors: rule(shape.taxId, (v) => (v ? undefined : "Required"), { when: when([shape.type], (t) => t === "company") }),
  });
  expect(s.get(shape.taxId.error)).toBe(undefined);
  s.set(shape.type, "company");
  expect(s.get(shape.taxId.error), "revalidated when the guard turns true").toBe("Required");
  s.set(shape.type, "person");
  expect(s.get(shape.taxId.error), "cleared when no rule is active").toBe(undefined);
});

it("cross-field: confirm re-validates when password changes", () => {
  const s = createStore(shape, initial(), {
    behaviors: rule(shape.confirm, (v, ctx) => (v === ctx.get(shape.password) ? undefined : "Does not match"), {
      triggers: [shape.password],
    }),
  });
  s.set(shape.password, "other", { origin: "user" });
  expect(s.get(shape.confirm.error)).toBe("Does not match");
  s.set(shape.confirm, "other", { origin: "user" });
  expect(s.get(shape.confirm.error)).toBe(undefined);
});

it("undeclared reads in a rule are reported", () => {
  const { list, onError } = errors();
  createStore(shape, initial(), { onError, behaviors: rule(shape.confirm, (_v, ctx) => (ctx.get(shape.password), undefined)) });
  expect(/not declared/.test((list[0].error as Error).message)).toBe(true);
});

it("rows: one queue per row, counted, removed rows leave the count", () => {
  const s = createStore(shape, initial(), { behaviors: rule(L.qty, (q) => (q >= 1 ? undefined : "Min 1")) });
  const lines = s.substore(shape.lines);
  lines.itemAt(1).set(L.qty, 0, { origin: "user" });
  expect(lines.itemAt(1).get(L.qty.error)).toBe("Min 1");
  expect(lines.itemAt(0).get(L.qty.error)).toBe(undefined);
  expect(s.get(countIn(shape, "error"))).toBe(1);
  const bad = lines.append({ qty: 0 });
  expect(bad.get(L.qty.error), "new rows are validated on creation").toBe("Min 1");
  expect(s.get(countIn(shape.lines, "error"))).toBe(2);
  lines.remove(bad);
  lines.remove(lines.itemAt(1));
  expect(s.get(countIn(shape, "error"))).toBe(0);
});

it("rows: a rule can read the whole array (unique SKU)", () => {
  const s = createStore(shape, initial(), {
    behaviors: rule(L.sku, (sku, ctx) => (ctx.get(shape.lines).filter((l) => l.sku === sku).length > 1 ? "Duplicate" : undefined), {
      triggers: [shape.lines],
    }),
  });
  const [a, b] = s.substore(shape.lines).items();
  b.set(L.sku, "A", { origin: "user" });
  expect(a.get(L.sku.error)).toBe("Duplicate");
  expect(b.get(L.sku.error)).toBe("Duplicate");
  a.set(L.sku, "Z", { origin: "user" });
  expect(a.get(L.sku.error)).toBe(undefined);
  expect(b.get(L.sku.error)).toBe(undefined);
});

it("validation runs after the behavior that computes the value", () => {
  let checks = 0;
  const s = createStore(shape, initial(), {
    behaviors: [
      rule(L.total, (t) => (checks++, t <= 10 ? undefined : "Too much")),
      defineBehavior({ triggers: [L.qty], writes: [L.total], run: (c) => c.set(L.total, c.get(L.qty) * 5) }),
    ],
  });
  const row = s.substore(shape.lines).itemAt(0);
  checks = 0;
  row.set(L.qty, 3, { origin: "user" });
  expect(row.get(L.total.error)).toBe("Too much");
  expect(checks, "validated once, on the final value").toBe(1);
});

// ---------------------------------------------------------------------------
// Hidden / disabled
it("hidden fields are skipped and re-validated when shown", () => {
  const s = createStore(shape, initial(), { behaviors: [rule(shape.company.vat, (v) => (v ? undefined : "Required"))] });
  expect(s.get(shape.company.vat.error)).toBe("Required");
  s.set(shape.company.visible, false);
  expect(s.get(shape.company.vat.error)).toBe(undefined);
  expect(s.get(countIn(shape, "error"))).toBe(0);
  s.set(shape.company.visible, true);
  expect(s.get(shape.company.vat.error)).toBe("Required");
});

it("validateHidden keeps validating", () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.company.secret, (v) => (v ? undefined : "Required")) });
  s.set(shape.company.visible, false);
  expect(s.get(shape.company.secret.error)).toBe("Required");
});

it("disabled (inherited into rows) is skipped", () => {
  const s = createStore(shape, initial(), { behaviors: rule(L.sku, () => "Always") });
  const row = s.substore(shape.lines).itemAt(0);
  expect(row.get(L.sku.error)).toBe("Always");
  s.set(shape.lines.disabled, true);
  expect(row.get(L.sku.error)).toBe(undefined);
});

// ---------------------------------------------------------------------------
// Component rules
it("a rule added on a row applies to that row, after the form's rules", () => {
  const s = createStore(shape, { ...initial() }, { behaviors: rule(L.sku, (v) => (v ? undefined : "Required")) });
  const [a, b] = s.substore(shape.lines).items();
  const off = a.addBehavior(rule(L.sku, (v) => (v.length > 1 ? undefined : "Too short")));
  expect(a.get(L.sku.error)).toBe("Too short");
  expect(b.get(L.sku.error)).toBe(undefined);
  a.set(L.sku, "", { origin: "user" });
  expect(a.get(L.sku.error), "form rules first").toBe("Required");
  a.set(L.sku, "Q", { origin: "user" });
  off();
  expect(a.get(L.sku.error), "re-validated without it").toBe(undefined);
});

it("removing the last rule clears the error", () => {
  const s = createStore(shape, initial());
  const off = s.addBehavior(rule(shape.name, () => "Bad"));
  expect(s.get(shape.name.error)).toBe("Bad");
  off();
  expect(s.get(shape.name.error)).toBe(undefined);
});

// ---------------------------------------------------------------------------
// Async
function lookup() {
  const calls: { value: string; signal: AbortSignal; d: ReturnType<typeof deferred<string | undefined>> }[] = [];
  const check = (value: string, ctx: { signal: AbortSignal }) => {
    const d = deferred<string | undefined>();
    calls.push({ value, signal: ctx.signal, d });
    return d.promise;
  };
  return { calls, check };
}

it("async: starts on user changes, result arrives as a new batch", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
  expect(calls.length, "never on creation").toBe(0);
  s.set(shape.email, "taken@x.io", { origin: "user" });
  expect(calls.length).toBe(1);
  expect(s.get(shape.email.validating)).toBe(true);
  expect(s.get(countIn(shape, "validating"))).toBe(1);
  let notified = 0;
  s.subscribe(shape.email.error, () => notified++);
  calls[0].d.resolve("Already taken");
  await sleep(0);
  expect(s.get(shape.email.error)).toBe("Already taken");
  expect(s.get(shape.email.validating)).toBe(false);
  expect(notified).toBe(1);
});

it("async: program writes mark unchecked; validate() checks them", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
  s.set(shape.email, "loaded@x.io");
  expect(calls.length).toBe(0);
  expect(s.get(shape.email.validating)).toBe(false);
  const pending = s.validate();
  expect(calls.length).toBe(1);
  expect(calls[0].value).toBe("loaded@x.io");
  calls[0].d.resolve("Already taken");
  const result = await pending;
  expect(result.valid).toBe(false);
  expect(result.errors.map((e) => [e.path, e.error])).toEqual([["email", "Already taken"]]);
  await s.validate();
  expect(calls.length, "unchanged value is not checked again").toBe(1);
});

it("async: not started while sync rules fail", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), {
    behaviors: [asyncRule(shape.email, check), rule(shape.email, (v) => (v.includes("@") ? undefined : "Invalid"))],
  });
  s.set(shape.email, "nope", { origin: "user" });
  expect(calls.length).toBe(0);
  expect(s.get(shape.email.error)).toBe("Invalid");
  const r = await s.validate();
  expect(calls.length).toBe(0);
  expect(r.valid).toBe(false);
});

it("async: debounce, and validate() skips the wait", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { debounce: 30 }) });
  s.set(shape.email, "a@x.io", { origin: "user" });
  s.set(shape.email, "ab@x.io", { origin: "user" });
  s.set(shape.email, "abc@x.io", { origin: "user" });
  expect(s.get(shape.email.validating), "pending during the debounce").toBe(true);
  await sleep(50);
  expect(calls.map((c) => c.value)).toEqual(["abc@x.io"]);
  calls[0].d.resolve(undefined);
  await sleep(0);

  s.set(shape.email, "zzz@x.io", { origin: "user" });
  const pending = s.validate();
  expect(calls.length, "started immediately").toBe(2);
  calls[1].d.resolve(undefined);
  expect((await pending).valid).toBe(true);
  await sleep(50);
  expect(calls.length, "the debounced timer did not start a second run").toBe(2);
});

it("async: a newer change aborts the running check; late results are dropped", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
  s.set(shape.email, "one@x.io", { origin: "user" });
  s.set(shape.email, "two@x.io", { origin: "user" });
  expect(calls[0].signal.aborted).toBe(true);
  calls[0].d.resolve("Stale");
  calls[1].d.resolve(undefined);
  await sleep(0);
  expect(s.get(shape.email.error)).toBe(undefined);
});

it("async: a removed row drops its result", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(L.sku, check) });
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  row.set(L.sku, "X", { origin: "user" });
  lines.remove(row);
  calls[0].d.resolve("Taken");
  await sleep(0);
  expect(s.get(countIn(shape, "error"))).toBe(0);
  expect(s.get(countIn(shape, "validating")), "the removed row no longer counts").toBe(0);
});

it("async: hiding the field aborts the check", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.company.vat, check) });
  s.set(shape.company.vat, "LV1", { origin: "user" });
  s.set(shape.company.visible, false);
  expect(calls[0].signal.aborted).toBe(true);
  expect(s.get(shape.company.vat.validating)).toBe(false);
});

it("async: origins 'any' starts on program writes", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { origins: "any" }) });
  expect(calls.length, "still not on creation").toBe(0);
  s.set(shape.email, "p@x.io");
  expect(calls.length).toBe(1);
});

it("async: a throwing check is reported and fails validate()", async () => {
  const { list, onError } = errors();
  const s = createStore(shape, initial(), {
    onError,
    behaviors: asyncRule(shape.email, async () => {
      throw new Error("network");
    }),
  });
  const r = await s.validate();
  expect(r.valid).toBe(false);
  expect(r.errors.length).toBe(0);
  expect(r.failures.map((f) => [f.path, (f.error as Error).message])).toEqual([["email", "network"]]);
  expect(list.length).toBe(1);
  expect(s.get(shape.email.validating)).toBe(false);
});

it("async: adding another rule keeps a checked result", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
  s.set(shape.email, "t@x.io", { origin: "user" });
  calls[0].d.resolve("Taken");
  await sleep(0);
  s.addBehavior(rule(shape.email, () => undefined));
  expect(s.get(shape.email.error)).toBe("Taken");
  expect(calls.length).toBe(1);
});

// ---------------------------------------------------------------------------
// validate(), values, focus, submit
it("validate: errors in shape order with concrete paths; subtrees", async () => {
  const s = createStore(shape, initial(), {
    behaviors: [rule(shape.name, () => "N"), rule(L.qty, (q) => (q > 1 ? "Q" : undefined)), rule(shape.company.vat, () => "V")],
  });
  const r = await s.validate();
  expect(r.errors.map((e) => e.path)).toEqual(["name", "company.vat", "lines[1].qty"]);
  expect(r.errors[2].store).toBe(s.substore(shape.lines).itemAt(1));
  const lines = await s.validate(shape.lines);
  expect(lines.errors.map((e) => e.path)).toEqual(["lines[1].qty"]);
  expect(lines.values).toEqual(initial().lines);
  const row = await s.substore(shape.lines).itemAt(0).validate();
  expect(row.valid).toBe(true);
});

it("validate: values leave out hidden and disabled nodes", async () => {
  const s = createStore(shape, initial());
  s.set(shape.company.visible, false);
  s.set(shape.promo.disabled, true);
  const r = await s.validate();
  expect("company" in r.values).toBe(false);
  expect("promo" in r.values).toBe(false);
  expect(r.values.name).toBe("Ann");
  expect(r.values.lines?.length).toBe(2);
});

it("focusFirst skips errors without a focus target", () => {
  const s = createStore(shape, initial());
  const focused: string[] = [];
  const target = (id: string): FocusTarget => ({ focus: () => focused.push(id) });
  s.set(shape.email.focusTarget, target("email"));
  const entries = [
    { path: "name", ref: shape.name, store: s },
    { path: "email", ref: shape.email, store: s },
  ];
  expect(s.focusFirst(entries)?.path).toBe("email");
  expect(focused).toEqual(["email"]);
  expect(s.focus(shape.name)).toBe(false);
});

it("submit: counts, submitting, onValid with values, focus on errors", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, (v) => (v ? undefined : "Required")) });
  const submitted: unknown[] = [];
  let submittingSeen = false;
  const ok = await s.submit(async (values) => {
    submittingSeen = s.get(shape.submitting);
    submitted.push(values.name);
  });
  expect(ok.valid).toBe(true);
  expect(submitted).toEqual(["Ann"]);
  expect(submittingSeen).toBe(true);
  expect(s.get(shape.submitting)).toBe(false);
  expect(s.get(shape.submitCount)).toBe(1);

  const focused: string[] = [];
  s.set(shape.name.focusTarget, { focus: () => focused.push("name") });
  s.set(shape.name, "", { origin: "user" });
  const bad = await s.submit(() => submitted.push("never"));
  expect(bad.valid).toBe(false);
  expect(focused).toEqual(["name"]);
  expect(s.get(shape.submitCount)).toBe(2);
  expect(submitted.length).toBe(1);
});

it("submit reveals its subtree: existing rows yes, later rows no; reset clears", async () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  expect(s.get(shape.name.revealed)).toBe(false);
  await s.submit();
  expect(s.get(shape.name.revealed)).toBe(true);
  expect(lines.items().map((row) => row.get(L.sku.revealed))).toEqual([true, true]);

  const added = lines.append();
  expect(added.get(L.sku.revealed), "a row added after submit starts hidden").toBe(false);
  await added.submit();
  expect(added.get(L.sku.revealed), "a row's submit reveals the row").toBe(true);

  s.reset();
  expect(s.get(shape.name.revealed)).toBe(false);
  expect(lines.items().map((row) => row.get(L.sku.revealed))).toEqual([false, false]);
});

it("a row's submit reveals only that row", async () => {
  const s = createStore(shape, initial());
  const [first, second] = s.substore(shape.lines).items();
  await second.submit();
  expect(first.get(L.sku.revealed)).toBe(false);
  expect(second.get(L.sku.revealed)).toBe(true);
  expect(s.get(shape.name.revealed)).toBe(false);
});

it("submit waits for a running async check", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { debounce: 1000 }) });
  s.set(shape.email, "late@x.io", { origin: "user" });
  const pending = s.submit();
  await sleep(0);
  expect(calls.length, "debounce skipped on submit").toBe(1);
  calls[0].d.resolve("Taken");
  const r = await pending;
  expect(r.valid).toBe(false);
  expect(r.errors[0].error).toBe("Taken");
});


// ---------------------------------------------------------------------------
// Submitted values under a disabled ancestor
const readOnly = form(
  object({
    name: field<string>().meta(control()),
    promo: field<string>().meta(control(), disableable()),
    section: object({ note: field<string>().meta(control()) }),
  }).meta(disableable())
);
type ReadOnlySubmit = SubmitValue<typeof readOnly>;
type _ro1 = Expect<Equal<ReadOnlySubmit["name"], string>>;
type _ro2 = Expect<Equal<ReadOnlySubmit["promo"], string | undefined>>;
type _ro3 = Expect<Equal<ReadOnlySubmit["section"], { note: string }>>;

it("values: a disabled ancestor keeps descendants that don't declare `disabled`, omits those that do", async () => {
  const s = createStore(readOnly, { name: "", promo: "P", section: { note: "" } }, {
    behaviors: [
      rule(readOnly.name, (v) => (v ? undefined : "Required")),
      rule(readOnly.section.note, (v) => (v ? undefined : "Required")),
    ],
  });
  expect(s.get(countIn(readOnly, "error"))).toBe(2);

  s.set(readOnly.disabled, true);
  expect(s.get(readOnly.promo.disabled), "effective value, inherited from the root").toBe(true);
  expect(s.get(countIn(readOnly, "error")), "effectively disabled fields are not validated").toBe(0);

  const r = await s.validate();
  expect(r.valid).toBe(true);
  expect(r.values, "promo declares `disabled` and is omitted; the others stay").toEqual({
    name: "",
    section: { note: "" },
  });
});

// ---------------------------------------------------------------------------
// Rules on a whole array
const party = form(
  object({
    travelers: array(object({ name: field<string>().meta(control()) }), { create: () => ({ name: "" }) }).meta(
      validation(),
      visibility()
    ),
  })
);
const atLeastOne = rule(party.travelers, (rows) => (rows.length === 0 ? "Add at least one traveler" : undefined));

it("array-level rules: an error on the array itself, counted and validated", async () => {
  const s = createStore(party, { travelers: [] }, { behaviors: atLeastOne });
  const travelers = s.substore(party.travelers);
  expect(s.get(party.travelers.error)).toBe("Add at least one traveler");
  expect(s.get(countIn(party, "error"))).toBe(1);

  const r = await s.validate();
  expect(r.valid).toBe(false);
  expect(r.errors.map((e) => [e.path, e.error])).toEqual([["travelers", "Add at least one traveler"]]);

  const row = travelers.append();
  expect(s.get(party.travelers.error)).toBe(undefined);
  expect(s.get(countIn(party, "error"))).toBe(0);

  travelers.remove(row);
  expect(s.get(party.travelers.error), "back when the last row goes").toBe("Add at least one traveler");
});

it("array-level rules: skipped while the array is hidden", async () => {
  const s = createStore(party, { travelers: [] }, { behaviors: atLeastOne });
  s.set(party.travelers.visible, false);
  expect(s.get(party.travelers.error)).toBe(undefined);
  const r = await s.validate();
  expect(r.valid).toBe(true);
  expect("travelers" in r.values).toBe(false);
  s.set(party.travelers.visible, true);
  expect(s.get(party.travelers.error), "re-validated when shown").toBe("Add at least one traveler");
});

// ---------------------------------------------------------------------------
// validateDisabled
it("validation({ validateDisabled: true }) keeps validating a disabled field", () => {
  const f = form({
    keep: field<string>().meta(control({ validateDisabled: true }), disableable()),
    skip: field<string>().meta(control(), disableable()),
  });
  const s = createStore(f, { keep: "", skip: "" }, {
    behaviors: [rule(f.keep, (v) => (v ? undefined : "Required")), rule(f.skip, (v) => (v ? undefined : "Required"))],
  });
  s.set(f.keep.disabled, true);
  s.set(f.skip.disabled, true);
  expect(s.get(f.keep.error)).toBe("Required");
  expect(s.get(f.skip.error)).toBe(undefined);
});

// ---------------------------------------------------------------------------
// Async: inputs and guards
it("async: a changed read value makes validate() re-check; identical inputs reuse the result", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), {
    behaviors: asyncRule(shape.email, (v, ctx) => check(`${v}|${ctx.get(shape.type)}`, ctx), { reads: [shape.type] }),
  });
  s.set(shape.email, "a@x.io", { origin: "user" });
  expect(calls.length).toBe(1);
  calls[0].d.resolve(undefined);
  await sleep(0);
  await s.validate();
  expect(calls.length, "same inputs: reused").toBe(1);

  s.set(shape.type, "company"); // a read, not a trigger
  expect(calls.length, "reads don't start a check").toBe(1);
  const pending = s.validate();
  expect(calls.length, "inputs changed: checked again").toBe(2);
  expect(calls[1].value).toBe("a@x.io|company");
  calls[1].d.resolve("Taken");
  expect((await pending).valid).toBe(false);
});

it("async: a guard turning false clears the state and aborts the running check", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), {
    behaviors: asyncRule(shape.email, check, { when: when([shape.type], (t) => t === "person") }),
  });
  s.set(shape.email, "b@x.io", { origin: "user" });
  expect(calls.length).toBe(1);
  expect(s.get(shape.email.validating)).toBe(true);
  s.set(shape.type, "company");
  expect(calls[0].signal.aborted).toBe(true);
  expect(s.get(shape.email.validating)).toBe(false);
  calls[0].d.resolve("Taken");
  await sleep(0);
  expect(s.get(shape.email.error), "the late result is dropped").toBe(undefined);
});

// ---------------------------------------------------------------------------
// validate() on a part
it("validate() on a row or a section: only that part's errors and values", async () => {
  const s = createStore(shape, initial(), {
    behaviors: [
      rule(shape.name, () => "name bad"),
      rule(L.sku, (v) => (v === "B" ? "sku bad" : undefined)),
      rule(shape.company.vat, () => "vat bad"),
    ],
  });
  const row = await s.substore(shape.lines).itemAt(1).validate();
  expect(row.errors.map((e) => [e.path, e.error])).toEqual([["lines[1].sku", "sku bad"]]);
  expect(row.values).toEqual({ sku: "B", qty: 2, total: 0 });

  const section = await s.substore(shape.company).validate();
  expect(section.errors.map((e) => [e.path, e.error])).toEqual([["company.vat", "vat bad"]]);
  expect(section.values).toEqual({ vat: "", secret: "" });
});

// ---------------------------------------------------------------------------
// submit without submission()
it("submit works on a form whose root has no submission()", async () => {
  const f = form({ name: field<string>().meta(control()) });
  const s = createStore(f, { name: "x" });
  const got: unknown[] = [];
  const r = await s.submit((values) => void got.push(values));
  expect(r.valid).toBe(true);
  expect(got).toEqual([{ name: "x" }]);
  expect(s.get(f.name.revealed)).toBe(true);
});

// ---------------------------------------------------------------------------
it("validate() with a check pending on a row that is then removed: the row is not listed", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(L.sku, check, { debounce: 1000 }) });
  const lines = s.substore(shape.lines);
  const doomed = lines.itemAt(1);
  doomed.set(L.sku, "ZZ", { origin: "user" });
  const pending = s.validate();
  await sleep(0);
  expect(calls.map((c) => c.value), "validate() skipped the debounce").toEqual(["A", "ZZ"]);
  lines.remove(doomed);
  calls[0].d.resolve(undefined);
  calls[1].d.resolve("Taken");
  const r = await pending;
  expect(r.valid).toBe(true);
  expect(r.errors).toEqual([]);
  expect(r.values.lines).toEqual([{ sku: "A", qty: 1, total: 0 }]);
});

// BUG: the header of validation.ts says removing a row aborts its check, but
// nothing does – the signal never fires and validate() keeps waiting for the
// removed row's promise, so a check that never settles hangs validate()/submit().
it.fails("validate(): removing a row aborts its pending check and validate() does not wait for it", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(L.sku, check, { debounce: 1000 }) });
  const lines = s.substore(shape.lines);
  const doomed = lines.itemAt(1);
  doomed.set(L.sku, "ZZ", { origin: "user" });
  const pending = s.validate();
  await sleep(0);
  lines.remove(doomed);
  calls[0].d.resolve(undefined); // row 0
  expect(calls[1].signal.aborted).toBe(true);
  const r = await Promise.race([pending, sleep(50).then(() => "hung" as const)]);
  expect(r).not.toBe("hung");
});
