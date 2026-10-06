// countIn(node, def): nodes in a subtree whose key declared with `def` counts
// (MetaKeyDef.aggregate), under whatever name. Read-only, on the tally channel.

import { FIELDS, META_DEFS, countSlotOf } from "../internal.js";
import type { Countable, MetaKeyDef } from "../meta.js";
import { ObjectNode, ArrayNode, type AnyNode } from "../shape.js";
import { isAncestorOrSelf } from "../tree.js";
import { KIND, type RefKind } from "./kind.js";

/** Number of nodes in a subtree (the node itself included) whose key declared with `def` counts (see MetaKeyDef.aggregate). */
export class CountRef {
  /** Nominal brand: a MetaRef has the same public shape and must not match. */
  private readonly _countRef = true;
  /**
   * @internal `_id` is a counter: a definition has no name of its own.
   * countIn caches one ref per (node, def), so equal refs share it.
   */
  constructor(
    readonly node: AnyNode,
    readonly def: MetaKeyDef<any, any>,
    readonly _id: string,
  ) {}
  get path(): string {
    return `${this.node.path ?? ""}#count`;
  }
  /** @internal */
  get [KIND](): RefKind<CountRef> {
    return countKind;
  }
}

const countKind: RefKind<CountRef> = {
  node: (ref) => ref.node,
  id: (ref) => ref._id,
  label: (ref) => ref.path,
  read: (store, ref) => {
    store.root._syncWalk();
    return store.scopeStore._countOf(ref.node, countSlotOf(ref.def));
  },
  subscribe: (store, ref, phase, fn) => store._addTallySub(ref.node, countSlotOf(ref.def), phase, fn),
  affectedBy: (ref, t) =>
    t.key === undefined
      ? isAncestorOrSelf(t.node, ref.node) || isAncestorOrSelf(ref.node, t.node)
      : t.def === ref.def && isAncestorOrSelf(ref.node, t.node),
  local: false,
  tally: true,
  readOnly: "Counts are read-only",
};

const countRefs = new WeakMap<AnyNode, Map<MetaKeyDef<any, any>, CountRef>>();
let countIds = 0;

/**
 * Where the subtree first declares `def` (`key "name" on "path"`), or
 * undefined. Rows share the array item template's declarations, so walking
 * the template covers them.
 */
function declaration(node: AnyNode, def: MetaKeyDef<any, any>): string | undefined {
  for (const [name, d] of Object.entries(node[META_DEFS]))
    if (d === def) return `key "${name}" on "${node.path || "<root>"}"`;
  if (node instanceof ObjectNode) {
    for (const child of Object.values(node[FIELDS] as Record<string, AnyNode>)) {
      const found = declaration(child, def);
      if (found) return found;
    }
  } else if (node instanceof ArrayNode) {
    return declaration(node.item, def);
  }
  return undefined;
}

/**
 * Count reference; the same instance for the same (node, def), so it can be
 * used as a hook dependency. Throws when the count would always be 0: the key
 * has no aggregate, or no node in the subtree declares it.
 */
export function countIn(node: AnyNode, def: MetaKeyDef<any, any, any> & Countable): CountRef {
  let byDef = countRefs.get(node);
  if (!byDef) countRefs.set(node, (byDef = new Map()));
  let ref = byDef.get(def);
  if (!ref) {
    const declared = declaration(node, def);
    const problem = !def._steps.aggregate
      ? `${declared ?? "the key"} has no aggregate`
      : !declared
        ? "no node in the subtree declares the key"
        : undefined;
    if (problem) {
      throw new Error(
        `countIn on "${node.path || "<root>"}": ${problem} – its count would always be 0. Counted keys are declared with metaKey(value).aggregate(…).`,
      );
    }
    byDef.set(def, (ref = new CountRef(node, def, `c:${countIds++}`)));
  }
  return ref;
}
