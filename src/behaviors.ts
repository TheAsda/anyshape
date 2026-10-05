// ============================================================
// Behaviors
// ------------------------------------------------------------
// A behavior declares what triggers it, what it reads and what it writes, and
// a run function; a contribution declares a payload for the owner of a
// combined key. This module holds the declarations. The runtime that
// registers and runs them (scope, order, writers, async runs) is runtime.ts.
//
// Contract (not enforced): a run may start, be cancelled and restart at any
// time. It must be idempotent and change the form only through ctx.set;
// reading the outside world (fetch) is fine.
// ============================================================

import type { AnyNode, InferValue } from "./shape";
import { MetaRef } from "./refs/meta";
import { isDev } from "./internal";
import type { AnyRef, RefValue, Origin } from "./store";

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
  /** Did this trigger change since the last run? Always false on the initial run. */
  changed(ref: AnyRef): boolean;
  /** Origins of the changes that caused this run (writes of this behavior, from any of its instances, excluded). */
  readonly origins: ReadonlySet<Origin>;
  /** Per-instance state, kept between runs (e.g. "the user overrode this"). A copy: saved only if the run completes. */
  readonly state: Record<string, unknown>;
  /** Aborted when the run is cancelled (pass it to fetch). After that, get and set throw its reason. */
  readonly signal: AbortSignal;
  /**
   * Async work that a rerun can continue instead of restarting: with a key
   * equal (element by element, Object.is) to the work in flight, returns that
   * work; otherwise aborts it and calls `start`. One slot per instance.
   * The work must depend only on its key: it gets its own signal, never ctx.
   */
  keep<T>(key: readonly unknown[], start: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

/** The declaration parts behaviors and contributions share. */
export interface Declaration {
  /** Used in errors, dev tools and origins. */
  name?: string;
  /** Changes to these run the behavior (for a contribution: its key's owner). */
  triggers?: readonly AnyRef[];
  /** Readable in run, never trigger it. */
  reads?: readonly AnyRef[];
  /**
   * All guards must pass. Their references become triggers. A behavior whose
   * guard fails skips the run (previous writes stay); a contribution whose
   * guard fails is absent (its owner recomputes without it).
   */
  when?: Guard | readonly Guard[];
}

export interface BehaviorConfig extends Declaration {
  /** The only targets ctx.set accepts. One writer per target. */
  writes?: readonly WritableRef[];
  /** Run when the instance is created. Default: true. */
  runOn?: { init?: boolean };
  /**
   * Run on changes only when at least one origin is of these kinds. Default:
   * any. Tallies (countIn, pendingIn, pendingOf) carry no origins: registration
   * throws when one is a trigger.
   */
  origins?: readonly OriginKind[];
  /** May return a promise: its writes apply when it resolves, unless the run was cancelled. */
  run(ctx: BehaviorContext): void | Promise<void>;
}

// ============================================================
// Key contributions
// ------------------------------------------------------------
// contribute(ref, payload, decl) feeds the owner behavior of a key declared
// with `combine`. The core never reads into the payload: it groups
// contributions per key, merges their declarations into the owner's, filters
// them per instance (the store they were added on, their guards) and passes
// the active ones to the owner's run as ctx.parts.
// ============================================================

/** One active contribution, as the owner of its key sees it. */
export interface Part<P = unknown> {
  readonly payload: P;
  readonly name: string;
  /** Stable per registered contribution. */
  readonly id: number;
  /** The contribution's declared triggers and reads (readable with ctx.get), e.g. to key cached results. */
  readonly inputs: readonly AnyRef[];
}

export interface OwnerContext<P> extends BehaviorContext {
  /** The contributions that apply to this instance and whose guards pass, in registration order. */
  readonly parts: readonly Part<P>[];
}

/** What `combine` returns: the owner behavior of a combined key. */
export interface OwnerConfig<P> extends Omit<BehaviorConfig, "run"> {
  run(ctx: OwnerContext<P>): void | Promise<void>;
}

export class Contribution<P = unknown> {
  /** @internal */
  constructor(
    readonly target: MetaRef<any, P>,
    readonly payload: P,
    readonly decl: Declaration
  ) {}
}

/** Contribute `payload` to the owner of a combined key. The payload type comes from the key. */
export function contribute<P>(target: MetaRef<any, P>, payload: NoInfer<P>, decl: Declaration = {}): Contribution<P> {
  if (!(target instanceof MetaRef)) throw new Error(`contribute(): the target must be a meta key reference, got ${String(target)}`);
  return new Contribution(target, payload, decl);
}

/** @internal What the core attaches to a behavior besides its config. */
export interface BehaviorInternals {
  /** Set for default behaviors: the node the behavior is limited to. */
  self?: AnyNode;
  /** Dev only: where defineBehavior was called. */
  trace?: Error;
}

export class Behavior {
  /** @internal */ readonly _self: AnyNode | undefined;
  /** @internal */ readonly _trace: Error | undefined;

  /** @internal */
  constructor(readonly config: BehaviorConfig, internals: BehaviorInternals = {}) {
    this._self = internals.self;
    this._trace = internals.trace;
  }
}

/** Anything addBehavior / createStore accept: behaviors and contributions. */
export type AnyBehavior = Behavior | Contribution<any>;

export function defineBehavior(config: BehaviorConfig): Behavior {
  if (typeof config?.run !== "function") throw new Error("defineBehavior: `run` must be a function");
  let trace: Error | undefined;
  if (isDev()) {
    trace = new Error();
    (Error as { captureStackTrace?: (target: object, fn: Function) => void }).captureStackTrace?.(trace, defineBehavior);
  }
  return new Behavior(config, { trace });
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

// ============================================================
// Handles
// ============================================================
/**
 * Returned by addBehavior: call it to remove the behaviors; pass it to
 * replaceBehavior to swap them. Removing a behavior resets the meta keys it
 * wrote to their defaults, since the rule they described is gone; the values
 * it wrote stay, since they are the user's data. A removed contribution is
 * absent, as with a failing guard: its owner recomputes without it, and the
 * key returns to its default with the last one. A behavior whose guard fails
 * is different: it still exists, so its earlier writes stay.
 */
export type BehaviorHandle = (() => void) & { readonly __behaviorHandle?: never };
