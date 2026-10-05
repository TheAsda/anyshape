// node.key: one meta key of one node.

import type { MetaRef } from "../shape";
import { defOf } from "../internal";
import type { RefKind } from "./kind";

export const metaKind: RefKind<MetaRef<any>> = {
  node: (ref) => ref.node,
  id: (ref) => `m:${ref.node.id}:${ref.key}`,
  label: (ref) => ref.path,
  read: (store, ref) => store._readMetaRef(ref),
  subscribe: (store, ref, phase, fn) => store._addKeySub(ref, phase, fn),
  affectedBy: (ref, t) => t.key === ref.key && t.node === ref.node,
  local: true,
  writer: {
    target: (ref) => ({ node: ref.node, key: ref.key, def: defOf(ref) }),
    write: (store, ref, value, options) => store._setMetaKey(ref, value, options),
  },
};
