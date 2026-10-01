// ============================================================
// Helpers for the React recipe suites (Vitest browser mode +
// vitest-browser-react). A copy of src/react/test-utils.tsx: recipes never
// import the core's test helpers.
//
//   • render / rerender / unmount come from vitest-browser-react; mounted
//     trees are cleaned up before each test.
//   • Positive UI effects are awaited with `expect.element(locator)`, which
//     retries until the DOM matches. `toHaveTextContent("…")` is an exact
//     (whitespace-normalized) match in Vitest 5; `toMatchTextContent` is the
//     substring / regex variant.
//   • `settle(fn)` runs a write from outside React inside act(), so every
//     resulting render has committed when it returns. Use it before
//     render-count assertions, especially "nothing re-rendered", where there
//     is no DOM change to wait for.
// ============================================================

import { act } from "react";

export { render } from "vitest-browser-react";

/** Runs `fn` (a store write, a hook callback) and flushes React's work. */
export async function settle(fn: () => unknown): Promise<void> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => void (await fn()));
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

/** Counts renders per label: call `hit(label)` in a component body. */
export function renders() {
  const counts: Record<string, number> = {};
  return {
    counts,
    hit: (label: string) => void (counts[label] = (counts[label] ?? 0) + 1),
    reset: () => Object.keys(counts).forEach((k) => delete counts[k]),
  };
}

/** Collects console.warn calls until `restore()`. */
export function captureWarnings() {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  return { warnings, restore: () => (console.warn = original) };
}

