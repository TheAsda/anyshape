// ============================================================
// Shape nodes
// ------------------------------------------------------------
//   • identity     – id, lens, path and parent live behind symbols (see
//                    internal.ts), so every name a node doesn't reserve is
//                    free for fields and meta keys; pathOf(node) and
//                    parentOf(node) read them. A node's lens stays relative
//                    to its scope root (form root or array item).
//   • array()      – object shapes only; optional `create` factory for new rows
//   • object()     – rejects the names the node itself needs (`meta`, and the
//                    names JavaScript treats specially on every object)
//   • .meta(...)   – key definitions only (metaKey(...), meta groups); variadic;
//                    must be called before form()
//   • meta refs    – every declared meta key is exposed on the node:
//                    form.name        → the value
//                    form.name.error  → the `error` meta key (MetaRef)
//                    A meta key cannot share a name with a child (an array's
//                    item template counts as a child).
// ============================================================

import { FIELDS, META_DEFS, META, CREATE, ID, LENS, PATH, PARENT, TYPE, HAS_CREATE } from "./internal.js";
import { type Lens, identityLens, propLens, composeLens } from "./lens.js";
import { MetaKeyDef, type Meta, type MetaValues, type MergeMetaRefs } from "./meta.js";
import { KIND, type RefKind } from "./refs/kind.js";
import { MetaRef } from "./refs/meta.js";
import { valueKind } from "./refs/value.js";

declare const FieldIdBrand: unique symbol;
export type FieldId = string & { readonly [FieldIdBrand]: true };

export type AnyNode = ShapeNode<any>;
export type ContainerNode = ObjectNode<any> | ArrayNode<any, any>;

export type InferValue<N> = N extends ShapeNode<infer V> ? V : N extends MetaRef<infer V, any> ? V : never;
/**
 * The node's declared meta keys and their value types, read from its meta
 * references. Properties typed `any` (every property of a loose AnyNode) are
 * not keys.
 */
export type InferMeta<N> = {
  [K in keyof N as 0 extends 1 & N[K] ? never : N[K] extends MetaRef<any, any> ? K : never]: N[K] extends MetaRef<
    infer V,
    any
  >
    ? V
    : never;
};

// The names the node itself keeps on every object: the .meta() method, and the
// names JavaScript treats specially on every object. Everything else the node
// needs (id, lens, path, parent, the type markers) lives behind symbols, so it
// cannot collide with a field name or a meta key. NoReserved rejects these at
// compile time; the RESERVED set is the run-time backstop.
type ReservedName = "meta" | "constructor" | "__proto__";
const RESERVED: ReadonlySet<string> = new Set(["meta", "constructor", "__proto__"]);
/** Maps an input of object()/.meta() so a reserved name can only hold `never`. */
type NoReserved<T> = { [K in keyof T]: K extends ReservedName ? never : T[K] };

/** Field and meta-key bags carry only their own keys. */
function assertPlainBag(bag: object, message: (key: string) => string): void {
  // A plain `{ __proto__: x }` literal never creates the key: for an object x
  // it swaps the bag's prototype, and the name silently disappears. Accept
  // only ordinary bags (Object.prototype); a `__proto__` own key set with
  // defineProperty is caught by the RESERVED check, and for a primitive x
  // JavaScript itself drops the entry, so there is nothing to see.
  if (Object.getPrototypeOf(bag) !== Object.prototype) {
    throw new Error(message("__proto__"));
  }
}

/** @internal */
interface InstantiateContext {
  path: string;
  lens: Lens<any, any>;
  parent: ContainerNode | undefined;
  nextId: () => FieldId;
}

/** A value reference (a node) or a meta reference. */
export type Ref<V = any> = ShapeNode<V> | MetaRef<V>;

// ============================================================
// Base node
// ============================================================
export abstract class ShapeNode<T = unknown> {
  /** Phantom type for inference – never exists at runtime. */
  declare readonly [TYPE]: T;

  /** @internal Default values of all declared meta keys. Live meta lives in the stores. */
  declare readonly [META]: MetaValues;
  /** @internal Normalized declarations, one per meta key. */
  declare readonly [META_DEFS]: Readonly<Record<string, MetaKeyDef<any>>>;

  /** @internal */
  get [KIND](): RefKind<AnyNode> {
    return valueKind;
  }

  // ---- filled by form() ----
  /** @internal The form-wide identity. Undefined on reusable (not instantiated) nodes. */
  declare readonly [ID]: FieldId | undefined;
  /** @internal Lens from the scope root (form root or array item) to this value. */
  declare readonly [LENS]: Lens<any, T>;
  /** @internal The node's path within its scope. Undefined on reusable (not instantiated) nodes. */
  declare readonly [PATH]: string | undefined;
  /** @internal The instantiated parent. Undefined for the form root and for reusable nodes. */
  declare readonly [PARENT]: ContainerNode | undefined;

  constructor() {
    setMeta(this, {});
  }

  /**
   * Declare meta keys. Each entry of every input is a key definition (metaKey):
   * an inline object, such as a meta group returns, e.g.
   *   field<string>().meta(control(), { label: metaKey("Name") })
   * Returns a new node; the original stays reusable.
   *
   * A node declares each key once: declaring it again throws, however it is
   * declared (inline, or through a meta group).
   */
  meta<Is extends readonly Meta[]>(
    ...inputs: { [K in keyof Is]: Is[K] & NoReserved<Is[K]> }
  ): this & MergeMetaRefs<Is> {
    if (this[ID] !== undefined) {
      throw new Error(
        `.meta() must be called before form() (node "${pathOf(this) || "<root>"}"). ` +
          `For root meta use form(object({...}).meta(...)).`,
      );
    }

    const defs: Record<string, MetaKeyDef<any>> = { ...this[META_DEFS] };
    for (const input of inputs) {
      assertPlainBag(input, (key) => `"${key}" is a reserved name and cannot be used as a meta key`);
      for (const [key, def] of Object.entries(input)) {
        if (!(def instanceof MetaKeyDef)) {
          throw new Error(`"${key}" is not a key definition – make it with metaKey()`);
        }
        if (RESERVED.has(key)) {
          throw new Error(`"${key}" is a reserved name and cannot be used as a meta key`);
        }
        if (this instanceof ObjectNode && Object.prototype.hasOwnProperty.call(this[FIELDS], key)) {
          throw new Error(`"${key}" is a field of "${pathOf(this) || "<root>"}" and cannot also be a meta key`);
        }
        if (this instanceof ArrayNode && key === "item") {
          throw new Error(`"item" is the item of "${pathOf(this) || "<root>"}" and cannot also be a meta key`);
        }
        if (Object.prototype.hasOwnProperty.call(defs, key)) {
          // No path before form(): the node is named by its kind.
          const kind = this instanceof ObjectNode ? "object" : this instanceof ArrayNode ? "array" : "field";
          throw new Error(`Meta key "${key}" is already declared on this ${kind} – a node declares each key once`);
        }
        defs[key] = def;
      }
    }

    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    setMeta(clone, defs);
    attachMetaRefs(clone);
    return clone;
  }
}

/** The node's path within its scope: "" for the form root and for reusable (not instantiated) nodes. A reference's path labels one of its keys (`"name#error"`). */
export function pathOf(node: AnyNode | { readonly path: string }): string {
  if (node instanceof ShapeNode) return node[PATH] ?? "";
  return node.path;
}

/** The instantiated parent, or undefined for the form root and for reusable (not instantiated) nodes. */
export function parentOf(node: AnyNode): ContainerNode | undefined {
  return node[PARENT];
}

/** Set a node's declarations and the defaults derived from them. */
function setMeta(node: AnyNode, defs: Record<string, MetaKeyDef<any>>): void {
  const defaults: MetaValues = {};
  for (const [key, def] of Object.entries(defs)) defaults[key] = def.defaultValue;
  (node as any)[META_DEFS] = defs;
  (node as any)[META] = defaults;
}

/** Expose a MetaRef for every declared key on the node. */
function attachMetaRefs(node: AnyNode): void {
  for (const key of Object.keys(node[META_DEFS])) (node as any)[key] = MetaRef._create(node, key);
}

// ============================================================
// Field (leaf)
// ============================================================
export class FieldNode<T = unknown> extends ShapeNode<T> {
  private constructor() {
    super();
  }

  /** @internal – use field() */
  static create<T>(): FieldNode<T> {
    return new FieldNode<T>();
  }
}

// ============================================================
// Object
// ============================================================
export class ObjectNode<TFields extends Record<string, AnyNode> = any> extends ShapeNode<{
  [K in keyof TFields]: InferValue<TFields[K]>;
}> {
  /** @internal – children; also exposed as direct properties. */
  declare readonly [FIELDS]: TFields;

  private constructor(fields: TFields) {
    super();
    assertPlainBag(fields, (key) => `"${key}" is a reserved name and cannot be used as a field name`);
    for (const key of Object.keys(fields)) {
      if (RESERVED.has(key)) {
        throw new Error(`"${key}" is a reserved name and cannot be used as a field name`);
      }
    }
    (this as any)[FIELDS] = fields;
    Object.assign(this, fields);
  }

  /** @internal – use object() */
  static create<TFields extends Record<string, AnyNode>>(fields: TFields): ObjectNode<TFields> & TFields {
    return new ObjectNode(fields) as any;
  }
}

// ============================================================
// Array (items must be object shapes)
// ============================================================
export interface ArrayOptions<TItem extends ObjectNode<any>> {
  /** Factory for new rows (append / insert). Must return a new object every call. */
  create: () => InferValue<TItem>;
}

export class ArrayNode<TItem extends ObjectNode<any> = any, THasCreate extends boolean = boolean> extends ShapeNode<
  InferValue<TItem>[]
> {
  /** Item template. Its lens is relative to the item object itself. */
  declare readonly item: TItem;
  /** @internal Factory for new rows, if declared. */
  declare readonly [CREATE]: (() => InferValue<TItem>) | undefined;
  /** Phantom: whether a `create` factory was declared (used by append/insert types). */
  declare readonly [HAS_CREATE]: THasCreate;

  private constructor(item: TItem, create: (() => InferValue<TItem>) | undefined) {
    super();
    if (!(item instanceof ObjectNode)) {
      throw new Error("array() items must be object shapes – wrap primitives, e.g. object({ value: field<string>() })");
    }
    if (create !== undefined && typeof create !== "function") {
      throw new Error("array(): `create` must be a function returning a new item");
    }
    (this as any).item = item;
    (this as any)[CREATE] = create;
  }

  /** @internal – use array() */
  static create<TItem extends ObjectNode<any>>(item: TItem, create?: () => InferValue<TItem>): ArrayNode<TItem, any> {
    return new ArrayNode(item, create);
  }
}

// ============================================================
// Instantiation – the copy form() makes, with identity fields set
// ============================================================
function instantiate<N extends AnyNode>(template: N, ctx: InstantiateContext): N {
  const node = Object.create(Object.getPrototypeOf(template));
  node[META] = { ...template[META] };
  node[META_DEFS] = template[META_DEFS];
  node[ID] = ctx.nextId();
  node[PATH] = ctx.path;
  node[LENS] = ctx.lens;
  node[PARENT] = ctx.parent;

  if (template instanceof ObjectNode) {
    const fields: Record<string, AnyNode> = {};
    for (const [key, child] of Object.entries(template[FIELDS] as Record<string, AnyNode>)) {
      fields[key] = instantiate(child, {
        path: ctx.path ? `${ctx.path}.${key}` : key,
        lens: composeLens(ctx.lens, propLens(key)),
        parent: node,
        nextId: ctx.nextId,
      });
    }
    node[FIELDS] = fields;
    Object.assign(node, fields);
  } else if (template instanceof ArrayNode) {
    node[CREATE] = template[CREATE];
    // The item template starts a new scope: its lens is identity (item → item).
    node.item = instantiate(template.item, {
      path: `${ctx.path}[]`,
      lens: identityLens,
      parent: node,
      nextId: ctx.nextId,
    });
  }

  attachMetaRefs(node);
  return node;
}

// ============================================================
// Public factories
// ============================================================
export function field<T>(): FieldNode<T> {
  return FieldNode.create<T>();
}

export function object<TFields extends Record<string, AnyNode>>(
  fields: NoReserved<TFields>,
): ObjectNode<TFields> & TFields {
  return ObjectNode.create(fields);
}

export function array<TItem extends ObjectNode<any>>(item: TItem): ArrayNode<TItem, false>;
export function array<TItem extends ObjectNode<any>>(item: TItem, options: ArrayOptions<TItem>): ArrayNode<TItem, true>;
export function array(item: any, options?: ArrayOptions<any>): any {
  return ArrayNode.create(item, options?.create);
}

/**
 * Root entry point: instantiates the form's object node (ids, paths, lenses).
 * @see {@link https://github.com/TheAsda/anyshape/blob/master/docs/guide/shape.md | Shapes and nodes} in the guide.
 */
export function form<N extends ObjectNode<any>>(root: N): N {
  if (!(root instanceof ObjectNode))
    throw new Error("form() takes an object node – wrap the fields, e.g. form(object({ ... }))");
  let counter = 0;
  return instantiate(root, {
    path: "",
    lens: identityLens,
    parent: undefined,
    nextId: () => `f${counter++}` as FieldId,
  });
}
