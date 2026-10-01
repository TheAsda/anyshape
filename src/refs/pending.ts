// pendingIn(node, def?) / pendingOf(target): behavior targets whose writing
// run is in flight (see Pending in GLOSSARY.md). Read-only, on the tally channel.
//   • pendingIn – targets in the subtree, rows included; with a key definition,
//     only meta targets declared with it, whatever their name.
//   • pendingOf – whether that exact target is pending (one writer per target).

import type { AnyNode, MetaRef } from "../shape";
import type { MetaKeyDef } from "../meta";
import { isAncestorOrSelf, refNode, refKey, refLabel, targetOf } from "../internal";
import type { AnyRef, BaseStore } from "../store";
import { KIND, type RefKind } from "./kind";

/** The slot of pendingIn(node) without a definition: every target. */
const ANY: object = Object.freeze({});

/** Number of targets in a subtree whose writing run is in flight. */
export class PendingInRef {
  /** Nominal brand. */
  private readonly _pendingInRef = true;
  /** @internal */
  constructor(readonly node: AnyNode, readonly def: MetaKeyDef<any> | undefined, readonly _id: string) {}
  get path(): string {
    return `${this.node.path ?? ""}#pendingIn`;
  }
  /** @internal */
  get [KIND](): RefKind<PendingInRef> {
    return pendingInKind;
  }
}

/** Whether a run that writes the target is in flight. */
export class PendingOfRef {
  /** Nominal brand. */
  private readonly _pendingOfRef = true;
  /** @internal */
  constructor(readonly target: AnyRef) {}
  get path(): string {
    return `${refLabel(this.target)}#pending`;
  }
  /** @internal */
  get [KIND](): RefKind<PendingOfRef> {
    return pendingOfKind;
  }
}

const slotOf = (ref: PendingInRef): object => ref.def ?? ANY;

const pendingInKind: RefKind<PendingInRef> = {
  node: (ref) => ref.node,
  id: (ref) => ref._id,
  label: (ref) => ref.path,
  read: (store, ref) => {
    countAll();
    store.root._syncWalk();
    return store._host._countOf(ref.node, slotOf(ref));
  },
  subscribe: (store, ref, phase, fn) => {
    countAll();
    return store._addTallySub(ref.node, slotOf(ref), phase, fn);
  },
  // A value write can add or remove rows, and their pending targets with them.
  affectedBy: (ref, t) => t.key === undefined && (isAncestorOrSelf(t.node, ref.node) || isAncestorOrSelf(ref.node, t.node)),
  local: false,
  readOnly: "Pending tallies are read-only",
};

/** Per scope host: targets whose run is in flight. */
const inFlight = new WeakMap<object, Set<AnyRef>>();

const pendingOfKind: RefKind<PendingOfRef> = {
  node: (ref) => refNode(ref.target),
  id: (ref) => `p:${refKey(ref.target)}`,
  label: (ref) => ref.path,
  read: (store, ref) => {
    countAll();
    return inFlight.get(store._host)?.has(ref.target) ?? false;
  },
  subscribe: (store, ref, phase, fn) => {
    countAll();
    return store._addTallySub(refNode(ref.target), ref.target, phase, fn, (host) => inFlight.get(host)?.has(ref.target) ?? false);
  },
  affectedBy: (ref, t) => t.key === undefined && isAncestorOrSelf(t.node, refNode(ref.target)),
  local: true,
  readOnly: "Pending tallies are read-only",
};

const pendingInRefs = new WeakMap<AnyNode, Map<object, PendingInRef>>();
let pendingInIds = 0;

/**
 * Targets in `node`'s subtree (rows included) whose writing run is in flight;
 * with `def`, only meta keys declared with that definition. The same instance
 * for the same (node, def).
 */
export function pendingIn(node: AnyNode, def?: MetaKeyDef<any>): PendingInRef {
  const slot = def ?? ANY;
  let bySlot = pendingInRefs.get(node);
  if (!bySlot) pendingInRefs.set(node, (bySlot = new Map()));
  let ref = bySlot.get(slot);
  if (!ref) bySlot.set(slot, (ref = new PendingInRef(node, def, `pi:${pendingInIds++}`)));
  return ref;
}

const pendingOfRefs = new WeakMap<object, PendingOfRef>();

/** Whether a run that writes `target` (a node or a meta key) is in flight. The same instance per target. */
export function pendingOf(target: AnyNode | MetaRef<any>): PendingOfRef {
  let ref = pendingOfRefs.get(target);
  if (!ref) pendingOfRefs.set(target, (ref = new PendingOfRef(target)));
  return ref;
}

interface Run {
  readonly host: BaseStore<any>;
  readonly writes: readonly AnyRef[];
  counted: boolean;
}

/**
 * Runs in flight whose targets are not on the tallies yet. A sync run ends
 * before anything else runs, so its targets are counted only if it reads a
 * pending reference itself; counting every run up the tree would tax them all.
 */
const uncounted = new Set<Run>();

function count(run: Run, delta: 1 | -1): void {
  const { host } = run;
  let targets = inFlight.get(host);
  if (!targets) inFlight.set(host, (targets = new Set()));
  for (const w of run.writes) {
    const { node, def } = targetOf(w)!;
    if (delta > 0) targets.add(w);
    else targets.delete(w);
    host.root._markCount(host, node, w);
    host.root._applyCountDelta(host, node, ANY, delta);
    if (def) host.root._applyCountDelta(host, node, def, delta);
  }
}

/** Put every run in flight on the tallies, before they are read or subscribed. */
function countAll(): void {
  for (const run of uncounted) {
    run.counted = true;
    count(run, 1);
  }
  uncounted.clear();
}

/**
 * @internal A run on scope host `host` that writes `writes` starts: its
 * targets are pending until the returned function is called (the run ended or
 * was cancelled).
 */
export function beginRun(host: BaseStore<any>, writes: readonly AnyRef[]): () => void {
  const run: Run = { host, writes, counted: false };
  uncounted.add(run);
  return () => {
    if (run.counted) count(run, -1);
    else uncounted.delete(run);
  };
}
