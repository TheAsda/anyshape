// ============================================================
// PROTOTYPE(#128) – throwaway. Step-boundary candidates beside handleSubmit
// on a step's substore (candidate A, no code here: submit.ts as it is, with
// fn typed InferChecked<N>).
//   B. checkStep(store, node): validate() the subtree (forcing async rules
//      not started yet), then return the checked value or throw. No reveal,
//      no focus: the caller does what it wants with `errors`.
//   C. assertChecked(store, node): synchronous, reads without subscribing.
//      Throws while an error is set or a check is pending under `node`, or
//      while a `defined` node holds undefined (re-run here on the value it
//      returns). An async rule that never started is not run.
// ============================================================

import { pendingIn, type AnyNode, type BaseStore } from "anyshape";

import { defined, error, validate, type InferChecked } from "../validation";

export interface Failure {
  path: string;
  error: string;
}

export class UncheckedError extends Error {
  constructor(
    readonly node: AnyNode,
    readonly failures: readonly Failure[],
    readonly pending: boolean,
  ) {
    const what = [...failures.map((f) => `${f.path}: ${f.error}`), ...(pending ? ["a check is pending"] : [])];
    super(`"${node.path || "<root>"}" is not checked – ${what.join("; ")}`);
  }
}

/** The nodes under `node` that declare `defined` and hold undefined: the type's own check, re-run. */
export function undefinedDefined(store: BaseStore<any>, node: AnyNode): Failure[] {
  return store
    .collect(node, defined)
    .filter((e) => e.store.get(e.ref.node as AnyNode) === undefined)
    .map((e) => ({ path: e.path, error: "Required" }));
}

function currentErrors(store: BaseStore<any>, node: AnyNode): Failure[] {
  return store
    .collect(node, error)
    .map((e) => ({ path: e.path, error: e.store.get(e.ref) }))
    .filter((e): e is Failure => e.error !== undefined);
}

export function assertChecked<N extends AnyNode>(store: BaseStore<any>, node: N): InferChecked<N> {
  const failures = currentErrors(store, node);
  // A required field cleared behind the queue's back (an outside write to its `error`) still fails.
  for (const f of undefinedDefined(store, node)) if (!failures.some((g) => g.path === f.path)) failures.push(f);
  const pending = store.get(pendingIn(node, error)) > 0;
  if (failures.length || pending) throw new UncheckedError(node, failures, pending);
  return store.get(node) as InferChecked<N>;
}

export async function checkStep<N extends AnyNode>(store: BaseStore<any>, node: N): Promise<InferChecked<N>> {
  const { valid, errors } = await validate(store, node);
  if (!valid) throw new UncheckedError(node, errors, false);
  return store.get(node) as InferChecked<N>;
}
