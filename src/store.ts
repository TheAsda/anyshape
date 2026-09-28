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
// References (stage 2):
//   • get / set / subscribe / react accept a node (value), a MetaRef (one
//     meta key) or a CountRef (countIn(node, key), read-only).
//   • Inherited keys (visible / disabled): get(ref) returns the effective
//     value; getOwn(ref) the value written on the node itself.
//   • Non-reactive keys (focusTarget) are stored in place: no flush, no
//     notification, allowed on detached stores, kept by reset().
//
// Writes carry an origin: "user" | "program" (default) | "initial" |
// "behavior:<id>". { as: "initial" } writes the value and its baseline.
// Reactions receive the origins of the writes that changed their target.
//
// Notification rules (unchanged):
//   1. A value subscription fires when its value is no longer Object.is-equal
//      to the value at its last notification.
//   2. Values and meta are separate channels; meta does not bubble.
//   3. ArrayStore.subscribeItems fires only when the sequence of item stores
//      changes; items() returns the same array until then.
//   4. When an item store's attachment changes, all its subscribers fire.
//   5. store.subscribe(listener) fires for anything inside the store's focus.
//   6. Every write is a batch of one; batch(fn) groups writes; notifications
//      run when the outermost batch ends.
//   7. The flush is synchronous.
//   8. Reactions run first (repeating until settled, max MAX_REACTION_ROUNDS),
//      then UI listeners once; writing during the UI phase throws.
//   9. UI listeners are () => void; reactions get (next, prev, info).
// ============================================================

import type { Meta } from "./meta";
import type { AnyBehavior, BehaviorHandle } from "./behaviors";
import type { ValidationHooks, ValidationResult } from "./validation";
import type { FocusTarget } from "./features";
import {
  ShapeNode, ObjectNode, ArrayNode, MetaRef,
  type AnyNode, type ContainerNode, type InferValue, type InferMeta,
} from "./shape";

export type Listener = () => void;
export type Unsubscribe = () => void;

export type Origin = "user" | "program" | "initial" | `behavior:${string}`;

export interface WriteOptions {
  /** Who made the write. Default "program". */
  origin?: Origin;
  /** "initial": also set the baseline (getInitial / dirty / reset). Values only. */
  as?: "initial";
}

export interface ChangeInfo {
  /** Origins of the writes that changed this reaction's target since its last run. */
  readonly origins: ReadonlySet<Origin>;
}

/** Live meta: exactly the keys declared on the node (meta is closed). */
export type LiveMeta<N> = InferMeta<N>;

/**
 * Accepted by setMeta: a subset of the declared keys. A node without declared
 * meta accepts no keys at all (a bare `{}` type would accept anything).
 */
export type MetaPatch<N> = [keyof InferMeta<N>] extends [never] ? Record<string, never> : Partial<InferMeta<N>>;

// ============================================================
// Count references
// ============================================================
/** Number of nodes in a subtree (the node itself included) whose `key` counts (see metaKey `aggregate`). */
export class CountRef {
  /** Nominal brand: a MetaRef has the same public shape and must not match. */
  private readonly _countRef = true;
  constructor(readonly node: AnyNode, readonly key: string) {}
  get path(): string {
    return `${this.node.path ?? ""}#count(${this.key})`;
  }
}

const countRefs = new WeakMap<AnyNode, Map<string, CountRef>>();

/** Count reference; the same instance for the same (node, key), so it can be used as a hook dependency. */
export function countIn(node: AnyNode, key: string): CountRef {
  let byKey = countRefs.get(node);
  if (!byKey) countRefs.set(node, (byKey = new Map()));
  let ref = byKey.get(key);
  if (!ref) byKey.set(key, (ref = new CountRef(node, key)));
  return ref;
}

export interface FocusOptions {
  /** Order entries by their focus targets, e.g. by position on the page. */
  compare?: (a: FocusTarget, b: FocusTarget) => number;
}

export interface SubmitOptions {
  /** Focus the first error when invalid. Default true; FocusOptions to order the errors. */
  focus?: boolean | FocusOptions;
}

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
}

const initialRefs = new WeakMap<AnyNode, InitialRef<any>>();

/** Initial-value reference; the same instance for the same node. */
export function initialOf<N extends AnyNode>(node: N): InitialRef<InferValue<N>> {
  let ref = initialRefs.get(node);
  if (!ref) initialRefs.set(node, (ref = new InitialRef(node)));
  return ref;
}

export type AnyRef = AnyNode | MetaRef<any> | CountRef | InitialRef<any>;
export type RefValue<R> = R extends CountRef ? number : R extends InitialRef<infer V> ? V : InferValue<R>;

export interface CollectEntry {
  /** Concrete path with row indexes, e.g. "lines[2].qty". */
  path: string;
  /** The node (template node for rows). */
  ref: AnyNode;
  /** A store that can address `ref` (root or item store). */
  store: BaseStore<any>;
}

export const MAX_REACTION_ROUNDS = 100;

/** @internal Installed on the root by the behavior runtime (behaviors.ts). */
export interface RuntimeHooks {
  hasWork(): boolean;
  runNext(): void;
  add(host: BaseStore<any>, behaviors: AnyBehavior | readonly AnyBehavior[]): BehaviorHandle;
  replace(previous: BehaviorHandle, behaviors: AnyBehavior | readonly AnyBehavior[]): BehaviorHandle;
  /** After reset(node) on `store`: re-run (as init) every instance that writes inside the reset part. */
  reinit(store: BaseStore<any>, node: AnyNode): void;
}

// ============================================================
// Internals: phases, subscriptions, write log
// ============================================================
type Phase = "reaction" | "ui";
const PHASES: readonly Phase[] = ["reaction", "ui"];
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

interface Seen {
  focus: unknown;
  attached: boolean;
}
type Calls = (() => void)[];
type StoreSet = Set<BaseStore<any>>;

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

function isAncestorOrSelf(ancestor: AnyNode, node: AnyNode): boolean {
  for (let n: AnyNode | undefined = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
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

/** Concrete path with row indexes, e.g. "lines[2].notes[0].text". */
function concretePath(host: BaseStore<any>, node: AnyNode): string {
  if (!(host instanceof ItemStore)) return node.path;
  const arr = host.arrayStore;
  const index = (arr.current() as readonly unknown[]).indexOf(host._currentRef);
  const relative = node.path.slice(host.node.path.length);
  return `${concretePath(arr._host, arr.node)}[${index}]${relative}`;
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

function shallowEqual(a: Meta, b: Meta): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
}

// ============================================================
// Base store – shared by all store kinds
// ============================================================
export abstract class BaseStore<N extends ContainerNode> {
  /** @internal live meta per node owned by this store */
  readonly _metaMap = new Map<AnyNode, Meta>();
  /** @internal */ readonly _valueSubs = new Map<AnyNode, Set<Sub>>();
  /** @internal whole-meta subscriptions */ readonly _metaSubs = new Map<AnyNode, Set<Sub>>();
  /** @internal single-key subscriptions, registered on every source node */ readonly _keySubs = new Map<AnyNode, Set<Sub>>();
  /** @internal scope hosts only */ readonly _countSubs = new Map<AnyNode, Map<string, Set<Sub>>>();
  /** @internal scope hosts only: node → key → count (node itself + descendants) */ readonly _counts = new Map<AnyNode, Map<string, number>>();
  /** @internal */ readonly _storeSubs = new Set<Listener>();
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
  /** Value of a node, value of a meta key (effective for inherited keys) or a count. */
  get<R extends AnyRef>(ref: R): RefValue<R> {
    if (ref instanceof CountRef) {
      this.assertInScope(ref.node);
      this.root._syncWalk();
      return this._host._countOf(ref.node, ref.key) as RefValue<R>;
    }
    if (ref instanceof MetaRef) {
      this.assertInScope(ref.node);
      return this._readMetaRef(ref);
    }
    if (ref instanceof InitialRef) return this.getInitial(ref.node) as RefValue<R>;
    return this.getValue(ref as AnyNode);
  }

  /** The value written on the node itself, ignoring inheritance. */
  getOwn<V>(ref: MetaRef<V>): V {
    return (this.getMeta(ref.node) as Meta)[ref.key] as V;
  }

  set<R extends AnyNode | MetaRef<any>>(ref: R, value: InferValue<R>, options?: WriteOptions): void {
    if ((ref as unknown) instanceof CountRef) throw new Error("Counts are read-only");
    if ((ref as unknown) instanceof InitialRef) throw new Error('Initial values are written with { as: "initial" }');
    if (ref instanceof MetaRef) {
      this.setMeta(ref.node, { [ref.key]: value } as any, options);
      return;
    }
    this.setValue(ref as ShapeNode<any, any>, value, options);
  }

  // ==========================================================
  // Values
  // ==========================================================
  getValue<T>(node: ShapeNode<T, any>): T {
    this.assertInScope(node);
    return this._read(node);
  }

  setValue<T>(node: ShapeNode<T, any>, value: T, options: WriteOptions = {}): void {
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

  getInitial<T>(node: ShapeNode<T, any>): T {
    this.assertInScope(node);
    return node.lens.get(this.scope.getScopeInitial());
  }

  /** Restore values to their initial state and meta to defaults (non-reactive keys are kept). */
  reset(node: AnyNode = this.node): void {
    this.assertInScope(node);
    this.root._batch(() => {
      this.assertAttached();
      const initial = node.lens.get(this.scope.getScopeInitial());
      this.root._log({ loc: locOf(this._host, node), origin: "initial" });
      this._write(node, initial);
      this._resetMeta(node);
      // Behavior-written meta (errors, disabled flags, ...) was reset to its
      // defaults: recompute it as if the form were created with these values.
      this.root._runtime?.reinit(this, node);
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
  /** Own (non-inherited) meta of a node. */
  getMeta<M extends AnyNode>(node: M): LiveMeta<M> {
    this.assertInScope(node);
    return this._ownerOf(node)._metaOf(node) as LiveMeta<M>;
  }

  setMeta<M extends AnyNode>(node: M, partial: MetaPatch<M>, options: WriteOptions = {}): void {
    this.assertInScope(node);
    if (options.as) throw new Error('`as: "initial"` applies to values only');
    const patch = partial as Meta;
    const quiet: string[] = [];
    const loud: string[] = [];
    for (const key of Object.keys(patch)) {
      const def = node._metaDefs[key];
      if (!def) throw new Error(`"${node.path || "<root>"}" has no meta key "${key}" – declare it with .meta()`);
      (def.options.reactive === false ? quiet : loud).push(key);
    }
    const owner = this._ownerOf(node);

    // Non-reactive keys: stored in place, never notify, allowed when detached.
    if (quiet.length) {
      const live = owner._metaOf(node);
      for (const key of quiet) live[key] = patch[key];
    }
    if (!loud.length) return;

    const origin: Origin = options.origin ?? "program";
    this.root._batch(() => {
      this.root._assertWritable();
      this.assertAttached();
      const current = owner._metaOf(node);
      if (loud.every((k) => Object.is(current[k], patch[k]))) return;
      const next = { ...current };
      for (const key of loud) next[key] = patch[key];
      owner._commitMeta(node, current, next, origin);
    });
  }

  /** @internal replace a node's meta object: counts, dirty marks, log */
  _commitMeta(node: AnyNode, current: Meta, next: Meta, origin: Origin): void {
    const host = this._host;
    const changed: string[] = [];
    for (const key of Object.keys(next)) {
      if (Object.is(current[key], next[key])) continue;
      changed.push(key);
      const aggregate = node._metaDefs[key]?.options.aggregate;
      if (aggregate) {
        const delta = (aggregate(next[key]) ? 1 : 0) - (aggregate(current[key]) ? 1 : 0);
        if (delta) this.root._applyCountDelta(host, node, key, delta);
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
      const seeded: Meta = { ...node._meta };
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

  /** Nodes whose `key` feeds the value of `ref`: the node itself, plus ancestors for inherited keys. */
  private _metaSources(ref: MetaRef<any>): LocLevel[] {
    if (!ref.def.options.inherit) return [{ host: this._host, node: ref.node }];
    const out: LocLevel[] = [];
    let host = this._host;
    let from: AnyNode = ref.node;
    for (;;) {
      for (let n: AnyNode | undefined = from; n; n = n.parent) {
        if (ref.key in n._metaDefs) out.push({ host, node: n });
        if (n === host.node) break;
      }
      if (!(host instanceof ItemStore)) break;
      from = host.arrayStore.node;
      host = host.arrayStore._host;
    }
    return out;
  }

  private _readMetaRef(ref: MetaRef<any>): any {
    const inherit = ref.def.options.inherit;
    if (!inherit) return (this.getMeta(ref.node) as Meta)[ref.key];
    const values = this._metaSources(ref).map((s) => (s.host.getMeta(s.node) as Meta)[ref.key]);
    return inherit === "all" ? values.every(Boolean) : values.some(Boolean);
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
    const next: Meta = { ...node._meta };
    for (const [key, def] of Object.entries(node._metaDefs)) {
      if (def.options.reactive === false || def.options.keepOnReset) next[key] = current[key];
    }
    if (shallowEqual(current, next)) return;
    this._commitMeta(node, current, next, "initial");
  }

  // ==========================================================
  // Counts
  // ==========================================================
  /** @internal */
  _countOf(node: AnyNode, key: string): number {
    return this._counts.get(node)?.get(key) ?? 0;
  }

  /** @internal */
  _bumpCount(node: AnyNode, key: string, delta: number): void {
    let byKey = this._counts.get(node);
    if (!byKey) this._counts.set(node, (byKey = new Map()));
    const value = (byKey.get(key) ?? 0) + delta;
    if (value) byKey.set(key, value);
    else byKey.delete(key);
  }

  /** Nodes in the subtree whose `key` currently counts, with concrete paths. Skips subtrees with count 0. */
  collect(node: AnyNode, key: string): CollectEntry[] {
    this.assertInScope(node);
    this.root._syncWalk();
    const out: CollectEntry[] = [];
    this._host._collectIn(node, key, out);
    return out;
  }

  /** @internal this = scope host */
  _collectIn(node: AnyNode, key: string, out: CollectEntry[]): void {
    if (this._countOf(node, key) === 0) return;
    const aggregate = node._metaDefs[key]?.options.aggregate;
    if (aggregate && aggregate((this.getMeta(node) as Meta)[key])) {
      out.push({ path: concretePath(this, node), ref: node, store: this });
    }
    if (node instanceof ObjectNode) {
      for (const child of Object.values(node._fields as Record<string, AnyNode>)) this._collectIn(child, key, out);
    } else if (node instanceof ArrayNode && node !== this.node) {
      for (const row of (this.substore(node as any) as ArrayStore<any>).items()) row._collectIn(row.node, key, out);
    }
  }

  /** @internal this = scope host: every node in the subtree that declares `key`, rows included */
  _eachWithKey(node: AnyNode, key: string, fn: (store: BaseStore<any>, node: AnyNode) => void): void {
    if (key in node._metaDefs) fn(this, node);
    if (node instanceof ObjectNode) {
      for (const child of Object.values(node._fields as Record<string, AnyNode>)) this._eachWithKey(child, key, fn);
    } else if (node instanceof ArrayNode && node !== this.node) {
      for (const row of (this.substore(node as any) as ArrayStore<any>).items()) row._eachWithKey(row.node, key, fn);
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
    return this._runtimeOrThrow().add(this._host, behaviors);
  }

  /**
   * Swap the behaviors registered by `previous` for `behaviors` in one
   * transaction, on the store `previous` was registered on. If a check fails,
   * `previous` stays registered. Returns the new handle.
   */
  replaceBehavior(previous: BehaviorHandle, behaviors: AnyBehavior | readonly AnyBehavior[]): BehaviorHandle {
    return this._runtimeOrThrow().replace(previous, behaviors);
  }

  private _runtimeOrThrow(): RuntimeHooks {
    const runtime = this.root._runtime;
    if (!runtime) throw new Error("This store has no behavior runtime – create it with createStore()");
    return runtime;
  }

  // ==========================================================
  // Validation, focus, submit
  // ==========================================================
  /**
   * Run every validation queue inside `node` (default: this store's node),
   * including async checks that are debounced or were never run, wait for
   * them, and return { valid, errors, failures, values }.
   */
  validate<X extends AnyNode = N & AnyNode>(node?: X): Promise<ValidationResult<X>> {
    const target = (node ?? this.node) as AnyNode;
    this.assertInScope(target);
    const hooks = this.root._validation;
    if (!hooks) throw new Error("This store has no validation – create it with createStore()");
    return hooks.validate(this, target) as Promise<ValidationResult<X>>;
  }

  /** The node's registered focus target, if any. */
  focusTargetOf(node: AnyNode): FocusTarget | undefined {
    this.assertInScope(node);
    if (!("focusTarget" in node._metaDefs)) return undefined;
    return this._ownerOf(node)._metaOf(node).focusTarget as FocusTarget | undefined;
  }

  /** Focus the node's registered focus target. Returns false when there is none. */
  focus(node: AnyNode): boolean {
    const target = this.focusTargetOf(node);
    if (!target) return false;
    target.focus();
    target.scrollIntoView?.();
    return true;
  }

  /**
   * Focus the first entry (e.g. result.errors) that has a focus target. By
   * default entries keep their order (shape order); `compare` orders them by
   * their targets instead, e.g. by position on the page. Falls back to the
   * store's `focusOrder` (createStore option).
   */
  focusFirst<E extends CollectEntry>(entries: readonly E[], options: FocusOptions = {}): E | undefined {
    const compare = options.compare ?? this.root._focusOrder;
    const candidates = entries
      .map((entry, index) => ({ entry, index, target: entry.store.isAttached() ? entry.store.focusTargetOf(entry.ref) : undefined }))
      .filter((c): c is { entry: E; index: number; target: FocusTarget } => c.target !== undefined);
    if (compare) candidates.sort((a, b) => compare(a.target, b.target) || a.index - b.index);
    const first = candidates[0];
    if (!first) return undefined;
    first.target.focus();
    first.target.scrollIntoView?.();
    return first.entry;
  }

  /**
   * Submit flow: increments `submitCount` and sets `submitting` (when the root
   * declares submission()), sets `revealed` on every node in this store's
   * subtree that declares it (reveal()), validates the subtree, then calls
   * `onValid(values)`, or focuses the first error and calls `onInvalid(result)`.
   * While a submit of this store is running, further calls return it.
   */
  submit(
    onValid?: (values: ValidationResult<N & AnyNode>["values"]) => unknown | Promise<unknown>,
    onInvalid?: (result: ValidationResult<N & AnyNode>) => unknown | Promise<unknown>,
    options: SubmitOptions = {}
  ): Promise<ValidationResult<N & AnyNode>> {
    if (this._submitRun) return this._submitRun;
    const run = this._submit(onValid, onInvalid, options).finally(() => {
      this._submitRun = undefined;
    });
    this._submitRun = run;
    return run;
  }

  /** submit() as an event handler: calls event.preventDefault() first. */
  handleSubmit(
    onValid?: (values: ValidationResult<N & AnyNode>["values"]) => unknown | Promise<unknown>,
    onInvalid?: (result: ValidationResult<N & AnyNode>) => unknown | Promise<unknown>,
    options: SubmitOptions = {}
  ): (event?: { preventDefault?(): void }) => Promise<ValidationResult<N & AnyNode>> {
    return (event) => {
      event?.preventDefault?.();
      return this.submit(onValid, onInvalid, options);
    };
  }

  private _submitRun: Promise<ValidationResult<N & AnyNode>> | undefined;

  private async _submit(
    onValid: ((values: any) => unknown) | undefined,
    onInvalid: ((result: any) => unknown) | undefined,
    options: SubmitOptions
  ): Promise<ValidationResult<N & AnyNode>> {
    const root = this.root;
    const rootNode = root.node as AnyNode;
    const has = (key: string) => key in rootNode._metaDefs;
    const patch = (values: Meta) => root.setMeta(rootNode, values as never);
    root.batch(() => {
      if (has("submitCount")) patch({ submitCount: ((root.getMeta(rootNode) as Meta).submitCount as number) + 1 });
      if (has("submitting")) patch({ submitting: true });
      this._host._eachWithKey(this.node, "revealed", (store, node) => store.setMeta(node, { revealed: true } as never));
    });
    try {
      const result = await this.validate();
      if (result.valid) {
        await onValid?.(result.values);
      } else {
        if (options.focus !== false) this.focusFirst(result.errors, options.focus === true || options.focus === undefined ? {} : options.focus);
        await onInvalid?.(result);
      }
      return result;
    } finally {
      if (has("submitting")) patch({ submitting: false });
    }
  }

  // ==========================================================
  // Paths
  // ==========================================================
  /**
   * Resolve a concrete path from the form root – "lines[1].qty", or with a
   * meta key "lines[1].qty#error" – to a store that can address it and its
   * reference. undefined when the path does not exist (unknown field, row
   * index out of range).
   */
  resolvePath(path: string): { store: BaseStore<any>; ref: AnyNode | MetaRef<any> } | undefined {
    const hash = path.indexOf("#");
    const valuePath = hash === -1 ? path : path.slice(0, hash);
    const key = hash === -1 ? undefined : path.slice(hash + 1);
    if (valuePath !== "" && !/^[^.[\]]+(?:\[\d+\])*(?:\.[^.[\]]+(?:\[\d+\])*)*$/.test(valuePath)) return undefined;
    const tokens = valuePath.match(/[^.[\]]+|\[\d+\]/g) ?? [];

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
        if (!(node instanceof ObjectNode) || !Object.prototype.hasOwnProperty.call(node._fields, token)) return undefined;
        node = (node._fields as Record<string, AnyNode>)[token];
      }
    }
    if (key === undefined) return { store, ref: node };
    if (!(key in node._metaDefs)) return undefined;
    return { store, ref: new MetaRef(node, key) };
  }

  // ==========================================================
  // Substores
  // ==========================================================
  substore<S extends ObjectNode<any, any>>(node: S): ObjectStore<S>;
  substore<S extends ArrayNode<any, any, any>>(node: S): ArrayStore<S>;
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
  /** Store-wide (rule 5), or one reference (node value, meta key, count). */
  subscribe(listener: Listener): Unsubscribe;
  subscribe(ref: AnyRef, listener: Listener): Unsubscribe;
  subscribe(a: Listener | AnyRef, b?: Listener): Unsubscribe {
    if (typeof a === "function") {
      this._storeSubs.add(a);
      return () => void this._storeSubs.delete(a);
    }
    return this._addRefSub(a, "ui", () => b!());
  }

  subscribeValue(node: AnyNode, listener: Listener): Unsubscribe {
    return this._addRefSub(node, "ui", () => listener());
  }

  /** Whole (own) meta object of a node. */
  subscribeMeta(node: AnyNode, listener: Listener): Unsubscribe {
    return this._addMetaSub(node, "ui", () => listener());
  }

  /** Reaction phase: may write; receives next, prev and the origins of the change. */
  react<R extends AnyRef>(ref: R, fn: (next: RefValue<R>, prev: RefValue<R>, info: ChangeInfo) => void): Unsubscribe {
    return this._addRefSub(ref, "reaction", fn as any);
  }

  reactMeta<M extends AnyNode>(node: M, fn: (next: LiveMeta<M>, prev: LiveMeta<M>, info: ChangeInfo) => void): Unsubscribe {
    return this._addMetaSub(node, "reaction", fn as any);
  }

  private _addRefSub(ref: AnyRef, phase: Phase, fn: Sub["fn"]): Unsubscribe {
    if (ref instanceof CountRef) return this._addCountSub(ref, phase, fn);
    if (ref instanceof MetaRef) return this._addKeySub(ref, phase, fn);
    if (ref instanceof InitialRef) return this._addInitialSub(ref, phase, fn);
    return this._addValueSub(ref, phase, fn);
  }

  private _addValueSub(node: AnyNode, phase: Phase, fn: Sub["fn"]): Unsubscribe {
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

  private _addMetaSub(node: AnyNode, phase: Phase, fn: Sub["fn"]): Unsubscribe {
    this.assertInScope(node);
    const owner = this._ownerOf(node);
    const host = owner._host;
    const sub: Sub = {
      phase, fn, active: true, last: undefined,
      read: () => owner._metaOf(node),
      equals: shallowEqual,
      origins: (log) => originsWhere(log, (e) => e.key !== undefined && lastOf(e.loc).host === host && lastOf(e.loc).node === node),
    };
    sub.last = sub.read();
    return register(owner._metaSubs, node, sub);
  }

  private _addKeySub(ref: MetaRef<any>, phase: Phase, fn: Sub["fn"]): Unsubscribe {
    this.assertInScope(ref.node);
    const sources = this._metaSources(ref);
    const sub: Sub = {
      phase, fn, active: true, last: undefined,
      read: () => this._readMetaRef(ref),
      equals: Object.is,
      origins: (log) =>
        originsWhere(log, (e) =>
          e.key === ref.key && sources.some((s) => lastOf(e.loc).host === s.host && lastOf(e.loc).node === s.node)
        ),
    };
    sub.last = sub.read();
    const offs = sources.map((s) => register(s.host._ownerOf(s.node)._keySubs, s.node, sub));
    return () => offs.forEach((off) => off());
  }

  private _addInitialSub(ref: InitialRef<any>, phase: Phase, fn: Sub["fn"]): Unsubscribe {
    this.assertInScope(ref.node);
    const host = this._host;
    const loc = locOf(host, ref.node);
    const sub: Sub = {
      phase, fn, active: true, last: undefined,
      read: () => host.getInitial(ref.node),
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

  private _addCountSub(ref: CountRef, phase: Phase, fn: Sub["fn"]): Unsubscribe {
    this.assertInScope(ref.node);
    this.root._syncWalk();
    const host = this._host;
    const loc = locOf(host, ref.node);
    const sub: Sub = {
      phase, fn, active: true, last: undefined,
      read: () => host._countOf(ref.node, ref.key),
      equals: Object.is,
      origins: (log) => originsWhere(log, (e) => e.key === ref.key && within(e.loc, loc)),
    };
    sub.last = sub.read();
    let byKey = host._countSubs.get(ref.node);
    if (!byKey) host._countSubs.set(ref.node, (byKey = new Map()));
    let set = byKey.get(ref.key);
    if (!set) byKey.set(ref.key, (set = new Set()));
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
    this._seen = { reaction: { focus, attached }, ui: { focus, attached } };
    this._syncSeen = focus;
  }

  /**
   * @internal Compares this store's region with the state seen at the last
   * visit of `phase` and collects the calls to make. Skips the whole subtree
   * when neither the focus value nor the attachment changed.
   */
  _visit(phase: Phase, calls: Calls, changed: StoreSet | undefined, log: readonly WriteEntry[] | undefined): void {
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

    // Rule 4: attachment changed → meta subscribers re-check (UI: always fire).
    if (attachChanged) {
      for (const map of [this._metaSubs, this._keySubs]) {
        for (const subs of map.values()) {
          for (const sub of subs) if (sub.phase === phase) check(sub, calls, log, phase === "ui");
        }
      }
    }

    changed?.add(this);
    this._visitChildren(phase, calls, changed, log);
  }

  protected _visitChildren(phase: Phase, calls: Calls, changed: StoreSet | undefined, log: readonly WriteEntry[] | undefined): void {
    for (const child of this._children.values()) child._visit(phase, calls, changed, log);
  }

  /** @internal Meta of `node` (owned by this store) changed. */
  _collectMeta(node: AnyNode, phase: Phase, calls: Calls, changed: StoreSet | undefined, log: readonly WriteEntry[] | undefined): void {
    for (const map of [this._metaSubs, this._keySubs]) {
      const subs = map.get(node);
      if (subs) for (const sub of subs) if (sub.phase === phase) check(sub, calls, log);
    }
    if (changed) {
      const focused = node === this.node ? this : this._children.get(node);
      if (focused) changed.add(focused);
      for (let s: BaseStore<any> | undefined = this; s; s = s.parentStore) changed.add(s);
    }
  }

  /** @internal this = scope host */
  _collectCount(node: AnyNode, key: string, phase: Phase, calls: Calls, log: readonly WriteEntry[] | undefined): void {
    const subs = this._countSubs.get(node)?.get(key);
    if (subs) for (const sub of subs) if (sub.phase === phase) check(sub, calls, log);
  }

  /** @internal this = scope host */
  _collectInitial(phase: Phase, calls: Calls, log: readonly WriteEntry[] | undefined): void {
    for (const sub of this._initialSubs) if (sub.phase === phase) check(sub, calls, log);
  }

  /** @internal */
  _collectStoreSubs(calls: Calls): void {
    for (const listener of this._storeSubs) {
      calls.push(() => {
        if (this._storeSubs.has(listener)) listener();
      });
    }
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
export class RootStore<N extends ObjectNode<any, any>> extends BaseStore<N> implements ScopeHost {
  private value: InferValue<N>;
  private initial: InferValue<N>;
  private depth = 0;
  private flushing = false;
  private phase: "idle" | Phase = "idle";
  private writeLog: WriteEntry[] = [];
  /** @internal */ _runtime: RuntimeHooks | undefined;
  /** @internal */ _validation: ValidationHooks | undefined;
  /** @internal default order for focusFirst (createStore option `focusOrder`) */
  _focusOrder: ((a: FocusTarget, b: FocusTarget) => number) | undefined;
  private readonly dirtyInitial: Record<Phase, Set<BaseStore<any>>> = { reaction: new Set(), ui: new Set() };
  private readonly dirtyMeta: Record<Phase, Map<BaseStore<any>, Set<AnyNode>>> = { reaction: new Map(), ui: new Map() };
  private readonly dirtyCounts: Record<Phase, Map<BaseStore<any>, Map<AnyNode, Set<string>>>> = { reaction: new Map(), ui: new Map() };

  constructor(shape: N, initialValues: InferValue<N>) {
    super(shape, undefined);
    if (shape.id === undefined || shape.parent !== undefined) {
      throw new Error("RootStore needs the root returned by form()");
    }
    validateValue(shape, initialValues);
    this.value = initialValues;
    this.initial = initialValues;
    this._initSeen();
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

  getValues(): InferValue<N> {
    return this.value;
  }
  setValues(values: InferValue<N>, options?: WriteOptions): void {
    this.setValue(this.node, values, options);
  }
  getInitialValues(): InferValue<N> {
    return this.initial;
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
    if (this.phase === "ui") {
      throw new Error("Cannot write while UI listeners are notified – use store.react(...) for derived writes");
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

  /** @internal Add `delta` to `key` on `node` and every ancestor, across scopes. */
  _applyCountDelta(host: BaseStore<any>, node: AnyNode, key: string, delta: number): void {
    let h = host;
    let from: AnyNode = node;
    for (;;) {
      for (let n: AnyNode | undefined = from; n; n = n.parent) {
        h._bumpCount(n, key, delta);
        this._markCount(h, n, key);
        if (n === h.node) break;
      }
      if (!(h instanceof ItemStore) || !h._countedInParent) break;
      from = h.arrayStore.node;
      h = h.arrayStore._host;
    }
  }

  private _markCount(host: BaseStore<any>, node: AnyNode, key: string): void {
    for (const phase of PHASES) {
      const byHost = this.dirtyCounts[phase];
      let byNode = byHost.get(host);
      if (!byNode) byHost.set(host, (byNode = new Map()));
      let keys = byNode.get(node);
      if (!keys) byNode.set(node, (keys = new Set()));
      keys.add(key);
    }
  }

  /** @internal */
  _syncWalk(): void {
    this._syncVisit();
  }

  private drain(phase: Phase, calls: Calls, changed: StoreSet | undefined, log: readonly WriteEntry[] | undefined): void {
    const meta = this.dirtyMeta[phase];
    if (meta.size) {
      this.dirtyMeta[phase] = new Map();
      for (const [owner, nodes] of meta) for (const node of nodes) owner._collectMeta(node, phase, calls, changed, log);
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
        for (const [node, keys] of byNode) for (const key of keys) host._collectCount(node, key, phase, calls, log);
      }
    }
  }

  // ---- flush (rules 6–8) ----
  private flush(): void {
    this.flushing = true;
    try {
      this.depth++; // writes made by reactions must not start a nested flush
      try {
        for (let round = 0; ; round++) {
          this._syncWalk();
          const log = this.writeLog;
          this.writeLog = [];
          const calls: Calls = [];
          this.drain("reaction", calls, undefined, log);
          this._visit("reaction", calls, undefined, log);
          if (calls.length === 0 && !this._runtime?.hasWork()) break;
          if (round >= MAX_REACTION_ROUNDS) {
            throw new Error(`Reactions did not settle after ${MAX_REACTION_ROUNDS} rounds – check for cycles`);
          }
          for (const call of calls) call();
          // Behaviors: run the pending instances with the lowest rank. Their
          // writes are picked up as triggers in the next round.
          if (this._runtime?.hasWork()) this._runtime.runNext();
        }
      } finally {
        this.depth--;
      }

      this._syncWalk();
      this.phase = "ui";
      const calls: Calls = [];
      const changed: StoreSet = new Set();
      this.drain("ui", calls, changed, undefined);
      this._visit("ui", calls, changed, undefined);
      for (const store of changed) store._collectStoreSubs(calls);

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
    }
  }
}

// ============================================================
// Object substore – a view; reads through the parent's scope
// ============================================================
export class ObjectStore<N extends ObjectNode<any, any>> extends BaseStore<N> {
  /** @internal – use store.substore(node) */
  constructor(node: N, parent: BaseStore<any>) {
    super(node, parent);
  }
}

// ============================================================
// Array substore
// ============================================================
type ItemOf<N extends ArrayNode<any, any, any>> = N["item"];
type ItemValue<N extends ArrayNode<any, any, any>> = InferValue<ItemOf<N>> & object;

/** append / insert arguments: a partial item when the array has `create`, a complete one otherwise. */
export type NewItemArgs<N extends ArrayNode<any, any, any>> = N["_hasCreate"] extends true
  ? [partial?: Partial<ItemValue<N>>, options?: WriteOptions]
  : [item: ItemValue<N>, options?: WriteOptions];

const EMPTY: readonly never[] = Object.freeze([]);
let stableIdCounter = 0;

export class ArrayStore<N extends ArrayNode<any, any, any>> extends BaseStore<N> {
  private readonly itemStores = new WeakMap<object, ItemStore<ItemOf<N>>>();
  private sequence: readonly ItemStore<ItemOf<N>>[] = EMPTY;
  private syncedArray: readonly object[] | undefined;
  private members = new Set<object>();
  private baseline: { array: readonly object[]; set: Set<object> } | undefined;
  private readonly itemsSubs = new Set<Sub<readonly ItemStore<ItemOf<N>>[]>>();
  private lastVisited: Record<Phase, readonly ItemStore<any>[]> = { reaction: EMPTY, ui: EMPTY };
  private createdSince: Record<Phase, ItemStore<any>[]> = { reaction: [], ui: [] };

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
      phase: "ui",
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
    this.setValue(this.node, next as any, options);
    // Behaviors may already have edited the new row during the flush, which
    // moves its store to a new object; the original object still maps to it.
    return this.itemStores.get(item) ?? this.item(item);
  }

  remove(row: ItemStore<ItemOf<N>>, options?: WriteOptions): void {
    const arr = this.current();
    const index = this.indexOfRow(row, arr);
    this.setValue(this.node, arr.filter((_, i) => i !== index) as any, options);
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
    this.setValue(this.node, next as any, options);
  }

  private indexOfRow(row: ItemStore<any>, arr: readonly object[]): number {
    if (row.arrayStore !== (this as unknown)) throw new Error(`The row does not belong to "${this.node.path}"`);
    const index = arr.indexOf(row._currentRef as object);
    if (index === -1) throw new Error(`The row is detached from "${this.node.path}"`);
    return index;
  }

  private newItem(input: ItemValue<N> | undefined): ItemValue<N> {
    const create = this.node._create;
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
        else store._currentRef = ref;
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

  /** Add or remove a row's subtree counts from the enclosing scopes. */
  private shiftTotals(row: ItemStore<any>, attach: boolean): void {
    row._counted = attach;
    const totals = row._counts.get(row.node);
    if (!totals) return;
    for (const [key, count] of totals) {
      this.root._applyCountDelta(this._host, this.node, key, attach ? count : -count);
    }
  }

  protected override _syncChildren(): void {
    for (const row of this._sync()) row._syncVisit();
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

  protected override _visitChildren(phase: Phase, calls: Calls, changed: StoreSet | undefined, log: readonly WriteEntry[] | undefined): void {
    const seq = this._sync();
    const visited = new Set<ItemStore<any>>();
    // Current items, plus items that may have just detached (rule 4).
    for (const list of [seq, this.lastVisited[phase], this.createdSince[phase]]) {
      for (const store of list) {
        if (visited.has(store)) continue;
        visited.add(store);
        store._visit(phase, calls, changed, log);
      }
    }
    this.lastVisited[phase] = seq;
    this.createdSince[phase] = [];

    if (phase === "ui") {
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
  }
}

// ============================================================
// Item store – a scope: node lenses inside the item template are
// resolved against the current item object (and its initial value).
// ============================================================
export class ItemStore<N extends ObjectNode<any, any>> extends BaseStore<N> implements ScopeHost {
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
    for (const [key, child] of Object.entries(node._fields as Record<string, AnyNode>)) {
      validateValue(child, (value as any)[key]);
    }
  }
}
