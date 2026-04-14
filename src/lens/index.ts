export class Lens<S = unknown, A = S> {
  private readonly _get: (source: S) => A;
  private readonly _set: (source: S, value: A) => S;

  constructor(
    get: (source: S) => A = (s) => s as unknown as A,
    set: (source: S, value: A) => S = (_s, v) => v,
  ) {
    this._get = get;
    this._set = set;
  }

  get(source: S): A {
    return this._get(source);
  }

  set(source: S, value: A): S {
    return this._set(source, value);
  }

  prop<K extends string>(key: K): Lens<S, unknown> {
    return new Lens<S, unknown>(
      (source) => (this._get(source) as Record<string, unknown>)[key],
      (source, value) =>
        this._set(
          source,
          {
            ...(this._get(source) as Record<string, unknown>),
            [key]: value,
          } as A,
        ),
    );
  }

  index(n: number): Lens<S, unknown> {
    return new Lens<S, unknown>(
      (source) => (this._get(source) as unknown[])[n],
      (source, value) => {
        const arr = this._get(source) as unknown[];
        const copy = [...arr];
        while (copy.length <= n) copy.push(undefined);
        copy[n] = value;
        return this._set(source, copy as A);
      },
    );
  }
}
