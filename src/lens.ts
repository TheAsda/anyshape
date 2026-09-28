// ============================================================
// Lenses
// ------------------------------------------------------------
// Every node's lens is relative to its SCOPE ROOT:
//   - the form root, for nodes outside any array
//   - the array item object, for nodes inside an array item template
// Stores resolve a lens against their scope's current value.
// ============================================================

export interface Lens<S, A> {
  get(source: S): A;
  /** Immutable write. Must return `source` itself when nothing changed. */
  set(source: S, value: A): S;
}

export const identityLens: Lens<any, any> = {
  get: (s) => s,
  set: (_s, v) => v,
};

export function propLens(key: string): Lens<any, any> {
  return {
    get: (obj) => obj?.[key],
    set: (obj, value) => {
      // Structural sharing: unchanged writes keep the same reference.
      // This matters for array item identity (reference === identity).
      if (obj != null && Object.is(obj[key], value)) return obj;
      return { ...obj, [key]: value };
    },
  };
}

export function composeLens<A, B, C>(outer: Lens<A, B>, inner: Lens<B, C>): Lens<A, C> {
  if (outer === identityLens) return inner as any;
  return {
    get: (a) => inner.get(outer.get(a)),
    set: (a, c) => {
      const b = outer.get(a);
      const nextB = inner.set(b, c);
      return nextB === b ? a : outer.set(a, nextB);
    },
  };
}
