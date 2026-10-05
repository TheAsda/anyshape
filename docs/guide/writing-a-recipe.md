# Writing your own recipe

A [recipe](../../GLOSSARY.md) is code you own that gives a [meta key](../../GLOSSARY.md) one team's meaning: what `disabled` implies, when an error shows, what submitting does. The [recipes folder](https://github.com/TheAsda/anyshape/tree/master/recipes) holds a set to copy, and this page builds one of them, `disabled` with its helper `disableWhen`, from nothing in five steps.

## The rules a recipe follows

- **It imports only `anyshape`**, plus `anyshape/react` for React parts. Nothing reaches into the [core](../../GLOSSARY.md)'s internals, so a recipe keeps working across versions of the core.
- **It takes references as parameters.** A helper receives the [nodes](../../GLOSSARY.md) it acts on, typed with the keys it needs, so passing the wrong node fails to compile. It never finds a key by its name; a helper that sweeps a subtree finds the key by its definition (`store.collect(node, definition)`).
- **It has no policy options.** A team that wants different behavior edits its copy. An option bag would only move the decision somewhere harder to read.
- **It is tested through the public interface**, like any other code that uses the library.

When a recipe needs something the core can't express, that is a gap in the core, not a reason to reach past it; [open an issue](https://github.com/TheAsda/anyshape/issues).

## Step 1: the key

```ts group=none
import { metaKey } from "anyshape";

export const disabled = metaKey<boolean, string>(false);
```

`disabled` holds a boolean, and its [contributions](../../GLOSSARY.md) carry a string: the reason the field is disabled. A field can be disabled for several reasons at once (the employer pays, another discount is filled in), and each reason comes from a different place. That makes it a combined key ([contributions.md](contributions.md)): the second type argument is the payload type.

The definition is declared once, at module level. Every node that declares it shares it, which is what lets a sweep or a count find all of them.

## Step 2: the owner

```ts
import {
  form, object, field, metaKey, contribute, when, createStore, defineBehaviors,
  type AnyNode, type AnyRef, type RefValue, type MetaRef, type Contribution,
} from "anyshape";

export const disabled = metaKey<boolean, string>(false).combine((self, key) => ({
  name: `${self.path || "<root>"}#disabled`,
  writes: [key],
  run: (ctx) => ctx.set(key, ctx.parts.length > 0),
}));
```

`.combine` adds the owner to the definition from step 1: the one [behavior](../../GLOSSARY.md) per node that writes the key. Its run sees the reasons that currently apply as `ctx.parts`, and the field is disabled while there is at least one. A reason whose [guard](../../GLOSSARY.md) fails is absent, so the key turns back to `false` on its own when the last reason goes away. The name built from the node's path makes the owner easy to find in error messages and DevTools.
## Step 3: a contribution function

```ts
/** A node that declares the `disabled` key: its reasons are strings. */
type Disableable = AnyNode & { readonly disabled: MetaRef<boolean, string> };

type Values<Rs extends readonly AnyRef[]> = { -readonly [K in keyof Rs]: RefValue<Rs[K]> };

/** Disables `target` while `test(...refs)` holds. Other reasons still apply. */
export function disableWhen<const Rs extends readonly AnyRef[]>(
  target: Disableable,
  refs: Rs,
  test: (...values: Values<Rs>) => boolean,
  options: { name?: string } = {},
): Contribution<string> {
  const name = options.name ?? `disableWhen(${target.path})`;
  return contribute(target.disabled, name, { name, when: when(refs, test) });
}
```

The helper takes the target node typed as `Disableable`: any node whose `disabled` reference carries string reasons. Passing a node that doesn't declare the key fails to compile, so the mistake is caught where it is made, not when the form runs. The helper reaches the key through `target.disabled`, the node's own reference, never by looking up a name.

The contribution is its reason, named after the target, and guarded by the test. `refs` is typed as a tuple, so `test` receives each reference's value with its type.

## Step 4: test it

```ts
const shape = form(
  object({
    employerPays: field<boolean>(),
    loyaltyNumber: field<string>(),
    nightlyRate: field<number>().meta({ disabled }),
  }),
);

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function testDisableWhen() {
  const store = createStore(
    shape,
    { employerPays: false, loyaltyNumber: "", nightlyRate: 80 },
    {
      behaviors: [
        disableWhen(shape.nightlyRate, [shape.employerPays], (pays) => pays),
        disableWhen(shape.nightlyRate, [shape.loyaltyNumber], (loyalty) => loyalty !== "", { name: "loyaltyRate" }),
      ],
    },
  );
  check(!store.get(shape.nightlyRate.disabled), "enabled with no reason");

  store.set(shape.employerPays, true);
  store.set(shape.loyaltyNumber, "LX-1");
  check(store.get(shape.nightlyRate.disabled), "disabled with two reasons");

  store.set(shape.employerPays, false);
  check(store.get(shape.nightlyRate.disabled), "still disabled with one reason left");

  store.set(shape.loyaltyNumber, "");
  check(!store.get(shape.nightlyRate.disabled), "enabled again with none");
  check(store.get(shape.nightlyRate) === 80, "the value is untouched");
}
```

The test builds a [store](../../GLOSSARY.md) and drives it with `set` and `get`, the same calls an app makes, and checks the cases the recipe promises: no reason, several reasons, reasons going away, and the value left alone. Run these checks inside your test runner's test function. The two contributions get different names, since a contribution's name is how messages and DevTools tell them apart.

## Step 5: use it

```tsx
import { useValue, useField } from "anyshape/react";

const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(disableWhen(s.nightlyRate, [s.employerPays], (pays) => pays));
});

function NightlyRate() {
  const { value, onChange } = useField(shape.nightlyRate);
  const locked = useValue(shape.nightlyRate.disabled);
  return <input type="number" value={value} disabled={locked} onChange={(e) => onChange(Number(e.target.value))} />;
}
```

A [shape](../../GLOSSARY.md) declares the key on the nodes that can be disabled, behaviors add reasons, and components read the key. Disabling changes nothing else: the rate stays in the store and is submitted, and its rules still run unless you guard them ([guards.md](guards.md)).

The same recipe in the evolution example: [stage 6](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage6) disables the nightly rate when the employer pays, and [stage 7](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage7) adds a second reason through `exclusive()`. The finished recipe is in [features.ts](https://github.com/TheAsda/anyshape/blob/master/recipes/features.ts) (the key) and [behaviors.ts](https://github.com/TheAsda/anyshape/blob/master/recipes/behaviors.ts) (`disableWhen`).

## See also

- [Meta keys](meta-keys.md): key definitions, [features](../../GLOSSARY.md), default behaviors.
- [Combined keys](contributions.md): owners and contributions.
- The [recipes catalog](https://github.com/TheAsda/anyshape/blob/master/recipes/README.md): what each recipe provides and how to copy it.
