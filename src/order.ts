// ============================================================
// Run order (internal, runtime.ts only)
// ------------------------------------------------------------
// The dependency graph between registrations (A writes what B triggers on or
// reads → A before B) and each registration's rank: the longest path to it.
// A flush runs the lowest pending rank first, equal ranks by seq.
//
// A registration change is planned, then committed. The plan finds the new
// edges through indexes by scope host and node, and recomputes the ranks only
// of what the change reaches; it throws on a cycle before anything changes.
// A write is kept under its registration's host, an input under the host that
// reads it: the registration's, or an enclosing one for a reference to an
// enclosing scope. A write and an input are linked only when those hosts are
// on one line of the host tree: a row's writes never reach a sibling row's
// inputs of its own scope, but do reach a sibling's reads of the whole list.
// The one-writer check (runtime.ts) lists the writes through the same index.
// ============================================================

import type { AnyNode } from "./shape.js";
import { refNode, refKey, outerHost, scopeOf, hostAt } from "./internal.js";
import type { AnyRef, BaseStore } from "./store.js";
import { kindOf, type Target } from "./refs/kind.js";

/** What the run order needs from a registration. */
export interface Ranked {
  readonly seq: number;
  readonly name: string;
  /** The scope host it was registered on. */
  readonly host: BaseStore<any>;
  readonly targets: readonly Target[];
  readonly inputs: readonly AnyRef[];
  rank: number;
}

/** Does writing `w` possibly change the value of input `r`? */
function affects(w: Target, r: AnyRef): boolean {
  return kindOf(r).affectedBy(r, w);
}

/**
 * Items by node. A write and what it overlaps or affects are on one line of
 * the tree (see RefKind.affectedBy): `near` finds them without a pass over
 * every item.
 */
export class NodeIndex<T> {
  private readonly at = new Map<AnyNode, Set<T>>();
  /** Items on the node or below it. */
  private readonly under = new Map<AnyNode, Set<T>>();

  add(node: AnyNode, item: T): void {
    entry(this.at, node, newSet).add(item);
    for (let n: AnyNode | undefined = node; n; n = n.parent) entry(this.under, n, newSet).add(item);
  }

  delete(node: AnyNode, item: T): void {
    const remove = (set: Set<T>) => set.delete(item) && !set.size;
    prune(this.at, node, remove);
    for (let n: AnyNode | undefined = node; n; n = n.parent) prune(this.under, n, remove);
  }

  /** Calls `fn` for the items on `node`, below it, or on one of its ancestors. */
  near(node: AnyNode, fn: (item: T) => void): void {
    this.under.get(node)?.forEach((item) => fn(item));
    for (let n = node.parent; n; n = n.parent) this.at.get(n)?.forEach((item) => fn(item));
  }

  /** `under` holds the same items as `at`, so it empties with it. */
  isEmpty(): boolean {
    return !this.at.size;
  }
}

/**
 * Items by scope host, then by node. `near` lists the items of a host, of the
 * hosts inside it and of those enclosing it: never those of a sibling row.
 */
class HostIndex<T> {
  private readonly at = new Map<BaseStore<any>, NodeIndex<T>>();
  /** Items of the hosts inside the host: a row without nested rows has none. */
  private readonly inner = new Map<BaseStore<any>, NodeIndex<T>>();

  add(host: BaseStore<any>, node: AnyNode, item: T): void {
    entry(this.at, host, newIndex).add(node, item);
    for (let h = outerHost(host); h; h = outerHost(h)) entry(this.inner, h, newIndex).add(node, item);
  }

  delete(host: BaseStore<any>, node: AnyNode, item: T): void {
    const remove = (index: NodeIndex<T>) => {
      index.delete(node, item);
      return index.isEmpty();
    };
    prune(this.at, host, remove);
    for (let h = outerHost(host); h; h = outerHost(h)) prune(this.inner, h, remove);
  }

  /** NodeIndex.near among the items of `host`, of the hosts inside it, and of the hosts enclosing it. */
  near(host: BaseStore<any>, node: AnyNode, fn: (item: T) => void): void {
    this.at.get(host)?.near(node, fn);
    this.inner.get(host)?.near(node, fn);
    for (let h = outerHost(host); h; h = outerHost(h)) this.at.get(h)?.near(node, fn);
  }
}

const newSet = <T>() => new Set<T>();
const newIndex = <T>() => new NodeIndex<T>();

/** `map`'s entry for `key`, created when missing. */
function entry<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (value === undefined) map.set(key, (value = create()));
  return value;
}

/** Removes from `map`'s entry for `key`; `remove` tells whether the entry is then empty, and it is dropped. */
function prune<K, V>(map: Map<K, V>, key: K, remove: (value: V) => boolean): void {
  const value = map.get(key);
  if (value !== undefined && remove(value)) map.delete(key);
}

/**
 * One write of a registration: `reg.targets[at]`, kept apart because an
 * owner refreshed in place is indexed from its fresh declarations before
 * `reg` takes them over.
 */
export interface Write<R> {
  readonly reg: R;
  readonly target: Target;
  readonly at: number;
}

interface Input<R extends Ranked> {
  readonly vertex: Vertex<R>;
  readonly ref: AnyRef;
  readonly node: AnyNode;
  /** The host that reads `ref`: see readerOf. */
  readonly host: BaseStore<any>;
}

/**
 * The host whose value `node` is read on, from a registration on `host`: the
 * enclosing host of the node's scope, or `host` itself for a node in its scope
 * or inside it (read in each of its rows).
 */
function readerOf(host: BaseStore<any>, node: AnyNode): BaseStore<any> {
  return hostAt(host, scopeOf(node)) ?? host;
}

class Vertex<R extends Ranked> {
  readonly succ = new Set<Vertex<R>>();
  readonly pred = new Set<Vertex<R>>();
  readonly writes: Write<R>[];
  readonly inputs: Input<R>[];

  /** `declaredBy` declares its edges: `reg` itself, unless an owner is refreshed in place. */
  constructor(readonly reg: R, declaredBy: Ranked) {
    this.writes = declaredBy.targets.map((target, at) => ({ reg, target, at }));
    this.inputs = declaredBy.inputs.map((ref) => {
      const node = refNode(ref);
      return { vertex: this, ref, node, host: readerOf(reg.host, node) };
    });
  }

  /** Does `decl` declare the same edges? */
  declares(decl: Ranked): boolean {
    const { targets, inputs } = decl;
    return (
      targets.length === this.writes.length &&
      targets.every((t, i) => t.node === this.writes[i].target.node && t.key === this.writes[i].target.key) &&
      inputs.length === this.inputs.length &&
      inputs.every((r, i) => refKey(r) === refKey(this.inputs[i].ref))
    );
  }
}

/** A registration to rank. An owner refreshed in place keeps its `reg`, `declaredBy` its fresh registration. */
export interface Addition<R> {
  readonly reg: R;
  readonly declaredBy: Ranked;
}

/** The graph a plan leads to: the committed edges between the vertices that stay, plus the new ones. */
class Planned<R extends Ranked> {
  /** New edges, each starting or ending at a fresh vertex. */
  readonly out = new Map<Vertex<R>, Set<Vertex<R>>>();
  readonly into = new Map<Vertex<R>, Set<Vertex<R>>>();

  constructor(readonly gone: ReadonlySet<Vertex<R>>) {}

  link(a: Vertex<R>, b: Vertex<R>): void {
    if (a === b) return;
    entry(this.out, a, newSet).add(b);
    entry(this.into, b, newSet).add(a);
  }

  succ(v: Vertex<R>): Vertex<R>[] {
    return [...v.succ, ...(this.out.get(v) ?? [])].filter((s) => !this.gone.has(s));
  }

  pred(v: Vertex<R>): Vertex<R>[] {
    return [...v.pred, ...(this.into.get(v) ?? [])].filter((p) => !this.gone.has(p));
  }
}

export class RunOrder<R extends Ranked> {
  private readonly vertices = new Map<R, Vertex<R>>();
  private readonly writes = new HostIndex<Write<R>>();
  private readonly inputs = new HostIndex<Input<R>>();

  /**
   * Calls `fn` for the registered writes that may overlap a write to `node`
   * from `host`: those whose hosts are `host`, inside it, or enclosing it.
   */
  writesNear(host: BaseStore<any>, node: AnyNode, fn: (write: Write<R>) => void): void {
    this.writes.near(host, node, fn);
  }

  /**
   * Plans adding `added` and removing `removed` as one change: finds the new
   * edges and the ranks that change. Throws on a cycle; otherwise returns the
   * commit, which applies the change and sets the ranks.
   */
  plan(added: readonly Addition<R>[], removed: ReadonlySet<R>): () => void {
    const gone = new Set<Vertex<R>>();
    for (const reg of removed) {
      const v = this.vertices.get(reg);
      if (v) gone.add(v);
    }
    // An owner refreshed in place with the same declarations keeps its vertex.
    const fresh: Vertex<R>[] = [];
    for (const a of added) {
      const kept = this.vertices.get(a.reg);
      if (kept && gone.has(kept) && kept.declares(a.declaredBy)) gone.delete(kept);
      else fresh.push(new Vertex(a.reg, a.declaredBy));
    }

    const graph = new Planned(gone);
    // Edges between fresh vertices: only with more than one. They need no host
    // filter: a change adds them on one host, plus the root for owners.
    const batch = fresh.length > 1 ? new NodeIndex<Input<R>>() : undefined;
    if (batch) for (const v of fresh) for (const input of v.inputs) batch.add(input.node, input);
    for (const v of fresh) {
      for (const { target } of v.writes) {
        const reach = (input: Input<R>) => {
          if (!gone.has(input.vertex) && affects(target, input.ref)) graph.link(v, input.vertex);
        };
        this.inputs.near(v.reg.host, target.node, reach);
        batch?.near(target.node, reach);
      }
      // Edges between fresh vertices were found above, from the writer's side.
      for (const { ref, node, host } of v.inputs) {
        this.writes.near(host, node, (w) => {
          const writer = this.vertices.get(w.reg)!;
          if (!gone.has(writer) && affects(w.target, ref)) graph.link(writer, v);
        });
      }
    }

    // The ranks that change; the others stay as they are.
    const ranks = new Map<Vertex<R>, number>();
    const rankOf = (v: Vertex<R>) => ranks.get(v) ?? v.reg.rank;

    // Removals: a rank can only fall, after a removed vertex that ended a
    // longest path to it. Walked by old rank, a topological order, over the
    // committed edges: the new ones only raise ranks, below.
    const byRank: Vertex<R>[][] = [];
    const queued = new Set<Vertex<R>>();
    const lower = (from: Vertex<R>) => {
      for (const s of from.succ) {
        if (gone.has(s) || queued.has(s) || from.reg.rank + 1 !== s.reg.rank) continue;
        queued.add(s);
        (byRank[s.reg.rank] ??= []).push(s);
      }
    };
    for (const g of gone) lower(g);
    for (let r = 0; r < byRank.length; r++) {
      for (const v of byRank[r] ?? []) {
        let rank = 0;
        for (const p of v.pred) {
          if (gone.has(p)) continue;
          rank = Math.max(rank, rankOf(p) + 1);
          if (rank === v.reg.rank) break;
        }
        if (rank === v.reg.rank) continue;
        ranks.set(v, rank);
        lower(v);
      }
    }

    // Additions: a rank can only rise, along the new edges and on from there.
    // In a cycle it rises past any longest path.
    const size = this.vertices.size - gone.size + fresh.length;
    for (const v of fresh) ranks.set(v, 0);
    const raised: Vertex<R>[] = [];
    const raise = (a: Vertex<R>, b: Vertex<R>) => {
      const rank = rankOf(a) + 1;
      if (rank <= rankOf(b)) return;
      if (rank >= size) throw this.cycle(fresh, graph);
      ranks.set(b, rank);
      raised.push(b);
    };
    for (const [a, bs] of graph.out) for (const b of bs) raise(a, b);
    while (raised.length) {
      const v = raised.pop()!;
      for (const s of graph.succ(v)) raise(v, s);
    }

    return () => {
      for (const v of gone) {
        for (const s of v.succ) s.pred.delete(v);
        for (const p of v.pred) p.succ.delete(v);
        for (const w of v.writes) this.writes.delete(v.reg.host, w.target.node, w);
        for (const input of v.inputs) this.inputs.delete(input.host, input.node, input);
        this.vertices.delete(v.reg);
      }
      for (const v of fresh) {
        for (const w of v.writes) this.writes.add(v.reg.host, w.target.node, w);
        for (const input of v.inputs) this.inputs.add(input.host, input.node, input);
        this.vertices.set(v.reg, v);
      }
      for (const [a, bs] of graph.out) {
        for (const b of bs) {
          a.succ.add(b);
          b.pred.add(a);
        }
      }
      for (const [v, rank] of ranks) v.reg.rank = rank;
    };
  }

  /**
   * The error for a change that forms a cycle. It names the vertices a
   * topological sort of what the fresh ones reach cannot place: the cycle and
   * what follows it.
   */
  private cycle(fresh: readonly Vertex<R>[], graph: Planned<R>): Error {
    const region = new Set<Vertex<R>>();
    const stack = [...fresh];
    while (stack.length) {
      const v = stack.pop()!;
      if (region.has(v)) continue;
      region.add(v);
      stack.push(...graph.succ(v));
    }
    const waiting = new Map<Vertex<R>, number>();
    for (const v of region) {
      waiting.set(v, graph.pred(v).filter((p) => region.has(p)).length);
    }
    const queue = [...region].filter((v) => waiting.get(v) === 0);
    for (let i = 0; i < queue.length; i++) {
      for (const s of graph.succ(queue[i])) {
        const n = waiting.get(s)! - 1;
        waiting.set(s, n);
        if (n === 0) queue.push(s);
      }
    }
    const placed = new Set(queue);
    const names = [...region].filter((v) => !placed.has(v)).sort((a, b) => a.reg.seq - b.reg.seq).map((v) => `"${v.reg.name}"`);
    return new Error(`Behaviors form a cycle: ${names.join(", ")} – merge them into one behavior that writes all their targets`);
  }
}
