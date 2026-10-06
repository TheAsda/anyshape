// ============================================================
// Rules: required, minLength, maxLength, min, max, pattern, email.
// ------------------------------------------------------------
// Built on the validation recipe's rule(). Each states in its type which node it
// needs (a validated node, with a string, array or number value), so using
// it on another node is a compile error.
//   • Format rules pass on empty values – combine them with required.
//   • required() always applies. A switchable requirement is a guard:
//       b.when([s.x.required], (r) => r, (b) => b.add(required(s.x)))
// ============================================================

import { type AnyNode, type InferValue, type Ref, type ShapeNode, type CountRef, type Contribution } from "anyshape";

import { rule, type RulePart, type Validatable } from "./validation";

export type Message<V = any> = string | ((value: V) => string);

export interface RuleRecipeOptions<V = any> {
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
export function labelOf(node: AnyNode): string {
  const path = node.path ?? "";
  return path.slice(path.lastIndexOf(".") + 1).replace(/\[\]$/, "") || "<root>";
}

export function required<N extends Validatable>(
  node: N,
  options: RuleRecipeOptions<InferValue<N>> = {},
): Contribution<RulePart> {
  return rule(node, (v) => (isEmpty(v) ? message(options.message, "Required", v) : undefined), {
    name: options.name ?? `required(${node.path})`,
  });
}

/** A limit: a number, or a reference whose value is the limit (undefined = no limit, the rule passes). */
export type Limit = number | Ref<number | undefined> | CountRef;

function limitRule<N extends Validatable>(
  node: N,
  limit: Limit,
  fails: (value: any, limit: number) => boolean,
  fallback: (limit: number) => string,
  label: string,
  options: RuleRecipeOptions<InferValue<N>>,
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
      name: options.name ?? `${label}(${node.path}, ${ref === undefined ? limit : ref.path})`,
      triggers: ref === undefined ? [] : [ref],
    },
  );
}

type Lengthy = Validatable & ShapeNode<string | readonly unknown[] | null | undefined>;

export function minLength<N extends Lengthy>(
  node: N,
  length: Limit,
  options: RuleRecipeOptions<InferValue<N>> = {},
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
  options: RuleRecipeOptions<InferValue<N>> = {},
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
  options: RuleRecipeOptions<InferValue<N>> = {},
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
  options: RuleRecipeOptions<InferValue<N>> = {},
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
  options: RuleRecipeOptions<InferValue<N>> = {},
): Contribution<RulePart> {
  return rule(
    node,
    (v) => (isEmpty(v) || regex.test(v as string) ? undefined : message(options.message, "Invalid format", v)),
    {
      name: options.name ?? `pattern(${node.path})`,
    },
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email<N extends Textual>(
  node: N,
  options: RuleRecipeOptions<InferValue<N>> = {},
): Contribution<RulePart> {
  return pattern(node, EMAIL, {
    message: "Invalid email address",
    ...options,
    name: options.name ?? `email(${node.path})`,
  });
}
