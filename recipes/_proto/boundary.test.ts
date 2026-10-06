// ============================================================
// PROTOTYPE(#128) – throwaway. The step-boundary candidates on the
// delivery-type wizard:
//   A. handleSubmit(store.substore(step), fn), fn typed InferChecked<N>
//   B. checkStep(store, node)
//   C. assertChecked(store, node)
// ============================================================

import { createStore, metaKey, field, form, object, type AnyBehavior } from "anyshape";
import { describe, test, expect, expectTypeOf } from "vitest";

import { control } from "../features";
import { required } from "../rules";
import { handleSubmit, submission } from "../submit";
import { deferred, flush } from "../test/harness";
import { asyncRule, type InferChecked } from "../validation";
import { assertChecked, checkStep, UncheckedError } from "./boundary";
import { order, empty, loadSkus, skusFor, type DeliveryType } from "./wizard";

const make = (behaviors: AnyBehavior[] = []) => createStore(order, empty(), { behaviors });
const D = order.delivery;

describe("types", () => {
  test("stored type on reads, checked type at the boundaries", () => {
    const store = make();
    expectTypeOf(store.get(D.deliveryType)).toEqualTypeOf<DeliveryType | undefined>();
    store.set(D.deliveryType, "Printed");
    expectTypeOf<InferChecked<typeof D>>().toEqualTypeOf<{ deliveryType: DeliveryType; email: string }>();
    expectTypeOf<InferChecked<typeof order.items>>().toEqualTypeOf<{
      sku: string;
      note: string | undefined;
      lines: { sku: string; qty: number }[];
    }>();
    expectTypeOf(assertChecked(store, D)).toEqualTypeOf<{ deliveryType: DeliveryType; email: string }>();
    expectTypeOf(assertChecked(store, D.deliveryType)).toEqualTypeOf<DeliveryType>();
    expectTypeOf(checkStep(store, D)).resolves.toEqualTypeOf<{ deliveryType: DeliveryType; email: string }>();
    handleSubmit(store.substore(D), (delivery) => {
      expectTypeOf(delivery).toEqualTypeOf<{ deliveryType: DeliveryType; email: string }>();
    });
    handleSubmit(store, (data) => {
      expectTypeOf(data.items.lines).toEqualTypeOf<{ sku: string; qty: number }[]>();
    });
  });

  test("a foreign key named `defined` does not narrow", () => {
    const fake = form(
      object({ x: field<string | undefined>().meta(control(), { defined: metaKey(true) }) }).meta(submission()),
    );
    expectTypeOf<InferChecked<typeof fake>>().toEqualTypeOf<{ x: string | undefined }>();
  });
});

describe("A · handleSubmit on the step's substore", () => {
  test("an empty required field blocks Next with no rule registered; only the step is revealed", async () => {
    const store = make();
    const got: unknown[] = [];
    await handleSubmit(store.substore(D), (d) => void got.push(d))();
    expect(got).toEqual([]);
    expect(store.get(D.deliveryType.error)).toBe("Required");
    expect(store.get(D.deliveryType.revealed)).toBe(true);
    expect(store.get(order.items.sku.revealed)).toBe(false);
    expect(store.get(D.submitting)).toBe(false);
  });

  test("the author's rule speaks first; the backstop is the fallback", async () => {
    const store = make([required(D.deliveryType, { message: "Choose a delivery type" })]);
    await handleSubmit(store.substore(D), () => {})();
    expect(store.get(D.deliveryType.error)).toBe("Choose a delivery type");
  });

  test("a filled step hands fn its value", async () => {
    const store = make();
    store.set(D.deliveryType, "Printed");
    const got: unknown[] = [];
    await handleSubmit(store.substore(D), (d) => void got.push(d))();
    expect(got).toEqual([{ deliveryType: "Printed", email: "" }]);
  });

  test("an async rule that never started runs at the boundary", async () => {
    const store = make([asyncRule(D.email, async (v) => (v.includes("@") ? undefined : "Bad email"))]);
    store.set(D.deliveryType, "Printed");
    const got: unknown[] = [];
    await handleSubmit(store.substore(D), (d) => void got.push(d))();
    expect(got).toEqual([]);
    expect(store.get(D.email.error)).toBe("Bad email");
  });

  test("an outside write that clears `error` doesn't let an empty field through: validate() re-runs the queue", async () => {
    const store = make();
    store.set(D.deliveryType.error, undefined);
    expect(store.get(D.deliveryType.error)).toBeUndefined();
    const got: unknown[] = [];
    await handleSubmit(store.substore(D), (d) => void got.push(d))();
    expect(got).toEqual([]);
  });

  test("going back and clearing step 1 blocks the final submit", async () => {
    const store = make();
    store.set(D.deliveryType, "Printed");
    store.set(order.items.sku, "P-1");
    store.set(D.deliveryType, undefined, { origin: "user" });
    const got: unknown[] = [];
    await handleSubmit(store, (d) => void got.push(d))();
    expect(got).toEqual([]);
    expect(store.get(D.deliveryType.error)).toBe("Required");
  });

  test("a row added later is checked too", async () => {
    const store = make();
    store.set(order.items.sku, "P-1");
    const row = store.substore(order.items.lines).append();
    const got: unknown[] = [];
    await handleSubmit(store.substore(order.items), (d) => void got.push(d))();
    expect(got).toEqual([]);
    expect(row.get(order.items.lines.item.sku.error)).toBe("Required");
    row.set(order.items.lines.item.sku, "P-1");
    await handleSubmit(store.substore(order.items), (d) => void got.push(d))();
    expect(got).toEqual([{ sku: "P-1", note: undefined, lines: [{ sku: "P-1", qty: 1 }] }]);
  });

  test("step 2's behavior reads the stored type and empties the list when step 1 is cleared", async () => {
    const store = make([loadSkus(async (t) => skusFor(t))]);
    store.set(D.deliveryType, "Electronic");
    await store.settle();
    expect(store.get(order.items.sku.skuOptions)).toEqual(["E-1", "E-2"]);
    store.set(D.deliveryType, undefined);
    await store.settle();
    expect(store.get(order.items.sku.skuOptions)).toEqual([]);
  });
});

describe("B · checkStep", () => {
  test("throws with the failing paths, reveals nothing; returns the checked value once filled", async () => {
    const store = make();
    const thrown = await checkStep(store, D).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(UncheckedError);
    expect((thrown as UncheckedError).failures.map((f) => f.path)).toEqual(["delivery.deliveryType"]);
    expect(store.get(D.deliveryType.revealed)).toBe(false);
    store.set(D.deliveryType, "Electronic");
    await expect(checkStep(store, D)).resolves.toEqual({ deliveryType: "Electronic", email: "" });
  });
});

describe("C · assertChecked", () => {
  test("throws while empty with no rule registered, returns once filled", () => {
    const store = make();
    expect(() => assertChecked(store, D)).toThrow(/delivery\.deliveryType: Required/);
    store.set(D.deliveryType, "Printed");
    expect(assertChecked(store, D)).toEqual({ deliveryType: "Printed", email: "" });
  });

  test("throws while a check is pending", async () => {
    const gate = deferred<string | undefined>();
    const store = make([asyncRule(D.email, () => gate.promise, { start: "any" })]);
    store.set(D.deliveryType, "Printed");
    store.set(D.email, "a@b");
    expect(() => assertChecked(store, D)).toThrow(/a check is pending/);
    gate.resolve(undefined);
    await flush();
    expect(assertChecked(store, D)).toEqual({ deliveryType: "Printed", email: "a@b" });
  });

  test("gap: an async rule that never started is not run – the sync read passes, checkStep fails", async () => {
    const store = make([asyncRule(D.email, async (v) => (v.includes("@") ? undefined : "Bad email"))]);
    store.set(D.deliveryType, "Printed");
    expect(assertChecked(store, D)).toEqual({ deliveryType: "Printed", email: "" });
    await expect(checkStep(store, D)).rejects.toThrow(/delivery\.email: Bad email/);
  });

  test("an outside write that clears `error` is caught by re-running `defined` on the value", () => {
    const store = make();
    store.set(D.deliveryType.error, undefined);
    expect(() => assertChecked(store, D)).toThrow(/delivery\.deliveryType: Required/);
  });

  test("a row node needs the row's store", () => {
    const store = make();
    store.substore(order.items.lines).append();
    expect(() => assertChecked(store, order.items.lines.item)).toThrow(/inside an array/);
  });
});
