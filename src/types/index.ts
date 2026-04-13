import type { ZodType } from 'zod/v4';

// ─── Utility Types ────────────────────────────────────────────────────────────

/**
 * Recursively makes all properties of T optional.
 * Arrays remain arrays but their element types are made deeply partial.
 * Primitives pass through unchanged.
 */
export type DeepPartial<T> =
  T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

// ─── Spec Kind ────────────────────────────────────────────────────────────────

/** Discriminator for the different spec node types. */
export type SpecKind = 'field' | 'object' | 'array' | 'meta';

// ─── Placeholder Spec Interfaces ─────────────────────────────────────────────
//
// These interfaces describe the shape that the real spec classes (FieldSpec,
// ObjectSpec, ArraySpec, MetaSpec) will implement. They exist here so that
// InferForm / InferFormRaw can resolve types via conditional discrimination on
// the `kind` field *before* the runtime classes are defined.

export interface FieldSpecLike<Valid, Raw = Valid | undefined> {
  readonly kind: 'field';
  readonly _valid: Valid;
  readonly _raw: Raw;
}

export interface ObjectSpecLike<Children extends Record<string, unknown>> {
  readonly kind: 'object';
  readonly children: Children;
}

export interface ArraySpecLike<ItemSpec> {
  readonly kind: 'array';
  readonly itemSpec: ItemSpec;
}

export interface MetaSpecLike<Value> {
  readonly kind: 'meta';
  readonly _value: Value;
}

// ─── InferForm ────────────────────────────────────────────────────────────────

/**
 * Resolves a form definition tree to its **validated** output type.
 *
 * - FieldSpecLike<Valid, Raw> → Valid
 * - MetaSpecLike<Value>       → Value
 * - ArraySpecLike<Item>       → InferForm<Item>[]
 * - ObjectSpecLike<Children>  → { [K in keyof Children]: InferForm<Children[K]> }
 * - Plain object (form def)   → mapped recursively, all fields required
 */
export type InferForm<T> =
  T extends FieldSpecLike<infer Valid, infer _Raw>
    ? Valid
    : T extends MetaSpecLike<infer Value>
      ? Value
      : T extends ArraySpecLike<infer Item>
        ? Array<InferForm<Item>>
        : T extends ObjectSpecLike<infer Children>
          ? { [K in keyof Children]: InferForm<Children[K]> }
          : T extends Record<string, unknown>
            ? { [K in keyof T]: InferForm<T[K]> }
            : never;

// ─── InferFormRaw ─────────────────────────────────────────────────────────────

/**
 * Resolves a form definition tree to its **raw** (pre-validation) type.
 *
 * - FieldSpecLike<Valid, Raw> → Raw
 * - MetaSpecLike<Value>       → Value
 * - ArraySpecLike<Item>       → InferFormRaw<Item>[]
 * - ObjectSpecLike<Children>  → { [K in keyof Children]: InferFormRaw<Children[K]> }
 * - Plain object (form def)   → mapped recursively, all fields required
 */
export type InferFormRaw<T> =
  T extends FieldSpecLike<infer _Valid, infer Raw>
    ? Raw
    : T extends MetaSpecLike<infer Value>
      ? Value
      : T extends ArraySpecLike<infer Item>
        ? Array<InferFormRaw<Item>>
        : T extends ObjectSpecLike<infer Children>
          ? { [K in keyof Children]: InferFormRaw<Children[K]> }
          : T extends Record<string, unknown>
            ? { [K in keyof T]: InferFormRaw<T[K]> }
            : never;
