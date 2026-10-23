// ============================================================
// Rules: required, minLength, maxLength, min, max, pattern, email, exclusive.
// ------------------------------------------------------------
// Built on the validation recipe's rule(). Each states in its type which node it
// needs (a validated node, with a string, array or number value), so using
// it on another node is a compile error.
//   • Format rules pass on empty values – combine them with required.
//   • required() also contributes to the node's `requiredNow`, so the UI can
//     show which fields are required now. It returns both contributions; add
//     it with b.add, or put it in createStore's behaviors.
//   • required() always applies. A switchable requirement is a guard, which
//     applies to both contributions:
//       b.when([s.type], (t) => t === "company", (b) => b.add(required(s.taxId)))
//   • exclusive() spans several fields: a rule on each, and a `disabled`
//     reason on each that the others being filled turns on.
// ============================================================

import {
  contribute,
  when,
  pathOf,
  type ShapeNode,
  type AnyNode,
  type AnyBehavior,
  type InferValue,
  type Ref,
  type CountRef,
  type Contribution,
} from "anyshape";

import type { Disableable } from "./disabling";
import { rule, type RulePart, type Validatable } from "./validation";

export type Message<V = any> = string | ((value: V) => string);

/** The options of a ready rule: its message, and its name for diagnostics. */
export interface MessageOptions<V = any> {
  message?: Message<V>;
  name?: string;
}

function message<V>(m: Message<V> | undefined, fallback: string, value: V): string {
  return m === undefined ? fallback : typeof m === "function" ? m(value) : m;
}

/** undefined, null, whitespace-only strings and empty arrays are empty. */
export function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** The last segment of the node's path. Pass `message` to a rule for real labels. */
function labelOf(node: AnyNode): string {
  const path = pathOf(node);
  return path.slice(path.lastIndexOf(".") + 1).replace(/\[\]$/, "") || "<root>";
}

/** The rule, and a contribution to the node's `requiredNow`; both under the same name. */
export function required<N extends Validatable>(
  node: N,
  options: MessageOptions<InferValue<N>> = {},
): readonly [Contribution<RulePart>, Contribution<string>] {
  const name = options.name ?? `required(${pathOf(node)})`;
  return [
    rule(node, (v) => (isEmpty(v) ? message(options.message, "Required", v) : undefined), { name }),
    contribute(node.requiredNow, name, { name }),
  ];
}

/** A limit: a number, or a reference whose value is the limit (undefined = no limit, the rule passes). */
export type Limit = number | Ref<number | undefined> | CountRef;

function limitRule<N extends Validatable>(
  node: N,
  limit: Limit,
  fails: (value: any, limit: number) => boolean,
  fallback: (limit: number) => string,
  label: string,
  options: MessageOptions<InferValue<N>>,
): Contribution<RulePart> {
  const ref = typeof limit === "number" ? undefined : limit;
  return rule(
    node,
    (v, ctx) => {
      const resolved = ref === undefined ? (limit as number) : (ctx.get(ref) as number | undefined);
      if (resolved === undefined || !fails(v, resolved)) return undefined;
      return message(options.message, fallback(resolved), v);
    },
    {
      name: options.name ?? `${label}(${pathOf(node)}, ${ref === undefined ? limit : pathOf(ref)})`,
      triggers: ref === undefined ? [] : [ref],
    },
  );
}

type Lengthy = Validatable & ShapeNode<string | readonly unknown[] | null | undefined>;

export function minLength<N extends Lengthy>(
  node: N,
  length: Limit,
  options: MessageOptions<InferValue<N>> = {},
): Contribution<RulePart> {
  return limitRule(
    node,
    length,
    (v, l) => !isEmpty(v) && v.length < l,
    (l) => `At least ${l} characters`,
    "minLength",
    options,
  );
}

export function maxLength<N extends Lengthy>(
  node: N,
  length: Limit,
  options: MessageOptions<InferValue<N>> = {},
): Contribution<RulePart> {
  return limitRule(
    node,
    length,
    (v, l) => !isEmpty(v) && v.length > l,
    (l) => `At most ${l} characters`,
    "maxLength",
    options,
  );
}

type Numeric = Validatable & ShapeNode<number | null | undefined>;

export function min<N extends Numeric>(
  node: N,
  limit: Limit,
  options: MessageOptions<InferValue<N>> = {},
): Contribution<RulePart> {
  return limitRule(
    node,
    limit,
    (v, l) => v != null && v < l,
    (l) => `Must be at least ${l}`,
    "min",
    options,
  );
}

export function max<N extends Numeric>(
  node: N,
  limit: Limit,
  options: MessageOptions<InferValue<N>> = {},
): Contribution<RulePart> {
  return limitRule(
    node,
    limit,
    (v, l) => v != null && v > l,
    (l) => `Must be at most ${l}`,
    "max",
    options,
  );
}

type Textual = Validatable & ShapeNode<string | null | undefined>;

export function pattern<N extends Textual>(
  node: N,
  regex: RegExp,
  options: MessageOptions<InferValue<N>> = {},
): Contribution<RulePart> {
  return rule(
    node,
    (v) => (isEmpty(v) || regex.test(v as string) ? undefined : message(options.message, "Invalid format", v)),
    {
      name: options.name ?? `pattern(${pathOf(node)})`,
    },
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email<N extends Textual>(node: N, options: MessageOptions<InferValue<N>> = {}): Contribution<RulePart> {
  return pattern(node, EMAIL, {
    message: "Invalid email address",
    ...options,
    name: options.name ?? `email(${pathOf(node)})`,
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
  const name = options.name ?? `exclusive(${fields.map(pathOf).join(", ")})`;
  const labels = fields.map(labelOf).join(", ");
  const tooMany = options.message?.tooMany ?? `Only one of ${labels} can be set`;
  const missing = options.message?.missing ?? `One of ${labels} is required`;

  const disablers = fields.map((field, i) =>
    contribute(field.disabled, name, {
      name: `${name}:${pathOf(field)}`,
      when: when(fields, (...values: unknown[]) => {
        const filled = values.map((v) => !isEmpty(v));
        return filled.filter(Boolean).length === 1 && !filled[i];
      }),
    }),
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
      { name: `${name}:${pathOf(field)}`, triggers: fields.filter((f) => f !== field) },
    ),
  );
  return [...disablers, ...rules];
}
