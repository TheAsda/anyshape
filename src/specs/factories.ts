import type { FieldConfig } from '../types/index.js';
import type { BaseSpec, ValidatableSpec } from './base.js';
import { FieldSpec } from './field.js';
import { ObjectSpec } from './object.js';
import { ArraySpec } from './array.js';
import { MetaSpec } from './meta.js';

// ── Helper types for explicit factory return types ──────────────────────────
// These mirror the internal ObjectSpecInstance / ArraySpecInstance types so
// TypeScript can resolve forwarded children without deferring conditional types.

type ObjectValid<C extends Record<string, BaseSpec>> = {
  [K in keyof C]: C[K] extends ValidatableSpec<infer V, infer _R> ? V : unknown;
};

type ObjectRaw<C extends Record<string, BaseSpec>> = {
  [K in keyof C]: C[K] extends ValidatableSpec<infer _V, infer R> ? R : unknown;
};

type ArrayValid<I extends BaseSpec> = I extends ValidatableSpec<infer V, infer _R> ? V[] : unknown[];
type ArrayRaw<I extends BaseSpec> = I extends ValidatableSpec<infer _V, infer R> ? R[] : unknown[];

type ArrayForwarded<I extends BaseSpec> = I extends { children: infer C extends Record<string, BaseSpec> } ? C : {};

type ObjectSpecReturn<C extends Record<string, BaseSpec>> = ValidatableSpec<ObjectValid<C>, ObjectRaw<C>> & {
  kind: 'object';
  children: C;
} & C;

type ArraySpecReturn<I extends BaseSpec> = ValidatableSpec<ArrayValid<I>, ArrayRaw<I>> & {
  kind: 'array';
  itemSpec: I;
} & ArrayForwarded<I>;

// ── Factory functions ───────────────────────────────────────────────────────

/**
 * Creates a FieldSpec for a form field.
 *
 * @typeParam Valid - The validated (output) type of the field.
 * @typeParam Raw  - The raw (pre-validation) type. Defaults to `Valid | undefined`.
 */
export function field<Valid, Raw = Valid | undefined>(
  config?: FieldConfig<Valid, Raw> & { id?: string; mountRequired?: boolean },
): FieldSpec<Valid, Raw> {
  return new FieldSpec<Valid, Raw>(config);
}

/**
 * Creates an ObjectSpec that groups child specs under a named object.
 * Named child accessors are available via dot-path (e.g. `obj.child`).
 */
export function object<Children extends Record<string, BaseSpec>>(
  children: Children,
  config?: { id?: string; mountRequired?: boolean; schema?: unknown },
): ObjectSpecReturn<Children> {
  return new ObjectSpec(children, config) as unknown as ObjectSpecReturn<Children>;
}

/**
 * Creates an ArraySpec for a repeating group of specs.
 * When the item spec is an ObjectSpec, its children are forwarded as
 * named accessors on the ArraySpec instance.
 */
export function array<ItemSpec extends BaseSpec>(
  itemSpec: ItemSpec,
  config?: { id?: string; mountRequired?: boolean; schema?: unknown },
): ArraySpecReturn<ItemSpec> {
  return new ArraySpec(itemSpec, config) as unknown as ArraySpecReturn<ItemSpec>;
}

export function meta<Value>(config?: { id?: string }): MetaSpec<Value> {
  return new MetaSpec<Value>(config);
}

/**
 * Wraps a flat object of spec instances into a form definition.
 * Returns the definition as-is; dot-path traversal works because
 * ObjectSpec and ArraySpec already define named child accessors.
 */
export function form<Def extends Record<string, BaseSpec>>(definition: Def): Def {
  return definition;
}
