// node.key: one meta key of one node.

import type { AnyNode } from "../shape";
import { defOf } from "../internal";
import { KIND, type RefKind } from "./kind";

export class MetaRef<V = unknown, P = unknown> {
  /** Phantom type – never exists at runtime. */
  declare readonly _value: V;
  /** Phantom type: the payload contributions to this key carry (NoPayload: none). */
  declare readonly _payload: P;

  private constructor(readonly node: AnyNode, readonly key: string) {}

  /** @internal Refs are attached to nodes (node.error); everything else reads them from there. */
  static _create(node: AnyNode, key: string): MetaRef<any> {
    return new MetaRef(node, key);
  }

  /** e.g. "shipping.city#error" */
  get path(): string {
    return `${this.node.path ?? ""}#${this.key}`;
  }

  /** @internal */
  get [KIND](): RefKind<MetaRef<any>> {
    return metaKind;
  }
}

const metaKind: RefKind<MetaRef<any>> = {
  node: (ref) => ref.node,
  id: (ref) => `m:${ref.node.id}:${ref.key}`,
  label: (ref) => ref.path,
  read: (store, ref) => store._readMetaRef(ref),
  subscribe: (store, ref, phase, fn) => store._addKeySub(ref, phase, fn),
  affectedBy: (ref, t) => t.key === ref.key && t.node === ref.node,
  local: true,
  tally: false,
  writer: {
    target: (ref) => ({ node: ref.node, key: ref.key, def: defOf(ref) }),
    write: (store, ref, value, options) => store._setMetaKey(ref, value, options),
  },
};
