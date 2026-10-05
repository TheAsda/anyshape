# Meta keys

A [meta key](../../GLOSSARY.md) is named state that a [node](../../GLOSSARY.md) declares beside its value, with a default: an error message, whether the field was touched, whether a section is shown. The [core](../../GLOSSARY.md) gives no key a meaning. `error`, `touched` and `visible` are all declared by you, or by a [recipe](../../GLOSSARY.md) you copied.

First shown in [stage 2](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage2); counting in [stage 13](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage13).

## Declaring a key

```ts
import { form, object, field, array, metaKey, createStore, initialOf } from "anyshape";

const error = metaKey<string | undefined>(undefined).aggregate((message) => message !== undefined);
const options = metaKey<string[]>([], { keepOnReset: true });

const shape = form(
  object({
    destination: field<string>().meta({ error, options, label: "Destination" }),
    nights: field<number>().meta({ error }),
  }),
);

const store = createStore(shape, { destination: "", nights: 1 });
store.set(shape.destination.options, ["Lisbon", "Porto"]);
store.get(shape.nights.error); // undefined, the default
```

A node declares keys in `.meta({ ... })` ([shape.md](shape.md)), in two ways:

- **A plain value**, such as `label: "Destination"`: a key with that default, on that node only.
- **A key definition**, made with `metaKey(default, options)`. One definition can be declared on many nodes, under any name. Code that sweeps or counts a key across the form finds it by its definition, never by its name, so it works whatever each node calls it.

The only option is `keepOnReset`: `store.reset()` leaves the key's value alone. Use it for state fed from outside the form, such as `options` above, which React keeps in sync with `useSync` ([react.md](react.md)). Every other key returns to its default on reset.

Each node gets a reference per key: `shape.destination.error`. Read and write it like a value, with `store.get`, `store.set`, `store.subscribe`, or `useValue` in React. A key's type comes from its default, or from the type argument: `metaKey<string | undefined>(undefined)`.

A definition's steps add capabilities, and each step returns a new definition:

| Step | What it adds |
|---|---|
| `.aggregate(isCounted)` | The key can be counted per subtree with `countIn`. |
| `.uses(...definitions)` | The default [behavior](../../GLOSSARY.md) or owner gets references to other keys of the same node. |
| `.behavior(factory)` | A default behavior, registered on every node that declares the key. |
| `.combine(factory)` | The key is written by one owner that combines [contributions](../../GLOSSARY.md) ([contributions.md](contributions.md)). |

## Features

A [feature](../../GLOSSARY.md) is a function that returns several key definitions, spread into `.meta()`:

```ts
const touched = metaKey(false);
const revealed = metaKey(false);

const control = () => ({ error, touched, revealed });

const signup = form(
  object({
    email: field<string>().meta(control(), { label: "Email" }),
    name: field<string>().meta(control()),
  }),
);
```

The feature returns definitions declared once, outside it. If it created new definitions on each call, every node would get a different key, and nothing could count or sweep them as one. The recipes' `control()` and `validation()` are features ([recipes](https://github.com/TheAsda/anyshape/blob/master/recipes/features.ts)).

## A key's default behavior

`.behavior((self, key, uses) => config)` gives a key a behavior that comes with it: every node that declares the key gets its own copy, and every row gets one when the key is on a row template. `self` is the node, `key` is the node's reference to the key under whatever name it was declared. The config is an ordinary behavior config ([behaviors.md](behaviors.md)).

```ts
const dirty = metaKey(false).behavior((self, key) => ({
  triggers: [self, initialOf(self)],
  writes: [key],
  run: (ctx) => ctx.set(key, !Object.is(ctx.get(self), ctx.get(initialOf(self)))),
}));

const markTouched = metaKey(false).behavior((self, key) => ({
  triggers: [self],
  writes: [key],
  origins: ["user"],
  runOn: { init: false },
  run: (ctx) => ctx.set(key, true),
}));
```

A default behavior is confined to its own node: its value, its meta keys and `initialOf(self)`. Registration rejects anything else. A key is defined before any node exists, and a reusable piece of [shape](../../GLOSSARY.md) can appear in several places, so its own node is the only thing it can name. The confinement also means a key never acts on a distant part of the form.

`.uses(...definitions)` hands the default behavior the node's references to other keys, matched by definition. The node must declare them too; registration says so if it doesn't. `.uses` grants no access by itself: list the references in `triggers`, `reads` or `writes` as usual.

```ts
const showError = metaKey(false)
  .uses(error, markTouched)
  .behavior((self, key, [nodeError, wasTouched]) => ({
    triggers: [nodeError, wasTouched],
    writes: [key],
    run: (ctx) => ctx.set(key, ctx.get(nodeError) !== undefined && ctx.get(wasTouched)),
  }));

const contact = form(object({ phone: field<string>().meta({ error, touched: markTouched, showError }) }));
```

## Counting and sweeping

`.aggregate(isCounted)` makes a key countable. `countIn(node, definition)` is a read-only reference to the number of nodes under `node`, rows included, whose value of that key is counted. `isCounted` must return false for the default, so a form starts at zero.

```ts
import { countIn } from "anyshape";

const trip = form(
  object({
    destination: field<string>().meta({ error }),
    travelers: array(object({ name: field<string>().meta({ error }) })),
  }),
);
const tripStore = createStore(trip, { destination: "", travelers: [{ name: "" }] });

tripStore.set(trip.destination.error, "Required");
tripStore.get(countIn(trip, error)); // 1
```

A count is a reference like any other: read it with `get` or `useValue`, subscribe to it, or use it as a behavior's trigger. `countIn` returns the same reference for the same node and definition. It takes only a definition declared with `.aggregate()`, and it throws when no node under `node`, rows included, declares the key, since that count would always be 0.

`store.collect(node, definition)` sweeps the subtree instead of counting: one entry per node that declares the key, whatever its value, in shape order with rows expanded. Each entry has the node's `path` with row indexes (`"travelers[0].name"`), its reference `ref`, and the `store` that addresses it (the root, or the row's [store](../../GLOSSARY.md)).

```ts
const messages = tripStore
  .collect(trip, error)
  .map((entry) => ({ path: entry.path, message: entry.store.get(entry.ref) }))
  .filter((entry) => entry.message !== undefined);
```

## Common mistakes

- **Looking a key up by its name**, as `node["error"]` or by listing a node's keys. Take the node typed with the key you need, or sweep by definition with `collect`.
- **A feature that creates its definitions inside the function.** Each call makes new keys; declare the definitions once.
- **`isCounted` true for the default.** `.aggregate()` throws: untouched nodes must count as zero.
- **Counting a key no node under the counted node declares.** `countIn` throws. Count from a node whose subtree declares the key.
- **Writing a combined key from a behavior.** Registration rejects it; contribute to the key instead ([contributions.md](contributions.md)).

## See also

- [Behaviors](behaviors.md): the config a default behavior returns.
- [Combined keys](contributions.md): `.combine` and `contribute`.
- [Writing your own recipe](writing-a-recipe.md): a key with its helpers, step by step.
