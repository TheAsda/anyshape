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
//                    A child field with the same name as a meta key wins.
// ============================================================

import { type Lens, identityLens, propLens, composeLens } from "./lens";
import {
  MetaBuilder, MetaKeyDef,
  type Meta, type MetaInput, type MergeMetaInputs,
} from "./meta";

declare const FieldIdBrand: unique symbol;
export type FieldId = string & { readonly [FieldIdBrand]: true };

export type AnyNode = ShapeNode<any, any>;
export type ContainerNode = ObjectNode<any, any> | ArrayNode<any, any, any>;

export type InferValue<N> = N extends ShapeNode<infer V, any> ? V : N extends MetaRef<infer V> ? V : never;
export type InferMeta<N> = N extends { readonly _meta: infer M } ? M : never;

/** Meta references for declared keys. */
export type MetaRefs<M> = { readonly [K in keyof M]: MetaRef<M[K]> };

// Names used by the node itself. Neither fields nor meta keys may use them.
const NODE_INTERNALS = [
  "id", "lens", "path", "parent", "meta", "constructor",
  "_meta", "_metaDefs", "_type", "_fields", "_create", "_hasCreate",
  "_instantiate", "_createInstance", "_attachMetaRefs", "_hasChild",
];
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
export class MetaRef<V = unknown> {
  /** Phantom type – never exists at runtime. */
  declare readonly _value: V;

  constructor(readonly node: AnyNode, readonly key: string) {}

  /** e.g. "shipping.city#error" */
  get path(): string {
    return `${this.node.path ?? ""}#${this.key}`;
  }

  get def(): MetaKeyDef<V> {
    return this.node._metaDefs[this.key];
  }
}

/** A value reference (a node) or a meta reference. */
export type Ref<V = any> = ShapeNode<V, any> | MetaRef<V>;

// ============================================================
// Base node
// ============================================================
export abstract class ShapeNode<T = unknown, TMeta extends Meta = {}> {
  /** Phantom type for inference – never exists at runtime. */
  declare readonly _type: T;

  /** Default values of all declared meta keys. Live meta lives in the stores. */
  readonly _meta: TMeta = {} as TMeta;
  /** @internal Normalized declarations, one per meta key. */
  _metaDefs: Readonly<Record<string, MetaKeyDef<any>>> = {};

  // ---- filled by form() ----
  id!: FieldId;
  /** Lens from the scope root (form root or array item) to this value. */
  lens!: Lens<any, T>;
  path!: string;
  /** Instantiated parent. Undefined for the form root and for reusable (not instantiated) nodes. */
  parent: ContainerNode | undefined;

  /**
   * Declare meta keys. Accepts plain objects, MetaBuilders and features, e.g.
   *   field<string>().meta(control(), { label: "Name" })
   * Returns a new node; the original stays reusable.
   *
   * A key declared by a key definition (metaKey / feature) cannot be declared
   * again. Plain values may be overridden by plain values.
   */
  meta<Is extends readonly MetaInput[]>(
    ...inputs: Is
  ): this & { readonly _meta: TMeta & MergeMetaInputs<Is> } & MetaRefs<MergeMetaInputs<Is>> {
    if (this.id !== undefined) {
      throw new Error(
        `.meta() must be called before form() (node "${this.path || "<root>"}"). ` +
          `For root meta use form(object({...}).meta(...)).`
      );
    }

    const defs: Record<string, MetaKeyDef<any>> = { ...this._metaDefs };
    for (const input of inputs) {
      const entries = input instanceof MetaBuilder ? input.build() : input;
      for (const [key, raw] of Object.entries(entries)) {
        if (RESERVED_META_KEYS.has(key)) {
          throw new Error(`"${key}" is a reserved name and cannot be used as a meta key`);
        }
        const def = raw instanceof MetaKeyDef ? raw : new MetaKeyDef(raw, {}, true);
        const prev = defs[key];
        if (prev && (!prev.plain || !def.plain)) {
          throw new Error(`Meta key "${key}" is already declared by a key definition and cannot be declared again`);
        }
        defs[key] = def;
      }
    }

    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._metaDefs = defs;
    clone._meta = defaultsOf(defs);
    clone._attachMetaRefs();
    return clone;
  }

  /** @internal Is `key` the name of a child (children win over meta refs)? */
  protected _hasChild(_key: string): boolean {
    return false;
  }

  /** @internal Expose a MetaRef for every declared key on this node. */
  protected _attachMetaRefs(): void {
    for (const key of Object.keys(this._metaDefs)) {
      if (this._hasChild(key)) continue;
      (this as any)[key] = new MetaRef(this, key);
    }
  }

  /** @internal Creates the instantiated copy with identity fields set. */
  protected _createInstance(ctx: InstantiateContext): this {
    const node = Object.create(Object.getPrototypeOf(this));
    node._meta = { ...this._meta };
    node._metaDefs = this._metaDefs;
    node.id = ctx.nextId();
    node.path = ctx.path;
    node.lens = ctx.lens;
    node.parent = ctx.parent;
    return node;
  }

  /** @internal */
  abstract _instantiate(ctx: InstantiateContext): this;
}

function defaultsOf(defs: Record<string, MetaKeyDef<any>>): any {
  const out: Meta = {};
  for (const [key, def] of Object.entries(defs)) out[key] = def.defaultValue;
  return out;
}

// ============================================================
// Field (leaf)
// ============================================================
export class FieldNode<T = unknown, TMeta extends Meta = {}> extends ShapeNode<T, TMeta> {
  private constructor() {
    super();
  }

  static create<T>(): FieldNode<T> {
    return new FieldNode<T>();
  }

  /** @internal */
  _instantiate(ctx: InstantiateContext): this {
    const node = this._createInstance(ctx);
    node._attachMetaRefs();
    return node;
  }
}

// ============================================================
// Object
// ============================================================
export class ObjectNode<
  TFields extends Record<string, AnyNode> = any,
  TMeta extends Meta = {}
> extends ShapeNode<{ [K in keyof TFields]: InferValue<TFields[K]> }, TMeta> {
  /** @internal – children; also exposed as direct properties. */
  declare readonly _fields: TFields;

  private constructor(fields: TFields) {
    super();
    for (const key of Object.keys(fields)) {
      if (RESERVED_FIELD_NAMES.has(key)) {
        throw new Error(`"${key}" is a reserved name and cannot be used as a field name`);
      }
    }
    (this as any)._fields = fields;
    Object.assign(this, fields);
  }

  static create<TFields extends Record<string, AnyNode>>(fields: TFields): ObjectNode<TFields> & TFields {
    return new ObjectNode(fields) as any;
  }

  protected override _hasChild(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._fields, key);
  }

  /** @internal */
  _instantiate(ctx: InstantiateContext): this {
    const node = this._createInstance(ctx);
    const fields: Record<string, AnyNode> = {};

    for (const [key, child] of Object.entries(this._fields)) {
      fields[key] = child._instantiate({
        path: ctx.path ? `${ctx.path}.${key}` : key,
        lens: composeLens(ctx.lens, propLens(key)),
        parent: node,
        nextId: ctx.nextId,
      });
    }

    (node as any)._fields = fields;
    node._attachMetaRefs();
    Object.assign(node, fields);
    return node;
  }
}

// ============================================================
// Array (items must be object shapes)
// ============================================================
export interface ArrayOptions<TItem extends ObjectNode<any, any>> {
  /** Factory for new rows (append / insert). Must return a new object every call. */
  create: () => InferValue<TItem>;
}

export class ArrayNode<
  TItem extends ObjectNode<any, any> = any,
  TMeta extends Meta = {},
  THasCreate extends boolean = boolean
> extends ShapeNode<InferValue<TItem>[], TMeta> {
  /** Item template. Its lens is relative to the item object itself. */
  declare readonly item: TItem;
  /** @internal Factory for new rows, if declared. */
  declare readonly _create: (() => InferValue<TItem>) | undefined;
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
    (this as any)._create = create;
  }

  static create<TItem extends ObjectNode<any, any>>(
    item: TItem,
    create?: () => InferValue<TItem>
  ): ArrayNode<TItem, {}, any> {
    return new ArrayNode(item, create);
  }

  /** @internal */
  _instantiate(ctx: InstantiateContext): this {
    const node = this._createInstance(ctx);
    (node as any)._create = this._create;
    // The item template starts a new scope: its lens is identity (item → item).
    (node as any).item = this.item._instantiate({
      path: `${ctx.path}[]`,
      lens: identityLens,
      parent: node,
      nextId: ctx.nextId,
    });
    node._attachMetaRefs();
    return node;
  }
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

export function array<TItem extends ObjectNode<any, any>>(item: TItem): ArrayNode<TItem, {}, false>;
export function array<TItem extends ObjectNode<any, any>>(item: TItem, options: ArrayOptions<TItem>): ArrayNode<TItem, {}, true>;
export function array(item: any, options?: ArrayOptions<any>): any {
  return ArrayNode.create(item, options?.create);
}

/** Root entry point: builds (if needed) and instantiates the form shape. */
export function form<N extends ObjectNode<any, any>>(root: N): N;
export function form<TFields extends Record<string, AnyNode>>(fields: TFields): ObjectNode<TFields> & TFields;
export function form(input: any): any {
  const structural: ObjectNode<any, any> = input instanceof ObjectNode ? input : object(input);
  let counter = 0;
  return structural._instantiate({
    path: "",
    lens: identityLens,
    parent: undefined,
    nextId: () => `f${counter++}` as FieldId,
  });
}
