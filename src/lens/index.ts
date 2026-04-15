/**
 * Structural type for a Lens — a pure functional getter/setter
 * for a focused part of a larger data structure.
 *
 * S = source (whole) type, A = focused (part) type.
 * Convention: "lens-first, data-second" — define the accessor first,
 * then provide data on get/set calls.
 *
 * ```ts
 * const nameLens = Lens.prop('name');
 * nameLens.get({ name: 'Alice' });        // 'Alice'
 * nameLens.set('Bob', { name: 'Alice' }); // { name: 'Bob' }
 * ```
 */
export interface Lens<S = unknown, A = S> {
  get(source: S): A;
  set(value: A, source: S): S;
}

/**
 * Concrete Lens implementation with chaining methods (prop, index).
 * Use the `Lens` factory object for construction.
 */
export class LensImpl<S = unknown, A = S> implements Lens<S, A> {
  private readonly _get: (source: S) => A;
  private readonly _set: (value: A, source: S) => S;

  constructor(
    get: (source: S) => A,
    set: (value: A, source: S) => S,
  ) {
    this._get = get;
    this._set = set;
  }

  get(source: S): A {
    return this._get(source);
  }

  set(value: A, source: S): S {
    return this._set(value, source);
  }

  prop<K extends string>(key: K): LensImpl<S, unknown> {
    return new LensImpl<S, unknown>(
      (source) => (this._get(source) as Record<string, unknown>)[key],
      (value, source) => {
        const current = this._get(source) as Record<string, unknown>;
        if (current[key] === value) return source;
        return this._set({ ...current, [key]: value } as A, source);
      },
    );
  }

  index(n: number): LensImpl<S, unknown> {
    return new LensImpl<S, unknown>(
      (source) => (this._get(source) as unknown[])[n],
      (value, source) => {
        const arr = this._get(source) as unknown[];
        if (arr[n] === value) return source;
        const copy = [...arr];
        while (copy.length <= n) copy.push(undefined);
        copy[n] = value;
        return this._set(copy as A, source);
      },
    );
  }
}

/**
 * Factory for creating and composing lenses.
 *
 * - `Lens.prop('name')`   — focus on an object property
 * - `Lens.index(0)`       — focus on an array element
 * - `Lens.compose(a, b)`  — compose two lenses (outer then inner)
 * - `Lens.identity<S>()`  — identity lens (useful as root for chaining)
 */
export const Lens = {
  prop<K extends string>(
    key: K,
  ): LensImpl<Record<string, unknown>, unknown> {
    return new LensImpl<Record<string, unknown>, unknown>(
      (source) => source[key],
      (value, source) =>
        source[key] === value ? source : { ...source, [key]: value },
    );
  },

  index(n: number): LensImpl<unknown[], unknown> {
    return new LensImpl<unknown[], unknown>(
      (source) => source[n],
      (value, source) => {
        if (source[n] === value) return source;
        const copy = [...source];
        while (copy.length <= n) copy.push(undefined);
        copy[n] = value;
        return copy;
      },
    );
  },

  compose<S, A, B>(
    outer: Lens<S, A>,
    inner: Lens<A, B>,
  ): LensImpl<S, B> {
    return new LensImpl<S, B>(
      (source) => inner.get(outer.get(source)),
      (value, source) => {
        const current = inner.get(outer.get(source));
        if (current === value) return source;
        return outer.set(inner.set(value, outer.get(source)), source);
      },
    );
  },

  /**
   * Identity lens: get returns source as-is, set replaces source with value.
   * Useful as root for chaining: `Lens.identity<Root>().prop('field')`.
   */
  identity<S>(): LensImpl<S, S> {
    return new LensImpl<S, S>(
      (s) => s,
      (v, _s) => v,
    );
  },
};
