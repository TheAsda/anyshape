// Run: npx tsx src/validation.test.ts   (type assertions: npx tsc)
import {
  form, object, array, field, createStore, defineBehavior, when, countIn, rule, asyncRule,
  control, validation, visibility, disableable, submission,
  type InferValue, type BehaviorErrorInfo, type FocusTarget, type SubmitValue,
} from "./index";
import { test, testAsync, runAsync, eq, deepEq, throws, sleep, deferred } from "./test/harness";

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
test("queue: rules in order, first error wins, runs on creation", () => {
  const s = createStore(shape, { ...initial(), name: "" }, { behaviors: [required(shape.name), minLength(shape.name, 3)] });
  eq(s.get(shape.name.error), "Required", "loaded data is validated on creation");
  s.set(shape.name, "Jo", { origin: "user" });
  eq(s.get(shape.name.error), "At least 3");
  s.set(shape.name, "Joe");                                // program writes validate too
  eq(s.get(shape.name.error), undefined);
});

test("rules need the validation() feature", () => {
  const s = createStore(shape, initial());
  throws(() => s.addBehavior(rule(shape.note as any, () => undefined)), /no validation\(\) feature/);
});

test("guards: conditional rules, guard refs trigger", () => {
  const s = createStore(shape, initial(), {
    behaviors: rule(shape.taxId, (v) => (v ? undefined : "Required"), { when: when([shape.type], (t) => t === "company") }),
  });
  eq(s.get(shape.taxId.error), undefined);
  s.set(shape.type, "company");
  eq(s.get(shape.taxId.error), "Required", "revalidated when the guard turns true");
  s.set(shape.type, "person");
  eq(s.get(shape.taxId.error), undefined, "cleared when no rule is active");
});

test("cross-field: confirm re-validates when password changes", () => {
  const s = createStore(shape, initial(), {
    behaviors: rule(shape.confirm, (v, ctx) => (v === ctx.get(shape.password) ? undefined : "Does not match"), {
      triggers: [shape.password],
    }),
  });
  s.set(shape.password, "other", { origin: "user" });
  eq(s.get(shape.confirm.error), "Does not match");
  s.set(shape.confirm, "other", { origin: "user" });
  eq(s.get(shape.confirm.error), undefined);
});

test("undeclared reads in a rule are reported", () => {
  const { list, onError } = errors();
  createStore(shape, initial(), { onError, behaviors: rule(shape.confirm, (_v, ctx) => (ctx.get(shape.password), undefined)) });
  eq(/not declared/.test((list[0].error as Error).message), true);
});

test("rows: one queue per row, counted, removed rows leave the count", () => {
  const s = createStore(shape, initial(), { behaviors: rule(L.qty, (q) => (q >= 1 ? undefined : "Min 1")) });
  const lines = s.substore(shape.lines);
  lines.itemAt(1).set(L.qty, 0, { origin: "user" });
  eq(lines.itemAt(1).get(L.qty.error), "Min 1");
  eq(lines.itemAt(0).get(L.qty.error), undefined);
  eq(s.get(countIn(shape, "error")), 1);
  const bad = lines.append({ qty: 0 });
  eq(bad.get(L.qty.error), "Min 1", "new rows are validated on creation");
  eq(s.get(countIn(shape.lines, "error")), 2);
  lines.remove(bad);
  lines.remove(lines.itemAt(1));
  eq(s.get(countIn(shape, "error")), 0);
});

test("rows: a rule can read the whole array (unique SKU)", () => {
  const s = createStore(shape, initial(), {
    behaviors: rule(L.sku, (sku, ctx) => (ctx.get(shape.lines).filter((l) => l.sku === sku).length > 1 ? "Duplicate" : undefined), {
      triggers: [shape.lines],
    }),
  });
  const [a, b] = s.substore(shape.lines).items();
  b.set(L.sku, "A", { origin: "user" });
  eq(a.get(L.sku.error), "Duplicate");
  eq(b.get(L.sku.error), "Duplicate");
  a.set(L.sku, "Z", { origin: "user" });
  eq(a.get(L.sku.error), undefined);
  eq(b.get(L.sku.error), undefined);
});

test("validation runs after the behavior that computes the value", () => {
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
  eq(row.get(L.total.error), "Too much");
  eq(checks, 1, "validated once, on the final value");
});

// ---------------------------------------------------------------------------
// Hidden / disabled
test("hidden fields are skipped and re-validated when shown", () => {
  const s = createStore(shape, initial(), { behaviors: [rule(shape.company.vat, (v) => (v ? undefined : "Required"))] });
  eq(s.get(shape.company.vat.error), "Required");
  s.set(shape.company.visible, false);
  eq(s.get(shape.company.vat.error), undefined);
  eq(s.get(countIn(shape, "error")), 0);
  s.set(shape.company.visible, true);
  eq(s.get(shape.company.vat.error), "Required");
});

test("validateHidden keeps validating", () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.company.secret, (v) => (v ? undefined : "Required")) });
  s.set(shape.company.visible, false);
  eq(s.get(shape.company.secret.error), "Required");
});

test("disabled (inherited into rows) is skipped", () => {
  const s = createStore(shape, initial(), { behaviors: rule(L.sku, () => "Always") });
  const row = s.substore(shape.lines).itemAt(0);
  eq(row.get(L.sku.error), "Always");
  s.set(shape.lines.disabled, true);
  eq(row.get(L.sku.error), undefined);
});

// ---------------------------------------------------------------------------
// Component rules
test("a rule added on a row applies to that row, after the form's rules", () => {
  const s = createStore(shape, { ...initial() }, { behaviors: rule(L.sku, (v) => (v ? undefined : "Required")) });
  const [a, b] = s.substore(shape.lines).items();
  const off = a.addBehavior(rule(L.sku, (v) => (v.length > 1 ? undefined : "Too short")));
  eq(a.get(L.sku.error), "Too short");
  eq(b.get(L.sku.error), undefined);
  a.set(L.sku, "", { origin: "user" });
  eq(a.get(L.sku.error), "Required", "form rules first");
  a.set(L.sku, "Q", { origin: "user" });
  off();
  eq(a.get(L.sku.error), undefined, "re-validated without it");
});

test("removing the last rule clears the error", () => {
  const s = createStore(shape, initial());
  const off = s.addBehavior(rule(shape.name, () => "Bad"));
  eq(s.get(shape.name.error), "Bad");
  off();
  eq(s.get(shape.name.error), undefined);
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

testAsync("async: starts on user changes, result arrives as a new batch", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
  eq(calls.length, 0, "never on creation");
  s.set(shape.email, "taken@x.io", { origin: "user" });
  eq(calls.length, 1);
  eq(s.get(shape.email.validating), true);
  eq(s.get(countIn(shape, "validating")), 1);
  let notified = 0;
  s.subscribe(shape.email.error, () => notified++);
  calls[0].d.resolve("Already taken");
  await sleep(0);
  eq(s.get(shape.email.error), "Already taken");
  eq(s.get(shape.email.validating), false);
  eq(notified, 1);
});

testAsync("async: program writes mark unchecked; validate() checks them", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
  s.set(shape.email, "loaded@x.io");
  eq(calls.length, 0);
  eq(s.get(shape.email.validating), false);
  const pending = s.validate();
  eq(calls.length, 1);
  eq(calls[0].value, "loaded@x.io");
  calls[0].d.resolve("Already taken");
  const result = await pending;
  eq(result.valid, false);
  deepEq(result.errors.map((e) => [e.path, e.error]), [["email", "Already taken"]]);
  await s.validate();
  eq(calls.length, 1, "unchanged value is not checked again");
});

testAsync("async: not started while sync rules fail", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), {
    behaviors: [asyncRule(shape.email, check), rule(shape.email, (v) => (v.includes("@") ? undefined : "Invalid"))],
  });
  s.set(shape.email, "nope", { origin: "user" });
  eq(calls.length, 0);
  eq(s.get(shape.email.error), "Invalid");
  const r = await s.validate();
  eq(calls.length, 0);
  eq(r.valid, false);
});

testAsync("async: debounce, and validate() skips the wait", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { debounce: 30 }) });
  s.set(shape.email, "a@x.io", { origin: "user" });
  s.set(shape.email, "ab@x.io", { origin: "user" });
  s.set(shape.email, "abc@x.io", { origin: "user" });
  eq(s.get(shape.email.validating), true, "pending during the debounce");
  await sleep(50);
  deepEq(calls.map((c) => c.value), ["abc@x.io"]);
  calls[0].d.resolve(undefined);
  await sleep(0);

  s.set(shape.email, "zzz@x.io", { origin: "user" });
  const pending = s.validate();
  eq(calls.length, 2, "started immediately");
  calls[1].d.resolve(undefined);
  eq((await pending).valid, true);
  await sleep(50);
  eq(calls.length, 2, "the debounced timer did not start a second run");
});

testAsync("async: a newer change aborts the running check; late results are dropped", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
  s.set(shape.email, "one@x.io", { origin: "user" });
  s.set(shape.email, "two@x.io", { origin: "user" });
  eq(calls[0].signal.aborted, true);
  calls[0].d.resolve("Stale");
  calls[1].d.resolve(undefined);
  await sleep(0);
  eq(s.get(shape.email.error), undefined);
});

testAsync("async: a removed row drops its result", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(L.sku, check) });
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  row.set(L.sku, "X", { origin: "user" });
  lines.remove(row);
  calls[0].d.resolve("Taken");
  await sleep(0);
  eq(s.get(countIn(shape, "error")), 0);
  eq(s.get(countIn(shape, "validating")), 0, "the removed row no longer counts");
});

testAsync("async: hiding the field aborts the check", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.company.vat, check) });
  s.set(shape.company.vat, "LV1", { origin: "user" });
  s.set(shape.company.visible, false);
  eq(calls[0].signal.aborted, true);
  eq(s.get(shape.company.vat.validating), false);
});

testAsync("async: origins 'any' starts on program writes", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { origins: "any" }) });
  eq(calls.length, 0, "still not on creation");
  s.set(shape.email, "p@x.io");
  eq(calls.length, 1);
});

testAsync("async: a throwing check is reported and fails validate()", async () => {
  const { list, onError } = errors();
  const s = createStore(shape, initial(), {
    onError,
    behaviors: asyncRule(shape.email, async () => {
      throw new Error("network");
    }),
  });
  const r = await s.validate();
  eq(r.valid, false);
  eq(r.errors.length, 0);
  deepEq(r.failures.map((f) => [f.path, (f.error as Error).message]), [["email", "network"]]);
  eq(list.length, 1);
  eq(s.get(shape.email.validating), false);
});

testAsync("async: adding another rule keeps a checked result", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
  s.set(shape.email, "t@x.io", { origin: "user" });
  calls[0].d.resolve("Taken");
  await sleep(0);
  s.addBehavior(rule(shape.email, () => undefined));
  eq(s.get(shape.email.error), "Taken");
  eq(calls.length, 1);
});

// ---------------------------------------------------------------------------
// validate(), values, focus, submit
testAsync("validate: errors in shape order with concrete paths; subtrees", async () => {
  const s = createStore(shape, initial(), {
    behaviors: [rule(shape.name, () => "N"), rule(L.qty, (q) => (q > 1 ? "Q" : undefined)), rule(shape.company.vat, () => "V")],
  });
  const r = await s.validate();
  deepEq(r.errors.map((e) => e.path), ["name", "company.vat", "lines[1].qty"]);
  eq(r.errors[2].store, s.substore(shape.lines).itemAt(1));
  const lines = await s.validate(shape.lines);
  deepEq(lines.errors.map((e) => e.path), ["lines[1].qty"]);
  deepEq(lines.values, initial().lines);
  const row = await s.substore(shape.lines).itemAt(0).validate();
  eq(row.valid, true);
});

testAsync("validate: values leave out hidden and disabled nodes", async () => {
  const s = createStore(shape, initial());
  s.set(shape.company.visible, false);
  s.set(shape.promo.disabled, true);
  const r = await s.validate();
  eq("company" in r.values, false);
  eq("promo" in r.values, false);
  eq(r.values.name, "Ann");
  eq(r.values.lines?.length, 2);
});

test("focusFirst skips errors without a focus target", () => {
  const s = createStore(shape, initial());
  const focused: string[] = [];
  const target = (id: string): FocusTarget => ({ focus: () => focused.push(id) });
  s.set(shape.email.focusTarget, target("email"));
  const entries = [
    { path: "name", ref: shape.name, store: s },
    { path: "email", ref: shape.email, store: s },
  ];
  eq(s.focusFirst(entries)?.path, "email");
  deepEq(focused, ["email"]);
  eq(s.focus(shape.name), false);
});

testAsync("submit: counts, submitting, onValid with values, focus on errors", async () => {
  const s = createStore(shape, initial(), { behaviors: rule(shape.name, (v) => (v ? undefined : "Required")) });
  const submitted: unknown[] = [];
  let submittingSeen = false;
  const ok = await s.submit(async (values) => {
    submittingSeen = s.get(shape.submitting);
    submitted.push(values.name);
  });
  eq(ok.valid, true);
  deepEq(submitted, ["Ann"]);
  eq(submittingSeen, true);
  eq(s.get(shape.submitting), false);
  eq(s.get(shape.submitCount), 1);

  const focused: string[] = [];
  s.set(shape.name.focusTarget, { focus: () => focused.push("name") });
  s.set(shape.name, "", { origin: "user" });
  const bad = await s.submit(() => submitted.push("never"));
  eq(bad.valid, false);
  deepEq(focused, ["name"]);
  eq(s.get(shape.submitCount), 2);
  eq(submitted.length, 1);
});

testAsync("submit waits for a running async check", async () => {
  const { calls, check } = lookup();
  const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { debounce: 1000 }) });
  s.set(shape.email, "late@x.io", { origin: "user" });
  const pending = s.submit();
  await sleep(0);
  eq(calls.length, 1, "debounce skipped on submit");
  calls[0].d.resolve("Taken");
  const r = await pending;
  eq(r.valid, false);
  eq(r.errors[0].error, "Taken");
});

runAsync("validation.test.ts");
