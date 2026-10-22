// ============================================================
// Shape-tree helpers that need no store: importable from the store, the
// behavior runtime and the reference kinds without an import cycle.
// Not exported from the package index.
// ============================================================

import { PARENT } from "./internal.js";
import type { AnyNode } from "./shape.js";

export function isAncestorOrSelf(ancestor: AnyNode, node: AnyNode): boolean {
  for (let n: AnyNode | undefined = node; n; n = n[PARENT]) if (n === ancestor) return true;
  return false;
}
