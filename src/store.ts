// ============================================================
// Stores
// ------------------------------------------------------------
// Structure:
//   • One root value, written immutably through node lenses.
//   • substore() accepts shape nodes only; membership is checked by walking
//     `parent`. A store addresses its focus node and every descendant in the
//     same scope (never across an array boundary).
//   • Scopes: RootStore and every ItemStore provide the value (and the initial
//     value) that node lenses are resolved against. Object/array substores
//     are views that read through their parent's scope.
//   • Meta: each store owns live meta for its direct properties; scope stores
//     (root, item) also own meta for their own node. Meta is closed: only
//     keys declared with .meta() exist.
//   • Arrays: object items only, no duplicate references. Item stores are
//     keyed by item reference; writes through an item store transfer the
//     store to the new reference. Each item store keeps its own initial value.
//
// References:
//   • get / set / subscribe (and the internal _react) accept any reference: a
//     node (value), a MetaRef (one meta key), and the read-only countIn,
//     initialOf, pendingIn and pendingOf. Each kind is one module in
//     src/refs/ and answers through RefKind (src/refs/kind.ts); the store
//     keeps only the change channels.
//   • Non-reactive keys (`reactive: false`) are stored in place: no flush, no
//     notification, allowed on detached stores, kept by reset().
//
// Writes carry an origin: "user" | "program" (default) | "initial" |
// "behavior:<id>". { as: "initial" } writes the value and its baseline.
// Reactions receive the origins of the writes that changed their target.
//
// Notification rules:
//   1. A value subscription fires when its value is no longer Object.is-equal
//      to the value at its last notification.
//   2. Values and meta are separate channels; meta does not bubble.
//   3. ArrayStore.subscribeItems fires only when the sequence of item stores
//      changes; items() returns the same array until then.
//   4. When an item store's attachment changes, all its subscribers fire.
//   5. Every write is a batch of one; batch(fn) groups writes; notifications
//      run when the outermost batch ends.
//   6. The flush is synchronous: its sync behavior runs settle inside it.
//      Async behavior runs may still be in flight after it, so the form is
//      not final; code that needs that awaits store.settle().
//   7. The behavior phase runs first (repeating until settled, max
//      MAX_BEHAVIOR_ROUNDS), then the listener phase once; writing during
//      the listener phase throws. Behaviors are triggered through the
//      internal reaction channel (_react): derived writes are behaviors,
//      side effects are listeners (subscribe).
//   8. Listeners are () => void; reactions get (next, prev, info).
// ============================================================

import type { Meta, MetaKeyDef } from "./meta";
import type { AnyBehavior, Behavior, BehaviorHandle } from "./behaviors";
import {
  ShapeNode, ObjectNode, ArrayNode, MetaRef,
  type AnyNode, type ContainerNode, type InferValue,
} from "./shape";
import { FIELDS, META_DEFS, META, CREATE, defOf, metaRefOf, countSlotOf, concretePath } from "./internal";
import { isAncestorOrSelf } from "./tree";
import { kindOf } from "./refs/kind";
import type { CountRef } from "./refs/count";
import type { InitialRef } from "./refs/initial";
import type { PendingInRef, PendingOfRef } from "./refs/pending";

export type Listener = () => void;
export type Unsubscribe = () => void;

export type Origin = "user" | "program" | "initial" | `behavior:${string}`;

export interface WriteOptions {
  /** Who made the write. Default "program". */
  origin?: Origin;
  /** "initial": also set the baseline (initialOf / dirty / reset). Values only. */
  as?: "initial";
}

/** @internal */
export interface ChangeInfo {
  /** Origins of the writes that changed this reaction's target since its last run. */
  readonly origins: ReadonlySet<Origin>;
}

export type AnyRef = AnyNode | MetaRef<any> | CountRef | InitialRef<any> | PendingInRef | PendingOfRef;
export type RefValue<R> =
  R extends CountRef | PendingInRef ? number
  : R extends PendingOfRef ? boolean
  : R extends InitialRef<infer V> ? V
  : InferValue<R>;

export interface CollectEntry<V = unknown> {
  /** Concrete path of the node with row indexes, e.g. "lines[2].qty". */
  path: string;
  /** The node's reference to the key (template node for rows: the node is `ref.node`). */
  ref: MetaRef<V>;
  /** A store that can address `ref` (root or item store). */
  store: BaseStore<any>;
}

export const MAX_BEHAVIOR_ROUNDS = 100;

/** @internal The behavior runtime (behaviors.ts): built by the factory createStore passes to the root. */
export interface RuntimeHooks {
  hasWork(): boolean;
  runNext(): void;
  add(host: BaseStore<any>, behaviors: AnyBehavior | readonly AnyBehavior[]): BehaviorHandle;
  replace(previous: BehaviorHandle, behaviors: AnyBehavior | readonly AnyBehavior[]): BehaviorHandle;
  /** After reset(node) on `store`: re-run (as init) every instance that writes inside the reset part. */
  reinit(store: BaseStore<any>, node: AnyNode): void;
  /** The behaviors settled: the end of the flush's behavior phase. */
  flushed(): void;
  /** See BaseStore.settle. */
  settle(store: BaseStore<any>, node: AnyNode): Promise<void>;
}

/**
 * @internal Where a form's time goes. Dev only: createStore installs one on
 * the root (diagnostics.ts); in production the root has none and nothing is
 * measured. Every point carries `at`, a performance.now() time.
 */
export interface Probe {
  flushStart(at: number): void;
  /** The behaviors settled: the listeners are next. */
  behaviorsEnd(at: number): void;
  flushEnd(at: number): void;
  /** A synchronous part of a run on `instance` starts. Parts never nest. */
  runStart(instance: ProbedInstance, at: number): void;
  /**
   * The part ends. "sync": the run completed. "async": run() returned a
   * promise; the run is in flight from runStart until flightEnd. "apply": an
   * async run's writes were applied.
   */
  runEnd(instance: ProbedInstance, at: number, part: RunPart): void;
  /** The instance's run in flight completed (its promise settled) or was cancelled. */
  flightEnd(instance: ProbedInstance, at: number, cancelled: boolean): void;
  /** A registration change starts: addBehavior, replaceBehavior, a handle's dispose, createStore's behaviors. */
  registrationStart(at: number): void;
  /** It is committed; its flush is next. `describe` reads the committed state: call it now or never. */
  registrationEnd(at: number, describe: () => RegistrationChange): void;
  /** store.settle(node) waited from `start` to `end` (a settle that doesn't wait isn't reported). */
  settled(store: BaseStore<any>, node: AnyNode, start: number, end: number): void;
}

/** @internal A registration change, for the registration track. */
export interface RegistrationChange {
  /** Concrete path of the store it was made on ("<root>" for the root). */
  readonly store: string;
  /** Names of the behaviors registered and removed. */
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /**
   * Each combined key whose contributions changed: its owner's merged triggers
   * and its first LISTED_CONTRIBUTIONS contributions in ctx.parts order, as
   * "name @store", with the number of the others.
   */
  readonly owners: readonly {
    readonly key: string;
    readonly triggers: readonly string[];
    readonly contributions: readonly string[];
    readonly more: number;
  }[];
}

/**
 * @internal An owner's contributions listed per registration entry. Rows that
 * each contribute on mount would otherwise list every row on every mount.
 */
export const LISTED_CONTRIBUTIONS = 20;

/** @internal A behavior instance as a probe sees it: instances of one registration share `reg`. */
export interface ProbedInstance {
  readonly reg: { readonly name: string; readonly behavior: Behavior };
  readonly host: BaseStore<any>;
}

/** @internal */
export type RunPart = "sync" | "async" | "apply";

// ============================================================
// Internals: phases, subscriptions, write log
// ============================================================
/** @internal */
export type Phase = "behavior" | "listener";
const PHASES: readonly Phase[] = ["behavior", "listener"];
const NO_ORIGINS: ReadonlySet<Origin> = new Set();

interface Sub<V = any> {
  phase: Phase;
  last: V;
  active: boolean;
  read: () => V;
  equals: (a: V, b: V) => boolean;
  fn: (next: V, prev: V, info: ChangeInfo) => void;
  /** Origins of the log entries relevant to this subscription. */
  origins: (log: readonly WriteEntry[]) => Set<Origin>;
}

/** @internal */
export type SubFn = Sub["fn"];

/** @internal A subtree tally: an object owned by a reference kind (aggregate counts, pending tallies). */
export type Slot = object;

interface Seen {
  focus: unknown;
  attached: boolean;
}
type Calls = (() => void)[];

/** A location: one (scope host, node) level per scope, outermost first. */
interface LocLevel {
  host: BaseStore<any>;
  node: AnyNode;
}
type Loc = readonly LocLevel[];

interface WriteEntry {
  loc: Loc;
  origin: Origin;
  /** Set for meta writes. */
  key?: string;
}

/** A store that provides the value its scope's lenses are resolved against. */
interface ScopeHost {
  getScopeValue(): any;
  setScopeValue(value: any): void;
  getScopeInitial(): any;
  setScopeInitial(value: any): void;
  isAttached(): boolean;
}

/** Do two locations overlap (one contains the other)? */
function related(a: Loc, b: Loc): boolean {
  for (let i = 0; i < a.length && i < b.length; i++) {
    const x = a[i], y = b[i];
    if (x.host !== y.host) return false;
    if (i === a.length - 1 || i === b.length - 1) {
      return isAncestorOrSelf(x.node, y.node) || isAncestorOrSelf(y.node, x.node);
    }
    if (x.node !== y.node) return false;
  }
  return false;
}

/** Is `inner` inside `outer` (or equal to it)? */
function within(inner: Loc, outer: Loc): boolean {
  for (let i = 0; i < inner.length && i < outer.length; i++) {
    const x = inner[i], y = outer[i];
    if (x.host !== y.host) return false;
    if (i === outer.length - 1) return isAncestorOrSelf(y.node, x.node);
    if (i === inner.length - 1) return false;
    if (x.node !== y.node) return false;
  }
  return false;
}

function lastOf(loc: Loc): LocLevel {
  return loc[loc.length - 1];
}

function originsWhere(log: readonly WriteEntry[], pred: (e: WriteEntry) => boolean): Set<Origin> {
  const out = new Set<Origin>();
  for (const e of log) if (pred(e)) out.add(e.origin);
  return out;
}

function locOf(host: BaseStore<any>, node: AnyNode): Loc {
  const out: LocLevel[] = [{ host, node }];
  let h = host;
  while (h instanceof ItemStore) {
    const arr = h.arrayStore;
    const parentHost = arr._host;
    out.unshift({ host: parentHost, node: arr.node });
    h = parentHost;
  }
  return out;
}

function register(map: Map<AnyNode, Set<Sub>>, node: AnyNode, sub: Sub): Unsubscribe {
  let set = map.get(node);
  if (!set) map.set(node, (set = new Set()));
  set.add(sub);
  return () => {
    sub.active = false;
    set!.delete(sub);
    if (set!.size === 0 && map.get(node) === set) map.delete(node);
  };
}

function check(sub: Sub, calls: Calls, log: readonly WriteEntry[] | undefined, force = false): void {
  const value = sub.read();
  if (!force && sub.equals(value, sub.last)) return;
  const prev = sub.last;
  sub.last = value;
  const info: ChangeInfo = { origins: log ? sub.origins(log) : NO_ORIGINS };
  calls.push(() => {
    if (sub.active) sub.fn(value, prev, info);
  });
}

// ============================================================
// Base store – shared by all store kinds
// ============================================================
export abstract class BaseStore<N extends ContainerNode> {
  /** @internal live meta per node owned by this store */
  readonly _metaMap = new Map<AnyNode, Meta>();
  /** @internal */ readonly _valueSubs = new Map<AnyNode, Set<Sub>>();
  /** @internal single-key subscriptions, registered on every source node */ readonly _keySubs = new Map<AnyNode, Set<Sub>>();
  /** @internal scope hosts only */ readonly _countSubs = new Map<AnyNode, Map<Slot, Set<Sub>>>();
  /** @internal scope hosts only: node → slot → tally (node itself + descendants) */ readonly _counts = new Map<AnyNode, Map<Slot, number>>();
  /** @internal scope hosts only: subscriptions to initial values */ readonly _initialSubs = new Set<Sub>();
  /** @internal cached substores, keyed by node */ readonly _children = new Map<AnyNode, BaseStore<any>>();
  /** @internal focus value / attachment at the last visit, per phase */ _seen!: Record<Phase, Seen>;
  /** @internal focus value at the last array sync walk */ _syncSeen: unknown;

  protected constructor(
    readonly node: N,
    readonly parentStore: BaseStore<any> | undefined
  ) {}

  // ---- scope wiring (overridden by RootStore / ItemStore) ----
  protected get scope(): ScopeHost {
    return this.parentStore!.scope;
  }
  /** @internal the scope host as a store */
  get _host(): BaseStore<any> {
    return this.scope as unknown as BaseStore<any>;
  }
  protected get ownsFocusMeta(): boolean {
    return false;
  }
  /** @internal is this store's subtree counted in its parent scope (item stores)? */
  get _countedInParent(): boolean {
    return false;
  }
  get root(): RootStore<any> {
    return this.parentStore!.root;
  }

  isAttached(): boolean {
    return this.scope.isAttached();
  }

  batch<R>(fn: () => R): R {
    return this.root._batch(fn);
  }

  // ==========================================================
  // Reference API
  // ==========================================================
  /** Value of a node, value of a meta key or a count. */
  get<R extends AnyRef>(ref: R): RefValue<R> {
    const kind = kindOf(ref);
    this.assertInScope(kind.node(ref));
    return kind.read(this, ref) as RefValue<R>;
  }

  set<R extends AnyNode | MetaRef<any>>(ref: R, value: InferValue<R>, options?: WriteOptions): void {
    const kind = kindOf(ref);
    if (!kind.writer) throw new Error(kind.readOnly);
    kind.writer.write(this, ref, value, options);
  }

  // ==========================================================
  // Values
  // ==========================================================
  /** @internal set() of a node, through the value kind */
  _setValue<T>(node: ShapeNode<T>, value: T, options: WriteOptions = {}): void {
    this.assertInScope(node);
    const asInitial = options.as === "initial";
    const origin: Origin = asInitial ? "initial" : options.origin ?? "program";
    this.root._batch(() => {
      this.assertAttached();
      validateValue(node, value);
      this.root._log({ loc: locOf(this._host, node), origin });
      this._write(node, value);
      if (asInitial) this._writeInitial(node, value);
    });
  }

  /** @internal the baseline value of a node; no scope check (get() and subscribe check it) */
  _readInitial(node: AnyNode): any {
    return node.lens.get(this.scope.getScopeInitial());
  }

  /** Restore values to their initial state and meta to defaults (non-reactive keys are kept). */
  reset(node: AnyNode = this.node): void {
    this.assertInScope(node);
    this.root._batch(() => {
      this.assertAttached();
      const initial = this._readInitial(node);
      this.root._log({ loc: locOf(this._host, node), origin: "initial" });
      this._write(node, initial);
      this._resetMeta(node);
      // Behavior-written meta (errors, disabled flags, ...) was reset to its
      // defaults: recompute it as if the form were created with these values.
      this.root._runtime.reinit(this, node);
    });
  }

  /** @internal read without scope check */
  _read(node: AnyNode): any {
    return node.lens.get(this.scope.getScopeValue());
  }

  /** @internal write without validation or logging (caller did both) */
  protected _write(node: AnyNode, value: unknown): void {
    this.root._assertWritable();
    const scope = this.scope;
    const current = scope.getScopeValue();
    const next = node.lens.set(current, value);
    if (next !== current) scope.setScopeValue(next);
  }

  private _writeInitial(node: AnyNode, value: unknown): void {
    const scope = this.scope;
    scope.setScopeInitial(node.lens.set(scope.getScopeInitial(), value));
    this.root._markInitial(this._host);
    if (node instanceof ObjectNode || node instanceof ArrayNode) {
      (this.substore(node as any) as BaseStore<any>)._refreshInitials();
    }
  }

  /** @internal after a baseline write: rows present in the new baseline take their current object as initial */
  _refreshInitials(): void {
    for (const child of this._children.values()) child._refreshInitials();
  }

  // ==========================================================
  // Meta
  // ==========================================================
  /** @internal */
  _setMetaKey(ref: MetaRef<any>, value: unknown, options: WriteOptions = {}): void {
    const { node, key } = ref;
    this.assertInScope(node);
    if (options.as) throw new Error('`as: "initial"` applies to values only');
    const owner = this._ownerOf(node);

    // Non-reactive keys: stored in place, never notify, allowed when detached.
    if (defOf(ref).options.reactive === false) {
      owner._metaOf(node)[key] = value;
      return;
    }

    const origin: Origin = options.origin ?? "program";
    this.root._batch(() => {
      this.root._assertWritable();
      this.assertAttached();
      const current = owner._metaOf(node);
      if (Object.is(current[key], value)) return;
      owner._commitMeta(node, current, { ...current, [key]: value }, origin);
    });
  }

  /** @internal replace a node's meta object: counts, dirty marks, log */
  _commitMeta(node: AnyNode, current: Meta, next: Meta, origin: Origin): void {
    const host = this._host;
    const changed: string[] = [];
    for (const key of Object.keys(next)) {
      if (Object.is(current[key], next[key])) continue;
      changed.push(key);
      const def = node[META_DEFS][key];
      const aggregate = def?._steps.aggregate;
      if (aggregate) {
        const delta = (aggregate(next[key]) ? 1 : 0) - (aggregate(current[key]) ? 1 : 0);
        if (delta) this.root._applyCountDelta(host, node, countSlotOf(def), delta);
      }
    }
    if (!changed.length) return;
    this._metaMap.set(node, next);
    this.root._markMeta(this, node);
    const loc = locOf(host, node);
    for (const key of changed) this.root._log({ loc, origin, key });
  }

  /** @internal */
  _metaOf(node: AnyNode): Meta {
    let live = this._metaMap.get(node);
    if (!live) {
      const seeded: Meta = { ...node[META] };
      this._metaMap.set(node, seeded);
      live = seeded;
    }
    return live;
  }

  /** @internal The store that owns `node`'s live meta and its subscriptions. */
  _ownerOf(node: AnyNode): BaseStore<any> {
    if (node === this.node) {
      return this.ownsFocusMeta ? this : this.parentStore!._ownerOf(node);
    }
    if (node.parent === this.node) return this;
    return (this.substore(node.parent as any) as BaseStore<any>)._ownerOf(node);
  }

  /** @internal one key of a node's live meta; no scope check (get() and subscribe check it) */
  _readMetaRef(ref: MetaRef<any>): any {
    return (this._ownerOf(ref.node)._metaOf(ref.node) as Meta)[ref.key];
  }

  private _resetMeta(node: AnyNode): void {
    this._ownerOf(node)._resetEntry(node);
    if (node instanceof ObjectNode || node instanceof ArrayNode) {
      (this.substore(node as any) as BaseStore<any>)._resetAllMeta();
    }
  }

  /** @internal reset every meta entry owned in this subtree */
  _resetAllMeta(): void {
    for (const node of [...this._metaMap.keys()]) this._resetEntry(node);
    for (const child of this._children.values()) child._resetAllMeta();
  }

  /** @internal back to static defaults, keeping non-reactive keys */
  _resetEntry(node: AnyNode): void {
    const current = this._metaMap.get(node);
    if (!current) return;
    const next: Meta = { ...node[META] };
    for (const [key, def] of Object.entries(node[META_DEFS])) {
      if (def.options.reactive === false || def.options.keepOnReset) next[key] = current[key];
    }
    this._commitMeta(node, current, next, "initial");
  }

  // ==========================================================
  // Counts
  // ==========================================================
  /** @internal */
  _countOf(node: AnyNode, slot: Slot): number {
    return this._counts.get(node)?.get(slot) ?? 0;
  }

  /** @internal */
  _bumpCount(node: AnyNode, slot: Slot, delta: number): void {
    let bySlot = this._counts.get(node);
    if (!bySlot) this._counts.set(node, (bySlot = new Map()));
    const value = (bySlot.get(slot) ?? 0) + delta;
    if (value) bySlot.set(slot, value);
    else bySlot.delete(slot);
  }

  /**
   * Every instance in the subtree that declares `def`, under whatever name,
   * whatever its value: shape order, rows expanded, with concrete paths.
   */
  collect<V>(node: AnyNode, def: MetaKeyDef<V>): CollectEntry<V>[] {
    this.assertInScope(node);
    this.root._syncWalk();
    const out: CollectEntry<V>[] = [];
    this._host._collectIn(node, def, out);
    return out;
  }

  /** @internal this = scope host */
  _collectIn<V>(node: AnyNode, def: MetaKeyDef<V>, out: CollectEntry<V>[]): void {
    for (const [key, declared] of Object.entries(node[META_DEFS])) {
      if (declared === def) out.push({ path: concretePath(this, node), ref: metaRefOf(node, key), store: this });
    }
    if (node instanceof ObjectNode) {
      for (const child of Object.values(node[FIELDS] as Record<string, AnyNode>)) this._collectIn(child, def, out);
    } else if (node instanceof ArrayNode && node !== this.node) {
      for (const row of (this.substore(node as any) as ArrayStore<any>).items()) row._collectIn(row.node, def, out);
    }
  }

  // ==========================================================
  // Behaviors
  // ==========================================================
  /**
   * Register behaviors after creation. On the root, behaviors on row template
   * nodes apply to every row; on a row's store, only to that row (and rows
   * nested in it). Returns a function that removes them again.
   */
  addBehavior(behaviors: AnyBehavior | readonly AnyBehavior[]): BehaviorHandle {
    return this.root._runtime.add(this._host, behaviors);
  }

  /**
   * Swap the behaviors registered by `previous` for `behaviors` in one
   * transaction, on the store `previous` was registered on. If a check fails,
   * `previous` stays registered. Returns the new handle.
   */
  replaceBehavior(previous: BehaviorHandle, behaviors: AnyBehavior | readonly AnyBehavior[]): BehaviorHandle {
    return this.root._runtime.replace(previous, behaviors);
  }

  /**
   * Resolves once no behavior run that writes inside `node` (default: this
   * store's node) is in flight, reruns included: once pendingIn(node) is 0.
   * Starts nothing; a cancelled run is not waited for, and neither is a run
   * that writes nothing (it is inside no node).
   */
  settle(node: AnyNode = this.node): Promise<void> {
    this.assertInScope(node);
    return this.root._runtime.settle(this, node);
  }

  // ==========================================================
  // Paths
  // ==========================================================
  /**
   * Resolve a concrete value path from the form root – "lines[1].qty" – to
   * the node and a store that can address it. undefined when the path does
   * not exist (unknown field, row index out of range). Meta keys are reached
   * through the node, by definition (e.g. collect(node, error) on that store).
   */
  resolvePath(path: string): { store: BaseStore<any>; ref: AnyNode } | undefined {
    if (path !== "" && !/^[^.[\]#]+(?:\[\d+\])*(?:\.[^.[\]#]+(?:\[\d+\])*)*$/.test(path)) return undefined;
    const tokens = path.match(/[^.[\]]+|\[\d+\]/g) ?? [];

    let store: BaseStore<any> = this.root;
    let node: AnyNode = this.root.node;
    for (const token of tokens) {
      if (token.startsWith("[")) {
        if (!(node instanceof ArrayNode)) return undefined;
        const index = Number(token.slice(1, -1));
        const rows = (store.substore(node as any) as ArrayStore<any>).items();
        if (index >= rows.length) return undefined;
        store = rows[index];
        node = node.item;
      } else {
        if (!(node instanceof ObjectNode) || !Object.prototype.hasOwnProperty.call(node[FIELDS], token)) return undefined;
        node = (node[FIELDS] as Record<string, AnyNode>)[token];
      }
    }
    return { store, ref: node };
  }

  // ==========================================================
  // Substores
  // ==========================================================
  substore<S extends ObjectNode<any>>(node: S): ObjectStore<S>;
  substore<S extends ArrayNode<any, any>>(node: S): ArrayStore<S>;
  substore(node: ContainerNode): BaseStore<any> {
    if (node === this.node) return this;
    this.assertInScope(node);
    if (!(node instanceof ObjectNode || node instanceof ArrayNode)) {
      throw new Error(`substore() needs an object or array node, got field "${(node as AnyNode).path}"`);
    }
    if (node.parent !== this.node) {
      return (this.substore(node.parent as any) as BaseStore<any>).substore(node as any);
    }
    let store = this._children.get(node);
    if (!store) {
      store = node instanceof ArrayNode ? new ArrayStore(node, this) : new ObjectStore(node, this);
      store._initSeen();
      this._children.set(node, store);
    }
    return store;
  }

  // ==========================================================
  // Subscriptions
  // ==========================================================
  /** Listener phase: called after the flush when the reference's value changed. */
  subscribe(ref: AnyRef, listener: Listener): Unsubscribe {
    return this._addRefSub(ref, "listener", () => listener());
  }

  /** @internal behavior phase, for the behavior runtime: may write; receives next, prev and the origins of the change. */
  _react<R extends AnyRef>(ref: R, fn: (next: RefValue<R>, prev: RefValue<R>, info: ChangeInfo) => void): Unsubscribe {
    return this._addRefSub(ref, "behavior", fn as any);
  }

  private _addRefSub(ref: AnyRef, phase: Phase, fn: SubFn): Unsubscribe {
    return kindOf(ref).subscribe(this, ref, phase, fn);
  }

  // Change channels, used by the reference kinds (src/refs/).
  /** @internal */
  _addValueSub(node: AnyNode, phase: Phase, fn: SubFn): Unsubscribe {
    this.assertInScope(node);
    const owner = this._ownerOf(node);
    const loc = locOf(owner._host, node);
    const sub: Sub = {
      phase, fn, active: true, last: undefined,
      read: () => owner._read(node),
      equals: Object.is,
      origins: (log) => originsWhere(log, (e) => e.key === undefined && related(e.loc, loc)),
    };
    sub.last = sub.read();
    return register(owner._valueSubs, node, sub);
  }

  /** @internal */
  _addKeySub(ref: MetaRef<any>, phase: Phase, fn: SubFn): Unsubscribe {
    this.assertInScope(ref.node);
    const { node, key } = ref;
    const owner = this._ownerOf(node);
    const host = owner._host;
    const sub: Sub = {
      phase, fn, active: true, last: undefined,
      read: () => this._readMetaRef(ref),
      equals: Object.is,
      origins: (log) => originsWhere(log, (e) => e.key === key && lastOf(e.loc).host === host && lastOf(e.loc).node === node),
    };
    sub.last = sub.read();
    return register(owner._keySubs, node, sub);
  }

  /** @internal baseline channel: marked by { as: "initial" } writes on this scope */
  _addInitialSub(node: AnyNode, phase: Phase, fn: SubFn): Unsubscribe {
    this.assertInScope(node);
    const host = this._host;
    const loc = locOf(host, node);
    const sub: Sub = {
      phase, fn, active: true, last: undefined,
      read: () => host._readInitial(node),
      equals: Object.is,
      origins: (log) => originsWhere(log, (e) => e.origin === "initial" && e.key === undefined && related(e.loc, loc)),
    };
    sub.last = sub.read();
    host._initialSubs.add(sub);
    return () => {
      sub.active = false;
      host._initialSubs.delete(sub);
    };
  }

  /**
   * @internal Tally channel: marks of `slot` at `node` on this scope host
   * (_applyCountDelta moves subtree tallies with rows, _markCount marks any
   * other value a kind keeps per slot). `read` defaults to the subtree tally.
   * Origins: for a key name, the writes of that key inside the subtree.
   */
  _addTallySub(node: AnyNode, slot: Slot, phase: Phase, fn: SubFn, read?: (host: BaseStore<any>) => unknown): Unsubscribe {
    this.assertInScope(node);
    this.root._syncWalk();
    const host = this._host;
    const loc = locOf(host, node);
    const sub: Sub = {
      phase, fn, active: true, last: undefined,
      read: read ? () => read(host) : () => host._countOf(node, slot),
      equals: Object.is,
      origins: (log) => (typeof slot === "string" ? originsWhere(log, (e) => e.key === slot && within(e.loc, loc)) : new Set()),
    };
    sub.last = sub.read();
    let bySlot = host._countSubs.get(node);
    if (!bySlot) host._countSubs.set(node, (bySlot = new Map()));
    let set = bySlot.get(slot);
    if (!set) bySlot.set(slot, (set = new Set()));
    set.add(sub);
    return () => {
      sub.active = false;
      set!.delete(sub);
    };
  }

  // ==========================================================
  // Change detection
  // ==========================================================
  /** @internal */
  _initSeen(focus: unknown = this._read(this.node), attached: boolean = this.isAttached()): void {
    this._seen = { behavior: { focus, attached }, listener: { focus, attached } };
    this._syncSeen = focus;
  }

  /**
   * @internal Compares this store's region with the state seen at the last
   * visit of `phase` and collects the calls to make. Skips the whole subtree
   * when neither the focus value nor the attachment changed.
   */
  _visit(phase: Phase, calls: Calls, log: readonly WriteEntry[] | undefined): void {
    const seen = this._seen[phase];
    const attached = this.isAttached();
    const focus = this._read(this.node);
    const attachChanged = attached !== seen.attached;
    if (!attachChanged && Object.is(focus, seen.focus)) return;
    seen.attached = attached;
    seen.focus = focus;

    for (const subs of this._valueSubs.values()) {
      for (const sub of subs) if (sub.phase === phase) check(sub, calls, log);
    }

    // Rule 4: attachment changed → meta key subscribers re-check (listeners: always fire).
    if (attachChanged) {
      for (const subs of this._keySubs.values()) {
        for (const sub of subs) if (sub.phase === phase) check(sub, calls, log, phase === "listener");
      }
    }

    this._visitChildren(phase, calls, log);
  }

  protected _visitChildren(phase: Phase, calls: Calls, log: readonly WriteEntry[] | undefined): void {
    for (const child of this._children.values()) child._visit(phase, calls, log);
  }

  /** @internal Meta of `node` (owned by this store) changed. */
  _collectMeta(node: AnyNode, phase: Phase, calls: Calls, log: readonly WriteEntry[] | undefined): void {
    const subs = this._keySubs.get(node);
    if (subs) for (const sub of subs) if (sub.phase === phase) check(sub, calls, log);
  }

  /** @internal this = scope host */
  _collectCount(node: AnyNode, slot: Slot, phase: Phase, calls: Calls, log: readonly WriteEntry[] | undefined): void {
    const subs = this._countSubs.get(node)?.get(slot);
    if (subs) for (const sub of subs) if (sub.phase === phase) check(sub, calls, log);
  }

  /** @internal this = scope host */
  _collectInitial(phase: Phase, calls: Calls, log: readonly WriteEntry[] | undefined): void {
    for (const sub of this._initialSubs) if (sub.phase === phase) check(sub, calls, log);
  }

  /** @internal bring array stores in changed regions up to date (row attach/detach → counts) */
  _syncVisit(): void {
    const focus = this._read(this.node);
    if (Object.is(focus, this._syncSeen)) return;
    this._syncSeen = focus;
    this._syncChildren();
  }

  protected _syncChildren(): void {
    for (const child of this._children.values()) child._syncVisit();
  }

  // ==========================================================
  // Checks
  // ==========================================================
  protected assertInScope(node: AnyNode): void {
    for (let n: AnyNode | undefined = node; n !== this.node; n = n.parent) {
      if (n === undefined) {
        throw new Error(`"${node.path ?? "<uninstantiated node>"}" is not part of the store for "${this.node.path || "<root>"}"`);
      }
      if (n.parent instanceof ArrayNode) {
        throw new Error(`"${node.path}" is inside an array item – use the item's store (arrayStore.item(...))`);
      }
    }
  }

  protected assertAttached(): void {
    if (!this.isAttached()) {
      throw new Error(`Store for "${this.node.path}" is detached: its array item was removed or replaced`);
    }
  }
}

// ============================================================
// Root store – owns the value, the baseline, batching and the flush
// ============================================================
export class RootStore<N extends ObjectNode<any>> extends BaseStore<N> implements ScopeHost {
  private value: InferValue<N>;
  private initial: InferValue<N>;
  private depth = 0;
  private flushing = false;
  private phase: "idle" | Phase = "idle";
  private writeLog: WriteEntry[] = [];
  /** @internal */ readonly _runtime: RuntimeHooks;
  /** @internal */ _probe: Probe | undefined;
  private readonly dirtyInitial: Record<Phase, Set<BaseStore<any>>> = { behavior: new Set(), listener: new Set() };
  private readonly dirtyMeta: Record<Phase, Map<BaseStore<any>, Set<AnyNode>>> = { behavior: new Map(), listener: new Map() };
  private readonly dirtyCounts: Record<Phase, Map<BaseStore<any>, Map<AnyNode, Set<Slot>>>> = { behavior: new Map(), listener: new Map() };

  /** @internal – use createStore() */
  constructor(shape: N, initialValues: InferValue<N>, createRuntime: (root: RootStore<N>) => RuntimeHooks) {
    super(shape, undefined);
    if (shape.id === undefined || shape.parent !== undefined) {
      throw new Error("RootStore needs the root returned by form()");
    }
    validateValue(shape, initialValues);
    this.value = initialValues;
    this.initial = initialValues;
    this._initSeen();
    this._runtime = createRuntime(this);
  }

  protected override get scope(): ScopeHost {
    return this;
  }
  protected override get ownsFocusMeta(): boolean {
    return true;
  }
  override get root(): RootStore<any> {
    return this;
  }

  /** @internal */ getScopeValue() {
    return this.value;
  }
  /** @internal */ setScopeValue(value: any) {
    this.value = value;
  }
  /** @internal */ getScopeInitial() {
    return this.initial;
  }
  /** @internal */ setScopeInitial(value: any) {
    this.initial = value;
  }
  /** @internal */ override isAttached() {
    return true;
  }

  // ---- batching ----
  /** @internal */
  _batch<R>(fn: () => R): R {
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
      if (this.depth === 0 && !this.flushing) this.flush();
    }
  }

  /** @internal */
  _assertWritable(): void {
    if (this.phase === "listener") {
      throw new Error("Cannot write while listeners are notified – write derived values with a behavior");
    }
  }

  /** @internal */
  _log(entry: WriteEntry): void {
    this.writeLog.push(entry);
  }

  /** @internal */
  _markMeta(owner: BaseStore<any>, node: AnyNode): void {
    for (const phase of PHASES) {
      const map = this.dirtyMeta[phase];
      let nodes = map.get(owner);
      if (!nodes) map.set(owner, (nodes = new Set()));
      nodes.add(node);
    }
  }

  /** @internal the baseline of a scope host changed */
  _markInitial(host: BaseStore<any>): void {
    for (const phase of PHASES) this.dirtyInitial[phase].add(host);
  }

  /** @internal Add `delta` to `slot` on `node` and every ancestor, across scopes. */
  _applyCountDelta(host: BaseStore<any>, node: AnyNode, slot: Slot, delta: number): void {
    let h = host;
    let from: AnyNode = node;
    for (;;) {
      for (let n: AnyNode | undefined = from; n; n = n.parent) {
        h._bumpCount(n, slot, delta);
        this._markCount(h, n, slot);
        if (n === h.node) break;
      }
      if (!(h instanceof ItemStore) || !h._countedInParent) break;
      from = h.arrayStore.node;
      h = h.arrayStore._host;
    }
  }

  /** @internal the tally `slot` of `node` on `host` changed */
  _markCount(host: BaseStore<any>, node: AnyNode, slot: Slot): void {
    for (const phase of PHASES) {
      const byHost = this.dirtyCounts[phase];
      let byNode = byHost.get(host);
      if (!byNode) byHost.set(host, (byNode = new Map()));
      let slots = byNode.get(node);
      if (!slots) byNode.set(node, (slots = new Set()));
      slots.add(slot);
    }
  }

  /** @internal */
  _syncWalk(): void {
    this._syncVisit();
  }

  private drain(phase: Phase, calls: Calls, log: readonly WriteEntry[] | undefined): void {
    const meta = this.dirtyMeta[phase];
    if (meta.size) {
      this.dirtyMeta[phase] = new Map();
      for (const [owner, nodes] of meta) for (const node of nodes) owner._collectMeta(node, phase, calls, log);
    }
    const initial = this.dirtyInitial[phase];
    if (initial.size) {
      this.dirtyInitial[phase] = new Set();
      for (const host of initial) host._collectInitial(phase, calls, log);
    }
    const counts = this.dirtyCounts[phase];
    if (counts.size) {
      this.dirtyCounts[phase] = new Map();
      for (const [host, byNode] of counts) {
        for (const [node, slots] of byNode) for (const slot of slots) host._collectCount(node, slot, phase, calls, log);
      }
    }
  }

  // ---- flush (rules 5–7) ----
  private flush(): void {
    this.flushing = true;
    const probe = this._probe;
    probe?.flushStart(performance.now());
    try {
      this.depth++; // writes made by behaviors must not start a nested flush
      try {
        for (let round = 0; ; round++) {
          this._syncWalk();
          const log = this.writeLog;
          this.writeLog = [];
          const calls: Calls = [];
          this.drain("behavior", calls, log);
          this._visit("behavior", calls, log);
          if (calls.length === 0 && !this._runtime.hasWork()) break;
          if (round >= MAX_BEHAVIOR_ROUNDS) {
            throw new Error(`Behaviors did not settle after ${MAX_BEHAVIOR_ROUNDS} rounds – check for cycles`);
          }
          for (const call of calls) call();
          // Behaviors: run the pending instances with the lowest rank. Their
          // writes are picked up as triggers in the next round.
          if (this._runtime.hasWork()) this._runtime.runNext();
        }
        this._runtime.flushed();
      } finally {
        this.depth--;
      }
      probe?.behaviorsEnd(performance.now());

      this._syncWalk();
      this.phase = "listener";
      const calls: Calls = [];
      this.drain("listener", calls, undefined);
      this._visit("listener", calls, undefined);

      let failed = false;
      let error: unknown;
      for (const call of calls) {
        try {
          call();
        } catch (e) {
          if (!failed) {
            failed = true;
            error = e;
          }
        }
      }
      if (failed) throw error;
    } finally {
      this.phase = "idle";
      this.flushing = false;
      this.writeLog = [];
      probe?.flushEnd(performance.now());
    }
  }
}

// ============================================================
// Object substore – a view; reads through the parent's scope
// ============================================================
export class ObjectStore<N extends ObjectNode<any>> extends BaseStore<N> {
  /** @internal – use store.substore(node) */
  constructor(node: N, parent: BaseStore<any>) {
    super(node, parent);
  }
}

// ============================================================
// Array substore
// ============================================================
type ItemOf<N extends ArrayNode<any, any>> = N["item"];
type ItemValue<N extends ArrayNode<any, any>> = InferValue<ItemOf<N>> & object;

/** append / insert arguments: a partial item when the array has `create`, a complete one otherwise. */
export type NewItemArgs<N extends ArrayNode<any, any>> = N["_hasCreate"] extends true
  ? [partial?: Partial<ItemValue<N>>, options?: WriteOptions]
  : [item: ItemValue<N>, options?: WriteOptions];

const EMPTY: readonly never[] = Object.freeze([]);
let stableIdCounter = 0;

/** A walk over the rows: the sync walk, or a phase's visit. */
type Walk = "sync" | Phase;
const WALKS: readonly Walk[] = ["sync", ...PHASES];

export class ArrayStore<N extends ArrayNode<any, any>> extends BaseStore<N> {
  private readonly itemStores = new WeakMap<object, ItemStore<ItemOf<N>>>();
  private sequence: readonly ItemStore<ItemOf<N>>[] = EMPTY;
  private syncedArray: readonly object[] | undefined;
  private members = new Set<object>();
  private baseline: { array: readonly object[]; set: Set<object> } | undefined;
  private readonly itemsSubs = new Set<Sub<readonly ItemStore<ItemOf<N>>[]>>();
  private createdSince: Record<Phase, ItemStore<any>[]> = { behavior: [], listener: [] };
  /** Per walk: the sequence it last walked, and the rows whose object changed since. */
  private walked: Record<Walk, readonly ItemStore<any>[]> = { sync: EMPTY, behavior: EMPTY, listener: EMPTY };
  private readonly rewritten: Record<Walk, Set<ItemStore<any>>> = { sync: new Set(), behavior: new Set(), listener: new Set() };

  /** @internal – use store.substore(node) */
  constructor(node: N, parent: BaseStore<any>) {
    super(node, parent);
  }

  /** Current array value ([] when unset or detached). */
  current(): readonly ItemValue<N>[] {
    return (this._read(this.node) as ItemValue<N>[] | undefined) ?? EMPTY;
  }

  /** Stores for all current items, in array order. Same array until the sequence changes. */
  readonly items = (): readonly ItemStore<ItemOf<N>>[] => this._sync();

  /** Fires only when the sequence of item stores changes (rule 3). */
  readonly subscribeItems = (listener: Listener): Unsubscribe => {
    const sub: Sub<readonly ItemStore<ItemOf<N>>[]> = {
      phase: "listener",
      active: true,
      last: this.items(),
      read: () => this._sync(),
      equals: Object.is,
      fn: () => listener(),
      origins: () => new Set(),
    };
    this.itemsSubs.add(sub);
    return () => {
      sub.active = false;
      this.itemsSubs.delete(sub);
    };
  };

  /** Store for an item object that is currently in the array. */
  item(ref: ItemValue<N>): ItemStore<ItemOf<N>> {
    this._sync();
    if (!this.members.has(ref)) {
      throw new Error(`item(): the object is not currently in "${this.node.path}"`);
    }
    return this.itemStores.get(ref)!;
  }

  itemAt(index: number): ItemStore<ItemOf<N>> {
    const seq = this._sync();
    if (index < 0 || index >= seq.length) {
      throw new RangeError(`itemAt(${index}): "${this.node.path}" has ${seq.length} items`);
    }
    return seq[index];
  }

  // ---- helpers ----
  append(...args: NewItemArgs<N>): ItemStore<ItemOf<N>> {
    return this.insert(this.current().length, ...args);
  }

  insert(index: number, ...args: NewItemArgs<N>): ItemStore<ItemOf<N>> {
    const [input, options] = args as [ItemValue<N> | undefined, WriteOptions | undefined];
    const arr = this.current();
    if (index < 0 || index > arr.length) {
      throw new RangeError(`insert(${index}): "${this.node.path}" has ${arr.length} items`);
    }
    const item = this.newItem(input);
    const next = arr.slice();
    next.splice(index, 0, item);
    this._setValue(this.node, next as any, options);
    // Behaviors may already have edited the new row during the flush, which
    // moves its store to a new object; the original object still maps to it.
    return this.itemStores.get(item) ?? this.item(item);
  }

  remove(row: ItemStore<ItemOf<N>>, options?: WriteOptions): void {
    const arr = this.current();
    const index = this.indexOfRow(row, arr);
    this._setValue(this.node, arr.filter((_, i) => i !== index) as any, options);
  }

  move(row: ItemStore<ItemOf<N>>, toIndex: number, options?: WriteOptions): void {
    const arr = this.current();
    const from = this.indexOfRow(row, arr);
    if (toIndex < 0 || toIndex >= arr.length) {
      throw new RangeError(`move(…, ${toIndex}): "${this.node.path}" has ${arr.length} items`);
    }
    if (from === toIndex) return;
    const next = arr.slice();
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved);
    this._setValue(this.node, next as any, options);
  }

  private indexOfRow(row: ItemStore<any>, arr: readonly object[]): number {
    if (row.arrayStore !== (this as unknown)) throw new Error(`The row does not belong to "${this.node.path}"`);
    const index = arr.indexOf(row._currentRef as object);
    if (index === -1) throw new Error(`The row is detached from "${this.node.path}"`);
    return index;
  }

  private newItem(input: ItemValue<N> | undefined): ItemValue<N> {
    const create = this.node[CREATE];
    if (create) return { ...(create() as object), ...(input ?? {}) } as ItemValue<N>;
    if (input === undefined) {
      throw new Error(`"${this.node.path}" has no \`create\` factory – pass a complete item`);
    }
    return input;
  }

  // ---- internals ----
  /** @internal */
  _contains(ref: unknown): boolean {
    this._sync();
    return this.members.has(ref as object);
  }

  /** @internal Is `ref` part of this array's baseline (initial value)? */
  _baselineHas(ref: object): boolean {
    const arr = this.node.lens.get(this.scope.getScopeInitial()) as readonly object[] | undefined;
    if (!arr) return false;
    if (this.baseline?.array !== arr) this.baseline = { array: arr, set: new Set(arr) };
    return this.baseline.set.has(ref);
  }

  /**
   * @internal Reconciles item stores with the current array value (once per
   * array reference) and keeps subtree counts in step with rows that detach
   * or re-attach.
   */
  private _sync(): readonly ItemStore<ItemOf<N>>[] {
    const arr = this.current() as readonly object[];
    if (arr === this.syncedArray) return this.sequence;

    const members = new Set(arr);
    const next = arr.map((ref) => {
      let store = this.itemStores.get(ref);
      if (store && store._currentRef !== ref) {
        if (members.has(store._currentRef as object)) store = undefined;
        else {
          store._currentRef = ref;
          this.markRewritten(store);
        }
      }
      if (!store) {
        store = new ItemStore<ItemOf<N>>(this, ref, `i${stableIdCounter++}`, this._baselineHas(ref) ? ref : {});
        store._initSeen(ref, true);
        this.itemStores.set(ref, store);
        for (const phase of PHASES) this.createdSince[phase].push(store);
      }
      return store;
    });

    const prev = this.sequence;
    const same = next.length === prev.length && next.every((s, i) => s === prev[i]);
    this.syncedArray = arr;
    this.members = members;
    if (!same) {
      this.sequence = Object.freeze(next);
      const nextSet = new Set(next);
      for (const store of prev) if (!nextSet.has(store) && store._counted) this.shiftTotals(store, false);
      for (const store of next) if (!store._counted) this.shiftTotals(store, true);
    }
    return this.sequence;
  }

  /**
   * The synced array `row` was in now holds `row` as `arr`, the row's new
   * object instead of `prev`: the same rows in the same order. Brings the
   * sync up to date in place rather than rebuilding it from `arr`.
   */
  private syncReplaced(row: ItemStore<any>, prev: object, arr: readonly object[]): void {
    this.members.delete(prev);
    this.members.add(row._currentRef as object);
    this.syncedArray = arr;
    this.markRewritten(row);
  }

  /** Add or remove a row's subtree counts from the enclosing scopes. */
  private shiftTotals(row: ItemStore<any>, attach: boolean): void {
    row._counted = attach;
    const totals = row._counts.get(row.node);
    if (!totals) return;
    for (const [slot, count] of totals) {
      this.root._applyCountDelta(this._host, this.node, slot, attach ? count : -count);
    }
  }

  /** A row now has another object: every walk looks at it, even when the sequence is the same. */
  private markRewritten(row: ItemStore<any>): void {
    for (const walk of WALKS) this.rewritten[walk].add(row);
  }

  /**
   * The rows `walk` goes through now, in array order; `seq` is the current
   * sequence. Records this pass: the next one starts from here.
   * - `seq` is the sequence of the walk's last pass: no row attached or
   *   detached since, so only the rewritten rows can have changed. A row
   *   write costs its row, not every row.
   * - Otherwise every row in `seq`; a visit also takes the rows of its last
   *   pass and the rows created since, which may have just detached (rule 4).
   */
  private rowsToWalk(walk: Walk, seq: readonly ItemStore<any>[]): readonly ItemStore<any>[] {
    const rewritten = this.rewritten[walk];
    const previous = this.walked[walk];
    let rows: readonly ItemStore<any>[];
    if (seq === previous) {
      // No rewritten row, or one (the usual row write): no scan of the sequence.
      rows = rewritten.size < 2 ? [...rewritten] : seq.filter((row) => rewritten.has(row));
    } else if (walk === "sync") {
      rows = seq;
    } else {
      // Each store created since the last pass changed the sequence: it is taken here.
      rows = [...new Set([...seq, ...previous, ...this.createdSince[walk]])];
      this.createdSince[walk] = [];
    }
    rewritten.clear();
    this.walked[walk] = seq;
    return rows;
  }

  protected override _syncChildren(): void {
    for (const row of this.rowsToWalk("sync", this._sync())) row._syncVisit();
  }

  override _refreshInitials(): void {
    for (const row of this._sync()) {
      if (this._baselineHas(row._currentRef as object) && row._initial !== row._currentRef) {
        row._initial = row._currentRef as object;
        this.root._markInitial(row);
      }
      row._refreshInitials();
    }
  }

  override _resetAllMeta(): void {
    for (const row of this._sync()) row._resetAllMeta();
  }

  protected override _visitChildren(phase: Phase, calls: Calls, log: readonly WriteEntry[] | undefined): void {
    for (const store of this.rowsToWalk(phase, this._sync())) store._visit(phase, calls, log);

    if (phase === "listener") {
      for (const sub of this.itemsSubs) check(sub, calls, undefined);
    }
  }

  /**
   * @internal Called by an ItemStore that produced a new version of its item.
   * Transfers the store (with its meta, substores, subscriptions and initial
   * value) to the new reference.
   */
  _replaceItem(store: ItemStore<ItemOf<N>>, next: unknown): void {
    this.assertAttached();
    const prev = store._currentRef;
    if (next === prev) return;

    const arr = this.current();
    const index = arr.indexOf(prev as ItemValue<N>);
    if (index === -1) {
      throw new Error(`Store for "${this.node.item.path}" is detached: its item was removed or replaced`);
    }
    if (typeof next !== "object" || next === null) {
      throw new TypeError(`"${this.node.path}" items must be objects`);
    }
    if (this._contains(next)) {
      throw new Error(`"${this.node.path}" would contain the same object twice`);
    }
    validateValue(this.node.item, next);

    const nextArr = arr.slice();
    nextArr[index] = next as ItemValue<N>;

    this.itemStores.set(next, store);
    store._currentRef = next;
    this._write(this.node, nextArr);
    this.syncReplaced(store, prev as object, nextArr);
  }
}

// ============================================================
// Item store – a scope: node lenses inside the item template are
// resolved against the current item object (and its initial value).
// ============================================================
export class ItemStore<N extends ObjectNode<any>> extends BaseStore<N> implements ScopeHost {
  /** Stable for the lifetime of the item (survives edits and reordering). Use as React key. */
  readonly stableId: string;
  /** @internal */ _currentRef: unknown;
  /** @internal the row's baseline: its loaded object, or {} for rows added later */ _initial: object;
  /** @internal are this row's counts included in the enclosing scopes? */ _counted = true;

  /** @internal – use arrayStore.item(ref) / items() */
  constructor(arrayStore: ArrayStore<any>, ref: object, stableId: string, initial: object) {
    super(arrayStore.node.item, arrayStore);
    this._currentRef = ref;
    this.stableId = stableId;
    this._initial = initial;
  }

  get arrayStore(): ArrayStore<any> {
    return this.parentStore as ArrayStore<any>;
  }

  protected override get scope(): ScopeHost {
    return this;
  }
  protected override get ownsFocusMeta(): boolean {
    return true;
  }
  override get _countedInParent(): boolean {
    return this._counted;
  }

  override isAttached(): boolean {
    return this.arrayStore.isAttached() && this.arrayStore._contains(this._currentRef);
  }

  /** @internal */ getScopeValue() {
    return this.isAttached() ? this._currentRef : undefined;
  }
  /** @internal */ setScopeValue(next: any) {
    this.arrayStore._replaceItem(this, next);
  }
  /** @internal */ getScopeInitial() {
    return this._initial;
  }
  /** @internal */ setScopeInitial(value: any) {
    this._initial = value;
  }
}

// ============================================================
// Structural checks required by reference identity.
// The only runtime validation: arrays must be arrays of distinct,
// non-null objects. Field values are never checked.
// ============================================================
export function validateValue(node: AnyNode, value: unknown): void {
  if (value == null) return;

  if (node instanceof ArrayNode) {
    if (!Array.isArray(value)) throw new TypeError(`"${node.path}" must be an array`);
    const seen = new Set<object>();
    value.forEach((item, i) => {
      if (typeof item !== "object" || item === null) {
        throw new TypeError(`"${node.path}[${i}]" must be an object – arrays of primitives are not supported`);
      }
      if (seen.has(item)) throw new Error(`"${node.path}" contains the same object twice (index ${i})`);
      seen.add(item);
      validateValue(node.item, item);
    });
    return;
  }

  if (node instanceof ObjectNode && typeof value === "object") {
    for (const [key, child] of Object.entries(node[FIELDS] as Record<string, AnyNode>)) {
      validateValue(child, (value as any)[key]);
    }
  }
}
