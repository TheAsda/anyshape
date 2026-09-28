// ============================================================
// Ready-made rules and behaviors
// ------------------------------------------------------------
// Everything here is built on the public API (rule, defineBehavior, when).
// Each utility states in its type which meta keys it needs, so using it on a
// node without them is a compile error.
//
// Rules: required, minLength, maxLength, min, max, pattern, email.
//   • Format rules pass on empty values – combine them with required.
//   • required() follows the node's `required` meta key when it declares one
//     (so a behavior can switch it); otherwise the field is always required.
//
// Behaviors: calculate, link, visibleWhen, disableWhen, clearWhenHidden,
//            exclusive.
// ============================================================

import { MetaRef, type AnyNode, type InferValue } from "./shape";
import { defineBehavior, when, type AnyBehavior, type Behavior, type Guard } from "./behaviors";
import { rule, type Rule, type Validatable } from "./validation";
import { initialOf, type AnyRef, type RefValue } from "./store";

type Values<Rs extends readonly AnyRef[]> = { -readonly [K in keyof Rs]: RefValue<Rs[K]> };
type WithKey<K extends string, V> = AnyNode & { readonly _meta: { [P in K]: V } };

export type Message<V = any> = string | ((value: V) => string);

export interface RuleUtilOptions<V = any> {
  message?: Message<V>;
  /** Skip the rule while the guard is false. */
  when?: Guard | readonly Guard[];
  name?: string;
}

function message<V>(m: Message<V> | undefined, fallback: string, value: V): string {
  return m === undefined ? fallback : typeof m === "function" ? m(value) : m;
}

function guards(when: Guard | readonly Guard[] | undefined): Guard[] {
  return when === undefined ? [] : Array.isArray(when) ? [...when] : [when as Guard];
}

/** undefined, null, whitespace-only strings and empty arrays are empty. */
export function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** The node's `label` meta when it is a string, otherwise the last path segment. */
export function labelOf(node: AnyNode): string {
  const label = (node._meta as Record<string, unknown>).label;
  if (typeof label === "string") return label;
  const path = node.path ?? "";
  return path.slice(path.lastIndexOf(".") + 1).replace(/\[\]$/, "") || "<root>";
}

// ============================================================
// Rules
// ============================================================
export function required<N extends Validatable>(node: N, options: RuleUtilOptions<InferValue<N>> = {}): Rule<N> {
  const all = guards(options.when);
  if ("required" in node._metaDefs) {
    all.push(when([new MetaRef<boolean>(node, "required")], (r) => r !== false));
  }
  return rule(node, (v) => (isEmpty(v) ? message(options.message, "Required", v) : undefined), {
    name: options.name ?? `required(${node.path})`,
    when: all,
  });
}

type Lengthy = Validatable & { readonly _type: string | readonly unknown[] | null | undefined };

export function minLength<N extends Lengthy>(node: N, length: number, options: RuleUtilOptions<InferValue<N>> = {}): Rule<N> {
  return rule(
    node,
    (v) => (isEmpty(v) || (v as { length: number }).length >= length ? undefined : message(options.message, `At least ${length} characters`, v)),
    { name: options.name ?? `minLength(${node.path}, ${length})`, when: options.when }
  );
}

export function maxLength<N extends Lengthy>(node: N, length: number, options: RuleUtilOptions<InferValue<N>> = {}): Rule<N> {
  return rule(
    node,
    (v) => (isEmpty(v) || (v as { length: number }).length <= length ? undefined : message(options.message, `At most ${length} characters`, v)),
    { name: options.name ?? `maxLength(${node.path}, ${length})`, when: options.when }
  );
}

type Numeric = Validatable & { readonly _type: number | null | undefined };

export function min<N extends Numeric>(node: N, limit: number, options: RuleUtilOptions<InferValue<N>> = {}): Rule<N> {
  return rule(node, (v) => (v == null || (v as number) >= limit ? undefined : message(options.message, `Must be at least ${limit}`, v)), {
    name: options.name ?? `min(${node.path}, ${limit})`,
    when: options.when,
  });
}

export function max<N extends Numeric>(node: N, limit: number, options: RuleUtilOptions<InferValue<N>> = {}): Rule<N> {
  return rule(node, (v) => (v == null || (v as number) <= limit ? undefined : message(options.message, `Must be at most ${limit}`, v)), {
    name: options.name ?? `max(${node.path}, ${limit})`,
    when: options.when,
  });
}

type Textual = Validatable & { readonly _type: string | null | undefined };

export function pattern<N extends Textual>(node: N, regex: RegExp, options: RuleUtilOptions<InferValue<N>> = {}): Rule<N> {
  return rule(node, (v) => (isEmpty(v) || regex.test(v as string) ? undefined : message(options.message, "Invalid format", v)), {
    name: options.name ?? `pattern(${node.path})`,
    when: options.when,
  });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email<N extends Textual>(node: N, options: RuleUtilOptions<InferValue<N>> = {}): Rule<N> {
  return pattern(node, EMAIL, { message: "Invalid email address", ...options, name: options.name ?? `email(${node.path})` });
}

// ============================================================
// Behaviors
// ============================================================
export interface CalculateOptions {
  name?: string;
  /**
   * Stop calculating once the user edits the target ("derived until edited",
   * e.g. a slug). A reset (origin "initial") resumes it.
   */
  stopOnUserEdit?: boolean;
  when?: Guard | readonly Guard[];
}

/** target = fn(...sources), recalculated when a source changes. */
export function calculate<N extends AnyNode, const Rs extends readonly AnyRef[]>(
  target: N,
  sources: Rs,
  fn: (...values: Values<Rs>) => InferValue<N>,
  options: CalculateOptions = {}
): Behavior {
  const stop = options.stopOnUserEdit === true;
  return defineBehavior({
    name: options.name ?? `calculate(${target.path})`,
    triggers: stop ? [...sources, target] : sources,
    writes: [target],
    when: options.when,
    run(ctx) {
      if (stop && ctx.changed(target)) {
        if (ctx.origins.has("user")) ctx.state.overridden = true;
        else if (ctx.origins.has("initial")) ctx.state.overridden = false;
      }
      if (ctx.state.overridden) return;
      ctx.set(target, fn(...(sources.map((r) => ctx.get(r)) as Values<Rs>)));
    },
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
  const ref = new MetaRef<boolean>(target, "visible");
  return defineBehavior({
    name: options.name ?? `visibleWhen(${target.path})`,
    triggers: refs,
    writes: [ref],
    run: (ctx) => ctx.set(ref, test(...(refs.map((r) => ctx.get(r)) as Values<Rs>))),
  });
}

/** target.disabled = test(...refs). */
export function disableWhen<const Rs extends readonly AnyRef[]>(
  target: WithKey<"disabled", boolean>,
  refs: Rs,
  test: (...values: Values<Rs>) => boolean,
  options: { name?: string } = {}
): Behavior {
  const ref = new MetaRef<boolean>(target, "disabled");
  return defineBehavior({
    name: options.name ?? `disableWhen(${target.path})`,
    triggers: refs,
    writes: [ref],
    run: (ctx) => ctx.set(ref, test(...(refs.map((r) => ctx.get(r)) as Values<Rs>))),
  });
}

/**
 * While the node is (effectively) hidden, its value is reset: to its initial
 * value, or to `to` when given. The node or an ancestor must declare `visible`.
 */
export function clearWhenHidden<N extends AnyNode>(target: N, options: { to?: InferValue<N>; name?: string } = {}): Behavior {
  let declaring: AnyNode | undefined;
  for (let n: AnyNode | undefined = target; n && !declaring; n = n.parent) if ("visible" in n._metaDefs) declaring = n;
  if (!declaring) throw new Error(`clearWhenHidden(${target.path}): neither the node nor an ancestor declares visibility()`);
  const visible = new MetaRef<boolean>(declaring, "visible");
  const hasTo = "to" in options;
  const initial = initialOf(target);
  return defineBehavior({
    name: options.name ?? `clearWhenHidden(${target.path})`,
    triggers: [visible, target],
    reads: [initial],
    writes: [target],
    run(ctx) {
      if (ctx.get(visible)) return;
      const next = hasTo ? options.to : ctx.get(initial);
      if (!Object.is(ctx.get(target), next)) ctx.set(target, next as InferValue<N>);
    },
  });
}

export interface ExclusiveOptions {
  /** Exactly one must be filled. Default false (at most one). */
  required?: boolean;
  /** What counts as filled. Default: !isEmpty(value). */
  isFilled?: (value: unknown, field: AnyNode) => boolean;
  message?: { tooMany?: string; missing?: string };
  name?: string;
}

type ExclusiveField = Validatable & WithKey<"disabled", boolean>;

/**
 * At most (or exactly, with `required`) one of the fields may be filled.
 *   • exactly one filled → the others are disabled
 *   • none or several    → all enabled, so the user can fix it
 *   • several filled     → every filled field gets an error
 *   • none (required)    → every field gets an error
 * Returns a behavior (owns the fields' `disabled`) plus one rule per field.
 */
export function exclusive(fields: readonly ExclusiveField[], options: ExclusiveOptions = {}): AnyBehavior[] {
  if (fields.length < 2) throw new Error("exclusive() needs at least two fields");
  const name = options.name ?? `exclusive(${fields.map((f) => f.path).join(", ")})`;
  const filled = (field: AnyNode, value: unknown) => (options.isFilled ? options.isFilled(value, field) : !isEmpty(value));
  const labels = fields.map(labelOf).join(", ");
  const tooMany = options.message?.tooMany ?? `Only one of ${labels} can be set`;
  const missing = options.message?.missing ?? `One of ${labels} is required`;

  const disabler = defineBehavior({
    name,
    triggers: fields,
    writes: fields.map((f) => new MetaRef<boolean>(f, "disabled")),
    run(ctx) {
      const isFilled = fields.map((f) => filled(f, ctx.get(f)));
      const count = isFilled.filter(Boolean).length;
      fields.forEach((f, i) => ctx.set(new MetaRef<boolean>(f, "disabled"), count === 1 && !isFilled[i]));
    },
  });

  const rules: Rule[] = fields.map((field) =>
    rule(
      field,
      (value, ctx) => {
        const count = fields.filter((f) => filled(f, f === field ? value : ctx.get(f))).length;
        if (count > 1 && filled(field, value)) return tooMany;
        if (options.required && count === 0) return missing;
        return undefined;
      },
      { name: `${name}:${field.path}`, triggers: fields.filter((f) => f !== field) }
    )
  );
  return [disabler, ...rules];
}
