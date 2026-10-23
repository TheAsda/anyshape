// ============================================================
// Values – behaviors that write values: calculate, link, clearWhen.
// ------------------------------------------------------------
// Built on the core's defineBehavior(). Each writes the value of the nodes
// it takes, so it is that value's one writer.
// ============================================================

import {
  defineBehavior,
  initialOf,
  pathOf,
  type AnyNode,
  type InferValue,
  type Behavior,
  type AnyRef,
  type RefValue,
} from "anyshape";

type Values<Rs extends readonly AnyRef[]> = { -readonly [K in keyof Rs]: RefValue<Rs[K]> };

/** target = fn(...sources), recalculated when a source changes. */
export function calculate<N extends AnyNode, const Rs extends readonly AnyRef[]>(
  target: N,
  sources: Rs,
  fn: (...values: Values<Rs>) => InferValue<N>,
  options: { name?: string } = {},
): Behavior {
  return defineBehavior({
    name: options.name ?? `calculate(${pathOf(target)})`,
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
export function link<A extends AnyNode, B extends AnyNode>(
  a: A,
  b: B,
  options: LinkOptions<InferValue<A>, InferValue<B>>,
): Behavior {
  return defineBehavior({
    name: options.name ?? `link(${pathOf(a)}, ${pathOf(b)})`,
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

/**
 * While test(...refs) holds, the target is reset to its initial value. Edits
 * are reset too, for as long as the test holds, e.g.
 *   clearWhen(s.car, [s.car.visible], (visible) => !visible)
 */
export function clearWhen<N extends AnyNode, const Rs extends readonly AnyRef[]>(
  target: N,
  refs: Rs,
  test: (...values: Values<Rs>) => boolean,
  options: { name?: string } = {},
): Behavior {
  const initial = initialOf(target);
  return defineBehavior({
    name: options.name ?? `clearWhen(${pathOf(target)})`,
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
