// Test-local rules: contributions to the test-local `error` key, with the
// messages the core tests assert.
import {
  contribute,
  type AnyNode,
  type AnyRef,
  type Contribution,
  type Declaration,
  type MetaRef,
} from "../../src/index";
import type { Check } from "./features";

/** A node with the test-local validation(), whose value is `V`. */
export type Validated<V = any> = AnyNode & { readonly _type: V; readonly error: MetaRef<string | undefined, Check> };

export function rule<V>(
  node: Validated<V>,
  check: (value: V, ctx: Parameters<Check>[1]) => string | undefined,
  decl: Declaration = {},
): Contribution<Check> {
  return contribute(node.error, check, { name: `rule(${node.path})`, ...decl });
}

export const required = (node: Validated): Contribution<Check> =>
  rule(node, (v) => (v === "" || v == null ? "Required" : undefined), { name: `required(${node.path})` });

/** Fails above `limit`: a number, or a reference whose value is the limit (undefined = no limit). */
export function max(node: Validated, limit: number | AnyRef, options: { message?: string } = {}): Contribution<Check> {
  const ref = typeof limit === "number" ? undefined : limit;
  return rule(
    node,
    (v, ctx) => {
      const l = ref === undefined ? (limit as number) : (ctx.get(ref) as number | undefined);
      return l !== undefined && (v as number) > l ? (options.message ?? `Must be at most ${l}`) : undefined;
    },
    { name: `max(${node.path})`, triggers: ref === undefined ? [] : [ref] },
  );
}

/** Passes on an empty value. */
export const pattern = (node: Validated, regex: RegExp, options: { message: string }): Contribution<Check> =>
  rule(node, (v) => (!v || regex.test(v as string) ? undefined : options.message), { name: `pattern(${node.path})` });

export const email = (node: Validated): Contribution<Check> =>
  pattern(node, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: "Invalid email address" });
