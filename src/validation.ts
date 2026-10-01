// ============================================================
// Validation
// ------------------------------------------------------------
//   • Rules: rule(target, check) and asyncRule(target, check) target nodes
//     with the validation() feature. They are passed like behaviors
//     (createStore({ behaviors }) / store.addBehavior(...)).
//   • Queue: all rules of one node form its queue, run in registration order
//     until the first error; async rules run after all sync rules pass. The
//     queue is a single feature behavior – the only writer of `error` and
//     `validating` – whose triggers are the union of its rules' triggers,
//     guards, and the node's effective `visible` / `disabled`.
//   • Rule changes (a component adding or removing a rule) re-register the
//     queue atomically; per-field async state survives.
//   • Rules added on a row store apply to that row only.
//   • Hidden / disabled fields are skipped: error cleared, async aborted
//     (unless validation({ validateHidden / validateDisabled })).
//   • Guards (when) skip single rules; with no active rule the error clears.
//   • Sync rules run for every origin, including the initial run.
//   • Async rules start on user changes (debounced) – or on any change with
//     { origins: "any" } – never on creation. Otherwise the value is marked
//     unchecked and validate() checks it. Every run gets an AbortSignal; a
//     newer run, removing the row or hiding the field aborts it, and late
//     results are dropped.
//   • validate(node) forces all queues in a subtree (debounced and unchecked
//     async runs start immediately), waits for them and returns
//     { valid, errors, failures, values }. `values` leave out nodes that
//     declare visible / disabled and are hidden / disabled.
// ============================================================

import { Behavior, type Guard, type RuleLike, type RuleHooks, type QueueChange, type Registration, type BehaviorRuntime } from "./behaviors";
import {
  refNode, refKey, refLabel, scopeOf, chainTo, rootOf, isAncestorOrSelf, storeWithin, hostFor, concreteScopePath,
  FIELDS, META_DEFS,
} from "./internal";
import { ShapeNode, ObjectNode, ArrayNode, MetaRef, type AnyNode, type InferValue, type InferMeta } from "./shape";
import type { BaseStore, AnyRef, RefValue, Origin, CollectEntry } from "./store";

// ============================================================
// Types
// ============================================================
/** A node with the validation() feature. */
export type Validatable = ShapeNode<any> & {
  readonly error: MetaRef<string | undefined>;
  readonly validating: MetaRef<boolean>;
};

export interface RuleContext {
  /** Read a declared reference (the target, triggers, reads, guard refs). */
  get<R extends AnyRef>(ref: R): RefValue<R>;
}

export interface AsyncRuleContext extends RuleContext {
  /** Aborted when a newer run starts, the row is removed or the field is hidden. */
  readonly signal: AbortSignal;
}

export interface RuleOptions {
  name?: string;
  /** Further references that re-run the rule (the target always does). */
  triggers?: readonly AnyRef[];
  /** References the rule reads without being triggered by them. */
  reads?: readonly AnyRef[];
  /** The rule is skipped while a guard is false. Guard refs are triggers. */
  when?: Guard | readonly Guard[];
}

export interface AsyncRuleOptions extends RuleOptions {
  /** Wait this long (ms) after the last change before starting. */
  debounce?: number;
  /** "user" (default): start on user changes only. "any": on every change (never on creation). */
  origins?: "user" | "any";
}

type SyncCheck = (value: any, ctx: RuleContext) => string | undefined;
type AsyncCheck = (value: any, ctx: AsyncRuleContext) => Promise<string | undefined>;

export class Rule<N extends AnyNode = AnyNode> implements RuleLike {
  readonly _rule = true as const;
  /** @internal */
  constructor(
    readonly target: N,
    readonly kind: "sync" | "async",
    readonly check: SyncCheck | AsyncCheck,
    readonly options: AsyncRuleOptions
  ) {}

  get name(): string {
    return this.options.name ?? `${this.kind}Rule(${this.target.path || "<root>"})`;
  }
  /** @internal */
  get guards(): Guard[] {
    const w = this.options.when;
    return w === undefined ? [] : Array.isArray(w) ? [...w] : [w as Guard];
  }
  /** @internal every reference the rule may read */
  get refs(): AnyRef[] {
    return [this.target, ...(this.options.triggers ?? []), ...(this.options.reads ?? []), ...this.guards.flatMap((g) => g.refs)];
  }
}

/** A synchronous rule: return an error message, or undefined when valid. */
export function rule<N extends Validatable>(
  target: N,
  check: (value: InferValue<N>, ctx: RuleContext) => string | undefined,
  options: RuleOptions = {}
): Rule<N> {
  return new Rule(target, "sync", check as SyncCheck, options);
}

/** An asynchronous rule; runs after all sync rules of the field pass. */
export function asyncRule<N extends Validatable>(
  target: N,
  check: (value: InferValue<N>, ctx: AsyncRuleContext) => Promise<string | undefined>,
  options: AsyncRuleOptions = {}
): Rule<N> {
  return new Rule(target, "async", check as AsyncCheck, options);
}

export interface ValidationError {
  /** Concrete path, e.g. "lines[1].qty". */
  path: string;
  /** The node (template node for rows). */
  ref: AnyNode;
  /** A store that can address `ref`. */
  store: BaseStore<any>;
  error: string;
}

export interface ValidationFailure {
  path: string;
  ref: AnyNode;
  /** What an async rule threw or rejected with. */
  error: unknown;
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type Omittable<N> = "visible" extends keyof InferMeta<N> ? true : "disabled" extends keyof InferMeta<N> ? true : false;

/** Values for submitting: fields that can be hidden or disabled are optional. */
export type SubmitValue<N> = N extends ObjectNode<infer F>
  ? Simplify<
      { [K in keyof F as Omittable<F[K]> extends true ? never : K]: SubmitValue<F[K]> } & {
        [K in keyof F as Omittable<F[K]> extends true ? K : never]?: SubmitValue<F[K]>;
      }
    >
  : N extends ArrayNode<infer I, any>
    ? SubmitValue<I>[]
    : InferValue<N>;

export interface ValidationResult<N> {
  valid: boolean;
  /** In shape order: fields in definition order, rows in array order. */
  errors: ValidationError[];
  /** Async rules that threw. They make the result invalid without setting an error. */
  failures: ValidationFailure[];
  values: SubmitValue<N>;
}

/** @internal Installed on the root store. */
export interface ValidationHooks {
  validate(store: BaseStore<any>, node: AnyNode): Promise<ValidationResult<any>>;
}

// ============================================================
// Layer
// ============================================================
interface Entry {
  rule: Rule;
  /** Scope host the rule was added on; it applies to instances within it. */
  host: BaseStore<any>;
}

interface Queue {
  node: AnyNode;
  entries: Entry[];
  reg: Registration | undefined;
  visible: MetaRef<boolean> | undefined;
  disabled: MetaRef<boolean> | undefined;
  options: { validateHidden?: boolean; validateDisabled?: boolean };
}

interface AsyncKey {
  rules: Rule[];
  inputs: unknown[];
}

interface FieldState {
  gen: number;
  controller: AbortController | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  startNow: (() => void) | undefined;
  running: { key: AsyncKey; promise: Promise<void>; resolve: () => void } | undefined;
  checked: { key: AsyncKey; error: string | undefined } | undefined;
  failed: { key: AsyncKey; error: unknown } | undefined;
}

interface IO {
  get(ref: AnyRef): any;
  write(error: string | undefined, validating: boolean): void;
  origins: ReadonlySet<Origin>;
  isInit: boolean;
}

function sameKey(a: AsyncKey, b: AsyncKey): boolean {
  return (
    a.rules.length === b.rules.length &&
    a.rules.every((r, i) => r === b.rules[i]) &&
    a.inputs.length === b.inputs.length &&
    a.inputs.every((v, i) => Object.is(v, b.inputs[i]))
  );
}

/** The meta key on `node` or its nearest ancestor that declares it (inherited keys). */
function effectiveRef(node: AnyNode, key: string): MetaRef<boolean> | undefined {
  for (let n: AnyNode | undefined = node; n; n = n.parent) if (key in n[META_DEFS]) return new MetaRef<boolean>(n, key);
  return undefined;
}

function concretePath(host: BaseStore<any>, node: AnyNode): string {
  const scope = concreteScopePath(host);
  const relative = node.path.slice(host.node.path.length).replace(/^\./, "");
  return scope && relative ? `${scope}.${relative}` : scope || relative;
}

export class ValidationLayer implements RuleHooks, ValidationHooks {
  private readonly queues = new Map<AnyNode, Queue>();
  private readonly states = new WeakMap<BaseStore<any>, Map<AnyNode, FieldState>>();

  constructor(private readonly runtime: BehaviorRuntime) {}

  // ==========================================================
  // Rule registration (RuleHooks)
  // ==========================================================
  /** Removes `removed` and adds `added` (both registered on `host`) as one queue change per node. */
  change(host: BaseStore<any>, added: readonly RuleLike[], removed: readonly RuleLike[]): QueueChange {
    const byNode = new Map<AnyNode, { add: Rule[]; remove: Rule[] }>();
    const group = (r: RuleLike, kind: "add" | "remove") => {
      if (!(r instanceof Rule)) throw new Error("Expected a rule created with rule() or asyncRule()");
      if (kind === "add") this.check(host, r);
      let g = byNode.get(r.target);
      if (!g) byNode.set(r.target, (g = { add: [], remove: [] }));
      g[kind].push(r);
    };
    for (const r of removed) group(r, "remove");
    for (const r of added) group(r, "add");

    const change: QueueChange = { remove: [], add: [], commit: () => {} };
    const commits: (() => void)[] = [];
    for (const [node, g] of byNode) {
      const current = this.queues.get(node);
      const entries = [...(current?.entries ?? [])];
      for (const rule of g.remove) {
        const i = entries.findIndex((e) => e.rule === rule && e.host === host);
        if (i !== -1) entries.splice(i, 1);
      }
      for (const rule of g.add) entries.push({ rule, host });
      const queue: Queue = current ?? this.newQueue(node);
      if (queue.reg) change.remove.push({ reg: queue.reg, resetMeta: entries.length === 0 });
      if (entries.length) {
        change.add.push({ behavior: this.queueBehavior(queue, entries), registered: (reg) => (queue.reg = reg) });
        commits.push(() => {
          queue.entries = entries;
          queue.reg = undefined;
          this.queues.set(node, queue);
        });
      } else {
        commits.push(() => this.queues.delete(node));
      }
    }
    change.commit = () => commits.forEach((c) => c());
    return change;
  }

  private check(host: BaseStore<any>, r: Rule): void {
    const fail = (msg: string): never => {
      throw new Error(`Rule "${r.name}": ${msg}`);
    };
    const target = r.target;
    const formRoot = this.runtime.store.node;
    for (const ref of r.refs) {
      const node = refNode(ref);
      if (!(node instanceof ShapeNode) || node.id === undefined || rootOf(node) !== formRoot) {
        fail(`"${refLabel(ref)}" is not part of this form`);
      }
    }
    if (!target[META_DEFS].error?.options.data?.validation) {
      fail(`"${target.path || "<root>"}" has no validation() feature`);
    }
    const chain = chainTo(scopeOf(target));
    if (!chain.includes(host.node)) fail(`the target is outside the store it was added to – add it to an outer store`);
    for (const ref of r.refs) {
      if (!chain.includes(scopeOf(refNode(ref)))) fail(`"${refLabel(ref)}" is outside the target's scope`);
    }
  }

  private newQueue(node: AnyNode): Queue {
    return {
      node,
      entries: [],
      reg: undefined,
      visible: effectiveRef(node, "visible"),
      disabled: effectiveRef(node, "disabled"),
      options: (node[META_DEFS].error.options.data ?? {}) as Queue["options"],
    };
  }

  private queueBehavior(queue: Queue, entries: Entry[]): Behavior {
    const node = queue.node as Validatable;
    const unique = (refs: AnyRef[]) => [...new Map(refs.map((r) => [refKey(r), r])).values()];
    const triggers = unique([
      node,
      ...entries.flatMap((e) => [...(e.rule.options.triggers ?? []), ...e.rule.guards.flatMap((g) => g.refs)]),
      ...(queue.visible && !queue.options.validateHidden ? [queue.visible] : []),
      ...(queue.disabled && !queue.options.validateDisabled ? [queue.disabled] : []),
    ]);
    const reads = unique(entries.flatMap((e) => [...(e.rule.options.reads ?? [])]));
    const errorRef = new MetaRef<string | undefined>(node, "error");
    const validatingRef = new MetaRef<boolean>(node, "validating");
    return new Behavior({
      name: `${node.path || "<root>"}#validation`,
      triggers,
      reads,
      writes: [errorRef, validatingRef],
      run: (ctx) =>
        this.evaluate(ctx.store, queue, "run", {
          get: (ref) => ctx.get(ref),
          write: (error, validating) => {
            ctx.set(errorRef, error);
            ctx.set(validatingRef, validating);
          },
          origins: ctx.origins,
          isInit: ctx.isInit,
        }),
    });
  }

  // ==========================================================
  // Evaluation
  // ==========================================================
  private stateOf(host: BaseStore<any>, node: AnyNode): FieldState {
    let byNode = this.states.get(host);
    if (!byNode) this.states.set(host, (byNode = new Map()));
    let state = byNode.get(node);
    if (!state) {
      state = { gen: 0, controller: undefined, timer: undefined, startNow: undefined, running: undefined, checked: undefined, failed: undefined };
      byNode.set(node, state);
    }
    return state;
  }

  private abort(state: FieldState): void {
    state.gen++;
    state.controller?.abort();
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
    state.startNow = undefined;
    state.controller = undefined;
    const running = state.running;
    state.running = undefined;
    running?.resolve();
  }

  /**
   * The queue: skip when hidden/disabled, sync rules until the first error,
   * then the async rules (start, keep a running check, reuse a result for
   * unchanged inputs, or mark unchecked).
   */
  private evaluate(host: BaseStore<any>, queue: Queue, mode: "run" | "force", io: IO): void {
    const entries = queue.entries.filter((e) => storeWithin(host, e.host));
    if (!entries.length) return; // no rule applies to this instance
    const state = this.stateOf(host, queue.node);

    const hidden = queue.visible && !queue.options.validateHidden && io.get(queue.visible) === false;
    const disabled = queue.disabled && !queue.options.validateDisabled && io.get(queue.disabled) === true;
    if (hidden || disabled) {
      this.abort(state);
      io.write(undefined, false);
      return;
    }

    const value = io.get(queue.node);
    const active = entries.filter((e) => e.rule.guards.every((g) => g.test(...g.refs.map(io.get))));
    const ctx: RuleContext = { get: io.get };
    for (const e of active) {
      if (e.rule.kind !== "sync") continue;
      const error = (e.rule.check as SyncCheck)(value, ctx);
      if (error !== undefined) {
        this.abort(state);
        io.write(error, false);
        return;
      }
    }

    const asyncRules = active.filter((e) => e.rule.kind === "async").map((e) => e.rule);
    if (!asyncRules.length) {
      this.abort(state);
      io.write(undefined, false);
      return;
    }

    const key: AsyncKey = {
      rules: asyncRules,
      inputs: [value, ...asyncRules.flatMap((r) => [...(r.options.triggers ?? []), ...(r.options.reads ?? [])].map(io.get))],
    };

    if (state.running && sameKey(state.running.key, key)) {
      if (mode === "force" && state.startNow) state.startNow(); // skip the debounce
      else io.write(undefined, true);
      return;
    }
    if (state.checked && sameKey(state.checked.key, key)) {
      this.abort(state);
      io.write(state.checked.error, false);
      return;
    }

    this.abort(state);
    const start =
      mode === "force" ||
      (!io.isInit && io.origins.size > 0 &&
        ([...io.origins].includes("user") || asyncRules.some((r) => r.options.origins === "any")));
    if (!start) {
      io.write(undefined, false); // unchecked: validate() will check it
      return;
    }
    io.write(undefined, true);
    this.startAsync(host, queue, state, key, value, mode === "force");
  }

  private startAsync(host: BaseStore<any>, queue: Queue, state: FieldState, key: AsyncKey, value: unknown, immediate: boolean): void {
    const gen = ++state.gen;
    const controller = new AbortController();
    state.controller = controller;
    state.failed = undefined;
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    state.running = { key, promise, resolve };
    const current = () => gen === state.gen && !controller.signal.aborted;
    const ctx: AsyncRuleContext = { get: (ref) => this.read(host, ref), signal: controller.signal };

    const exec = async () => {
      state.timer = undefined;
      state.startNow = undefined;
      let error: string | undefined;
      try {
        for (const r of key.rules) {
          error = await (r.check as AsyncCheck)(value, ctx);
          if (!current()) return;
          if (error !== undefined) break;
        }
      } catch (thrown) {
        if (!current()) return;
        state.running = undefined;
        state.failed = { key, error: thrown };
        this.runtime.onError(thrown, { behavior: `${queue.node.path}#validation`, scope: concreteScopePath(host) });
        this.writeFromOutside(host, queue, undefined, false);
        resolve();
        return;
      }
      if (!current()) return;
      state.running = undefined;
      state.checked = { key, error };
      this.writeFromOutside(host, queue, error, false);
      resolve();
    };

    if (!immediate && key.rules.some((r) => (r.options.debounce ?? 0) > 0)) {
      const delay = Math.max(...key.rules.map((r) => r.options.debounce ?? 0));
      state.timer = setTimeout(() => void exec(), delay);
      state.startNow = () => {
        if (state.timer !== undefined) clearTimeout(state.timer);
        void exec();
      };
    } else {
      void exec();
    }
  }

  private read(host: BaseStore<any>, ref: AnyRef): any {
    return hostFor(host, scopeOf(refNode(ref))).get(ref);
  }

  /** Result writes after an await: a new batch, dropped when the row is gone. */
  private writeFromOutside(host: BaseStore<any>, queue: Queue, error: string | undefined, validating: boolean): void {
    if (!host.isAttached()) return;
    const origin: Origin = `behavior:${queue.node.path || "<root>"}#validation`;
    host.batch(() => {
      host.set(new MetaRef<string | undefined>(queue.node, "error"), error, { origin });
      host.set(new MetaRef<boolean>(queue.node, "validating"), validating, { origin });
    });
  }

  // ==========================================================
  // validate()
  // ==========================================================
  async validate(store: BaseStore<any>, node: AnyNode): Promise<ValidationResult<any>> {
    const instances = this.instancesIn(store, node);

    store.batch(() => {
      for (const [host, queue] of instances) {
        if (!host.isAttached()) continue;
        this.evaluate(host, queue, "force", {
          get: (ref) => this.read(host, ref),
          write: (error, validating) => this.writeFromOutside(host, queue, error, validating),
          origins: new Set(),
          isInit: false,
        });
      }
    });

    // Wait for every running check in the subtree (a check may be replaced while waiting).
    for (;;) {
      const running = instances.map(([h, q]) => this.stateOf(h, q.node).running?.promise).filter((p) => p !== undefined);
      if (!running.length) break;
      await Promise.all(running);
    }

    const errors: ValidationError[] = store.collect(node, "error").map((e: CollectEntry) => ({
      ...e,
      error: (e.store.getMeta(e.ref) as Record<string, unknown>).error as string,
    }));
    const failures: ValidationFailure[] = [];
    for (const [host, queue] of instances) {
      const failed = this.stateOf(host, queue.node).failed;
      if (failed && host.isAttached()) failures.push({ path: concretePath(host, queue.node), ref: queue.node, error: failed.error });
    }
    return { valid: errors.length === 0 && failures.length === 0, errors, failures, values: submitValues(store, node) };
  }

  /** (scope host, queue) pairs for every queue instance inside `node`. */
  private instancesIn(store: BaseStore<any>, node: AnyNode): [BaseStore<any>, Queue][] {
    const start = store._host;
    const out: [BaseStore<any>, Queue][] = [];
    for (const queue of this.queues.values()) {
      if (!isAncestorOrSelf(node, queue.node)) continue;
      const chain = chainTo(scopeOf(queue.node));
      const level = chain.indexOf(start.node);
      if (level < 0) continue;
      let hosts: BaseStore<any>[] = [start];
      for (let i = level; i < chain.length - 1; i++) {
        const arrayNode = chain[i + 1].parent as ArrayNode<any, any>;
        hosts = hosts.flatMap((h) => [...h.substore(arrayNode).items()]);
      }
      for (const h of hosts) out.push([h, queue]);
    }
    return out;
  }
}

// ============================================================
// Submit values
// ============================================================
function omitted(host: BaseStore<any>, node: AnyNode): boolean {
  if ("visible" in node[META_DEFS] && host.get(new MetaRef<boolean>(node, "visible")) === false) return true;
  if ("disabled" in node[META_DEFS] && host.get(new MetaRef<boolean>(node, "disabled")) === true) return true;
  return false;
}

/** The value of `node` without hidden / disabled nodes that declare those keys (the node itself is kept). */
export function submitValues(store: BaseStore<any>, node: AnyNode): any {
  const host = store._host;
  const walk = (h: BaseStore<any>, n: AnyNode): any => {
    const raw = h.getValue(n);
    if (raw == null) return raw;
    if (n instanceof ObjectNode) {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(n[FIELDS] as Record<string, AnyNode>)) {
        if (omitted(h, child)) continue;
        out[key] = walk(h, child);
      }
      return out;
    }
    if (n instanceof ArrayNode) {
      return (h.substore(n) as any).items().map((row: BaseStore<any>) => walk(row, row.node));
    }
    return raw;
  };
  return walk(host, node);
}
