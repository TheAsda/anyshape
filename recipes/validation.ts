// ============================================================
// Validation – `error` as a combined key, fed by rules.
// ------------------------------------------------------------
//   • rule(node, check) / asyncRule(node, check) contribute a check to the
//     node's `error` (validation() declares it). The key's owner – the
//     queue – runs the node's rules in registration order: the sync rules
//     until the first error, then the `defined` backstop, then, if they
//     pass, the async rules.
//   • `defined` on a field that starts empty (`field<T | undefined>()`)
//     contributes the backstop: "Required" while the value is undefined,
//     whatever rules the author registered. InferChecked<N> drops undefined
//     from such fields; handleSubmit hands fn that checked type.
//   • Nothing is skipped implicitly: a rule that applies only while a field
//     is shown or enabled is guarded (b.when). A false guard makes
//     the rule absent; with no rule present the error is undefined.
//   • Async rules start on a user edit (start: "user"), on any change
//     ("any") or also on creation ("always"). Otherwise the value stays
//     unchecked until validate(). The field's longest `debounce` applies.
//     The debounce and the checks are kept work: a rerun with the same
//     rules, value and inputs (an unrelated trigger, a rule mounted)
//     continues them instead of restarting.
//   • A completed check is remembered per instance, keyed on the async
//     rules, the value and their inputs, and written back when they match
//     again – e.g. when a guarded rule comes back. Its start follows the
//     cause of that run: a guard on `s.car.visible` leaves a loaded value
//     unchecked until an edit or validate(); a guard on a field the user
//     edits (`s.rentingCar`) starts the check at once.
//   • `error` is the last completed result, written when a check ends;
//     pendingOf(node.error) is true while one runs. A "can submit" UI reads
//     countIn(form, error) === 0 && !pendingIn(form, error).
//   • A check that throws is a bug or an unhandled failure (expected
//     failures return a message): "Validation failed" is written, the
//     thrown value goes to console.error, and nothing is remembered.
//   • validate(store, node) forces the idle fields of the subtree (no
//     debounce, whatever the start rule), waits for every check, and
//     returns { valid, errors } in shape order.
// ============================================================

import {
  metaKey,
  contribute,
  pendingOf,
  MetaRef,
  type AnyNode,
  type ArrayNode,
  type InferValue,
  type AnyRef,
  type RefValue,
  type Contribution,
  type Origin,
  type Part,
  type BaseStore,
  type CollectEntry,
} from "anyshape";

export interface RuleContext {
  /** Read a declared reference (the target, triggers, reads, guard refs). */
  get<R extends AnyRef>(ref: R): RefValue<R>;
}

export interface AsyncRuleContext extends RuleContext {
  /** Aborted when the check is no longer needed (a newer value, the row removed, the rule gone). */
  readonly signal: AbortSignal;
}

type SyncPart = { kind: "sync"; check: (value: any, ctx: RuleContext) => string | undefined };
type AsyncPart = {
  kind: "async";
  check: (value: any, ctx: AsyncRuleContext) => Promise<string | undefined>;
  start: AsyncStart;
  debounce: number;
};

type DefinedPart = { kind: "defined" };

/** What a rule, or the `defined` key, contributes to `error`. */
export type RulePart = SyncPart | AsyncPart | DefinedPart;

/**
 * Which runs may start an async rule's check: "user" – a user edit (the
 * default); "any" – any change; "always" – also the initial run.
 */
export type AsyncStart = "user" | "any" | "always";

const starts = {
  user: (origins: ReadonlySet<Origin>) => origins.has("user"),
  // The initial run has no origins, so "any" excludes it.
  any: (origins: ReadonlySet<Origin>) => origins.size > 0,
  always: () => true,
} satisfies Record<AsyncStart, (origins: ReadonlySet<Origin>) => boolean>;

/** The last completed async check of an instance, in the owner's ctx.state. */
interface Checked {
  ids: readonly number[];
  inputs: readonly unknown[];
  error: string | undefined;
}

/** A get over values read up front: the work reads no live state. */
function frozenGet(refs: readonly AnyRef[], values: readonly unknown[]): RuleContext["get"] {
  const byRef = new Map<AnyRef, unknown>(refs.map((r, i) => [r, values[i]]));
  return ((ref: AnyRef) => {
    if (!byRef.has(ref)) throw new Error(`asyncRule: "${ref.path}" is not declared in the rule's triggers or reads`);
    return byRef.get(ref);
  }) as RuleContext["get"];
}

/** Resolves after `ms`, rejects with the signal's reason when it aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

const same = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * Set by validate() on the fields it checks: the next run starts the async
 * rules whatever its cause, without their debounce, and resets the flag with
 * its result. A cancelled run writes nothing, so its rerun is still forced.
 */
export const forced = metaKey(false);

/** The field's first error: written by the queue, the owner of its rules. Counted per subtree. */
export const error = metaKey<string | undefined, RulePart>(undefined)
  .aggregate((e) => e !== undefined)
  .uses(forced)
  .combine((self, key, [force]) => ({
    name: `${self.path || "<root>"}#validation`,
    triggers: [self, force],
    writes: [key, force],
    run(ctx) {
      const isForced = ctx.get(force);
      const result = (found: string | undefined) => {
        ctx.set(key, found);
        if (isForced) ctx.set(force, false);
      };
      // A check that throws is a bug or a failure it didn't handle (expected
      // failures return a message). Never remembered as checked.
      const failed = (thrown: unknown) => {
        if (ctx.signal.aborted) throw thrown;
        console.error(thrown);
        result("Validation failed");
      };

      const value = ctx.get(self);
      for (const p of ctx.parts) {
        if (p.payload.kind !== "sync") continue;
        let found: string | undefined;
        try {
          found = p.payload.check(value, ctx);
        } catch (thrown) {
          return failed(thrown);
        }
        if (found !== undefined) return result(found);
      }
      if (value === undefined && ctx.parts.some((p) => p.payload.kind === "defined")) return result("Required");

      const asyncParts = ctx.parts.filter((p): p is Part<AsyncPart> => p.payload.kind === "async");
      if (!asyncParts.length) return result(undefined);

      // A checked result is reused while the async parts, the value and their inputs are the same.
      const ids = asyncParts.map((p) => p.id);
      const inputs = [value, ...asyncParts.flatMap((p) => p.inputs.map((r) => ctx.get(r)))];
      const checked = ctx.state.checked as Checked | undefined;
      if (checked && same(checked.ids, ids) && same(checked.inputs, inputs)) return result(checked.error);

      // Unless forced, the chain runs if any async part may start on this run's cause.
      if (!isForced && !asyncParts.some((p) => starts[p.payload.start](ctx.origins))) return result(undefined);
      // Kept work: a rerun with the same key (an unrelated trigger, a rule
      // mounted) continues the debounce and the request in flight.
      const debounce = isForced ? 0 : Math.max(...asyncParts.map((p) => p.payload.debounce));
      const get = frozenGet([self, ...asyncParts.flatMap((p) => p.inputs)], [value, ...inputs.slice(1)]);
      return ctx
        .keep([...ids, ...inputs], async (signal) => {
          if (debounce > 0) await sleep(debounce, signal);
          let found: string | undefined;
          for (const p of asyncParts) {
            found = await p.payload.check(value, { get, signal });
            if (found !== undefined) break;
          }
          return found;
        })
        .then((found) => {
          ctx.state.checked = { ids, inputs, error: found } satisfies Checked;
          result(found);
        }, failed);
    },
  }));

declare const DefinedBrand: unique symbol;
/** The value type of `defined`: the mark InferChecked looks for. */
export type Defined = true & { readonly [DefinedBrand]: true };

/** The field's value is not undefined: a "Required" backstop in its `error`, after its sync rules. */
export const defined = metaKey<Defined>(true as Defined)
  .uses(error)
  .behavior((_self, _key, [err]) => contribute(err, { kind: "defined" }));

/** True when some property of N, under any name, is a ref to a `Defined` key. */
type HasDefined<N> = true extends {
  [K in keyof N]-?: 0 extends 1 & N[K]
    ? false
    : N[K] extends MetaRef<infer V, any>
      ? V extends Defined
        ? true
        : false
      : false;
}[keyof N]
  ? true
  : false;

/**
 * An object node: every key of its value is a child of the node. Not
 * `N extends ObjectNode<any>`: with `[FIELDS]` stripped from the `.d.ts`, a
 * FieldNode is structurally an ObjectNode.
 */
type IsObjectNode<N> =
  InferValue<N> extends object ? ([Exclude<keyof InferValue<N>, keyof N>] extends [never] ? true : false) : false;

type Walk<N> =
  N extends ArrayNode<infer I, any>
    ? InferChecked<I>[]
    : IsObjectNode<N> extends true
      ? { [K in keyof InferValue<N>]: K extends keyof N ? InferChecked<N[K]> : never }
      : InferValue<N>;

/** What the node holds once its checks pass: its stored type, without undefined where `defined` is declared. */
export type InferChecked<N> = HasDefined<N> extends true ? Exclude<Walk<N>, undefined> : Walk<N>;

/** `error`, written by the field's rules, and `forced` for validate(). */
export const validation = () => ({ error, forced });

/** A node with validation(), whose value is `V`. */
export type Validatable<V = any> = AnyNode & {
  readonly _type: V;
  readonly error: MetaRef<string | undefined, RulePart>;
};

export interface RuleOptions {
  name?: string;
  /** Further references that re-run the rule (the target always does). */
  triggers?: readonly AnyRef[];
  /** References the rule reads without being triggered by them. */
  reads?: readonly AnyRef[];
}

/** A synchronous rule: return an error message, or undefined when valid. */
export function rule<V>(
  node: Validatable<V>,
  check: (value: V, ctx: RuleContext) => string | undefined,
  options: RuleOptions = {},
): Contribution<RulePart> {
  return contribute(
    errorOf(node),
    { kind: "sync", check },
    { ...options, name: options.name ?? `rule(${node.path || "<root>"})` },
  );
}

function errorOf(node: Validatable): Validatable["error"] {
  if (!(node.error instanceof MetaRef)) throw new Error(`"${node.path || "<root>"}" has no validation() feature`);
  return node.error;
}

export interface AsyncRuleOptions extends RuleOptions {
  /** Default "user". */
  start?: AsyncStart;
  /** Wait this long (ms) after the last change before checking. The field's longest debounce applies. */
  debounce?: number;
}

/** An asynchronous rule; runs after all sync rules of the field pass. */
export function asyncRule<V>(
  node: Validatable<V>,
  check: (value: V, ctx: AsyncRuleContext) => Promise<string | undefined>,
  options: AsyncRuleOptions = {},
): Contribution<RulePart> {
  const { start = "user", debounce = 0, ...decl } = options;
  return contribute(
    errorOf(node),
    { kind: "async", check, start, debounce },
    { ...decl, name: decl.name ?? `asyncRule(${node.path || "<root>"})` },
  );
}

export interface ValidationError extends CollectEntry<string | undefined> {
  error: string;
}

export interface ValidationResult {
  valid: boolean;
  /** In shape order: fields in definition order, rows in array order. */
  errors: ValidationError[];
}

/**
 * Checks `node` (default: the store's node) and lists its errors: forces the
 * fields that aren't pending, then waits for every check in the subtree. A
 * field already in its debounce or request isn't forced but is awaited.
 */
export async function validate(store: BaseStore<any>, node: AnyNode = store.node): Promise<ValidationResult> {
  const errorRefs = new Map<BaseStore<any>, Map<AnyNode, MetaRef<string | undefined>>>();
  for (const e of store.collect(node, error)) {
    let byNode = errorRefs.get(e.store);
    if (!byNode) errorRefs.set(e.store, (byNode = new Map()));
    byNode.set(e.ref.node, e.ref);
  }
  const flags = store.collect(node, forced).filter((f) => {
    const errorRef = errorRefs.get(f.store)?.get(f.ref.node);
    return errorRef !== undefined && !f.store.get(pendingOf(errorRef));
  });
  store.batch(() => flags.forEach((f) => f.store.set(f.ref, true)));
  await store.settle(node);
  // A field without rules has no run to serve its flag: don't leave it for a rule mounted later.
  store.batch(() => flags.forEach((f) => f.store.isAttached() && f.store.get(f.ref) && f.store.set(f.ref, false)));
  const errors = store
    .collect(node, error)
    .map((e) => ({ ...e, error: e.store.get(e.ref) }))
    .filter((e): e is ValidationError => e.error !== undefined);
  return { valid: errors.length === 0, errors };
}
