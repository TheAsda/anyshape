// ============================================================
// The recipes' type contract: each states in its type the meta keys it needs.
// These assertions are checked by `npm run typecheck` (tsc), not by vitest.
// ============================================================

import { form, object, array, field, metaKey, createStore, defineBehavior } from "anyshape";
import { test, expectTypeOf } from "vitest";

import {
  control,
  visible,
  disabled,
  defined,
  required,
  min,
  pattern,
  visibleWhen,
  disableWhen,
  exclusive,
  handleSubmit,
  type InferChecked,
} from "./index";
import type { useControl } from "./react";
import * as order from "./test/fixtures/order";
import type { DeliveryType } from "./test/fixtures/order";

const t = form(
  object({
    text: field<string>().meta(control()),
    count: field<number>().meta(control()),
    plain: field<number>(),
    hidden: object({ x: field<string>() }).meta({ visible }),
    off: field<string>().meta(control(), { disabled }),
    other: field<string>().meta(control(), { disabled }),
  }),
);

// Calls that must (and must not) compile. Never called.
export function typeOnlyChecks() {
  // @ts-expect-error – `plain` has no validation()
  required(t.plain);
  // @ts-expect-error – min needs a number field
  min(t.text, 1);
  // @ts-expect-error – pattern needs a string field
  pattern(t.count, /x/);
  // @ts-expect-error – visibleWhen needs `visible`
  visibleWhen(t.text, [t.plain], () => true);
  // @ts-expect-error – exclusive needs `disabled` on every field
  exclusive([t.text, t.off]);
  exclusive([t.off, t.other]);
}

test("recipes state the keys they need through ref properties", () => {
  type VisibleTarget = Parameters<typeof visibleWhen>[0];
  type DisableTarget = Parameters<typeof disableWhen>[0];
  type ControlTarget = Parameters<typeof useControl>[0];
  const named = form(object({ group: object({ visible: field<boolean>() }) }));

  expectTypeOf(t.hidden).toExtend<VisibleTarget>();
  expectTypeOf(t.text).not.toExtend<VisibleTarget>();
  expectTypeOf(named.group).not.toExtend<VisibleTarget>(); // a child named `visible` is not the key
  expectTypeOf(t.off).toExtend<DisableTarget>();
  expectTypeOf(t.text).not.toExtend<DisableTarget>();
  expectTypeOf(t.text).toExtend<ControlTarget>();
  expectTypeOf(t.plain).not.toExtend<ControlTarget>();
});

// Stored type on reads (useValue in react/submit.test.tsx), checked type at the
// submit boundary. Never called.
export function checkedTypeChecks() {
  const { shape, D } = order;
  const store = createStore(shape, order.initial());
  expectTypeOf(store.get(D.deliveryType)).toEqualTypeOf<DeliveryType | undefined>();
  defineBehavior({
    triggers: [D.deliveryType],
    run(ctx) {
      expectTypeOf(ctx.get(D.deliveryType)).toEqualTypeOf<DeliveryType | undefined>();
    },
  });
  handleSubmit(store.substore(D), (delivery) => {
    expectTypeOf(delivery).toEqualTypeOf<{ deliveryType: DeliveryType; email: string }>();
  });
  handleSubmit(store, (data) => {
    expectTypeOf(data).toEqualTypeOf<{
      delivery: { deliveryType: DeliveryType; email: string };
      items: { sku: string; note: string | undefined; lines: { sku: string; qty: number }[] };
    }>();
  });
}

test("InferChecked drops undefined only where `defined` is declared", () => {
  const foreign = form(object({ x: field<string | undefined>().meta(control(), { defined: metaKey(true) }) }));
  expectTypeOf<InferChecked<typeof foreign>>().toEqualTypeOf<{ x: string | undefined }>();

  const kept = form(
    object({
      maybe: field<string | null | undefined>().meta(control(), { defined }),
      plain: field<number | undefined>().meta(control()),
      nested: object({ deep: object({ y: field<boolean | undefined>().meta(control(), { defined }) }) }),
      rows: array(object({ z: field<string | undefined>().meta(control(), { defined }) })),
    }),
  );
  expectTypeOf<InferChecked<typeof kept>>().toEqualTypeOf<{
    maybe: string | null;
    plain: number | undefined;
    nested: { deep: { y: boolean } };
    rows: { z: string }[];
  }>();
});
