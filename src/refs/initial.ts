// initialOf(node): a node's baseline value. Read-only (written with
// { as: "initial" }), on the baseline channel.

import type { AnyNode, InferValue } from "../shape";
import { KIND, type RefKind } from "./kind";

/** The initial (baseline) value of a node. Changes with { as: "initial" } writes. */
export class InitialRef<V = unknown> {
  /** Nominal brand. */
  private readonly _initialRef = true;
  /** Phantom type – never exists at runtime. */
  declare readonly _value: V;
  constructor(readonly node: AnyNode) {}
  get path(): string {
    return `${this.node.path ?? ""}#initial`;
  }
  /** @internal */
  get [KIND](): RefKind<InitialRef<any>> {
    return initialKind;
  }
}

const initialKind: RefKind<InitialRef<any>> = {
  node: (ref) => ref.node,
  id: (ref) => `i:${ref.node.id}`,
  label: (ref) => ref.path,
  read: (store, ref) => store._readInitial(ref.node),
  subscribe: (store, ref, phase, fn) => store._addInitialSub(ref.node, phase, fn),
  affectedBy: () => false,
  local: true,
  tally: false,
  readOnly: 'Initial values are written with { as: "initial" }',
};

const initialRefs = new WeakMap<AnyNode, InitialRef<any>>();

/** Initial-value reference; the same instance for the same node. */
export function initialOf<N extends AnyNode>(node: N): InitialRef<InferValue<N>> {
  let ref = initialRefs.get(node);
  if (!ref) initialRefs.set(node, (ref = new InitialRef(node)));
  return ref;
}
