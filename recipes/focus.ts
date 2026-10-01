// ============================================================
// Focus – where focusing an error moves the cursor.
// ------------------------------------------------------------
//   • focusable() declares `focusTarget`, registered by the bindings
//     (useControl) and never notifying.
//   • focusFirst(entries) focuses the first entry (e.g. a validation
//     result's errors) whose node has a target, in document order by default.
// ============================================================

import { metaKey, type AnyNode, type BaseStore, type MetaRef } from "form-lib";

/** Anything that can receive focus – an input, or a custom component's handle. */
export interface FocusTarget {
  focus(): void;
  scrollIntoView?(): void;
}

/** Where focusFirst / focus() move the cursor. One definition, found with collect(node, focusTarget). */
export const focusTarget = metaKey<FocusTarget | undefined>(undefined, { owner: "feature", reactive: false });

export const focusable = () => ({ focusTarget });

/** An entry to focus: a node, through any of its refs, and a store that can address it. */
export interface FocusEntry {
  ref: MetaRef<any>;
  store: BaseStore<any>;
}

/**
 * Orders focus targets by their position in the document. Targets that are
 * not DOM nodes (custom focus handles) compare equal, so they keep their
 * shape order relative to each other.
 */
export function domOrder(a: FocusTarget, b: FocusTarget): number {
  if (typeof Node === "undefined" || !(a instanceof Node) || !(b instanceof Node) || a === b) return 0;
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

/** The target registered on the node; none for a removed row. */
function targetOf(store: BaseStore<any>, node: AnyNode): FocusTarget | undefined {
  if (!store.isAttached()) return undefined;
  const own = store.collect(node, focusTarget).find((e) => e.ref.node === node && e.store === store);
  return own && own.store.get(own.ref);
}

function moveTo(target: FocusTarget): void {
  target.focus();
  target.scrollIntoView?.();
}

/** Focus the node's registered target. Returns false when there is none. */
export function focus(store: BaseStore<any>, node: AnyNode): boolean {
  const target = targetOf(store, node);
  if (!target) return false;
  moveTo(target);
  return true;
}

/**
 * Focus the first entry whose node has a focus target, ordered by `compare`
 * (ties keep the entries' order). Returns the focused entry.
 */
export function focusFirst<E extends FocusEntry>(entries: readonly E[], compare = domOrder): E | undefined {
  const first = entries
    .map((entry, index) => ({ entry, index, target: targetOf(entry.store, entry.ref.node) }))
    .filter((c): c is { entry: E; index: number; target: FocusTarget } => c.target !== undefined)
    .sort((a, b) => compare(a.target, b.target) || a.index - b.index)[0];
  if (!first) return undefined;
  moveTo(first.target);
  return first.entry;
}
