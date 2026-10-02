// ============================================================
// Run order (internal, behaviors.ts only)
// ------------------------------------------------------------
// The dependency graph between registrations (A writes what B triggers on or
// reads → A before B) and each registration's rank: the longest path to it.
// A flush runs the lowest pending rank first, equal ranks by seq.
//
// A registration change is planned, then committed. The plan finds the new
// edges through indexes by node and recomputes the ranks only of what the
// change reaches; it throws on a cycle before anything changes.
// ============================================================

import type { AnyNode } from "./shape";
import { refNode, refKey } from "./internal";
import type { AnyRef } from "./store";
import { kindOf, type Target } from "./refs/kind";

/** What the run order needs from a registration. */
export interface Ranked {
  readonly seq: number;
  readonly name: string;
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
    setOf(this.at, node).add(item);
    for (let n: AnyNode | undefined = node; n; n = n.parent) setOf(this.under, n).add(item);
  }

  delete(node: AnyNode, item: T): void {
    unset(this.at, node, item);
    for (let n: AnyNode | undefined = node; n; n = n.parent) unset(this.under, n, item);
  }

  /** Calls `fn` for the items on `node`, below it, or on one of its ancestors. */
  near(node: AnyNode, fn: (item: T) => void): void {
    this.under.get(node)?.forEach((item) => fn(item));
    for (let n = node.parent; n; n = n.parent) this.at.get(n)?.forEach((item) => fn(item));
  }
}

function setOf<K, T>(map: Map<K, Set<T>>, key: K): Set<T> {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  return set;
}

function unset<T>(map: Map<AnyNode, Set<T>>, node: AnyNode, item: T): void {
  const set = map.get(node);
  if (set?.delete(item) && !set.size) map.delete(node);
}

/** One write of a registration: `reg.targets[at]`. */
export interface Write<R> {
  readonly reg: R;
  readonly target: Target;
  readonly at: number;
}

interface Input<R extends Ranked> {
  readonly vertex: Vertex<R>;
  readonly ref: AnyRef;
}

class Vertex<R extends Ranked> {
  readonly succ = new Set<Vertex<R>>();
  readonly pred = new Set<Vertex<R>>();
  readonly writes: Write<R>[];
  readonly inputs: Input<R>[];

  /** `id` is the registration ranked; `decl` declares its edges (the same one, unless an owner is refreshed in place). */
  constructor(readonly id: R, decl: Ranked) {
    this.writes = decl.targets.map((target, at) => ({ reg: id, target, at }));
    this.inputs = decl.inputs.map((ref) => ({ vertex: this, ref }));
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

/** A registration to add: `decl` declares it; `id` is what is ranked (an owner refreshed in place keeps its registration). */
export interface Addition<R> {
  readonly id: R;
  readonly decl: Ranked;
}

export class RunOrder<R extends Ranked> {
  private readonly vertices = new Map<R, Vertex<R>>();
  private readonly writes = new NodeIndex<Write<R>>();
  private readonly inputs = new NodeIndex<Input<R>>();

  /** Calls `fn` for the registered writes that may overlap a write to `node`. */
  writesNear(node: AnyNode, fn: (write: Write<R>) => void): void {
    this.writes.near(node, fn);
  }

  /**
   * Plans adding `added` and removing `removed` as one change: finds the new
   * edges and ranks. Throws on a cycle; otherwise returns the commit, which
   * applies the change and sets the ranks.
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
      const kept = this.vertices.get(a.id);
      if (kept && gone.has(kept) && kept.declares(a.decl)) gone.delete(kept);
      else fresh.push(new Vertex(a.id, a.decl));
    }

    // New edges: each starts or ends at a fresh vertex.
    const out = new Map<Vertex<R>, Set<Vertex<R>>>();
    const into = new Map<Vertex<R>, Set<Vertex<R>>>();
    const link = (a: Vertex<R>, b: Vertex<R>) => {
      if (a === b) return;
      setOf(out, a).add(b);
      setOf(into, b).add(a);
    };
    // Edges between fresh vertices: only with more than one.
    const batch = fresh.length > 1 ? new NodeIndex<Input<R>>() : undefined;
    if (batch) for (const v of fresh) for (const input of v.inputs) batch.add(refNode(input.ref), input);
    for (const v of fresh) {
      for (const { target } of v.writes) {
        const reach = (input: Input<R>) => {
          if (!gone.has(input.vertex) && affects(target, input.ref)) link(v, input.vertex);
        };
        this.inputs.near(target.node, reach);
        batch?.near(target.node, reach);
      }
      // Edges between fresh vertices were found above, from the writer's side.
      for (const { ref } of v.inputs) {
        this.writes.near(refNode(ref), (w) => {
          const writer = this.vertices.get(w.reg)!;
          if (!gone.has(writer) && affects(w.target, ref)) link(writer, v);
        });
      }
    }

    const succ = (v: Vertex<R>): Vertex<R>[] => [...v.succ, ...(out.get(v) ?? [])].filter((s) => !gone.has(s));
    const pred = (v: Vertex<R>): Vertex<R>[] => [...v.pred, ...(into.get(v) ?? [])].filter((p) => !gone.has(p));

    // What the change reaches: the fresh vertices and the successors of the
    // removed ones, then everything after them. Other ranks stay.
    const region = new Set<Vertex<R>>();
    const stack = [...fresh, ...[...gone].flatMap((g) => [...g.succ])];
    while (stack.length) {
      const v = stack.pop()!;
      if (region.has(v) || gone.has(v)) continue;
      region.add(v);
      stack.push(...succ(v));
    }

    // Longest paths within the region (Kahn); a cycle leaves vertices unranked.
    const ranks = new Map<Vertex<R>, number>();
    const waiting = new Map<Vertex<R>, number>();
    const queue: Vertex<R>[] = [];
    for (const v of region) {
      const n = pred(v).filter((p) => region.has(p)).length;
      waiting.set(v, n);
      if (n === 0) queue.push(v);
    }
    for (let i = 0; i < queue.length; i++) {
      const v = queue[i];
      let rank = 0;
      for (const p of pred(v)) rank = Math.max(rank, (region.has(p) ? ranks.get(p)! : p.id.rank) + 1);
      ranks.set(v, rank);
      for (const s of succ(v)) {
        const n = waiting.get(s)! - 1;
        waiting.set(s, n);
        if (n === 0) queue.push(s);
      }
    }
    if (queue.length !== region.size) {
      const cycle = [...region].filter((v) => !ranks.has(v)).sort((a, b) => a.id.seq - b.id.seq).map((v) => `"${v.id.name}"`);
      throw new Error(`Behaviors form a cycle: ${cycle.join(", ")} – merge them into one behavior (see link())`);
    }

    return () => {
      for (const v of gone) {
        for (const s of v.succ) s.pred.delete(v);
        for (const p of v.pred) p.succ.delete(v);
        for (const w of v.writes) this.writes.delete(w.target.node, w);
        for (const input of v.inputs) this.inputs.delete(refNode(input.ref), input);
        this.vertices.delete(v.id);
      }
      for (const v of fresh) {
        for (const w of v.writes) this.writes.add(w.target.node, w);
        for (const input of v.inputs) this.inputs.add(refNode(input.ref), input);
        this.vertices.set(v.id, v);
      }
      for (const [a, bs] of out) {
        for (const b of bs) {
          a.succ.add(b);
          b.pred.add(a);
        }
      }
      for (const [v, rank] of ranks) v.id.rank = rank;
    };
  }
}
