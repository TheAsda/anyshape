import { defineBehavior, type AnyRef, type Origin, type RootStore } from "../index";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Lets settled promises (async rule results) and the batches they write run to completion. */
export const flush = () => sleep(0);
/** A promise you resolve from the outside (to control async rules). */
export function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

/** The origins of each change of `ref`, as a behavior triggered by it sees them (ctx.origins). */
export function watchOrigins(store: RootStore<any>, ref: AnyRef): Origin[][] {
  const seen: Origin[][] = [];
  store.addBehavior(defineBehavior({ triggers: [ref], runOn: { init: false }, run: (ctx) => void seen.push([...ctx.origins]) }));
  return seen;
}
