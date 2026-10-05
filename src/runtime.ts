// ============================================================
// Behavior runtime
// ------------------------------------------------------------
// Registers and runs the behaviors and contributions declared in
// behaviors.ts. The runtime:
//
//   • Scope   – infers the behavior's scope from its references: the deepest
//               row template among them (or the form root). Behaviors on row
//               templates get one instance per row, created with the row.
//               References from enclosing scopes may be read and used as
//               triggers; writes must be in the behavior's own scope.
//   • Order   – ranks registrations by a dependency graph built from the
//               declarations (A writes what B triggers on / reads → A first).
//               Each flush runs the lowest pending rank, then the next, so
//               every instance runs at most once per flush and sees final
//               values. Cycles between registrations are rejected. A
//               registration change reranks only what it reaches (order.ts).
//   • Own writes never trigger the behavior that made them, in any of its
//               instances (origins are per registration:
//               "behavior:<name>@<registration>"). So a row behavior
//               triggered by its whole array runs once per row, not again
//               for each sibling's write.
//   • Writes  – buffered during a run and applied only when it completes.
//               ctx.state is a copy, saved only when the run completes.
//   • Errors  – caught per run and passed to onError (default console.error);
//               the run's writes are dropped and the form keeps running.
//               In dev, the error is located where defineBehavior was
//               called, with the thrown value as its cause.
//   • Writers – one behavior per target (value, or meta key); a combined key
//               (`combine`) only by its owner.
//   • Access  – ctx.get / ctx.set only accept declared references.
//   • Defaults– a key definition's .behavior() registers a default behavior
//               per node that declares the key, limited to that node.
//   • Runtime registration – store.addBehavior(...) runs every check above and
//               returns a dispose function; disposing resets the meta keys
//               the behavior wrote to their defaults, the values it wrote
//               stay.
//   • Contributions – see "Key contributions" in behaviors.ts: a combined
//               key's owner is updated in place as contributions come and go.
//
// Async runs: run() may return a promise. The run is in flight, and its
// targets pending (pendingOf / pendingIn), until it settles; its writes then
// apply in one batch. The latest run wins. A run is cancelled (ctx.signal is
// aborted; ctx.get / ctx.set throw its reason, which is never reported) when:
//   • a trigger or a reads ref changes, whatever the origin: it is rerun with
//     the cancelled run's cause (origins, changed inputs) plus the change's,
//     unless the origins filter ignores the change;
//   • another origin writes one of its targets: no rerun;
//   • a guard turns false: no rerun, earlier writes stay;
//   • its row is removed, it is disposed, or reset() covers it: no rerun.
// So a run that completes has read only values equal to those at its start.
//
// The cause of an async run covers everything since the last completed run:
// an init run replaced in flight is rerun with the user's origins. Behaviors
// that respond to a change, and server checks, use runOn.init: false.
//
// Kept work (ctx.keep(key, start)): async work a rerun can continue instead of
// restarting, one slot per instance. It must depend only on its key; it gets
// its own signal, never ctx. It is aborted on a different key, at the end of
// the flush that cancelled its holder unless a rerun kept it, and on row
// removal, dispose or reset().
//
// store.settle(node?) waits until no run writing inside the node is in flight.
// ============================================================

import { ShapeNode, ObjectNode, ArrayNode, type AnyNode } from "./shape";
import type { MetaRef } from "./refs/meta";
import {
  refNode, refKey, refLabel, targetOf, scopeOf, chainTo, rootOf, storeWithin, hostFor, concretePath,
  FIELDS, META_DEFS, metaRefOf, defOf, usedRefs, rowsBetween, locatedAt, pathLabel,
} from "./internal";
import { isAncestorOrSelf } from "./tree";
import {
  RootStore, BaseStore, ItemStore, ArrayStore,
  type AnyRef, type Origin, type ChangeInfo, type Unsubscribe, type RuntimeHooks, type RegistrationChange,
  type Probe, type ProbedInstance, type RunPart, LISTED_CONTRIBUTIONS,
} from "./store";
import { kindOf, type Target } from "./refs/kind";
import { beginRun, pendingIn, type PendingRun } from "./refs/pending";
import { RunOrder, NodeIndex, type Write } from "./order";
import {
  Behavior, Contribution,
  type AnyBehavior, type BehaviorConfig, type BehaviorContext, type BehaviorErrorInfo, type BehaviorHandle,
  type Declaration, type Guard, type OriginKind, type OwnerConfig, type OwnerContext, type Part, type WritableRef,
} from "./behaviors";

/**
 * What onError receives for an error thrown by a run: in dev, for behaviors
 * from defineBehavior, an error with the same message located where the
 * behavior was defined, with the thrown value as its cause.
 */
function located(behavior: Behavior, error: unknown): unknown {
  const trace = behavior._trace;
  if (!trace?.stack) return error;
  return locatedAt(trace, error instanceof Error ? error.message : String(error), { cause: error });
}

function guardsOf(decl: Declaration): Guard[] {
  return decl.when === undefined ? [] : Array.isArray(decl.when) ? [...decl.when] : [decl.when as Guard];
}

function originKind(origin: Origin): OriginKind {
  return origin.startsWith("behavior:") ? "behavior" : (origin as OriginKind);
}

/** Do two write targets overlap (the same data)? */
function overlaps(a: Target, b: Target): boolean {
  if (a.key === undefined && b.key === undefined) return isAncestorOrSelf(a.node, b.node) || isAncestorOrSelf(b.node, a.node);
  return a.key !== undefined && a.node === b.node && a.key === b.key;
}

// ============================================================
// Registrations, bindings, instances
// ============================================================
let regCounter = 0;
let instanceCounter = 0;
let entryCounter = 0;
let callCounter = 0;

/** @internal */
export interface Registration {
  seq: number;
  name: string;
  behavior: Behavior;
  config: BehaviorConfig;
  /** Store the behavior was registered on (a scope host). */
  host: BaseStore<any>;
  /** Origin of every instance's writes: they never trigger the registration's own instances. */
  origin: Origin;
  scope: AnyNode;
  chain: AnyNode[];
  triggers: AnyRef[];
  /** Read inputs that are not triggers: watched only while a run is in flight. */
  reads: AnyRef[];
  inputs: AnyRef[];
  /** refKeys of `inputs`. */
  inputKeys: Set<string>;
  writes: WritableRef[];
  /** What each write changes, in the order of `writes`. */
  targets: Target[];
  guards: Guard[];
  declared: Set<string>;
  writable: Set<string>;
  kinds: Set<OriginKind> | undefined;
  runInit: boolean;
  rank: number;
  disposed: boolean;
  root: Binding | undefined;
  /** Set when this registration is the owner of a combined key. */
  owner: Owner | undefined;
}

/** A registered contribution. */
interface Entry {
  readonly contribution: Contribution;
  /** The store it was added on: it applies to instances within it. */
  readonly host: BaseStore<any>;
  /** Part.id. */
  readonly id: number;
  /** ctx.parts order: the call that registered it (kept by replaceBehavior), then its position in the call. */
  readonly seq: number;
  readonly index: number;
}

const partOrder = (a: Entry, b: Entry): number => a.seq - b.seq || a.index - b.index;

/** The owner's first `n` entries in ctx.parts order, without sorting them all: each host's list is in that order. */
function firstContributions(owner: Owner, n: number): Entry[] {
  const out: Entry[] = [];
  for (const list of owner.byHost.values()) {
    for (const e of list) {
      if (out.length === n && partOrder(e, out[n - 1]) > 0) break;
      let at = out.length;
      while (at > 0 && partOrder(out[at - 1], e) > 0) at--;
      out.splice(at, 0, e);
      if (out.length > n) out.pop();
    }
  }
  return out;
}

/** Dev: `fn` as one synchronous part of a run on `leaf`, timed by the probe. `part` is read when it ends. */
function timed(probe: Probe, leaf: ProbedInstance, fn: () => void, part: () => RunPart): void {
  probe.runStart(leaf, performance.now());
  try {
    fn();
  } finally {
    probe.runEnd(leaf, performance.now(), part());
  }
}

/** How many entries declare each ref, by refKey. */
type RefCounts = Map<string, { ref: AnyRef; n: number }>;

/** The owner of a combined key on one node, with the contributions registered for it. */
interface Owner {
  /** The node's ref to the key. */
  readonly ref: MetaRef<any, any>;
  readonly config: OwnerConfig<unknown>;
  /** Entries by the store they were added on, each list in ctx.parts order. */
  readonly byHost: Map<BaseStore<any>, Entry[]>;
  /** Entries by contribution: two copies must not reach one instance. */
  readonly byContribution: Map<Contribution, Entry[]>;
  /** The entries' triggers (guard refs included) and reads: the merged lists without a pass over every entry. */
  readonly triggers: RefCounts;
  readonly reads: RefCounts;
  size: number;
  reg: Registration | undefined;
}

/**
 * One owner's change in an addBehavior / replaceBehavior call: its entries
 * added and removed, their hosts, and its size after the change. Applied
 * (commitOwner) only once every check passed.
 */
interface OwnerDelta {
  readonly owner: Owner;
  readonly added: Entry[];
  readonly removed: Entry[];
  readonly hosts: BaseStore<any>[];
  size: number;
}
type OwnerChange = OwnerDelta[];

const triggerRefs = (d: Declaration): AnyRef[] => [...(d.triggers ?? []), ...guardsOf(d).flatMap((g) => g.refs)];
const readRefs = (d: Declaration): readonly AnyRef[] => d.reads ?? [];

function tally(counts: RefCounts, refs: readonly AnyRef[], by: 1 | -1): void {
  for (const ref of refs) {
    const key = refKey(ref);
    const count = counts.get(key);
    if (!count) counts.set(key, { ref, n: by });
    else if ((count.n += by) === 0) counts.delete(key);
  }
}

/** The refs `counts` holds once `delta` is applied. */
function mergedRefs(counts: RefCounts, delta: OwnerDelta, pick: (d: Declaration) => readonly AnyRef[]): AnyRef[] {
  const next: RefCounts = new Map([...counts].map(([key, count]) => [key, { ...count }]));
  for (const e of delta.added) tally(next, pick(e.contribution.decl), 1);
  for (const e of delta.removed) tally(next, pick(e.contribution.decl), -1);
  return [...next.values()].map((c) => c.ref);
}

interface Pending {
  changed: Set<string>;
  origins: Set<Origin>;
}

/** Work handed to ctx.keep, in an instance's slot until it settles. */
interface Kept {
  readonly key: readonly unknown[];
  readonly promise: Promise<unknown>;
  readonly controller: AbortController;
  /** The signal of the run that last kept it. */
  holder: AbortSignal;
}

const sameKey = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/** An async run in flight. */
interface Flight {
  readonly controller: AbortController;
  /** What the run handles: passed on to its rerun when an input change cancels it. */
  readonly cause: Pending;
  /** Its targets are pending until it ends. */
  readonly tally: PendingRun;
  /** Subscriptions that cancel it (see watch()). */
  readonly offs: Unsubscribe[];
}

/**
 * One level of a registration's binding tree. The leaf level (host.node ===
 * reg.scope) is an instance; the levels above watch an array and hold one
 * child binding per row.
 */
class Binding {
  /** Trigger subscriptions: rewired when an owner's declarations change in place. */
  triggerOffs: Unsubscribe[] = [];
  /** refKeys of the subscribed triggers, in order. */
  triggerKeys: string[] = [];
  /** The array watch (non-leaf levels). */
  readonly offs: Unsubscribe[] = [];
  // leaf
  readonly id = instanceCounter++;
  /** ctx.state as the last completed run left it. */
  state: Record<string, unknown> = {};
  /** The ctx.keep slot. */
  kept: Kept | undefined;
  // non-leaf
  arrStore: ArrayStore<any> | undefined;
  readonly rows = new WeakMap<ItemStore<any>, Binding>();

  constructor(
    readonly reg: Registration,
    readonly host: BaseStore<any>,
    readonly depth: number
  ) {}

  get isLeaf(): boolean {
    return this.host.node === this.reg.scope;
  }
}

// ============================================================
// Handles – what a BehaviorHandle (behaviors.ts) disposes
// ============================================================
interface HandleEntry {
  runtime: BehaviorRuntime;
  host: BaseStore<any>;
  regs: Registration[];
  entries: Entry[];
  /** Sequence number of the addBehavior call; replaceBehavior keeps it. */
  seq: number;
  disposed: boolean;
}

const handles = new WeakMap<BehaviorHandle, HandleEntry>();

// ============================================================
// Runtime
// ============================================================
export class BehaviorRuntime implements RuntimeHooks {
  private readonly regs: Registration[] = [];
  /** Dependency edges and ranks of `regs`. */
  private readonly order = new RunOrder<Registration>();
  private readonly pending = new Map<Binding, Pending>();
  private readonly flights = new Map<Binding, Flight>();
  /** Instances whose kept-work slot holds work. */
  private readonly keeping = new Set<Binding>();
  /** Instances whose run in flight was cancelled while holding kept work: see behaviorsEnd(). */
  private readonly orphans = new Set<Binding>();
  /** Resolved when a run in flight ends or is cancelled; settle() awaits it. */
  private settledGate: { promise: Promise<void>; resolve: () => void } | undefined;
  /** Owners of combined keys, by refKey of the key. */
  private readonly owners = new Map<string, Owner>();
  /** combine(self, key) results: called once per node and key. */
  private readonly combined = new Map<string, OwnerConfig<unknown>>();

  constructor(
    readonly store: RootStore<any>,
    readonly onError: (error: unknown, info: BehaviorErrorInfo) => void
  ) {}

  // ---- RuntimeHooks ----
  hasWork(): boolean {
    return this.pending.size > 0;
  }

  runNext(): void {
    let min = Infinity;
    for (const b of this.pending.keys()) min = Math.min(min, b.reg.rank);
    const batch: [Binding, Pending][] = [];
    for (const entry of this.pending) if (entry[0].reg.rank === min) batch.push(entry);
    batch.sort((a, b) => a[0].reg.seq - b[0].reg.seq || a[0].id - b[0].id);
    for (const [binding] of batch) this.pending.delete(binding);
    for (const [binding, p] of batch) this.run(binding, p);
  }

  add(host: BaseStore<any>, behaviors: AnyBehavior | readonly AnyBehavior[]): BehaviorHandle {
    return this.swap(host, undefined, behaviors);
  }

  /**
   * Replace what `previous` registered with `behaviors`, as one transaction:
   * if any check fails, `previous` stays registered. The UI sees only the
   * final state (no flicker of errors or meta in between).
   */
  replace(previous: BehaviorHandle, behaviors: AnyBehavior | readonly AnyBehavior[]): BehaviorHandle {
    const entry = handles.get(previous);
    if (!entry || entry.runtime !== this) throw new Error("replace(): not a handle of this store");
    if (entry.disposed) throw new Error("replace(): the handle was already disposed or replaced");
    return this.swap(entry.host, entry, behaviors);
  }

  private swap(host: BaseStore<any>, previous: HandleEntry | undefined, behaviors: AnyBehavior | readonly AnyBehavior[]): BehaviorHandle {
    const list = (Array.isArray(behaviors) ? behaviors : [behaviors]) as readonly AnyBehavior[];
    if (!host.isAttached()) throw new Error("Cannot add behaviors to a detached row");
    const contributions = list.filter((b): b is Contribution => b instanceof Contribution);
    const plain = list.filter((b): b is Behavior => !(b instanceof Contribution));
    const seq = previous?.seq ?? callCounter++;
    const owners = this.ownerChange(host, contributions, previous?.entries ?? [], seq);
    const regs = this.apply(host, plain, previous?.regs ?? [], owners.change);
    if (previous) previous.disposed = true;

    const entries = owners.added;
    const entry: HandleEntry = { runtime: this, host, regs, entries, seq, disposed: false };
    const handle = (() => {
      if (entry.disposed) return;
      entry.disposed = true;
      if (!regs.length && !entries.length) return; // registered nothing
      this.apply(host, [], regs, entries.length ? this.ownerChange(host, [], entries, seq).change : []);
    }) as BehaviorHandle;
    handles.set(handle, entry);
    return handle;
  }

  /**
   * Registers behaviors, removes `removing` and applies owner changes as one
   * transaction: every check (scope, writers, cycles) runs before anything changes.
   */
  private apply(
    host: BaseStore<any>,
    behaviors: readonly Behavior[],
    removing: readonly Registration[],
    owners: OwnerChange = []
  ): Registration[] {
    const probe = this.store._probe;
    probe?.registrationStart(performance.now());
    const regs = behaviors.map((b) => this.prepare(host, b));
    // A fresh registration per changed owner, used for every check; an owner
    // already registered then takes over its declarations in place.
    const live = owners.filter((o) => o.size);
    const ownerRegs = live.map((delta) => this.prepare(this.store, this.ownerBehavior(delta), delta.owner));
    const removed = new Set([
      ...removing,
      ...owners.flatMap((o) => (o.owner.reg ? [o.owner.reg] : [])),
    ]);
    this.checkWriters([...regs, ...ownerRegs], removed);
    const commitOrder = this.order.plan(
      [
        ...regs.map((reg) => ({ reg, declaredBy: reg })),
        ...live.map(({ owner }, i) => ({ reg: owner.reg ?? ownerRegs[i], declaredBy: ownerRegs[i] })),
      ],
      removed
    ); // throws on cycles, before any state change

    this.store._batch(() => {
      commitOrder();
      for (const reg of removing) this.unregister(reg);
      for (const reg of regs) this.register(reg, host);
      for (const delta of owners) {
        const owner = delta.owner;
        this.commitOwner(delta);
        if (owner.size || !owner.reg) continue;
        // The last contribution is gone: the key returns to its default.
        this.unregister(owner.reg);
        owner.reg = undefined;
        this.owners.delete(refKey(owner.ref));
      }
      live.forEach(({ owner, hosts }, i) => {
        if (owner.reg) return this.update(owner.reg, ownerRegs[i], hosts);
        owner.reg = ownerRegs[i];
        this.owners.set(refKey(owner.ref), owner);
        this.register(ownerRegs[i], this.store);
      });
      probe?.registrationEnd(performance.now(), () => this.describe(host, regs, removing, owners));
    });
    return regs;
  }

  /** A committed registration change, for the probe. */
  private describe(host: BaseStore<any>, added: readonly Registration[], removed: readonly Registration[], owners: OwnerChange): RegistrationChange {
    const at = (store: BaseStore<any>) => pathLabel(store, store.node);
    return {
      store: at(host),
      added: added.map((r) => r.name),
      removed: removed.map((r) => r.name),
      owners: owners.map(({ owner }) => ({
        key: refLabel(owner.ref),
        triggers: owner.reg?.triggers.map(refLabel) ?? [],
        contributions: firstContributions(owner, LISTED_CONTRIBUTIONS).map((e) => `${e.contribution.decl.name ?? owner.reg!.name} @${at(e.host)}`),
        more: Math.max(0, owner.size - LISTED_CONTRIBUTIONS),
      })),
    };
  }

  // ---- combined keys ----
  /**
   * The owners that change when `added` (on `host`) is registered and
   * `removed` unregistered, with their next contribution lists. Checks the
   * contributions; changes nothing yet.
   */
  private ownerChange(
    host: BaseStore<any>,
    added: readonly Contribution[],
    removed: readonly Entry[],
    seq: number
  ): { change: OwnerChange; added: Entry[] } {
    const byKey = new Map<string, OwnerDelta>();
    const deltaOf = (target: MetaRef<any, any>) => {
      const key = refKey(target);
      let delta = byKey.get(key);
      if (!delta) {
        const owner = this.owners.get(key) ?? this.newOwner(target);
        byKey.set(key, (delta = { owner, added: [], removed: [], hosts: [], size: owner.size }));
      }
      return delta;
    };
    for (const entry of removed) {
      const delta = deltaOf(entry.contribution.target);
      delta.removed.push(entry);
      delta.hosts.push(entry.host);
      delta.size--;
    }
    const entries = added.map((contribution, index) => {
      this.checkContribution(host, contribution);
      const delta = deltaOf(contribution.target);
      // Two copies reaching one instance: the same store, or an outer and an inner one.
      const copies = [
        ...(delta.owner.byContribution.get(contribution) ?? []).filter((e) => !delta.removed.includes(e)),
        ...delta.added.filter((e) => e.contribution === contribution),
      ];
      if (copies.some((e) => storeWithin(host, e.host) || storeWithin(e.host, host))) {
        throw new Error(`Contribution "${contribution.decl.name ?? refLabel(contribution.target)}" is registered twice for the same instances`);
      }
      const entry: Entry = { contribution, host, id: entryCounter++, seq, index };
      delta.added.push(entry);
      delta.hosts.push(host);
      delta.size++;
      return entry;
    });
    return { change: [...byKey.values()], added: entries };
  }

  /** Applies a checked delta to its owner's indexes. */
  private commitOwner({ owner, added, removed, size }: OwnerDelta): void {
    for (const e of removed) {
      const list = owner.byHost.get(e.host)!;
      list.splice(list.indexOf(e), 1);
      if (!list.length) owner.byHost.delete(e.host);
      const copies = owner.byContribution.get(e.contribution)!;
      copies.splice(copies.indexOf(e), 1);
      if (!copies.length) owner.byContribution.delete(e.contribution);
      tally(owner.triggers, triggerRefs(e.contribution.decl), -1);
      tally(owner.reads, readRefs(e.contribution.decl), -1);
    }
    for (const e of added) {
      // Usually appended: a new call comes last; replaceBehavior keeps an earlier call's place.
      let list = owner.byHost.get(e.host);
      if (!list) owner.byHost.set(e.host, (list = []));
      let at = list.length;
      while (at > 0 && partOrder(list[at - 1], e) > 0) at--;
      list.splice(at, 0, e);
      let copies = owner.byContribution.get(e.contribution);
      if (!copies) owner.byContribution.set(e.contribution, (copies = []));
      copies.push(e);
      tally(owner.triggers, triggerRefs(e.contribution.decl), 1);
      tally(owner.reads, readRefs(e.contribution.decl), 1);
    }
    owner.size = size;
  }

  /** The owner's entries that apply to an instance at `host`: added on it or an enclosing store, in ctx.parts order. */
  private applicable(owner: Owner, host: BaseStore<any>): Entry[] {
    const out: Entry[] = [];
    for (let h: BaseStore<any> | undefined = host; h; h = h.parentStore) {
      const list = owner.byHost.get(h);
      if (list) out.push(...list);
    }
    return out.sort(partOrder);
  }

  /**
   * In-place update of an owner: `reg` keeps its state (`root`, its binding
   * tree with each instance's ctx.state; `disposed`; `rank`, set by the run
   * order) and takes everything else from `fresh`, prepared with the same
   * `seq` and origin, then rewires its trigger subscriptions and reruns the
   * instances inside `hosts`, where contributions were added or removed. A
   * run in flight there is cancelled and rerun with its cause. The scope
   * never changes: contributions' references stay in the target's scope chain.
   */
  private update(reg: Registration, fresh: Registration, hosts: readonly BaseStore<any>[]): void {
    Object.assign(reg, { ...fresh, root: reg.root, disposed: reg.disposed, rank: reg.rank });
    const seen = new Set<Binding>();
    for (const host of hosts) {
      const path = this.pathTo(reg, host);
      if (!path) continue;
      const at = path.pop()!;
      // Bindings above the host take triggers of enclosing scopes; bindings
      // inside it are the instances the change applies to. Others keep theirs.
      for (const binding of [...path, ...this.bindings(at)]) {
        if (seen.has(binding)) continue;
        seen.add(binding);
        this.rewire(binding);
        if (binding.isLeaf && binding.host.isAttached() && !this.supersede(binding)) this.mark(binding);
      }
    }
  }

  /**
   * Bindings of `reg` from its root down to `host`'s level; undefined when
   * `host` is detached or below the registration's instances.
   */
  private pathTo(reg: Registration, host: BaseStore<any>): Binding[] | undefined {
    if (!host.isAttached() || !reg.chain.includes(host.node)) return;
    const path = [reg.root!];
    for (const row of rowsBetween(reg.root!.host, host)) path.push(this.child(path[path.length - 1], row));
    return path;
  }

  /** Resubscribes the binding's triggers if the registration's changed. */
  private rewire(binding: Binding): void {
    const refs = this.triggersOf(binding);
    const keys = refs.map(refKey);
    if (keys.length === binding.triggerKeys.length && keys.every((k, i) => k === binding.triggerKeys[i])) return;
    for (const off of binding.triggerOffs) off();
    this.subscribeTriggers(binding, refs);
  }

  /** Its target is a combined key of this form inside `host`; its references are in the target's scope chain. */
  private checkContribution(host: BaseStore<any>, contribution: Contribution): void {
    const { target, decl } = contribution;
    const fail = (msg: string): never => {
      throw new Error(`Contribution "${decl.name ?? refLabel(target)}": ${msg}`);
    };
    const inForm = (node: AnyNode) => node instanceof ShapeNode && node.id !== undefined && rootOf(node) === this.store.node;
    if (!inForm(target.node)) fail(`"${refLabel(target)}" is not part of this form`);
    if (!defOf(target)._steps.combine) fail(`"${refLabel(target)}" has no \`combine\``);
    const chain = chainTo(scopeOf(target.node));
    if (!chain.includes(host.node)) {
      fail(`"${refLabel(target)}" is outside the store it was added to ("${host.node.path || "<root>"}") – add it to an outer store`);
    }
    for (const ref of [...(decl.triggers ?? []), ...(decl.reads ?? []), ...guardsOf(decl).flatMap((g) => g.refs)]) {
      const node = refNode(ref);
      if (!inForm(node)) fail(`"${refLabel(ref)}" is not part of this form`);
      if (!chain.includes(scopeOf(node))) fail(`"${refLabel(ref)}" is outside the target's scope ("${scopeOf(target.node).path || "<root>"}")`);
    }
  }

  private newOwner(target: MetaRef<any, any>): Owner {
    const ref = metaRefOf(target.node, target.key);
    let config = this.combined.get(refKey(ref));
    if (!config) {
      const def = defOf(ref);
      config = def._steps.combine!(ref.node, ref, usedRefs(ref.node, ref.key, def)) as OwnerConfig<unknown>;
      this.combined.set(refKey(ref), config);
    }
    return { ref, config, byHost: new Map(), byContribution: new Map(), triggers: new Map(), reads: new Map(), size: 0, reg: undefined };
  }

  /** The owner behavior once `delta` applies: combine's config plus every contribution's triggers, reads and guard refs, each once. */
  private ownerBehavior(delta: OwnerDelta): Behavior {
    const { owner } = delta;
    const config = owner.config;
    const once = (refs: AnyRef[]) => [...new Map(refs.map((r) => [refKey(r), r])).values()];
    return new Behavior({
      ...config,
      name: config.name ?? `${owner.ref.node.path || "<root>"}#${owner.ref.key}`,
      triggers: once([...(config.triggers ?? []), ...mergedRefs(owner.triggers, delta, triggerRefs)]),
      reads: once([...(config.reads ?? []), ...mergedRefs(owner.reads, delta, readRefs)]),
      run: config.run as BehaviorConfig["run"],
    });
  }

  private register(reg: Registration, host: BaseStore<any>): void {
    this.regs.push(reg);
    this.bind(reg, host, reg.chain.indexOf(host.node), true);
  }

  /** End of the flush's behavior phase: kept work that no run holds any more (its holder was cancelled) is aborted. */
  behaviorsEnd(): void {
    for (const leaf of this.orphans) if (leaf.kept?.holder.aborted) this.abortKept(leaf);
    this.orphans.clear();
  }

  async settle(store: BaseStore<any>, node: AnyNode): Promise<void> {
    const pending = pendingIn(node);
    if (store.get(pending) === 0) return;
    const probe = this.store._probe;
    const start = probe ? performance.now() : 0;
    do {
      if (!this.settledGate) {
        let resolve!: () => void;
        const promise = new Promise<void>((r) => (resolve = r));
        this.settledGate = { promise, resolve };
      }
      await this.settledGate.promise;
    } while (store.get(pending) > 0);
    probe?.settled(store, node, start, performance.now());
  }

  // ---- reset ----
  reinit(store: BaseStore<any>, node: AnyNode): void {
    const resetHost = store.scopeStore;
    const inside = (leafHost: BaseStore<any>): boolean => {
      if (storeWithin(resetHost, leafHost)) return true; // the reset store's scope, or an enclosing one
      // A row below the reset store: its array must be inside `node`.
      for (let h: BaseStore<any> = leafHost; h instanceof ItemStore; h = h.arrayStore.scopeStore) {
        if (h.arrayStore.scopeStore === resetHost) return isAncestorOrSelf(node, h.arrayStore.node);
      }
      return false;
    };
    for (const reg of this.regs) {
      if (reg.disposed || !reg.root) continue;
      if (!reg.writes.some((w) => isAncestorOrSelf(node, refNode(w)))) continue;
      for (const leaf of this.leaves(reg.root)) {
        if (!inside(leaf.host)) continue;
        this.drop(leaf); // its cause is not passed on
        if (reg.runInit) this.mark(leaf);
      }
    }
  }

  // ---- registration ----
  private prepare(host: BaseStore<any>, behavior: Behavior, owner?: Owner): Registration {
    if (!(behavior instanceof Behavior)) throw new Error("Expected a behavior created with defineBehavior()");
    const config = behavior.config;
    const seq = owner?.reg?.seq ?? regCounter++; // an owner refreshed in place keeps its run order and origin
    const name = config.name ?? `b${seq}`;
    const guards = guardsOf(config);
    const triggers = [...(config.triggers ?? []), ...guards.flatMap((g) => g.refs)];
    const reads = [...(config.reads ?? [])];
    const writes = [...(config.writes ?? [])];
    const all: AnyRef[] = [...triggers, ...reads, ...writes];
    const fail = (msg: string): never => {
      throw new Error(`Behavior "${name}": ${msg}`);
    };

    // References belong to this form.
    const formRoot = this.store.node;
    for (const ref of all) {
      const node = refNode(ref);
      if (!(node instanceof ShapeNode) || node.id === undefined || rootOf(node) !== formRoot) {
        fail(`"${refLabel(ref)}" is not part of this form`);
      }
    }

    // An origins filter needs triggers that carry origins.
    if (config.origins) {
      for (const ref of triggers) {
        if (kindOf(ref).tally) fail(`"${refLabel(ref)}" carries no origins (it is a tally) – drop the origins filter or the reference`);
      }
    }

    // Writes: nodes and meta keys only; a combined key only by its owner.
    const targets = writes.map((w) => {
      const target = targetOf(w as AnyRef);
      if (!target) return fail(`cannot write "${refLabel(w as AnyRef)}" – only values and meta keys are writable`);
      if (target.def?._steps.combine && (!owner || refKey(owner.ref) !== refKey(w as AnyRef))) {
        fail(`"${refLabel(w)}" is written only by the owner of its key – contribute() to it instead`);
      }
      return target;
    });

    // Default behaviors are limited to their own node.
    if (behavior._self) {
      const self = behavior._self;
      for (const ref of all) {
        if (refNode(ref) !== self || !kindOf(ref).local) fail(`default behaviors may only use their own node ("${self.path || "<root>"}"), got "${refLabel(ref)}"`);
      }
    }

    // Scope: the deepest scope among the references; all others on its chain.
    let deepest: AnyNode | undefined;
    for (const ref of all) {
      const s = scopeOf(refNode(ref));
      if (!deepest || chainTo(s).length > chainTo(deepest).length) deepest = s;
    }
    const scope: AnyNode = deepest ?? host.node;
    const chain = chainTo(scope);
    if (!chain.includes(host.node)) {
      fail(`its references are outside the store it was added to ("${host.node.path || "<root>"}") – add it to an outer store`);
    }
    for (const ref of all) {
      if (!chain.includes(scopeOf(refNode(ref)))) fail(`"${refLabel(ref)}" is in an unrelated row scope`);
    }
    for (const w of writes) {
      if (scopeOf(refNode(w)) !== scope) fail(`"${refLabel(w)}" is outside the behavior's scope ("${scope.path || "<root>"}") – behaviors write only their own scope`);
    }

    const triggerKeys = new Set(triggers.map(refKey));
    return {
      seq, name, behavior, config, host, origin: `behavior:${name}@${seq}`, scope, chain,
      triggers, reads: reads.filter((r) => !triggerKeys.has(refKey(r))),
      inputs: [...triggers, ...reads], inputKeys: new Set([...triggers, ...reads].map(refKey)),
      writes, targets, guards,
      declared: new Set(all.map(refKey)),
      writable: new Set(writes.map(refKey)),
      kinds: config.origins ? new Set(config.origins) : undefined,
      runInit: config.runOn?.init !== false,
      rank: 0, disposed: false, root: undefined, owner,
    };
  }

  /**
   * One writer per target among registrations whose regions overlap: `added`
   * against each other and against the registrations other than `removed`.
   * Regions overlap only when one host is inside the other or they are the
   * same, so only those writes are listed. `batch` needs no such filter: `added` is on
   * one host, plus the root for owners.
   */
  private checkWriters(added: Registration[], removed: ReadonlySet<Registration>): void {
    const batch = added.length > 1 ? new NodeIndex<Write<Registration>>() : undefined;
    for (const reg of added) {
      const conflicts: { other: Write<Registration>; at: number }[] = [];
      reg.targets.forEach((target, at) => {
        const check = (other: Write<Registration>) => {
          const o = other.reg;
          if (removed.has(o) || !overlaps(target, other.target)) return;
          conflicts.push({ other, at });
        };
        this.order.writesNear(reg.host, target.node, check);
        batch?.near(target.node, check);
      });
      if (conflicts.length) {
        // The earliest registration, then the first write of each.
        const { other, at } = conflicts.sort((x, y) => x.other.reg.seq - y.other.reg.seq || x.at - y.at || x.other.at - y.other.at)[0];
        const w = reg.writes[at];
        const hit = other.reg.writes[other.at];
        throw new Error(
          `Behavior "${reg.name}": "${refLabel(w)}" is already written by "${other.reg.name}"` +
            (hit === w ? "" : ` (via "${refLabel(hit)}")`) + " – one writer per target"
        );
      }
      if (batch) reg.targets.forEach((target, at) => batch.add(target.node, { reg, target, at }));
    }
  }

  // ---- binding tree ----
  private bind(reg: Registration, host: BaseStore<any>, depth: number, isRoot: boolean): Binding {
    const binding = new Binding(reg, host, depth);
    if (isRoot) reg.root = binding;
    this.subscribeTriggers(binding, this.triggersOf(binding));

    if (binding.isLeaf) {
      if (reg.runInit) this.mark(binding);
    } else {
      const next = reg.chain[depth + 1];
      const arrStore = host.substore(next.parent as ArrayNode<any, any>) as ArrayStore<any>;
      binding.arrStore = arrStore;
      let seq = arrStore.items();
      for (const row of seq) this.child(binding, row);
      binding.offs.push(
        host._react(arrStore.node, () => {
          if (reg.disposed) return;
          const now = arrStore.items();
          if (now === seq) return;
          seq = now;
          for (const row of now) this.child(binding, row);
          // Removed rows: their runs in flight are cancelled.
          for (const leaf of this.busy(reg)) if (!leaf.host.isAttached()) this.drop(leaf);
        })
      );
    }
    return binding;
  }

  /** Triggers of the binding's scope; the root binding also takes every scope above it. */
  private triggersOf(binding: Binding): AnyRef[] {
    const reg = binding.reg;
    const isRoot = binding === reg.root;
    return reg.triggers.filter((ref) => {
      const level = reg.chain.indexOf(scopeOf(refNode(ref)));
      return level === binding.depth || (isRoot && level < binding.depth);
    });
  }

  private subscribeTriggers(binding: Binding, refs: AnyRef[]): void {
    binding.triggerKeys = refs.map(refKey);
    binding.triggerOffs = refs.map((ref) =>
      hostFor(binding.host, scopeOf(refNode(ref)))._react(ref, (_n, _p, info) => this.onTrigger(binding, ref, info))
    );
  }

  /** Bindings under `binding` whose rows are attached, `binding` first. */
  private *bindings(binding: Binding): Generator<Binding> {
    yield binding;
    if (binding.isLeaf) return;
    for (const row of binding.arrStore!.items()) yield* this.bindings(this.child(binding, row));
  }

  private child(parent: Binding, row: ItemStore<any>): Binding {
    let b = parent.rows.get(row);
    if (!b) {
      b = this.bind(parent.reg, row, parent.depth + 1, false);
      parent.rows.set(row, b);
    }
    return b;
  }

  /** Leaves under `binding` whose scope is currently attached. */
  private *leaves(binding: Binding): Generator<Binding> {
    if (binding.isLeaf) {
      if (binding.host.isAttached()) yield binding;
      return;
    }
    for (const row of binding.arrStore!.items()) yield* this.leaves(this.child(binding, row));
  }

  private onTrigger(binding: Binding, ref: AnyRef, info: ChangeInfo): void {
    const reg = binding.reg;
    if (reg.disposed) return;
    const key = refKey(ref);
    for (const leaf of this.leaves(binding)) this.onInput(leaf, key, info);
  }

  /**
   * An input of `leaf` changed: a trigger, or a read while its run is in
   * flight (see watch). A run in flight read the old value: it is cancelled
   * and rerun with its cause, whatever the change's origin. The change adds to
   * the cause unless the origins filter ignores it.
   */
  private onInput(leaf: Binding, key: string, info: ChangeInfo): void {
    const reg = leaf.reg;
    const origins = new Set(info.origins);
    origins.delete(reg.origin);
    if (info.origins.size > 0 && origins.size === 0) return; // only its own writes, from any instance
    this.supersede(leaf);
    if (reg.kinds && ![...origins].some((o) => reg.kinds!.has(originKind(o)))) return;
    this.mark(leaf, { changed: [key], origins });
  }

  /**
   * While a run is in flight, a change to one of its reads cancels and reruns
   * it; another origin writing one of its targets only cancels it.
   */
  private watch(leaf: Binding, flight: Flight): void {
    const reg = leaf.reg;
    for (const ref of reg.writes) {
      if (reg.inputKeys.has(refKey(ref))) continue; // an input change reruns it
      flight.offs.push(
        leaf.host._react(ref, () => {
          if (this.flights.get(leaf) === flight) this.cancel(leaf);
        })
      );
    }
    for (const ref of reg.reads) {
      const key = refKey(ref);
      flight.offs.push(
        hostFor(leaf.host, scopeOf(refNode(ref)))._react(ref, (_n, _p, info) => {
          if (this.flights.get(leaf) === flight) this.onInput(leaf, key, info);
        })
      );
    }
  }

  /** Ends the leaf's run in flight, if any: unwatches it and aborts its signal. Returns its cause. */
  private cancel(leaf: Binding): Pending | undefined {
    const flight = this.flights.get(leaf);
    if (!flight) return;
    this.end(leaf, flight, true);
    flight.controller.abort();
    if (leaf.kept) this.orphans.add(leaf);
    return flight.cause;
  }

  /** Row removal, dispose, reset(): cancels the run in flight and aborts the instance's kept work. */
  private drop(leaf: Binding): void {
    this.cancel(leaf);
    this.abortKept(leaf);
  }

  private abortKept(leaf: Binding): void {
    const kept = leaf.kept;
    if (!kept) return;
    leaf.kept = undefined;
    this.keeping.delete(leaf);
    kept.controller.abort();
  }

  /** The registration's instances with a run in flight or kept work: what row removal and dispose stop. */
  private busy(reg: Registration): Binding[] {
    const out = new Set<Binding>();
    for (const leaf of this.flights.keys()) if (leaf.reg === reg) out.add(leaf);
    for (const leaf of this.keeping) if (leaf.reg === reg) out.add(leaf);
    return [...out];
  }

  /** Cancels the run in flight and marks the rerun with its cause. Returns whether there was one. */
  private supersede(leaf: Binding): boolean {
    const cause = this.cancel(leaf);
    if (cause) this.mark(leaf, cause);
    return cause !== undefined;
  }

  private end(leaf: Binding, flight: Flight, cancelled: boolean): void {
    if (this.flights.get(leaf) !== flight) return;
    this.flights.delete(leaf);
    this.store._probe?.flightEnd(leaf, performance.now(), cancelled);
    for (const off of flight.offs) off();
    flight.tally.end();
    const gate = this.settledGate;
    this.settledGate = undefined;
    gate?.resolve();
  }

  private mark(leaf: Binding, change: { changed?: Iterable<string>; origins?: Iterable<Origin> } = {}): void {
    let p = this.pending.get(leaf);
    if (!p) this.pending.set(leaf, (p = { changed: new Set(), origins: new Set() }));
    if (change.changed) for (const k of change.changed) p.changed.add(k);
    if (change.origins) for (const o of change.origins) p.origins.add(o);
  }

  // ---- running ----
  private run(leaf: Binding, p: Pending): void {
    if (leaf.reg.disposed || !leaf.host.isAttached()) return;
    const probe = this.store._probe;
    if (!probe) return this.execute(leaf, p);
    timed(probe, leaf, () => this.execute(leaf, p), () => (this.flights.has(leaf) ? "async" : "sync"));
  }

  private execute(leaf: Binding, p: Pending): void {
    const reg = leaf.reg;
    const info = (): BehaviorErrorInfo => ({ behavior: reg.name, scope: concretePath(leaf.host, leaf.host.node) });

    const buffer = new Map<string, { ref: WritableRef; value: unknown }>();
    const state = { ...leaf.state }; // saved only if the run completes
    const controller = new AbortController();
    const signal = controller.signal;
    const read = (ref: AnyRef): any => {
      if (signal.aborted) throw signal.reason;
      const key = refKey(ref);
      if (!reg.declared.has(key)) {
        throw new Error(`Behavior "${reg.name}": "${refLabel(ref)}" is not declared in triggers, reads, writes or when`);
      }
      const pendingWrite = buffer.get(key);
      if (pendingWrite) return pendingWrite.value;
      return hostFor(leaf.host, scopeOf(refNode(ref))).get(ref);
    };
    const ctx: BehaviorContext = {
      get: read,
      set: (ref, value) => {
        if (signal.aborted) throw signal.reason;
        const key = refKey(ref);
        if (!reg.writable.has(key)) throw new Error(`Behavior "${reg.name}": "${refLabel(ref)}" is not declared in writes`);
        buffer.delete(key); // keep insertion order = last write
        buffer.set(key, { ref, value });
      },
      keep: <T>(key: readonly unknown[], start: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        if (signal.aborted) throw signal.reason;
        const slot = leaf.kept;
        if (slot && sameKey(slot.key, key)) {
          slot.holder = signal;
          return slot.promise as Promise<T>;
        }
        this.abortKept(leaf);
        const work = new AbortController();
        let promise: Promise<T>;
        try {
          promise = Promise.resolve(start(work.signal));
        } catch (error) {
          promise = Promise.reject(error);
        }
        const kept: Kept = { key: [...key], promise, controller: work, holder: signal };
        leaf.kept = kept;
        this.keeping.add(leaf);
        const empty = () => {
          if (leaf.kept !== kept) return;
          leaf.kept = undefined;
          this.keeping.delete(leaf);
        };
        promise.then(empty, empty);
        return promise;
      },
      changed: (ref) => p.changed.has(refKey(ref)),
      origins: p.origins,
      state,
      signal,
    };

    const commit = () => {
      leaf.state = state;
      for (const { ref, value } of buffer.values()) {
        hostFor(leaf.host, scopeOf(refNode(ref))).set(ref as any, value as never, { origin: reg.origin });
      }
    };

    try {
      const owner = reg.owner;
      const applicable = owner ? this.applicable(owner, leaf.host) : [];
      if (owner && !applicable.length) {
        // No contribution applies to this instance: the key keeps (or returns to) its default.
        ctx.set(owner.ref, defOf(owner.ref).defaultValue);
        return commit();
      }
      for (const guard of reg.guards) {
        if (!guard.test(...guard.refs.map(read))) return;
      }
      const parts: Part[] = applicable
        .filter((e) => guardsOf(e.contribution.decl).every((g) => g.test(...g.refs.map(read))))
        .map((e) => {
          const d = e.contribution.decl;
          return { payload: e.contribution.payload, name: d.name ?? reg.name, id: e.id, inputs: [...(d.triggers ?? []), ...(d.reads ?? [])] };
        });
      const tally = beginRun(leaf.host, reg.writes);
      let result: unknown;
      try {
        result = owner ? (owner.config.run as (ctx: OwnerContext<unknown>) => unknown)({ ...ctx, parts }) : reg.config.run(ctx);
      } catch (error) {
        tally.end();
        throw error;
      }
      if (!(result && typeof (result as PromiseLike<unknown>).then === "function")) {
        tally.end();
        commit();
        return;
      }
      tally.hold();
      const flight: Flight = { controller, cause: p, tally, offs: [] };
      this.flights.set(leaf, flight);
      this.watch(leaf, flight);
      (result as PromiseLike<unknown>).then(
        () => {
          if (signal.aborted) return;
          try {
            this.store._batch(() => {
              this.end(leaf, flight, false);
              const probe = this.store._probe;
              if (!probe) return commit();
              timed(probe, leaf, commit, () => "apply");
            });
          } catch (error) {
            this.onError(located(reg.behavior, error), info());
          }
        },
        (error) => {
          if (signal.aborted) return;
          this.store._batch(() => this.end(leaf, flight, false));
          this.onError(located(reg.behavior, error), info());
        }
      );
    } catch (error) {
      this.onError(located(reg.behavior, error), info());
    }
  }

  // ---- disposal ----
  private unregister(reg: Registration): void {
    if (reg.disposed) return;
    reg.disposed = true;
    this.regs.splice(this.regs.indexOf(reg), 1);
    for (const leaf of this.pending.keys()) if (leaf.reg === reg) this.pending.delete(leaf);
    for (const leaf of this.busy(reg)) this.drop(leaf);
    if (reg.root) this.unbind(reg, reg.root);
  }

  private unbind(reg: Registration, binding: Binding): void {
    for (const off of binding.triggerOffs) off();
    for (const off of binding.offs) off();
    if (binding.isLeaf) {
      if (!binding.host.isAttached()) return;
      // Meta the behavior wrote goes back to its default.
      reg.writes.forEach((w, i) => {
        const def = reg.targets[i].def;
        if (def) binding.host.set(w, def.defaultValue as never, { origin: reg.origin });
      });
      return;
    }
    for (const row of binding.arrStore!.items()) {
      const child = binding.rows.get(row);
      if (child) this.unbind(reg, child);
    }
  }
}

// ============================================================
// Default behaviors from key definitions
// ============================================================
/**
 * @internal Default behaviors declared by key definitions, one per node.
 * Checks every key's uses on the way, combined keys included: their owners
 * are created later, with the first contribution.
 */
export function defaultBehaviors(root: AnyNode): Behavior[] {
  const out: Behavior[] = [];
  const visit = (node: AnyNode) => {
    for (const [name, def] of Object.entries(node[META_DEFS])) {
      const uses = usedRefs(node, name, def);
      const factory = def._steps.behavior;
      if (!factory) continue;
      const config = factory(node, metaRefOf(node, name), uses) as BehaviorConfig;
      out.push(new Behavior({ ...config, name: config.name ?? `${node.path || "<root>"}#${name}` }, { self: node }));
    }
    if (node instanceof ObjectNode) for (const child of Object.values(node[FIELDS] as Record<string, AnyNode>)) visit(child);
    if (node instanceof ArrayNode) visit(node.item);
  };
  visit(root);
  return out;
}
