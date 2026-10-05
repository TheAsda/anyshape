// countIn(node, def): nodes in a subtree whose key declared with `def` counts
// (MetaKeyDef.aggregate), under whatever name. Read-only, on the tally channel.

import { ObjectNode, ArrayNode, type AnyNode } from "../shape";
import type { MetaKeyDef } from "../meta";
import { FIELDS, META_DEFS, countSlotOf } from "../internal";
import { isAncestorOrSelf } from "../tree";
import { KIND, type RefKind } from "./kind";

/** Number of nodes in a subtree (the node itself included) whose key declared with `def` counts (see MetaKeyDef.aggregate). */
export class CountRef {
  /** Nominal brand: a MetaRef has the same public shape and must not match. */
  private readonly _countRef = true;
  /**
   * @internal `_id` is a counter: a definition has no name of its own.
   * countIn caches one ref per (node, def), so equal refs share it.
   */
  constructor(readonly node: AnyNode, readonly def: MetaKeyDef<any, any>, readonly _id: string) {}
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
    t.key === undefined ? isAncestorOrSelf(t.node, ref.node) || isAncestorOrSelf(ref.node, t.node) : t.def === ref.def && isAncestorOrSelf(ref.node, t.node),
  local: false,
  tally: true,
  readOnly: "Counts are read-only",
};

const countRefs = new WeakMap<AnyNode, Map<MetaKeyDef<any, any>, CountRef>>();
let countIds = 0;

/**
 * Whether any node in the subtree declares `def`. Rows share the array item
 * template's declarations, so walking the template covers them.
 */
function isDeclared(node: AnyNode, def: MetaKeyDef<any, any>): boolean {
  if (Object.values(node[META_DEFS]).includes(def)) return true;
  if (node instanceof ObjectNode) {
    for (const child of Object.values(node[FIELDS] as Record<string, AnyNode>)) if (isDeclared(child, def)) return true;
  } else if (node instanceof ArrayNode) {
    return isDeclared(node.item, def);
  }
  return false;
}

/** Count reference; the same instance for the same (node, def), so it can be used as a hook dependency. */
export function countIn(node: AnyNode, def: MetaKeyDef<any, any>): CountRef {
  let byDef = countRefs.get(node);
  if (!byDef) countRefs.set(node, (byDef = new Map()));
  let ref = byDef.get(def);
  if (!ref) {
    byDef.set(def, (ref = new CountRef(node, def, `c:${countIds++}`)));
    const problem = !def._steps.aggregate
      ? "the key has no aggregate"
      : !isDeclared(node, def)
        ? `no node under "${node.path || "<root>"}" declares it`
        : undefined;
    if (problem) {
      console.warn(`countIn: ${problem} – the count is always 0. Counted keys are declared with metaKey(value).aggregate(…).`);
    }
  }
  return ref;
}
