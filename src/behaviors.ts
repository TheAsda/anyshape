// ============================================================
// Behavior runtime
// ------------------------------------------------------------
// A behavior declares what triggers it, what it reads and what it writes, and
// a run function. The runtime:
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
//               values. Cycles between registrations are rejected.
//   • Own writes never trigger the instance that made them (origins are
//               per instance: "behavior:<name>@<instance>").
//   • Writes  – buffered during a run and applied only when it completes.
//   • Errors  – caught per run and passed to onError (default console.error);
//               the run's writes are dropped and the form keeps running.
//   • Writers – one behavior per target (value, or meta key). Keys owned by a
//               feature can only be written by that feature's behaviors.
//   • Access  – ctx.get / ctx.set only accept declared references.
//   • Defaults– key definitions with `behavior` (touched, dirty) register a
//               feature behavior per node, limited to that node.
//   • Runtime registration – store.addBehavior(...) runs every check above and
//               returns a dispose function; disposing resets the meta keys
//               the behavior wrote to their defaults.
//
// Not in this stage: async runs (stage 4, with validation).
// ============================================================

import { ShapeNode, ObjectNode, ArrayNode, MetaRef, type AnyNode, type InferValue } from "./shape";
import {
  refNode, refKey, refLabel, scopeOf, chainTo, rootOf, isAncestorOrSelf, storeWithin, hostFor, concreteScopePath,
  FIELDS, META_DEFS, defOf,
} from "./internal";
import {
  RootStore, BaseStore, ItemStore, ArrayStore, CountRef, InitialRef, initialOf,
  type AnyRef, type RefValue, type Origin, type ChangeInfo, type Unsubscribe, type RuntimeHooks,
} from "./store";

export type OriginKind = "user" | "program" | "initial" | "behavior";
export type WritableRef = AnyNode | MetaRef<any>;

// ============================================================
// Definitions
// ============================================================
export interface Guard {
  readonly refs: readonly AnyRef[];
  readonly test: (...values: any[]) => boolean;
}

/** A condition over declared references. Its references become triggers. */
export function when<const Rs extends readonly AnyRef[]>(
  refs: Rs,
  test: (...values: { -readonly [K in keyof Rs]: RefValue<Rs[K]> }) => boolean
): Guard {
  return { refs, test: test as (...values: any[]) => boolean };
}

export interface BehaviorContext {
  /** Read a declared reference (trigger, read, write or guard). Pending writes of this run are visible. */
  get<R extends AnyRef>(ref: R): RefValue<R>;
  /** Write a declared target. Applied when the run completes. */
  set<R extends WritableRef>(ref: R, value: InferValue<R>): void;
  /** Initial value of a declared node (declare `initialOf(node)`). */
  initial<N extends AnyNode>(node: N): InferValue<N>;
  /** Did this trigger change since the last run? Always false on the initial run. */
  changed(ref: AnyRef): boolean;
  /** true for the run made when the instance is created. */
  readonly isInit: boolean;
  /** Origins of the changes that caused this run (own writes excluded). */
  readonly origins: ReadonlySet<Origin>;
  /** Per-instance state, kept between runs (e.g. "the user overrode this"). */
  readonly state: Record<string, unknown>;
  /** The store of the instance's scope (root or row). */
  readonly store: BaseStore<any>;
}

export interface BehaviorConfig {
  /** Used in errors, dev tools and origins. */
  name?: string;
  /** Changes to these run the behavior. */
  triggers?: readonly AnyRef[];
  /** Readable in run, never trigger it. */
  reads?: readonly AnyRef[];
  /** The only targets ctx.set accepts. One writer per target. */
  writes?: readonly WritableRef[];
  /** Default: both true. */
  runOn?: { init?: boolean; change?: boolean };
  /** Run on changes only when at least one origin is of these kinds. Default: any. */
  origins?: readonly OriginKind[];
  /** All guards must pass; otherwise the run is skipped (previous writes stay). */
  when?: Guard | readonly Guard[];
  run(ctx: BehaviorContext): void;
}

/**
 * @internal A side of a when / otherwise split. Behaviors in opposite sides of
 * the same split never run together, so they may write the same target.
 */
export interface Branch {
  readonly group: object;
  readonly side: 0 | 1;
}

export class Behavior {
  /** @internal */
  constructor(
    readonly config: BehaviorConfig,
    /** @internal set for feature (default) behaviors: node the behavior is limited to */
    readonly _self?: AnyNode,
    /** @internal when / otherwise splits this behavior is inside of (builder) */
    readonly _branches: readonly Branch[] = []
  ) {}
}

function exclusiveBranches(a: Registration, b: Registration): boolean {
  return a.behavior._branches.some((x) => b.behavior._branches.some((y) => x.group === y.group && x.side !== y.side));
}

/** Anything addBehavior / createStore accept: behaviors and validation rules. */
export type AnyBehavior = Behavior | RuleLike;

/** @internal Validation rules are handled by the validation layer (validation.ts). */
export interface RuleLike {
  readonly _rule: true;
}

function isRule(x: unknown): x is RuleLike {
  return typeof x === "object" && x !== null && (x as RuleLike)._rule === true;
}

/** @internal A change of validation queues, applied atomically with other registrations. */
export interface QueueChange {
  /** Queue registrations to remove; `resetMeta` clears what they wrote. */
  remove: { reg: Registration; resetMeta: boolean }[];
  /** Queue behaviors to register on the root. */
  add: { behavior: Behavior; registered(reg: Registration): void }[];
  /** Update rule lists – called after all checks passed, before registering. */
  commit(): void;
}

/** @internal Installed by the validation layer. */
export interface RuleHooks {
  change(host: BaseStore<any>, added: readonly RuleLike[], removed: readonly RuleLike[]): QueueChange;
}

export function defineBehavior(config: BehaviorConfig): Behavior {
  if (typeof config?.run !== "function") throw new Error("defineBehavior: `run` must be a function");
  return new Behavior(config);
}

export interface BehaviorErrorInfo {
  behavior: string;
  /** Concrete path of the instance's scope, e.g. "lines[2]" ("" for the root). */
  scope: string;
}

export interface StoreOptions {
  behaviors?: AnyBehavior | readonly AnyBehavior[];
  /** Called when a behavior throws. Default: console.error. */
  onError?: (error: unknown, info: BehaviorErrorInfo) => void;
}

function kindOf(origin: Origin): OriginKind {
  return origin.startsWith("behavior:") ? "behavior" : (origin as OriginKind);
}

/** Does writing `w` possibly change the value of input `r`? */
function affects(w: WritableRef, r: AnyRef): boolean {
  if (r instanceof InitialRef) return false;
  if (w instanceof ShapeNode) {
    if (r instanceof ShapeNode) return isAncestorOrSelf(w, r) || isAncestorOrSelf(r, w);
    if (r instanceof CountRef) return isAncestorOrSelf(w, r.node) || isAncestorOrSelf(r.node, w);
    return false;
  }
  if (r instanceof MetaRef) {
    if (w.key !== r.key) return false;
    return w.node === r.node || (!!defOf(r).options.inherit && isAncestorOrSelf(w.node, r.node));
  }
  if (r instanceof CountRef) return w.key === r.key && isAncestorOrSelf(r.node, w.node);
  return false;
}

/** Do two write targets overlap (the same data)? */
function overlaps(a: WritableRef, b: WritableRef): boolean {
  if (a instanceof ShapeNode && b instanceof ShapeNode) return isAncestorOrSelf(a, b) || isAncestorOrSelf(b, a);
  if (a instanceof MetaRef && b instanceof MetaRef) return a.node === b.node && a.key === b.key;
  return false;
}

// ============================================================
// Registrations, bindings, instances
// ============================================================
let regCounter = 0;
let instanceCounter = 0;

/** @internal */
export interface Registration {
  seq: number;
  name: string;
  behavior: Behavior;
  config: BehaviorConfig;
  feature: boolean;
  /** Store the behavior was registered on (a scope host). */
  host: BaseStore<any>;
  scope: AnyNode;
  chain: AnyNode[];
  triggers: AnyRef[];
  inputs: AnyRef[];
  writes: WritableRef[];
  guards: Guard[];
  declared: Set<string>;
  writable: Set<string>;
  kinds: Set<OriginKind> | undefined;
  runInit: boolean;
  runChange: boolean;
  rank: number;
  disposed: boolean;
  root: Binding | undefined;
}

interface Pending {
  init: boolean;
  changed: Set<string>;
  origins: Set<Origin>;
}

/**
 * One level of a registration's binding tree. The leaf level (host.node ===
 * reg.scope) is an instance; the levels above watch an array and hold one
 * child binding per row.
 */
class Binding {
  readonly offs: Unsubscribe[] = [];
  // leaf
  readonly id = instanceCounter++;
  readonly state: Record<string, unknown> = {};
  readonly origin: Origin;
  // non-leaf
  arrStore: ArrayStore<any> | undefined;
  readonly rows = new WeakMap<ItemStore<any>, Binding>();

  constructor(
    readonly reg: Registration,
    readonly host: BaseStore<any>,
    readonly depth: number
  ) {
    this.origin = `behavior:${reg.name}@${this.id}`;
  }

  get isLeaf(): boolean {
    return this.host.node === this.reg.scope;
  }
}

// ============================================================
// Handles
// ============================================================
/** Returned by addBehavior: call it to remove the behaviors; pass it to replaceBehavior to swap them. */
export type BehaviorHandle = (() => void) & { readonly __behaviorHandle?: never };

interface HandleEntry {
  runtime: BehaviorRuntime;
  host: BaseStore<any>;
  regs: Registration[];
  rules: RuleLike[];
  disposed: boolean;
}

const handles = new WeakMap<BehaviorHandle, HandleEntry>();

// ============================================================
// Runtime
// ============================================================
export class BehaviorRuntime implements RuntimeHooks {
  private readonly regs: Registration[] = [];
  private readonly pending = new Map<Binding, Pending>();
  /** @internal set by the validation layer */
  rules: RuleHooks | undefined;

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

  add(host: BaseStore<any>, behaviors: AnyBehavior | readonly AnyBehavior[], feature = false): BehaviorHandle {
    return this.swap(host, undefined, behaviors, feature);
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
    return this.swap(entry.host, entry, behaviors, false);
  }

  private swap(host: BaseStore<any>, previous: HandleEntry | undefined, behaviors: AnyBehavior | readonly AnyBehavior[], feature: boolean): BehaviorHandle {
    const list = (Array.isArray(behaviors) ? behaviors : [behaviors]) as readonly AnyBehavior[];
    if (!host.isAttached()) throw new Error("Cannot add behaviors to a detached row");
    const rules = list.filter(isRule);
    const plain = list.filter((b): b is Behavior => !isRule(b));
    const oldRules = previous?.rules ?? [];
    if ((rules.length || oldRules.length) && !this.rules) throw new Error("Validation rules need a store created with createStore()");

    const change = rules.length || oldRules.length ? this.rules!.change(host, rules, oldRules) : undefined;
    const regs = this.apply(
      host,
      plain.map((b) => ({ behavior: b, feature: feature || b._self !== undefined })),
      change,
      previous?.regs ?? []
    );
    if (previous) previous.disposed = true;

    const entry: HandleEntry = { runtime: this, host, regs, rules, disposed: false };
    const handle = (() => {
      if (entry.disposed) return;
      entry.disposed = true;
      this.store._batch(() => {
        this.dispose(regs);
        if (rules.length) this.apply(host, [], this.rules!.change(host, [], rules), []);
      });
    }) as BehaviorHandle;
    handles.set(handle, entry);
    return handle;
  }

  /**
   * Registers behaviors, removes `removing` and applies a queue change as one
   * transaction: every check (scope, writers, cycles) runs before anything changes.
   */
  private apply(
    host: BaseStore<any>,
    items: { behavior: Behavior; feature: boolean }[],
    change: QueueChange | undefined,
    removing: readonly Registration[]
  ): Registration[] {
    const regs = items.map((i) => this.prepare(host, i.behavior, i.feature));
    const queueRegs = (change?.add ?? []).map((a) => this.prepare(this.store, a.behavior, true));
    const removed = new Set([...(change?.remove ?? []).map((r) => r.reg), ...removing]);
    const kept = this.regs.filter((r) => !removed.has(r));
    this.checkWriters([...regs, ...queueRegs], kept);
    this.rank([...kept, ...regs, ...queueRegs]); // throws on cycles, before any state change

    this.store._batch(() => {
      for (const reg of removing) this.unregister(reg, true);
      for (const { reg, resetMeta } of change?.remove ?? []) this.unregister(reg, resetMeta);
      change?.commit();
      for (const reg of regs) this.register(reg, host);
      queueRegs.forEach((reg, i) => {
        this.register(reg, this.store);
        change!.add[i].registered(reg);
      });
    });
    return regs;
  }

  private register(reg: Registration, host: BaseStore<any>): void {
    this.regs.push(reg);
    reg.root = this.bind(reg, host, reg.chain.indexOf(host.node), true);
  }

  // ---- reset ----
  reinit(store: BaseStore<any>, node: AnyNode): void {
    const resetHost = store._host;
    const inside = (leafHost: BaseStore<any>): boolean => {
      if (storeWithin(resetHost, leafHost)) return true; // the reset store's scope, or an enclosing one
      // A row below the reset store: its array must be inside `node`.
      for (let h: BaseStore<any> = leafHost; h instanceof ItemStore; h = h.arrayStore._host) {
        if (h.arrayStore._host === resetHost) return isAncestorOrSelf(node, h.arrayStore.node);
      }
      return false;
    };
    for (const reg of this.regs) {
      if (reg.disposed || !reg.runInit || !reg.root) continue;
      if (!reg.writes.some((w) => isAncestorOrSelf(node, refNode(w)))) continue;
      for (const leaf of this.leaves(reg.root)) if (inside(leaf.host)) this.mark(leaf, { init: true });
    }
  }

  // ---- registration ----
  private prepare(host: BaseStore<any>, behavior: Behavior, feature: boolean): Registration {
    if (!(behavior instanceof Behavior)) throw new Error("Expected a behavior created with defineBehavior()");
    const config = behavior.config;
    const seq = regCounter++;
    const name = config.name ?? (behavior._self ? `feature` : `b${seq}`);
    const guards = config.when === undefined ? [] : Array.isArray(config.when) ? [...config.when] : [config.when as Guard];
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

    // Writes: nodes and meta keys only, never feature-owned keys (unless feature).
    for (const w of writes) {
      if (!(w instanceof ShapeNode || w instanceof MetaRef)) fail(`cannot write "${refLabel(w as AnyRef)}" – only values and meta keys are writable`);
      if (w instanceof MetaRef && defOf(w).options.owner === "feature" && !feature) {
        fail(`"${w.path}" is owned by its feature and cannot be written by other behaviors`);
      }
    }

    // Feature (default) behaviors are limited to their own node.
    if (behavior._self) {
      const self = behavior._self;
      for (const ref of all) {
        if (refNode(ref) !== self || ref instanceof CountRef) fail(`default behaviors may only use their own node ("${self.path || "<root>"}"), got "${refLabel(ref)}"`);
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

    return {
      seq, name, behavior, config, feature, host, scope, chain,
      triggers, inputs: [...triggers, ...reads], writes, guards,
      declared: new Set(all.map(refKey)),
      writable: new Set(writes.map(refKey)),
      kinds: config.origins ? new Set(config.origins) : undefined,
      runInit: config.runOn?.init !== false,
      runChange: config.runOn?.change !== false,
      rank: 0, disposed: false, root: undefined,
    };
  }

  /** One writer per target among registrations whose regions overlap. */
  private checkWriters(added: Registration[], current: Registration[]): void {
    const existing = [...current];
    for (const reg of added) {
      for (const other of existing) {
        if (!(storeWithin(reg.host, other.host) || storeWithin(other.host, reg.host))) continue;
        if (exclusiveBranches(reg, other)) continue;
        for (const w of reg.writes) {
          const hit = other.writes.find((o) => overlaps(w, o));
          if (hit) {
            throw new Error(
              `Behavior "${reg.name}": "${refLabel(w)}" is already written by "${other.name}"` +
                (hit === w ? "" : ` (via "${refLabel(hit)}")`) + " – one writer per target"
            );
          }
        }
      }
      existing.push(reg);
    }
  }

  /** Longest-path ranks over the dependency graph; throws on cycles. */
  private rank(regs: Registration[]): void {
    const edges = new Map<Registration, Registration[]>(regs.map((r) => [r, []]));
    const indegree = new Map<Registration, number>(regs.map((r) => [r, 0]));
    for (const a of regs) {
      for (const b of regs) {
        if (a === b) continue;
        if (a.writes.some((w) => b.inputs.some((r) => affects(w, r)))) {
          edges.get(a)!.push(b);
          indegree.set(b, indegree.get(b)! + 1);
        }
      }
    }
    const ranks = new Map<Registration, number>();
    const queue = regs.filter((r) => indegree.get(r) === 0);
    for (const r of queue) ranks.set(r, 0);
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i];
      for (const b of edges.get(a)!) {
        ranks.set(b, Math.max(ranks.get(b) ?? 0, ranks.get(a)! + 1));
        indegree.set(b, indegree.get(b)! - 1);
        if (indegree.get(b) === 0) queue.push(b);
      }
    }
    if (queue.length !== regs.length) {
      const cycle = regs.filter((r) => indegree.get(r)! > 0).map((r) => `"${r.name}"`);
      throw new Error(`Behaviors form a cycle: ${cycle.join(", ")} – merge them into one behavior (see link())`);
    }
    for (const r of regs) r.rank = ranks.get(r)!;
  }

  // ---- binding tree ----
  private bind(reg: Registration, host: BaseStore<any>, depth: number, isRoot: boolean): Binding {
    const binding = new Binding(reg, host, depth);

    // Triggers of this level's scope; the root binding also takes every scope above it.
    for (const ref of reg.triggers) {
      const scope = scopeOf(refNode(ref));
      const level = reg.chain.indexOf(scope);
      if (level === depth || (isRoot && level < depth)) {
        const target = hostFor(host, scope);
        binding.offs.push(target.react(ref, (_n, _p, info) => this.onTrigger(binding, ref, info)));
      }
    }

    if (binding.isLeaf) {
      if (reg.runInit) this.mark(binding, { init: true });
    } else {
      const next = reg.chain[depth + 1];
      const arrStore = host.substore(next.parent as ArrayNode<any, any>) as ArrayStore<any>;
      binding.arrStore = arrStore;
      let seq = arrStore.items();
      for (const row of seq) this.child(binding, row);
      binding.offs.push(
        host.react(arrStore.node, () => {
          if (reg.disposed) return;
          const now = arrStore.items();
          if (now === seq) return;
          seq = now;
          for (const row of now) this.child(binding, row);
        })
      );
    }
    return binding;
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
    if (reg.disposed || !reg.runChange) return;
    const key = refKey(ref);
    for (const leaf of this.leaves(binding)) {
      const origins = new Set(info.origins);
      origins.delete(leaf.origin);
      if (info.origins.size > 0 && origins.size === 0) continue; // only its own writes
      if (reg.kinds && ![...origins].some((o) => reg.kinds!.has(kindOf(o)))) continue;
      this.mark(leaf, { changed: key, origins });
    }
  }

  private mark(leaf: Binding, change: { init?: boolean; changed?: string; origins?: Set<Origin> }): void {
    let p = this.pending.get(leaf);
    if (!p) this.pending.set(leaf, (p = { init: false, changed: new Set(), origins: new Set() }));
    if (change.init) p.init = true;
    if (change.changed) p.changed.add(change.changed);
    if (change.origins) for (const o of change.origins) p.origins.add(o);
  }

  // ---- running ----
  private run(leaf: Binding, p: Pending): void {
    const reg = leaf.reg;
    if (reg.disposed || !leaf.host.isAttached()) return;
    const info = (): BehaviorErrorInfo => ({ behavior: reg.name, scope: concreteScopePath(leaf.host) });

    const buffer = new Map<string, { ref: WritableRef; value: unknown }>();
    const read = (ref: AnyRef): any => {
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
        const key = refKey(ref);
        if (!reg.writable.has(key)) throw new Error(`Behavior "${reg.name}": "${refLabel(ref)}" is not declared in writes`);
        buffer.delete(key); // keep insertion order = last write
        buffer.set(key, { ref, value });
      },
      initial: (node) => read(initialOf(node)),
      changed: (ref) => p.changed.has(refKey(ref)),
      isInit: p.init,
      origins: p.origins,
      state: leaf.state,
      store: leaf.host,
    };

    try {
      for (const guard of reg.guards) {
        if (!guard.test(...guard.refs.map(read))) return;
      }
      const result: unknown = reg.config.run(ctx);
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        throw new Error(`Behavior "${reg.name}": async behaviors are not supported yet`);
      }
      for (const { ref, value } of buffer.values()) {
        hostFor(leaf.host, scopeOf(refNode(ref))).set(ref as any, value as never, { origin: leaf.origin });
      }
    } catch (error) {
      this.onError(error, info());
    }
  }

  // ---- disposal ----
  private dispose(regs: Registration[]): void {
    const live = regs.filter((r) => !r.disposed);
    if (!live.length) return;
    this.store._batch(() => {
      for (const reg of live) this.unregister(reg, true);
    });
  }

  private unregister(reg: Registration, resetMeta: boolean): void {
    if (reg.disposed) return;
    reg.disposed = true;
    this.regs.splice(this.regs.indexOf(reg), 1);
    for (const leaf of this.pending.keys()) if (leaf.reg === reg) this.pending.delete(leaf);
    if (reg.root) this.unbind(reg, reg.root, resetMeta);
    this.rank(this.regs);
  }

  private unbind(reg: Registration, binding: Binding, resetMeta: boolean): void {
    for (const off of binding.offs) off();
    if (binding.isLeaf) {
      if (!resetMeta || !binding.host.isAttached()) return;
      // Meta the behavior wrote goes back to its default.
      for (const w of reg.writes) {
        if (w instanceof MetaRef) binding.host.set(w, defOf(w).defaultValue as never, { origin: binding.origin });
      }
      return;
    }
    for (const row of binding.arrStore!.items()) {
      const child = binding.rows.get(row);
      if (child) this.unbind(reg, child, resetMeta);
    }
  }
}

// ============================================================
// Default behaviors from key definitions
// ============================================================
/** @internal Feature behaviors declared by key definitions, one per node. */
export function defaultBehaviors(root: AnyNode): Behavior[] {
  const out: Behavior[] = [];
  const visit = (node: AnyNode) => {
    for (const [key, def] of Object.entries(node[META_DEFS])) {
      const factory = def.options.behavior;
      if (!factory) continue;
      const config = factory(node) as BehaviorConfig;
      out.push(new Behavior({ ...config, name: config.name ?? `${node.path || "<root>"}#${key}` }, node));
    }
    if (node instanceof ObjectNode) for (const child of Object.values(node[FIELDS] as Record<string, AnyNode>)) visit(child);
    if (node instanceof ArrayNode) visit(node.item);
  };
  visit(root);
  return out;
}
