// A node: its value. Written by set, subscribed on the value channel.

import type { ShapeNode, AnyNode } from "../shape";
import { isAncestorOrSelf } from "../tree";
import type { RefKind } from "./kind";

export const valueKind: RefKind<AnyNode> = {
  node: (node) => node,
  id: (node) => `v:${node.id}`,
  label: (node) => node.path || "<root>",
  read: (store, node) => store._read(node),
  subscribe: (store, node, phase, fn) => store._addValueSub(node, phase, fn),
  affectedBy: (node, t) => t.key === undefined && (isAncestorOrSelf(t.node, node) || isAncestorOrSelf(node, t.node)),
  local: true,
  tally: false,
  writer: {
    target: (node) => ({ node }),
    write: (store, node, value, options) => store._setValue(node as ShapeNode<any>, value, options),
  },
};
