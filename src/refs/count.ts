// countIn(node, key): nodes in a subtree whose `key` counts (metaKey `aggregate`).
// Read-only, on the tally channel.

import { ObjectNode, ArrayNode, type AnyNode } from "../shape";
import { FIELDS, META_DEFS, isAncestorOrSelf } from "../internal";
import { KIND, type RefKind } from "./kind";

/** Number of nodes in a subtree (the node itself included) whose `key` counts (see metaKey `aggregate`). */
export class CountRef {
  /** Nominal brand: a MetaRef has the same public shape and must not match. */
  private readonly _countRef = true;
  constructor(readonly node: AnyNode, readonly key: string) {}
  get path(): string {
    return `${this.node.path ?? ""}#count(${this.key})`;
  }
  /** @internal */
  get [KIND](): RefKind<CountRef> {
    return countKind;
  }
}

const countKind: RefKind<CountRef> = {
  node: (ref) => ref.node,
  id: (ref) => `c:${ref.node.id}:${ref.key}`,
  label: (ref) => ref.path,
  read: (store, ref) => {
    store.root._syncWalk();
    return store._host._countOf(ref.node, ref.key);
  },
  subscribe: (store, ref, phase, fn) => store._addTallySub(ref.node, ref.key, phase, fn),
  affectedBy: (ref, t) =>
    t.key === undefined ? isAncestorOrSelf(t.node, ref.node) || isAncestorOrSelf(ref.node, t.node) : t.key === ref.key && isAncestorOrSelf(ref.node, t.node),
  local: false,
  readOnly: "Counts are read-only",
};

const countRefs = new WeakMap<AnyNode, Map<string, CountRef>>();

/**
 * Whether any node in the subtree declares `key` with an `aggregate`. Rows share
 * the array item template's declarations, so walking the template covers them.
 */
function isCountable(node: AnyNode, key: string): boolean {
  if (node[META_DEFS][key]?.options.aggregate) return true;
  if (node instanceof ObjectNode) {
    for (const child of Object.values(node[FIELDS] as Record<string, AnyNode>)) if (isCountable(child, key)) return true;
  } else if (node instanceof ArrayNode) {
    return isCountable(node.item, key);
  }
  return false;
}

/** Count reference; the same instance for the same (node, key), so it can be used as a hook dependency. */
export function countIn(node: AnyNode, key: string): CountRef {
  let byKey = countRefs.get(node);
  if (!byKey) countRefs.set(node, (byKey = new Map()));
  let ref = byKey.get(key);
  if (!ref) {
    byKey.set(key, (ref = new CountRef(node, key)));
    if (!isCountable(node, key)) {
      console.warn(
        `countIn: no node under "${node.path || "<root>"}" declares "${key}" with an aggregate – ` +
          `the count is always 0. Counted keys are declared with metaKey(value, { aggregate }).`
      );
    }
  }
  return ref;
}
