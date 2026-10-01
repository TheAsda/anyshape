// ============================================================
// Internal helpers shared by the behavior runtime and validation.
// Not exported from the package index.
// ============================================================

import { ArrayNode, type MetaRef, type AnyNode } from "./shape";
import type { MetaKeyDef } from "./meta";
import { BaseStore, ItemStore, type AnyRef } from "./store";
import { kindOf, type Target } from "./refs/kind";

// ============================================================
// Node internals, keyed by symbols so that every string name stays free for
// fields and meta keys. Classes only `declare` these members and assign them
// at runtime: this module and shape.ts import each other.
// ============================================================

/** ObjectNode: its children (also exposed as direct properties). */
export const FIELDS: unique symbol = Symbol("form-lib.fields");
/** ShapeNode: normalized declarations, one per meta key. */
export const META_DEFS: unique symbol = Symbol("form-lib.metaDefs");
/** ShapeNode: default values of all declared meta keys. */
export const META: unique symbol = Symbol("form-lib.meta");
/** ArrayNode: factory for new rows, if declared. */
export const CREATE: unique symbol = Symbol("form-lib.create");
/** MetaKeyDef: true when created from a plain value in .meta({...}). */
export const PLAIN: unique symbol = Symbol("form-lib.plain");

/** The declaration of the key a meta reference points at. */
export function defOf<V>(ref: MetaRef<V>): MetaKeyDef<V> {
  return ref.node[META_DEFS][ref.key];
}

/** The node's own reference to a declared key (node.error), the one every reader shares. */
export function metaRefOf<V = unknown>(node: AnyNode, key: string): MetaRef<V> {
  return (node as any)[key];
}

// ============================================================
// References: every kind answers through its RefKind (src/refs/kind.ts).
// ============================================================
export function refNode(ref: AnyRef): AnyNode {
  return kindOf(ref).node(ref);
}

export function refKey(ref: AnyRef): string {
  return kindOf(ref).id(ref);
}

export function refLabel(ref: AnyRef): string {
  return kindOf(ref).label(ref);
}

/** What writing `ref` changes; undefined for read-only kinds. */
export function targetOf(ref: AnyRef): Target | undefined {
  return kindOf(ref).writer?.target(ref);
}

/** The scope a node belongs to: its row template, or the form root. */
export function scopeOf(node: AnyNode): AnyNode {
  for (let n: AnyNode = node; ; n = n.parent!) {
    if (!n.parent || n.parent instanceof ArrayNode) return n;
  }
}

/** Scopes from the root down to `scope`. */
export function chainTo(scope: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  for (let s: AnyNode | undefined = scope; s; s = s.parent ? scopeOf(s.parent) : undefined) out.unshift(s);
  return out;
}

export function rootOf(node: AnyNode): AnyNode {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

export function isAncestorOrSelf(a: AnyNode, b: AnyNode): boolean {
  for (let n: AnyNode | undefined = b; n; n = n.parent) if (n === a) return true;
  return false;
}

export function storeWithin(inner: BaseStore<any>, outer: BaseStore<any>): boolean {
  for (let s: BaseStore<any> | undefined = inner; s; s = s.parentStore) if (s === outer) return true;
  return false;
}

/** The scope host (root or row store) at `scope`, walking up from `host`. */
export function hostFor(host: BaseStore<any>, scope: AnyNode): BaseStore<any> {
  let h = host;
  while (h.node !== scope) {
    if (!(h instanceof ItemStore)) throw new Error(`No store for scope "${scope.path || "<root>"}"`);
    h = h.arrayStore._host;
  }
  return h;
}

export function concreteScopePath(host: BaseStore<any>): string {
  if (!(host instanceof ItemStore)) return "";
  const arr = host.arrayStore;
  const index = (arr.current() as readonly unknown[]).indexOf(host._currentRef);
  const outer = concreteScopePath(arr._host);
  const relative = arr.node.path.slice(arr._host.node.path.length).replace(/^\./, "");
  return `${outer}${outer && relative ? "." : ""}${relative}[${index}]`;
}

