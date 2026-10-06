// Submit recipe: handleSubmit(store, fn).

import { form, object, array, field, metaKey, createStore } from "anyshape";
import { test as base, describe, expect } from "vitest";

import { control } from "./features";
import { registerFocus } from "./focus";
import { required } from "./rules";
import { handleSubmit, submission } from "./submit";
import * as limits from "./test/fixtures/limits";
import * as order from "./test/fixtures/order";
import { deferred } from "./test/harness";
import { rule, asyncRule } from "./validation";

describe("Submit", () => {
  const { shape, L, initial } = limits;
  const test = base.extend("store", () => createStore(shape, initial()));

  test("handleSubmit: preventDefault, fn gets the store's value", async ({ store: s }) => {
    let prevented = 0;
    const got: unknown[] = [];
    const handler = handleSubmit(s, async (formData) => void got.push(formData));
    await handler({ preventDefault: () => prevented++ });
    expect(prevented).toBe(1);
    expect(got).toEqual([initial()]);
    await handler(); // no event: a programmatic submit
    expect(got.length).toBe(2);
  });

  test("submitting is true while fn runs; an error in fn rejects and resets it", async ({ store: s }) => {
    let seen: boolean | undefined;
    await handleSubmit(s, async () => void (seen = s.get(shape.submitting)))();
    expect(seen).toBe(true);
    expect(s.get(shape.submitting)).toBe(false);

    const failing = handleSubmit(s, async () => {
      throw new Error("save failed");
    });
    await expect(failing()).rejects.toThrow("save failed");
    expect(s.get(shape.submitting)).toBe(false);
  });

  test("fn may be sync: it gets the value, and its throw rejects and resets submitting", async ({ store: s }) => {
    const got: unknown[] = [];
    await handleSubmit(s, (formData) => void got.push(formData))();
    expect(got).toEqual([initial()]);

    const failing = handleSubmit(s, () => {
      throw new Error("save failed");
    });
    await expect(failing()).rejects.toThrow("save failed");
    expect(s.get(shape.submitting)).toBe(false);
  });

  test("an invalid form focuses the first error and does not call fn", async () => {
    const s = createStore(shape, initial(), {
      behaviors: [rule(shape.name, () => "bad"), rule(shape.code, () => "bad")],
    });
    const focused: string[] = [];
    registerFocus(s, shape.name, { focus: () => focused.push("name") });
    registerFocus(s, shape.code, { focus: () => focused.push("code") });
    let calls = 0;
    await handleSubmit(s, async () => void calls++)();
    expect(calls).toBe(0);
    expect(focused).toEqual(["name"]);
    expect(s.get(shape.submitting)).toBe(false);
  });

  test("a submit reveals its subtree: existing rows yes, later rows no; reset clears", async ({ store: s }) => {
    const lines = s.substore(shape.lines);
    await handleSubmit(s, async () => {})();
    expect(s.get(shape.name.revealed)).toBe(true);
    expect(lines.items().map((row) => row.get(L.qty.revealed))).toEqual([true, true]);
    expect(lines.itemAt(1).substore(L.notes).itemAt(0).get(L.notes.item.text.revealed), "nested rows").toBe(true);

    const added = lines.append({ qty: 1, notes: [] });
    expect(added.get(L.qty.revealed), "a row added after the submit starts hidden").toBe(false);

    s.reset();
    expect(s.get(shape.name.revealed)).toBe(false);
    expect(lines.items().map((row) => row.get(L.qty.revealed))).toEqual([false, false]);
  });

  test("a submit while one of the same store runs resolves at once, without fn or a reveal", async ({ store: s }) => {
    const gate = deferred<void>();
    let calls = 0;
    const handler = handleSubmit(s, async () => {
      calls++;
      await gate.promise;
    });
    const first = handler();
    await expect.poll(() => calls).toBe(1);
    s.set(shape.name.revealed, false);

    await handleSubmit(s, async () => void calls++)();
    expect(calls, "the second submit did not call fn").toBe(1);
    expect(s.get(shape.name.revealed), "nor reveal").toBe(false);
    expect(s.get(shape.submitting), "the first one still runs").toBe(true);

    gate.resolve();
    await first;
    await handler();
    expect(calls, "a new submit after completion").toBe(2);
  });
});

describe("Submit: submittable nodes", () => {
  const shape = form(
    object({
      name: field<string>().meta(control()),
      rows: array(object({ sku: field<string>().meta(control()) }).meta(submission())),
    }).meta(submission()),
  );
  const R = shape.rows.item;
  const test = base.extend("store", () => createStore(shape, { name: "Ann", rows: [{ sku: "A" }, { sku: "B" }] }));

  test("a row and the root submit independently; neither sets the other's submitting", async ({ store: s }) => {
    const [a, b] = s.substore(shape.rows).items();
    const gate = deferred<void>();
    const got: unknown[] = [];
    const rowSubmit = handleSubmit(a, async (formData) => {
      got.push(formData);
      await gate.promise;
    })();
    await expect.poll(() => got.length).toBe(1);
    expect(got[0]).toEqual({ sku: "A" });
    expect([s.get(shape.submitting), a.get(R.submitting), b.get(R.submitting)]).toEqual([false, true, false]);
    expect(
      [s.get(shape.name.revealed), a.get(R.sku.revealed), b.get(R.sku.revealed)],
      "the row's subtree only",
    ).toEqual([false, true, false]);

    let rootSeen: boolean[] = [];
    await handleSubmit(s, async (formData) => {
      got.push(formData);
      rootSeen = [s.get(shape.submitting), a.get(R.submitting)];
    })();
    expect(got[1], "the root submitted while the row's submit runs").toEqual({
      name: "Ann",
      rows: [{ sku: "A" }, { sku: "B" }],
    });
    expect(rootSeen).toEqual([true, true]);
    expect(a.get(R.submitting), "the root's finally leaves the row's submitting alone").toBe(true);

    gate.resolve();
    await rowSubmit;
    expect(a.get(R.submitting)).toBe(false);
  });

  test("a row removed while its submit runs: the handler settles with fn's outcome", async ({ store: s }) => {
    const rows = s.substore(shape.rows);
    const [a, b] = rows.items();
    const gate = deferred<void>();
    const done = handleSubmit(a, () => gate.promise)();
    await expect.poll(() => a.get(R.submitting)).toBe(true);
    rows.remove(a);
    gate.resolve();
    await expect(done, "no error from the detached row").resolves.toBeUndefined();

    const failing = deferred<void>();
    const rejected = handleSubmit(b, async () => {
      await failing.promise;
      throw new Error("save failed");
    })();
    await expect.poll(() => b.get(R.submitting)).toBe(true);
    rows.remove(b);
    failing.resolve();
    await expect(rejected, "fn's error, not the detached store's").rejects.toThrow("save failed");
  });

  test("repeated handleSubmit calls on one store keep toggling its own submitting as rows come and go", async ({
    store: s,
  }) => {
    const rows = s.substore(shape.rows);
    const [a] = rows.items();
    const seen: boolean[][] = [];
    const watch = (row: typeof a) => async () => void seen.push([s.get(shape.submitting), row.get(R.submitting)]);
    await handleSubmit(s, watch(a))();
    const added = rows.append({ sku: "C" });
    await handleSubmit(s, watch(added))();
    await handleSubmit(added, watch(added))();
    await handleSubmit(a, watch(a))();
    expect(seen).toEqual([
      [true, false],
      [true, false],
      [false, true],
      [false, true],
    ]);
    expect([s.get(shape.submitting), a.get(R.submitting), added.get(R.submitting)]).toEqual([false, false, false]);
  });

  test("a store whose own node does not declare submission() is rejected", ({ store: s }) => {
    const plain = createStore(form(object({ name: field<string>().meta(control()) })), { name: "" });
    // @ts-expect-error – the root has no submission()
    expect(() => handleSubmit(plain, async () => {})).toThrow(/submission\(\)/);
    // @ts-expect-error – still rejected on a second call: nothing is cached
    expect(() => handleSubmit(plain, async () => {}), "a second call").toThrow(/submission\(\)/);
    const section = form(object({ step: object({ x: field<string>() }) }));
    const step = createStore(section, { step: { x: "" } }).substore(section.step);
    // @ts-expect-error – a section is submittable only if it declares submission() itself
    expect(() => handleSubmit(step, async () => {})).toThrow(/"step"/);
    expect(() => handleSubmit(s.substore(shape.rows).itemAt(0), async () => {})).not.toThrow();
  });

  test("a section that declares submission() is submittable through its own store", async () => {
    const wizard = form(object({ step: object({ x: field<string>().meta(control()) }).meta(submission()) }));
    const s = createStore(wizard, { step: { x: "a" } });
    const got: unknown[] = [];
    await handleSubmit(s.substore(wizard.step), (formData) => void got.push(formData))();
    expect(got).toEqual([{ x: "a" }]);
    expect(s.get(wizard.step.x.revealed)).toBe(true);
  });

  test("a node with its own `submitting` definition is not submittable: the key is matched by definition", () => {
    const foreign = form(object({ name: field<string>() }).meta({ submitting: metaKey(false) }));
    expect(() => handleSubmit(createStore(foreign, { name: "" }), async () => {})).toThrow(/submission\(\)/);
  });
});

describe("Submit: a step at the boundary", () => {
  const { shape, D, L, initial, loadSkus, skusFor } = order;
  const test = base.extend("store", () => createStore(shape, initial()));

  test("an empty `defined` field blocks Next with no rule registered; only the step is revealed", async ({
    store: s,
  }) => {
    const got: unknown[] = [];
    await handleSubmit(s.substore(D), (d) => void got.push(d))();
    expect(got).toEqual([]);
    expect(s.get(D.deliveryType.error)).toBe("Required");
    expect(s.get(D.deliveryType.revealed)).toBe(true);
    expect(s.get(shape.items.sku.revealed)).toBe(false);
    expect(s.get(D.submitting)).toBe(false);
  });

  test("the author's rule speaks first; the backstop is the fallback", async () => {
    const s = createStore(shape, initial(), {
      behaviors: [required(D.deliveryType, { message: "Choose a delivery type" })],
    });
    await handleSubmit(s.substore(D), () => {})();
    expect(s.get(D.deliveryType.error)).toBe("Choose a delivery type");
  });

  test("a filled step hands fn its value", async ({ store: s }) => {
    s.set(D.deliveryType, "Printed");
    const got: unknown[] = [];
    await handleSubmit(s.substore(D), (d) => void got.push(d))();
    expect(got).toEqual([{ deliveryType: "Printed", email: "" }]);
  });

  test("an async rule that never started runs at the boundary", async () => {
    const s = createStore(shape, initial(), {
      behaviors: [asyncRule(D.email, async (v) => (v.includes("@") ? undefined : "Bad email"))],
    });
    s.set(D.deliveryType, "Printed");
    const got: unknown[] = [];
    await handleSubmit(s.substore(D), (d) => void got.push(d))();
    expect(got).toEqual([]);
    expect(s.get(D.email.error)).toBe("Bad email");
  });

  test("an outside write that clears `error` doesn't let an empty field through: validate() reruns the queue", async ({
    store: s,
  }) => {
    s.set(D.deliveryType.error, undefined);
    expect(s.get(D.deliveryType.error)).toBeUndefined();
    const got: unknown[] = [];
    await handleSubmit(s.substore(D), (d) => void got.push(d))();
    expect(got).toEqual([]);
  });

  test("going back and clearing step 1 blocks the final submit", async ({ store: s }) => {
    s.set(D.deliveryType, "Printed");
    s.set(shape.items.sku, "P-1");
    s.set(D.deliveryType, undefined, { origin: "user" });
    const got: unknown[] = [];
    await handleSubmit(s, (d) => void got.push(d))();
    expect(got).toEqual([]);
    expect(s.get(D.deliveryType.error)).toBe("Required");
  });

  test("a row added later is checked too", async ({ store: s }) => {
    s.set(shape.items.sku, "P-1");
    const row = s.substore(shape.items.lines).append();
    const got: unknown[] = [];
    await handleSubmit(s.substore(shape.items), (d) => void got.push(d))();
    expect(got).toEqual([]);
    expect(row.get(L.sku.error)).toBe("Required");
    row.set(L.sku, "P-1");
    await handleSubmit(s.substore(shape.items), (d) => void got.push(d))();
    expect(got).toEqual([{ sku: "P-1", note: undefined, lines: [{ sku: "P-1", qty: 1 }] }]);
  });

  test("step 2's behavior reads the stored type and empties the list when step 1 is cleared", async () => {
    const s = createStore(shape, initial(), { behaviors: [loadSkus(async (t) => skusFor(t))] });
    s.set(D.deliveryType, "Electronic");
    await s.settle();
    expect(s.get(shape.items.sku.skuOptions)).toEqual(["E-1", "E-2"]);
    s.set(D.deliveryType, undefined);
    await s.settle();
    expect(s.get(shape.items.sku.skuOptions)).toEqual([]);
  });
});
