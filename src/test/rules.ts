// Test-local rules: the few the core tests use, with the messages they assert.
import { rule, type AnyRef, type Rule, type Validatable } from "../index";

export const required = <N extends Validatable>(node: N): Rule<N> =>
  rule(node, (v) => (v === "" || v == null ? "Required" : undefined), { name: `required(${node.path})` });

/** Fails above `limit`: a number, or a reference whose value is the limit (undefined = no limit). */
export function max<N extends Validatable>(node: N, limit: number | AnyRef, options: { message?: string } = {}): Rule<N> {
  const ref = typeof limit === "number" ? undefined : limit;
  return rule(
    node,
    (v, ctx) => {
      const l = ref === undefined ? (limit as number) : (ctx.get(ref) as number | undefined);
      return l !== undefined && (v as number) > l ? options.message ?? `Must be at most ${l}` : undefined;
    },
    { name: `max(${node.path})`, triggers: ref === undefined ? [] : [ref] }
  );
}

/** Passes on an empty value. */
export const pattern = <N extends Validatable>(node: N, regex: RegExp, options: { message: string }): Rule<N> =>
  rule(node, (v) => (!v || regex.test(v as string) ? undefined : options.message), { name: `pattern(${node.path})` });

export const email = <N extends Validatable>(node: N): Rule<N> =>
  pattern(node, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: "Invalid email address" });
