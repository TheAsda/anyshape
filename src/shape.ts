// ============================================================
// Shape nodes
// ------------------------------------------------------------
//   • parent       – explicit link to the instantiated parent node
//   • lens         – relative to the node's scope root (form root or array item)
//   • array()      – object shapes only; optional `create` factory for new rows
//   • object()     – rejects field names that collide with node internals
//   • .meta(...)   – plain values and/or key definitions (metaKey, features);
//                    variadic; must be called before form()
//   • meta refs    – every declared meta key is exposed on the node:
//                    form.name        → the value
//                    form.name.error  → the `error` meta key (MetaRef)
//                    A meta key cannot share a name with a child.
//   • internals    – symbol-keyed (see internal.ts), so every name a node
//                    doesn't reserve is free for fields and meta keys
// ============================================================

import { type Lens, identityLens, propLens, composeLens } from "./lens";
import {
  MetaKeyDef,
  type Meta, type MergeMetaRefs,
} from "./meta";
import { FIELDS, META_DEFS, META, CREATE } from "./internal";
import { KIND, type RefKind } from "./refs/kind";
import { valueKind } from "./refs/value";
import { metaKind } from "./refs/meta";

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
  [K in keyof N as 0 extends 1 & N[K] ? never : N[K] extends MetaRef<any, any> ? K : never]: N[K] extends MetaRef<infer V, any> ? V : never;
};

// Names used by the node itself. Neither fields nor meta keys may use them.
const NODE_INTERNALS = ["id", "lens", "path", "parent", "meta", "constructor", "_type", "_hasCreate"];
const RESERVED_FIELD_NAMES = new Set(NODE_INTERNALS);
const RESERVED_META_KEYS = new Set([...NODE_INTERNALS, "item"]);

/** @internal */
interface InstantiateContext {
  path: string;
  lens: Lens<any, any>;
  parent: ContainerNode | undefined;
  nextId: () => FieldId;
}

// ============================================================
// Meta reference – points at one meta key of one node
// ============================================================
export class MetaRef<V = unknown, P = unknown> {
  /** Phantom type – never exists at runtime. */
  declare readonly _value: V;
  /** Phantom type: the payload contributions to this key carry (NoPayload: none). */
  declare readonly _payload: P;

  private constructor(readonly node: AnyNode, readonly key: string) {}

  /** @internal Refs are attached to nodes (node.error); everything else reads them from there. */
  static _create(node: AnyNode, key: string): MetaRef<any> {
    return new MetaRef(node, key);
  }

  /** e.g. "shipping.city#error" */
  get path(): string {
    return `${this.node.path ?? ""}#${this.key}`;
  }

  /** @internal */
  get [KIND](): RefKind<MetaRef<any>> {
    return metaKind;
  }

}

/** A value reference (a node) or a meta reference. */
export type Ref<V = any> = ShapeNode<V> | MetaRef<V>;

// ============================================================
// Base node
// ============================================================
export abstract class ShapeNode<T = unknown> {
  /** Phantom type for inference – never exists at runtime. */
  declare readonly _type: T;

  /** @internal Default values of all declared meta keys. Live meta lives in the stores. */
  declare readonly [META]: Meta;
  /** @internal Normalized declarations, one per meta key. */
  declare readonly [META_DEFS]: Readonly<Record<string, MetaKeyDef<any>>>;

  /** @internal */
  get [KIND](): RefKind<AnyNode> {
    return valueKind;
  }

  // ---- filled by form() ----
  id!: FieldId;
  /** Lens from the scope root (form root or array item) to this value. */
  lens!: Lens<any, T>;
  path!: string;
  /** Instantiated parent. Undefined for the form root and for reusable (not instantiated) nodes. */
  parent: ContainerNode | undefined;

  constructor() {
    setMeta(this, {});
  }

  /**
   * Declare meta keys. Accepts plain objects and features, e.g.
   *   field<string>().meta(control(), { label: "Name" })
   * Returns a new node; the original stays reusable.
   *
   * A node declares each key once: declaring it again throws, whether as a
   * plain value or a key definition (metaKey / feature).
   */
  meta<Is extends readonly Meta[]>(
    ...inputs: Is
  ): this & MergeMetaRefs<Is> {
    if (this.id !== undefined) {
      throw new Error(
        `.meta() must be called before form() (node "${this.path || "<root>"}"). ` +
          `For root meta use form(object({...}).meta(...)).`
      );
    }

    const defs: Record<string, MetaKeyDef<any>> = { ...this[META_DEFS] };
    for (const input of inputs) {
      for (const [key, raw] of Object.entries(input)) {
        if (RESERVED_META_KEYS.has(key)) {
          throw new Error(`"${key}" is a reserved name and cannot be used as a meta key`);
        }
        if (this instanceof ObjectNode && Object.prototype.hasOwnProperty.call(this[FIELDS], key)) {
          throw new Error(`"${key}" is a field of "${this.path || "<root>"}" and cannot also be a meta key`);
        }
        if (Object.prototype.hasOwnProperty.call(defs, key)) {
          // No path before form(): the node is named by its kind.
          const kind = this instanceof ObjectNode ? "object" : this instanceof ArrayNode ? "array" : "field";
          throw new Error(`Meta key "${key}" is already declared on this ${kind} – a node declares each key once`);
        }
        defs[key] = raw instanceof MetaKeyDef ? raw : new MetaKeyDef(raw);
      }
    }

    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    setMeta(clone, defs);
    attachMetaRefs(clone);
    return clone;
  }
}

/** Set a node's declarations and the defaults derived from them. */
function setMeta(node: AnyNode, defs: Record<string, MetaKeyDef<any>>): void {
  const defaults: Meta = {};
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

  static create<T>(): FieldNode<T> {
    return new FieldNode<T>();
  }
}

// ============================================================
// Object
// ============================================================
export class ObjectNode<
  TFields extends Record<string, AnyNode> = any
> extends ShapeNode<{ [K in keyof TFields]: InferValue<TFields[K]> }> {
  /** @internal – children; also exposed as direct properties. */
  declare readonly [FIELDS]: TFields;

  private constructor(fields: TFields) {
    super();
    for (const key of Object.keys(fields)) {
      if (RESERVED_FIELD_NAMES.has(key)) {
        throw new Error(`"${key}" is a reserved name and cannot be used as a field name`);
      }
    }
    (this as any)[FIELDS] = fields;
    Object.assign(this, fields);
  }

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

export class ArrayNode<
  TItem extends ObjectNode<any> = any,
  THasCreate extends boolean = boolean
> extends ShapeNode<InferValue<TItem>[]> {
  /** Item template. Its lens is relative to the item object itself. */
  declare readonly item: TItem;
  /** @internal Factory for new rows, if declared. */
  declare readonly [CREATE]: (() => InferValue<TItem>) | undefined;
  /** Phantom: whether a `create` factory was declared (used by append/insert types). */
  declare readonly _hasCreate: THasCreate;

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

  static create<TItem extends ObjectNode<any>>(
    item: TItem,
    create?: () => InferValue<TItem>
  ): ArrayNode<TItem, any> {
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
  node.id = ctx.nextId();
  node.path = ctx.path;
  node.lens = ctx.lens;
  node.parent = ctx.parent;

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

export function object<TFields extends Record<string, AnyNode>>(fields: TFields): ObjectNode<TFields> & TFields {
  return ObjectNode.create(fields);
}

export function array<TItem extends ObjectNode<any>>(item: TItem): ArrayNode<TItem, false>;
export function array<TItem extends ObjectNode<any>>(item: TItem, options: ArrayOptions<TItem>): ArrayNode<TItem, true>;
export function array(item: any, options?: ArrayOptions<any>): any {
  return ArrayNode.create(item, options?.create);
}

/** Root entry point: instantiates the form's object node (ids, paths, lenses). */
export function form<N extends ObjectNode<any>>(root: N): N {
  if (!(root instanceof ObjectNode)) throw new Error("form() takes an object node – wrap the fields, e.g. form(object({ ... }))");
  let counter = 0;
  return instantiate(root, {
    path: "",
    lens: identityLens,
    parent: undefined,
    nextId: () => `f${counter++}` as FieldId,
  });
}
