// ============================================================
// Focus – where focusing an error moves the cursor.
// ------------------------------------------------------------
// The pattern for state kept beside the form: a focus target (a DOM
// element, or any { focus() }) is not form state, so the store never holds
// it. The recipe keeps its own registry, keyed by the node's scope store
// (the root or a row) and the node; reset() leaves it alone, and a removed
// row's targets are skipped through store.isAttached().
//   • registerFocus(store, node, target) registers a target, called by the
//     bindings (useControl's focusRef); it returns the unregister function.
//   • focus(store, node) focuses the node's target.
//   • focusFirst(entries) focuses the first entry (e.g. a validation
//     result's errors) whose node has a target, in document order by default.
// ============================================================

import type { AnyNode, BaseStore, CollectEntry } from "form-lib";

/** Anything that can receive focus – an input, or a custom component's handle. */
export interface FocusTarget {
  focus(): void;
  scrollIntoView?(): void;
}

/** Registered targets by scope store, then node. A removed row's store takes its targets with it. */
const targets = new WeakMap<BaseStore<any>, Map<AnyNode, FocusTarget>>();

/**
 * Register where focus() and focusFirst() move the cursor for `node`; a
 * later registration for the node replaces it. The returned function
 * unregisters the target, unless another one has replaced it since.
 */
export function registerFocus(store: BaseStore<any>, node: AnyNode, target: FocusTarget): () => void {
  let byNode = targets.get(store.scopeStore);
  if (!byNode) targets.set(store.scopeStore, (byNode = new Map()));
  byNode.set(node, target);
  return () => {
    if (byNode.get(node) === target) byNode.delete(node);
  };
}

/** An entry to focus, as collect() and validate() return them: a node (ref.node) and its scope store. */
export type FocusEntry = Pick<CollectEntry, "ref" | "store">;

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

/** The target registered for the node; none for a removed row. */
function targetOf(store: BaseStore<any>, node: AnyNode): FocusTarget | undefined {
  if (!store.isAttached()) return undefined;
  return targets.get(store.scopeStore)?.get(node);
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
 * (ties keep the entries' order). Entries of removed rows are skipped.
 * Returns the focused entry.
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
