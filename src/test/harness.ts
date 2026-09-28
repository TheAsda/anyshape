declare const process: { exitCode?: number };
let passed = 0;
export function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (e) { console.error(`FAIL ${name}\n  ${(e as Error).stack}`); process.exitCode = 1; }
}
export function eq(a: unknown, b: unknown, msg = "") {
  if (!Object.is(a, b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
export function deepEq(a: unknown, b: unknown, msg = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
export function throws(fn: () => unknown, re: RegExp) {
  try { fn(); } catch (e) { if (re.test((e as Error).message)) return; throw new Error(`wrong error: ${(e as Error).message}`); }
  throw new Error(`expected throw matching ${re}`);
}
export function report(file: string) { console.log(`${file}: ${passed} tests passed`); }

// ---- async tests: queued and run in order by runAsync() ----
const queue: [string, () => Promise<void>][] = [];
export function testAsync(name: string, fn: () => Promise<void>) {
  queue.push([name, fn]);
}
export async function runAsync(file: string) {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}\n  ${(e as Error).stack}`); process.exitCode = 1; }
  }
  report(file);
}
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** A promise you resolve from the outside (to control async rules). */
export function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

/** Browser runs: lets the runner know the queued tests finished. */
export async function runAsyncAndSignal(file: string) {
  await runAsync(file);
  (globalThis as any).__testsDone = true;
}
