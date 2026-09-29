export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Lets settled promises (async rule results) and the batches they write run to completion. */
export const flush = () => sleep(0);
/** A promise you resolve from the outside (to control async rules). */
export function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
