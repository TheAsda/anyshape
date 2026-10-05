// ============================================================
// Internal helpers shared by the store, the behavior runtime and the reference kinds.
// Not exported from the package index.
// ============================================================

import { ArrayNode, type AnyNode } from "./shape";
import type { MetaRef } from "./refs/meta";
import type { MetaKeyDef } from "./meta";
import { BaseStore, ItemStore, type AnyRef } from "./store";
import { kindOf, type Target } from "./refs/kind";

/**
 * Dev build? Read as `process.env.NODE_ENV`, which bundlers replace: an app's
 * production build then drops every dev-only branch. Node reads it at runtime.
 */
export const isDev = (): boolean => process.env.NODE_ENV !== "production";

/**
 * An error with `message` whose stack is `trace`'s: a behavior's trace is
 * captured in dev where defineBehavior was called (Behavior._trace).
 */
export function locatedAt(trace: Error, message: string, options?: ErrorOptions): Error {
  const error = new Error(message, options);
  error.stack = `Error: ${message}\n${(trace.stack ?? "").split("\n").slice(1).join("\n")}`;
  return error;
}

// ============================================================
// Node internals, keyed by symbols so that every string name stays free for
// fields and meta keys. Classes only `declare` these members and assign them
// at runtime: this module and shape.ts import each other.
// ============================================================

/** ObjectNode: its children (also exposed as direct properties). */
export const FIELDS: unique symbol = Symbol("anyshape.fields");
/** ShapeNode: normalized declarations, one per meta key. */
export const META_DEFS: unique symbol = Symbol("anyshape.metaDefs");
/** ShapeNode: default values of all declared meta keys. */
export const META: unique symbol = Symbol("anyshape.meta");
/** ArrayNode: factory for new rows, if declared. */
export const CREATE: unique symbol = Symbol("anyshape.create");

/** The declaration of the key a meta reference points at. */
export function defOf<V>(ref: MetaRef<V>): MetaKeyDef<V> {
  return ref.node[META_DEFS][ref.key];
}

const countSlots = new WeakMap<MetaKeyDef<any, any>, object>();

/**
 * The tally slot of a definition's aggregate counts (countIn). Not the
 * definition itself: pendingIn tallies under that.
 */
export function countSlotOf(def: MetaKeyDef<any, any>): object {
  let slot = countSlots.get(def);
  if (!slot) countSlots.set(def, (slot = {}));
  return slot;
}

/** The node's own reference to a declared key (node.error), the one every reader shares. */
export function metaRefOf<V = unknown>(node: AnyNode, key: string): MetaRef<V> {
  return (node as any)[key];
}

/**
 * The node's refs to the keys `def` uses, matched by definition, in the order
 * of .uses(). The node declares `def` as `name`.
 */
export function usedRefs(node: AnyNode, name: string, def: MetaKeyDef<any, any>): MetaRef<any, any>[] {
  return (def._steps.uses ?? []).map((used, i) => {
    const names = Object.keys(node[META_DEFS]).filter((n) => node[META_DEFS][n] === used);
    const at = `Key "${name}" on "${node.path || "<root>"}" uses a key the node`;
    const which = `(uses[${i}], default ${String(used.defaultValue)})`;
    if (!names.length) throw new Error(`${at} doesn't declare ${which} – declare it in .meta()`);
    if (names.length > 1) throw new Error(`${at} declares twice (${names.map((n) => `"${n}"`).join(", ")}) ${which} – declare it once`);
    return metaRefOf(node, names[0]);
  });
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

export function storeWithin(inner: BaseStore<any>, outer: BaseStore<any>): boolean {
  for (let s: BaseStore<any> | undefined = inner; s; s = s.parentStore) if (s === outer) return true;
  return false;
}

/** The scope host enclosing a scope host: a row's, none for the root. */
export function outerHost(host: BaseStore<any>): BaseStore<any> | undefined {
  return host instanceof ItemStore ? host.arrayStore.scopeStore : undefined;
}

/** The scope host (root or row store) at `scope`, walking up from `host`; none when `scope` isn't `host`'s or an enclosing one. */
export function hostAt(host: BaseStore<any>, scope: AnyNode): BaseStore<any> | undefined {
  for (let h: BaseStore<any> | undefined = host; h; h = outerHost(h)) if (h.node === scope) return h;
  return undefined;
}

/** hostAt, for a scope that must be `host`'s or an enclosing one. */
export function hostFor(host: BaseStore<any>, scope: AnyNode): BaseStore<any> {
  const found = hostAt(host, scope);
  if (!found) throw new Error(`No store for scope "${scope.path || "<root>"}"`);
  return found;
}

/** The row stores from `outer` (excluded) down to `host` (included): every scope host on the way is a row. */
export function rowsBetween(outer: BaseStore<any>, host: BaseStore<any>): ItemStore<any>[] {
  const rows: ItemStore<any>[] = [];
  let h = host;
  while (h !== outer) {
    if (!(h instanceof ItemStore)) throw new Error(`"${host.node.path || "<root>"}" is not inside "${outer.node.path || "<root>"}"`);
    rows.unshift(h);
    h = h.arrayStore.scopeStore;
  }
  return rows;
}

/** Concrete path with row indexes, e.g. "lines[2].notes[0].text". `host` is the scope host of `node`. */
export function concretePath(host: BaseStore<any>, node: AnyNode): string {
  if (!(host instanceof ItemStore)) return node.path;
  const arr = host.arrayStore;
  const index = (arr.current() as readonly unknown[]).indexOf(host._currentRef);
  const relative = node.path.slice(host.node.path.length);
  return `${concretePath(arr.scopeStore, arr.node)}[${index}]${relative}`;
}

/** concretePath for labels and messages: "<root>" for the form root. */
export function pathLabel(host: BaseStore<any>, node: AnyNode): string {
  return concretePath(host, node) || "<root>";
}

