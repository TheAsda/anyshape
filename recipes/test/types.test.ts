// ============================================================
// The recipes' type contract: each states in its type the meta keys it needs.
// These assertions are checked by `npm run typecheck` (tsc), not by vitest.
// ============================================================

import { form, object, array, field, metaKey, createStore, defineBehavior, type InferValue } from "anyshape";
import { test, expectTypeOf } from "vitest";

import {
  control,
  visible,
  disabled,
  defined,
  required,
  min,
  minLength,
  pattern,
  visibleWhen,
  disableWhen,
  exclusive,
  startWith,
  emptyToUndefined,
  handleSubmit,
  type InferChecked,
  type Validatable,
  type Lengthy,
  type Numeric,
  type Textual,
  type Limit,
  type MessageOptions,
  type DefinedOptions,
} from "../index";
import type { useControl, ControlNode, ControlBinding } from "../react";
import * as order from "./fixtures/order";
import type { DeliveryType } from "./fixtures/order";

const t = form(
  object({
    text: field<string>().meta(control()),
    count: field<number>().meta(control()),
    plain: field<number>(),
    hidden: object({ x: field<string>() }).meta(visible()),
    off: field<string>().meta(control(), disabled()),
    other: field<string>().meta(control(), disabled()),
    optText: field<string | undefined>().meta(control()),
    optTags: field<string[] | undefined>().meta(control()),
    optCount: field<number | undefined>().meta(control()),
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
  // @ts-expect-error – a meta group is a function: call it (.meta(visible()))
  t.plain.meta({ visible });
  // @ts-expect-error – visibleWhen needs `visible`
  visibleWhen(t.text, [t.plain], () => true);
  // @ts-expect-error – exclusive needs `disabled` on every field
  exclusive([t.text, t.off]);
  exclusive([t.off, t.other]);
  // @ts-expect-error – startWith takes a meta key, not a node
  startWith(t.text, "");
  // @ts-expect-error – the start must match the key's value type
  startWith(t.text.error, 0);
  startWith(t.text.revealed, true);
  // @ts-expect-error – emptyToUndefined requires undefined in the node's value type
  emptyToUndefined(t.text);
  // @ts-expect-error – emptyToUndefined only accepts string or array nodes
  emptyToUndefined(t.optCount);
  emptyToUndefined(t.optText);
  emptyToUndefined(t.optTags);
}

// Wrappers in user code type cleanly using the exported node & option types. Never called.
export function wrapperTypeChecks() {
  const myRequired = <N extends Validatable>(node: N, options: MessageOptions<InferValue<N>> = {}) =>
    required(node, { message: () => "Req", ...options });
  const myMinLength = <N extends Lengthy>(
    node: N,
    length: Limit,
    options: MessageOptions<InferValue<N>, { limit: number }> = {},
  ) => minLength(node, length, { message: (_v, { limit }) => `Min ${limit}`, ...options });
  const myMin = <N extends Numeric>(
    node: N,
    limit: Limit,
    options: MessageOptions<InferValue<N>, { limit: number }> = {},
  ) => min(node, limit, { message: (_v, { limit: l }) => `>= ${l}`, ...options });
  const myPattern = <N extends Textual>(node: N, regex: RegExp, options: MessageOptions<InferValue<N>> = {}) =>
    pattern(node, regex, { message: () => "Bad", ...options });
  const myDefined = (options?: DefinedOptions) => defined({ message: () => "Req", ...options });

  myRequired(t.text);
  myMinLength(t.text, 3);
  myMin(t.count, 1);
  myPattern(t.text, /x/);
  const f = form(object({ pick: field<string | undefined>().meta(control(), myDefined()) }));
  expectTypeOf<InferChecked<typeof f>>().toEqualTypeOf<{ pick: string }>();
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
      maybe: field<string | null | undefined>().meta(control(), defined()),
      plain: field<number | undefined>().meta(control()),
      nested: object({ deep: object({ y: field<boolean | undefined>().meta(control(), defined()) }) }),
      rows: array(object({ z: field<string | undefined>().meta(control(), defined()) })),
    }),
  );
  expectTypeOf<InferChecked<typeof kept>>().toEqualTypeOf<{
    maybe: string | null;
    plain: number | undefined;
    nested: { deep: { y: boolean } };
    rows: { z: string }[];
  }>();
});

test("ControlNode is parameterized by the node's value type", () => {
  expectTypeOf(t.text).toExtend<ControlNode<string>>();
  expectTypeOf(t.count).toExtend<ControlNode<number>>();
  expectTypeOf(t.text).not.toExtend<ControlNode<number>>();
  expectTypeOf(t.hidden.x).not.toExtend<ControlNode<string>>(); // string value, no control() keys
  expectTypeOf<ControlBinding<string>["value"]>().toEqualTypeOf<string>();
  expectTypeOf<ControlBinding<string>["onChange"]>().toEqualTypeOf<(value: string) => void>();
  expectTypeOf<ControlBinding<string>["error"]>().toEqualTypeOf<string | undefined>();
  expectTypeOf<ReturnType<typeof useControl<string>>>().toEqualTypeOf<ControlBinding<string>>();
});
