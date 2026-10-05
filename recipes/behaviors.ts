// ============================================================
// Behaviors: calculate, link, visibleWhen, disableWhen, clearWhen, exclusive.
// ------------------------------------------------------------
// Built on the core's defineBehavior(). Each takes the meta keys it
// writes as the node's own refs (target.visible), so using it on a node
// without them is a compile error.
// ============================================================

import {
  defineBehavior, contribute, when, initialOf,
  type AnyNode, type InferValue, type MetaRef, type AnyBehavior, type Behavior,
  type AnyRef, type RefValue, type Contribution,
} from "anyshape";
import { isEmpty, labelOf } from "./rules";
import { rule, type Validatable } from "./validation";

type Values<Rs extends readonly AnyRef[]> = { -readonly [K in keyof Rs]: RefValue<Rs[K]> };
type WithKey<K extends string, V, P = unknown> = AnyNode & { readonly [P2 in K]: MetaRef<V, P> };
/** A node with the `disabled` feature: its reasons (contributions) are strings. */
type Disableable = WithKey<"disabled", boolean, string>;

/** target = fn(...sources), recalculated when a source changes. */
export function calculate<N extends AnyNode, const Rs extends readonly AnyRef[]>(
  target: N,
  sources: Rs,
  fn: (...values: Values<Rs>) => InferValue<N>,
  options: { name?: string } = {}
): Behavior {
  return defineBehavior({
    name: options.name ?? `calculate(${target.path})`,
    triggers: sources,
    writes: [target],
    run: (ctx) => ctx.set(target, fn(...(sources.map((r) => ctx.get(r)) as Values<Rs>))),
  });
}

export interface LinkOptions<A, B> {
  /** a changed → new value for b */
  forward: (a: A) => B;
  /** b changed → new value for a */
  backward: (b: B) => A;
  name?: string;
}

/**
 * Two-way relation between two values (start/end dates, net/gross price).
 * One behavior: its own writes never re-trigger it. When both change in the
 * same batch (e.g. loading), they are assumed consistent and left alone.
 */
export function link<A extends AnyNode, B extends AnyNode>(a: A, b: B, options: LinkOptions<InferValue<A>, InferValue<B>>): Behavior {
  return defineBehavior({
    name: options.name ?? `link(${a.path}, ${b.path})`,
    triggers: [a, b],
    writes: [a, b],
    runOn: { init: false },
    run(ctx) {
      const aChanged = ctx.changed(a);
      const bChanged = ctx.changed(b);
      if (aChanged && bChanged) return;
      if (aChanged) ctx.set(b, options.forward(ctx.get(a) as InferValue<A>));
      else if (bChanged) ctx.set(a, options.backward(ctx.get(b) as InferValue<B>));
    },
  });
}

/** target.visible = test(...refs). */
export function visibleWhen<const Rs extends readonly AnyRef[]>(
  target: WithKey<"visible", boolean>,
  refs: Rs,
  test: (...values: Values<Rs>) => boolean,
  options: { name?: string } = {}
): Behavior {
  return defineBehavior({
    name: options.name ?? `visibleWhen(${target.path})`,
    triggers: refs,
    writes: [target.visible],
    run: (ctx) => ctx.set(target.visible, test(...(refs.map((r) => ctx.get(r)) as Values<Rs>))),
  });
}

/** Disables the target while test(...refs) holds. Other reasons (exclusive, more disableWhen) still apply. */
export function disableWhen<const Rs extends readonly AnyRef[]>(
  target: Disableable,
  refs: Rs,
  test: (...values: Values<Rs>) => boolean,
  options: { name?: string } = {}
): Contribution<string> {
  const name = options.name ?? `disableWhen(${target.path})`;
  return contribute(target.disabled, name, { name, when: when(refs, test) });
}

/**
 * While test(...refs) holds, the target is reset to its initial value. Edits
 * are reset too, for as long as the test holds, e.g.
 *   clearWhen(s.car, [s.car.visible], (visible) => !visible)
 */
export function clearWhen<N extends AnyNode, const Rs extends readonly AnyRef[]>(
  target: N,
  refs: Rs,
  test: (...values: Values<Rs>) => boolean,
  options: { name?: string } = {}
): Behavior {
  const initial = initialOf(target);
  return defineBehavior({
    name: options.name ?? `clearWhen(${target.path})`,
    triggers: [...refs, target],
    reads: [initial],
    writes: [target],
    run(ctx) {
      if (!test(...(refs.map((r) => ctx.get(r)) as Values<Rs>))) return;
      const next = ctx.get(initial);
      if (!Object.is(ctx.get(target), next)) ctx.set(target, next);
    },
  });
}

export interface ExclusiveOptions {
  /** Exactly one must be filled. Default false (at most one). */
  required?: boolean;
  message?: { tooMany?: string; missing?: string };
  name?: string;
}

type ExclusiveField = Validatable & Disableable;

/**
 * At most (or exactly, with `required`) one of the fields may be filled.
 *   • exactly one filled → the others are disabled
 *   • none or several    → all enabled, so the user can fix it
 *   • several filled     → every filled field gets an error
 *   • none (required)    → every field gets an error
 * Returns a `disabled` reason plus a rule per field.
 */
export function exclusive(fields: readonly ExclusiveField[], options: ExclusiveOptions = {}): AnyBehavior[] {
  if (fields.length < 2) throw new Error("exclusive() needs at least two fields");
  const name = options.name ?? `exclusive(${fields.map((f) => f.path).join(", ")})`;
  const labels = fields.map(labelOf).join(", ");
  const tooMany = options.message?.tooMany ?? `Only one of ${labels} can be set`;
  const missing = options.message?.missing ?? `One of ${labels} is required`;

  const disablers = fields.map((field, i) =>
    contribute(field.disabled, name, {
      name: `${name}:${field.path}`,
      when: when(fields, (...values: unknown[]) => {
        const filled = values.map((v) => !isEmpty(v));
        return filled.filter(Boolean).length === 1 && !filled[i];
      }),
    })
  );

  const rules: AnyBehavior[] = fields.map((field) =>
    rule(
      field,
      (value, ctx) => {
        const count = fields.filter((f) => !isEmpty(f === field ? value : ctx.get(f))).length;
        if (count > 1 && !isEmpty(value)) return tooMany;
        if (options.required && count === 0) return missing;
        return undefined;
      },
      { name: `${name}:${field.path}`, triggers: fields.filter((f) => f !== field) }
    )
  );
  return [...disablers, ...rules];
}
