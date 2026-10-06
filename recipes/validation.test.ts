// The validation recipe (recipes/validation.ts): rules contribute to `error`,
// whose owner is the queue; validate(store, node) forces and collects.
import {
  form,
  object,
  array,
  field,
  createStore,
  defineBehavior,
  defineBehaviors,
  countIn,
  pendingOf,
  pendingIn,
} from "anyshape";
import { test as base, describe, expect, vi, onTestFinished } from "vitest";

import { rule, asyncRule, required, validate, error, control, validation, visible } from "./index";
import { shape, L, initial, lookup } from "./test/fixtures/account";
import * as orderFixture from "./test/fixtures/order";
import { flush, sleep } from "./test/harness";

const test = base.extend("store", () => createStore(shape, initial())).extend("lookup", () => lookup());

// Compile-time only – never called.
export function typeOnlyChecks() {
  // @ts-expect-error – `note` has no validation()
  rule(shape.note, () => undefined);
  // @ts-expect-error – the check takes the field's value type
  rule(shape.name, (v: number) => (v > 0 ? undefined : "No"));
  // @ts-expect-error – async checks return a promise
  asyncRule(shape.name, () => undefined);
}

describe("M · Sync queue", () => {
  test("queue: rules in order, first error wins, runs on creation", () => {
    const required = rule(shape.name, (v) => (v ? undefined : "Required"));
    const minLength = rule(shape.name, (v) => (v.length >= 3 ? undefined : "At least 3"));
    const s = createStore(shape, { ...initial(), name: "" }, { behaviors: [required, minLength] });
    expect(s.get(shape.name.error), "loaded data is validated on creation").toBe("Required");
    s.set(shape.name, "Jo", { origin: "user" });
    expect(s.get(shape.name.error)).toBe("At least 3");
    s.set(shape.name, "Joe"); // program writes validate too
    expect(s.get(shape.name.error)).toBe(undefined);
  });

  test("rules need the validation() feature", ({ store: s }) => {
    expect(() => s.addBehavior(rule(shape.note as any, () => undefined))).toThrow(/no validation\(\) feature/);
  });

  test("guards: conditional rules, guard refs trigger", () => {
    const s = createStore(shape, initial(), {
      behaviors: defineBehaviors(shape, (b) =>
        b.when(
          [shape.type],
          (t) => t === "company",
          (b) => b.add(rule(shape.taxId, (v) => (v ? undefined : "Required"))),
        ),
      ),
    });
    expect(s.get(shape.taxId.error)).toBe(undefined);
    s.set(shape.type, "company");
    expect(s.get(shape.taxId.error), "revalidated when the guard turns true").toBe("Required");
    s.set(shape.type, "person");
    expect(s.get(shape.taxId.error), "cleared when no rule is active").toBe(undefined);
  });

  test("cross-field: confirm re-validates when password changes", () => {
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

  test("an undeclared read in a rule is a failing check: logged, 'Validation failed'", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => logged.mockRestore());
    const s = createStore(shape, initial(), {
      behaviors: rule(shape.confirm, (_v, ctx) => (ctx.get(shape.password), undefined)),
    });
    expect(s.get(shape.confirm.error)).toBe("Validation failed");
    expect((logged.mock.calls[0][0] as Error).message).toMatch(/"password" is not declared/);
  });

  test("rows: one queue per row, counted, removed rows leave the count", () => {
    const s = createStore(shape, initial(), { behaviors: rule(L.qty, (q) => (q >= 1 ? undefined : "Min 1")) });
    const lines = s.substore(shape.lines);
    lines.itemAt(1).set(L.qty, 0, { origin: "user" });
    expect(lines.itemAt(1).get(L.qty.error)).toBe("Min 1");
    expect(lines.itemAt(0).get(L.qty.error)).toBe(undefined);
    expect(s.get(countIn(shape, error))).toBe(1);
    const bad = lines.append({ qty: 0 });
    expect(bad.get(L.qty.error), "new rows are validated on creation").toBe("Min 1");
    expect(s.get(countIn(shape.lines, error))).toBe(2);
    lines.remove(bad);
    lines.remove(lines.itemAt(1));
    expect(s.get(countIn(shape, error))).toBe(0);
  });

  test("rows: a rule can read the whole array (unique SKU)", () => {
    const s = createStore(shape, initial(), {
      behaviors: rule(
        L.sku,
        (sku, ctx) => (ctx.get(shape.lines).filter((l) => l.sku === sku).length > 1 ? "Duplicate" : undefined),
        {
          triggers: [shape.lines],
        },
      ),
    });
    const [a, b] = s.substore(shape.lines).items();
    b.set(L.sku, "A", { origin: "user" });
    expect(a.get(L.sku.error)).toBe("Duplicate");
    expect(b.get(L.sku.error)).toBe("Duplicate");
    a.set(L.sku, "Z", { origin: "user" });
    expect(a.get(L.sku.error)).toBe(undefined);
    expect(b.get(L.sku.error)).toBe(undefined);
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
    expect(row.get(L.total.error)).toBe("Too much");
    expect(checks, "validated once, on the final value").toBe(1);
  });
});

describe("M · Component rules", () => {
  test("a rule added on a row applies to that row, after the form's rules", () => {
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

  test("removing the last rule clears the error", ({ store: s }) => {
    const off = s.addBehavior(rule(shape.name, () => "Bad"));
    expect(s.get(shape.name.error)).toBe("Bad");
    off();
    expect(s.get(shape.name.error)).toBe(undefined);
  });
});

describe("M · Hidden / disabled are guards (#21)", () => {
  test("a hidden field is still validated: nothing is skipped", () => {
    const s = createStore(shape, initial(), {
      behaviors: rule(shape.company.vat, (v) => (v ? undefined : "Required")),
    });
    s.set(shape.company.visible, false);
    expect(s.get(shape.company.vat.error)).toBe("Required");
  });

  test("rules guarded on visibility: absent while hidden, back when shown", () => {
    const behaviors = defineBehaviors(shape, (b) =>
      b.when(
        [shape.company.visible],
        (v) => v,
        (b) => b.add(rule(shape.company.vat, (v) => (v ? undefined : "Required"))),
      ),
    );
    const s = createStore(shape, initial(), { behaviors });
    expect(s.get(shape.company.vat.error)).toBe("Required");
    s.set(shape.company.visible, false);
    expect(s.get(shape.company.vat.error)).toBe(undefined);
    expect(s.get(countIn(shape, error))).toBe(0);
    s.set(shape.company.visible, true);
    expect(s.get(shape.company.vat.error)).toBe("Required");
  });
});

const party = form(
  object({
    travelers: array(object({ name: field<string>().meta(control()) }), { create: () => ({ name: "" }) }).meta(
      validation(),
      { visible },
    ),
  }),
);
const atLeastOne = rule(party.travelers, (rows) => (rows.length === 0 ? "Add at least one traveler" : undefined));

describe("M · Rules on a whole array", () => {
  test("array-level rules: an error on the array itself, counted and validated", async () => {
    const s = createStore(party, { travelers: [] }, { behaviors: atLeastOne });
    const travelers = s.substore(party.travelers);
    expect(s.get(party.travelers.error)).toBe("Add at least one traveler");
    expect(s.get(countIn(party, error))).toBe(1);

    const r = await validate(s);
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => [e.path, e.error])).toEqual([["travelers", "Add at least one traveler"]]);

    const row = travelers.append();
    expect(s.get(party.travelers.error)).toBe(undefined);
    expect(s.get(countIn(party, error))).toBe(0);

    travelers.remove(row);
    expect(s.get(party.travelers.error), "back when the last row goes").toBe("Add at least one traveler");
  });
});

describe("M · Async", () => {
  test("async: starts on user changes, pending while in flight, result arrives as a new batch", async ({
    lookup: { calls, check },
  }) => {
    const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
    expect(calls.length, "never on creation").toBe(0);
    s.set(shape.email, "taken@x.io", { origin: "user" });
    expect(calls.length).toBe(1);
    expect(s.get(pendingOf(shape.email.error))).toBe(true);
    expect(s.get(pendingIn(shape, error))).toBe(1);
    let notified = 0;
    s.subscribe(shape.email.error, () => notified++);
    calls[0].d.resolve("Already taken");
    await flush();
    expect(s.get(shape.email.error)).toBe("Already taken");
    expect(s.get(pendingOf(shape.email.error))).toBe(false);
    expect(notified).toBe(1);
  });

  test("async start: 'user' (default) waits for a user edit, 'any' starts on program writes, 'always' also on creation", () => {
    const user = lookup(),
      any = lookup(),
      always = lookup();
    const s = createStore(shape, initial(), {
      behaviors: [
        asyncRule(shape.name, user.check),
        asyncRule(shape.email, any.check, { start: "any" }),
        asyncRule(shape.taxId, always.check, { start: "always" }),
      ],
    });
    expect([user.calls.length, any.calls.length, always.calls.length], "on creation").toEqual([0, 0, 1]);
    s.batch(() => {
      s.set(shape.name, "Bo");
      s.set(shape.email, "p@x.io");
      s.set(shape.taxId, "T1");
    });
    expect([user.calls.length, any.calls.length, always.calls.length], "a program write").toEqual([0, 1, 2]);
  });

  test("a guard turning false clears the error and cancels the check in flight; turning true writes the remembered result back", async ({
    lookup: { calls, check },
  }) => {
    const behaviors = defineBehaviors(shape, (b) =>
      b.when(
        [shape.type],
        (t) => t === "person",
        (b) => b.add(asyncRule(shape.email, check)),
      ),
    );
    const s = createStore(shape, initial(), { behaviors });
    s.set(shape.email, "a@x.io", { origin: "user" });
    calls[0].d.resolve("Taken");
    await flush();
    s.set(shape.email, "b@x.io", { origin: "user" });
    s.set(shape.type, "company");
    expect(calls[1].signal.aborted, "absent: its check is cancelled").toBe(true);
    expect(s.get(shape.email.error)).toBe(undefined);
    expect(s.get(pendingOf(shape.email.error))).toBe(false);
    calls[1].d.resolve("Late");
    await flush();
    expect(s.get(shape.email.error), "the late result is dropped").toBe(undefined);

    s.set(shape.email, "a@x.io", { origin: "user" });
    s.set(shape.type, "person");
    expect(s.get(shape.email.error), "back: the checked result for a@x.io").toBe("Taken");
    expect(calls.length).toBe(2);
  });

  test("adding another rule keeps a checked result", async ({ lookup: { calls, check } }) => {
    const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
    s.set(shape.email, "t@x.io", { origin: "user" });
    calls[0].d.resolve("Taken");
    await flush();
    s.addBehavior(rule(shape.email, () => undefined));
    expect(s.get(shape.email.error)).toBe("Taken");
    expect(calls.length).toBe(1);
  });

  test("async: not started while sync rules fail", ({ lookup: { calls, check } }) => {
    const s = createStore(shape, initial(), {
      behaviors: [asyncRule(shape.email, check), rule(shape.email, (v) => (v.includes("@") ? undefined : "Invalid"))],
    });
    s.set(shape.email, "nope", { origin: "user" });
    expect(calls.length).toBe(0);
    expect(s.get(shape.email.error)).toBe("Invalid");
  });

  test("async: a newer change aborts the running check; late results are dropped", async ({
    lookup: { calls, check },
  }) => {
    const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
    s.set(shape.email, "one@x.io", { origin: "user" });
    s.set(shape.email, "two@x.io", { origin: "user" });
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].d.resolve("Stale");
    calls[1].d.resolve(undefined);
    await flush();
    expect(s.get(shape.email.error)).toBe(undefined);
  });

  test("async: a removed row drops its result", async ({ lookup: { calls, check } }) => {
    const s = createStore(shape, initial(), { behaviors: asyncRule(L.sku, check) });
    const lines = s.substore(shape.lines);
    const row = lines.itemAt(0);
    row.set(L.sku, "X", { origin: "user" });
    lines.remove(row);
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].d.resolve("Taken");
    await flush();
    expect(s.get(countIn(shape, error))).toBe(0);
    expect(s.get(pendingIn(shape, error)), "the removed row is no longer pending").toBe(0);
  });

  test("async: debounce – pending while it waits, one check after the last change", async ({
    lookup: { calls, check },
  }) => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { debounce: 30 }) });
    s.set(shape.email, "a@x.io", { origin: "user" });
    s.set(shape.email, "ab@x.io", { origin: "user" });
    s.set(shape.email, "abc@x.io", { origin: "user" });
    expect(s.get(pendingOf(shape.email.error)), "pending during the debounce").toBe(true);
    await vi.advanceTimersByTimeAsync(29);
    expect(calls.length, "still debouncing").toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.value)).toEqual(["abc@x.io"]);
    calls[0].d.resolve("Taken");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.get(shape.email.error)).toBe("Taken");
  });
});

// #28: as on the basic form's requester.email – a sync rule triggered by
// another field (here `name`, the approver) plus a debounced server check.
describe("M · Async: an unrelated trigger keeps the check in flight (#28)", () => {
  const behaviors = (check: ReturnType<typeof lookup>["check"]) => [
    rule(shape.email, (v, ctx) => (v === ctx.get(shape.name) ? "Can't approve yourself" : undefined), {
      triggers: [shape.name],
    }),
    asyncRule(shape.email, check, { debounce: 300 }),
  ];

  test("typing in the other field during the debounce or the request checks once", async ({
    lookup: { calls, check },
  }) => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const s = createStore(shape, initial(), { behaviors: behaviors(check) });
    s.set(shape.email, "bob@x.io", { origin: "user" });
    await vi.advanceTimersByTimeAsync(200);
    s.set(shape.name, "Ann B", { origin: "user" });
    await vi.advanceTimersByTimeAsync(100);
    expect(
      calls.map((c) => c.value),
      "the debounce was not restarted",
    ).toEqual(["bob@x.io"]);
    s.set(shape.name, "Ann Bo", { origin: "user" });
    await vi.advanceTimersByTimeAsync(300);
    expect(calls.length, "the request was not restarted").toBe(1);
    expect(calls[0].signal.aborted).toBe(false);
    calls[0].d.resolve("Not an employee");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.get(shape.email.error)).toBe("Not an employee");
  });

  test("an autofill writing the other field mid-flight doesn't leave the field unchecked", async ({
    lookup: { calls, check },
  }) => {
    const s = createStore(shape, initial(), { behaviors: behaviors(check) });
    s.set(shape.email, "bob@x.io", { origin: "user" });
    await sleep(300);
    expect(calls.length).toBe(1);
    s.set(shape.name, "Autofilled");
    expect(s.get(pendingOf(shape.email.error)), "still checking").toBe(true);
    calls[0].d.resolve("Not an employee");
    await flush();
    expect(s.get(shape.email.error)).toBe("Not an employee");
    expect(calls.length).toBe(1);
  });
});

describe("M · A check that throws", () => {
  const spyConsole = () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => spy.mockRestore());
    return spy;
  };

  test("a sync check that throws: 'Validation failed', and console.error gets what it threw", () => {
    const logged = spyConsole();
    const bug = new Error("bug");
    const s = createStore(shape, initial(), {
      behaviors: rule(shape.name, () => {
        throw bug;
      }),
    });
    expect(s.get(shape.name.error)).toBe("Validation failed");
    expect(logged).toHaveBeenCalledWith(bug);
  });

  test("an async check that throws: 'Validation failed', logged, and not remembered as checked", async ({
    lookup: { calls, check },
  }) => {
    const logged = spyConsole();
    const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check) });
    s.set(shape.email, "a@x.io", { origin: "user" });
    const network = new Error("network");
    calls[0].d.reject(network);
    await flush();
    expect(s.get(shape.email.error)).toBe("Validation failed");
    expect(logged).toHaveBeenCalledWith(network);

    s.set(shape.email, "b@x.io", { origin: "user" });
    s.set(shape.email, "a@x.io", { origin: "user" });
    expect(calls.length, "checked again: the failure was not remembered").toBe(3);
  });

  test("a check that throws because it was cancelled is not a failure", async () => {
    const logged = spyConsole();
    const s = createStore(shape, initial(), {
      behaviors: asyncRule(
        shape.email,
        (_v, { signal }) =>
          new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
      ),
    });
    s.set(shape.email, "a@x.io", { origin: "user" });
    s.set(shape.email, "b@x.io", { origin: "user" });
    await flush();
    expect(logged).not.toHaveBeenCalled();
    expect(s.get(shape.email.error)).toBe(undefined);
    expect(s.get(pendingOf(shape.email.error))).toBe(true);
  });
});

describe("M · validate()", () => {
  test("validate: errors in shape order with concrete paths; subtrees, rows and sections", async () => {
    const s = createStore(shape, initial(), {
      behaviors: [
        rule(shape.name, () => "N"),
        rule(L.qty, (q) => (q > 1 ? "Q" : undefined)),
        rule(shape.company.vat, () => "V"),
      ],
    });
    const r = await validate(s);
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => [e.path, e.error])).toEqual([
      ["name", "N"],
      ["company.vat", "V"],
      ["lines[1].qty", "Q"],
    ]);
    expect(r.errors[2].store).toBe(s.substore(shape.lines).itemAt(1));
    expect(r.errors[2].ref).toBe(L.qty.error);
    expect((await validate(s, shape.lines)).errors.map((e) => e.path)).toEqual(["lines[1].qty"]);
    expect((await validate(s.substore(shape.lines).itemAt(1))).errors.map((e) => e.path)).toEqual(["lines[1].qty"]);
    expect((await validate(s.substore(shape.company))).errors.map((e) => e.path)).toEqual(["company.vat"]);
    expect(await validate(s.substore(shape.lines).itemAt(0))).toEqual({ valid: true, errors: [] });
  });

  test("forcing: validate() checks an unchecked async field at once, without its debounce, and resets `forced`", async ({
    lookup: { calls, check },
  }) => {
    const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { debounce: 1000 }) });
    s.set(shape.email, "loaded@x.io");
    expect(calls.length, "a program write leaves it unchecked").toBe(0);
    const pending = validate(s);
    expect(
      calls.map((c) => c.value),
      "started at once",
    ).toEqual(["loaded@x.io"]);
    calls[0].d.resolve("Taken");
    const r = await pending;
    expect(r.errors.map((e) => [e.path, e.error])).toEqual([["email", "Taken"]]);
    expect(s.get(shape.email.forced), "the run that served the force reset it").toBe(false);
    await validate(s);
    expect(calls.length, "an unchanged value is not checked again").toBe(1);
  });

  test("forcing: a forced run cancelled by an edit is rerun forced", async ({ lookup: { calls, check } }) => {
    const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { debounce: 1000 }) });
    s.set(shape.email, "loaded@x.io");
    const pending = validate(s);
    s.set(shape.email, "edited@x.io", { origin: "user" });
    expect(calls[0].signal.aborted).toBe(true);
    expect(
      calls.map((c) => c.value),
      "the rerun starts at once, still forced",
    ).toEqual(["loaded@x.io", "edited@x.io"]);
    calls[1].d.resolve("Taken");
    expect((await pending).errors.map((e) => e.error)).toEqual(["Taken"]);
    expect(s.get(shape.email.forced)).toBe(false);
  });

  test("forcing: a field in its debounce is not forced, and validate() waits for it", async ({
    lookup: { calls, check },
  }) => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { debounce: 300 }) });
    s.set(shape.email, "typed@x.io", { origin: "user" });
    let result: Awaited<ReturnType<typeof validate>> | undefined;
    void validate(s).then((r) => (result = r));
    expect(s.get(shape.email.forced)).toBe(false);
    await vi.advanceTimersByTimeAsync(299);
    expect(calls.length, "the debounce keeps running").toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.length).toBe(1);
    expect(result, "validate() waits for the check").toBe(undefined);
    calls[0].d.resolve("Taken");
    await vi.advanceTimersByTimeAsync(0);
    expect(result?.errors.map((e) => e.error)).toEqual(["Taken"]);
  });

  test("forcing: a node declaring `error` without `forced` is rejected by createStore", () => {
    const f = form(object({ name: field<string>().meta({ error }) }));
    expect(() => createStore(f, { name: "" })).toThrow(/uses a key the node doesn.t declare/);
  });

  test("forcing: a field without rules is not left forced, so a rule mounted later starts as usual", async ({
    lookup: { calls, check },
  }) => {
    const s = createStore(shape, initial());
    await validate(s);
    expect(s.get(shape.email.forced)).toBe(false);
    s.addBehavior(asyncRule(shape.email, check));
    expect(calls.length, "not a forced run").toBe(0);
  });
});

describe("M · Async: inputs", () => {
  test("a changed read value makes validate() re-check; identical inputs reuse the result", async ({
    lookup: { calls, check },
  }) => {
    const s = createStore(shape, initial(), {
      behaviors: asyncRule(shape.email, (v, ctx) => check(`${v}|${ctx.get(shape.type)}`, ctx), { reads: [shape.type] }),
    });
    s.set(shape.email, "a@x.io", { origin: "user" });
    calls[0].d.resolve(undefined);
    await flush();
    await validate(s);
    expect(calls.length, "same inputs: reused").toBe(1);

    s.set(shape.type, "company"); // a read, not a trigger
    expect(calls.length, "reads don't start a check").toBe(1);
    const pending = validate(s);
    expect(calls.length, "inputs changed: checked again").toBe(2);
    expect(calls[1].value).toBe("a@x.io|company");
    calls[1].d.resolve("Taken");
    expect((await pending).valid).toBe(false);
  });

  test("an async check reads only its declared inputs", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => logged.mockRestore());
    const s = createStore(shape, initial(), {
      behaviors: asyncRule(shape.email, async (_v, ctx) => (ctx.get(shape.name), undefined)),
    });
    await validate(s);
    expect(s.get(shape.email.error)).toBe("Validation failed");
    expect((logged.mock.calls[0][0] as Error).message).toMatch(/"name" is not declared/);
  });
});

describe("M · validate() and removed rows (#1)", () => {
  test("a row removed while its check is pending: validate() doesn't wait for it or list it", async ({
    lookup: { calls, check },
  }) => {
    const s = createStore(shape, initial(), { behaviors: asyncRule(L.sku, check, { debounce: 1000 }) });
    const lines = s.substore(shape.lines);
    const doomed = lines.itemAt(1);
    doomed.set(L.sku, "ZZ", { origin: "user" });
    const pending = validate(s);
    expect(
      calls.map((c) => c.value),
      "the idle row is forced, the debouncing one is not",
    ).toEqual(["A"]);
    lines.remove(doomed);
    calls[0].d.resolve(undefined);
    const r = await Promise.race([pending, sleep(50).then(() => "hung" as const)]);
    expect(r).toEqual({ valid: true, errors: [] });
  });

  test("a row removed while its check is in flight: the check is aborted", async ({ lookup: { calls, check } }) => {
    const s = createStore(shape, initial(), { behaviors: asyncRule(L.sku, check) });
    const lines = s.substore(shape.lines);
    const pending = validate(s);
    expect(calls.length).toBe(2);
    lines.remove(lines.itemAt(1));
    expect(calls[1].signal.aborted).toBe(true);
    calls[0].d.resolve(undefined);
    const r = await Promise.race([pending, sleep(50).then(() => "hung" as const)]);
    expect(r).toEqual({ valid: true, errors: [] });
  });
});

describe("M · `defined`: the Required backstop", () => {
  const { shape: order, D, L: Line, initial: empty } = orderFixture;

  test("an empty `defined` field with no rule shows Required", () => {
    const s = createStore(order, empty());
    expect(s.get(D.deliveryType.error)).toBe("Required");
    s.set(D.deliveryType, "Printed", { origin: "user" });
    expect(s.get(D.deliveryType.error)).toBeUndefined();
  });

  test("the author's sync rule speaks first; a rule that lets undefined through still fails closed", () => {
    const s = createStore(order, empty(), {
      behaviors: [required(D.deliveryType, { message: "Choose a delivery type" })],
    });
    expect(s.get(D.deliveryType.error)).toBe("Choose a delivery type");
    const lenient = createStore(order, empty(), { behaviors: [rule(D.deliveryType, () => undefined)] });
    expect(lenient.get(D.deliveryType.error)).toBe("Required");
  });

  test("an async rule doesn't start while the backstop fails", async () => {
    const check = vi.fn<(value: string | undefined) => Promise<string | undefined>>(async () => undefined);
    const s = createStore(order, empty(), { behaviors: [asyncRule(D.deliveryType, check, { start: "always" })] });
    await flush();
    expect(check).not.toHaveBeenCalled();
    expect(s.get(D.deliveryType.error)).toBe("Required");
    s.set(D.deliveryType, "Printed", { origin: "user" });
    await flush();
    expect(check).toHaveBeenCalledOnce();
    expect(s.get(D.deliveryType.error)).toBeUndefined();
  });

  test('only undefined fails the backstop: "" passes it', () => {
    const s = createStore(order, empty());
    s.set(order.items.sku, "", { origin: "user" });
    expect(s.get(order.items.sku.error)).toBeUndefined();
  });

  test("a row added later gets the backstop", () => {
    const s = createStore(order, empty());
    const row = s.substore(order.items.lines).append();
    expect(row.get(Line.sku.error)).toBe("Required");
  });
});
