/**
 * Minimal functional lens module.
 * Standalone — no dependencies on other project modules.
 *
 * Referential equality on unchanged paths is CRITICAL for useSyncExternalStore.
 */

export interface Lens<S, A> {
  get(source: S): A;
  set(value: A, source: S): S;
}

function lens<S, A>(get: (source: S) => A, set: (value: A, source: S) => S): Lens<S, A> {
  return { get, set };
}

export const Lens = {
  prop<K extends string>(key: K): Lens<Record<string, unknown>, unknown> {
    return lens(
      (source) => source[key],
      (value, source) => ({ ...source, [key]: value }),
    );
  },

  index(n: number): Lens<unknown[], unknown> {
    return lens(
      (source) => source[n],
      (value, source) => {
        const copy = [...source];
        while (copy.length <= n) copy.push(undefined);
        copy[n] = value;
        return copy;
      },
    );
  },

  compose<S, A, B>(outer: Lens<S, A>, inner: Lens<A, B>): Lens<S, B> {
    return lens(
      (source) => inner.get(outer.get(source)),
      (value, source) => {
        const outerVal = outer.get(source);
        const newOuterVal = inner.set(value, outerVal);
        return outer.set(newOuterVal, source);
      },
    );
  },
} as const;
