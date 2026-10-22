// A node: its value. Written by set, subscribed on the value channel.

import { ID } from "../internal.js";
import { pathOf, type ShapeNode, type AnyNode } from "../shape.js";
import { isAncestorOrSelf } from "../tree.js";
import type { RefKind } from "./kind.js";

export const valueKind: RefKind<AnyNode> = {
  node: (node) => node,
  id: (node) => `v:${node[ID]}`,
  label: (node) => pathOf(node) || "<root>",
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
