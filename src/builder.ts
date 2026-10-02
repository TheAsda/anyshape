// ============================================================
// Builder
// ------------------------------------------------------------
//   defineBehaviors(shape, (b) => {
//     b.add(required(shape.name), maxLength(shape.name, 50));
//     b.when([shape.type], (t) => t === "company", (b) => {
//       b.add(required(shape.taxId));
//     }).otherwise((b) => {
//       b.add(required(shape.personalId));
//     });
//     b.each(shape.lines, (b, line) => lineRules(b, line));
//   });
//
// An authoring layer only: it returns the plain list of behaviors and rules
// that createStore / addBehavior accept.
//   • when blocks add their guard to every behavior, contribution and rule
//     inside them (guard refs become triggers; a skipped behavior keeps its
//     writes, a contribution or rule whose guard fails is absent).
//   • otherwise gets the negated guard. Behaviors in opposite branches of the
//     same split may write the same target: they never run together.
//   • Blocks nest; guards accumulate.
//   • Reusable fragments are plain functions taking the builder.
// ============================================================

import { Behavior, Contribution, when as guardOf, type AnyBehavior, type Branch, type Guard } from "./behaviors";
import { Rule } from "./validation";
import type { ArrayNode, ObjectNode } from "./shape";
import type { AnyRef, RefValue } from "./store";

type Values<Rs extends readonly AnyRef[]> = { -readonly [K in keyof Rs]: RefValue<Rs[K]> };
type Item = AnyBehavior | readonly Item[];

function asArray<T>(v: T | readonly T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? [...(v as readonly T[])] : [v as T];
}

export class BehaviorBuilder {
  /** @internal */
  constructor(
    private readonly out: AnyBehavior[],
    private readonly guards: readonly Guard[],
    private readonly branches: readonly Branch[]
  ) {}

  /** Add behaviors, contributions and rules (arrays, e.g. from exclusive(), are flattened). */
  add(...items: Item[]): this {
    for (const item of items) {
      if (Array.isArray(item)) this.add(...(item as Item[]));
      else this.out.push(this.wrap(item as AnyBehavior));
    }
    return this;
  }

  /** Everything added inside `fn` applies only while `test(...refs)` is true. */
  when<const Rs extends readonly AnyRef[]>(
    refs: Rs,
    test: (...values: Values<Rs>) => boolean,
    fn: (b: BehaviorBuilder) => void
  ): { otherwise(fn: (b: BehaviorBuilder) => void): void } {
    const guard = guardOf(refs, test);
    const group = {};
    fn(new BehaviorBuilder(this.out, [...this.guards, guard], [...this.branches, { group, side: 0 }]));
    return {
      otherwise: (other) => {
        const negated = guardOf(refs, (...values) => !test(...(values as Values<Rs>)));
        other(new BehaviorBuilder(this.out, [...this.guards, negated], [...this.branches, { group, side: 1 }]));
      },
    };
  }

  /** Rules for array items: `item` is the row template (behaviors on it run once per row). */
  each<I extends ObjectNode<any>>(array: ArrayNode<I, any>, fn: (b: BehaviorBuilder, item: I) => void): this {
    fn(this, array.item);
    return this;
  }

  private wrap(item: AnyBehavior): AnyBehavior {
    if (!this.guards.length) return item;
    if (item instanceof Rule) {
      return new Rule(item.target, item.kind, item.check, { ...item.options, when: [...asArray(item.options.when), ...this.guards] });
    }
    if (item instanceof Contribution) {
      // Contributions never conflict, so their branches don't matter.
      return new Contribution(item.target, item.payload, { ...item.decl, when: [...asArray(item.decl.when), ...this.guards] });
    }
    if (item instanceof Behavior) {
      if (item._self) throw new Error("Default behaviors cannot be added through the builder");
      return new Behavior(
        { ...item.config, when: [...asArray(item.config.when), ...this.guards] },
        { branches: [...item._branches, ...this.branches], trace: item._trace }
      );
    }
    throw new Error("Expected a behavior, a contribution or a rule");
  }
}

/** Build a list of behaviors and rules for `shape` (pass it to createStore or addBehavior). */
export function defineBehaviors<S extends ObjectNode<any>>(shape: S, fn: (b: BehaviorBuilder, shape: S) => void): AnyBehavior[] {
  const out: AnyBehavior[] = [];
  fn(new BehaviorBuilder(out, [], []), shape);
  return out;
}
