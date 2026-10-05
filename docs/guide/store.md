# The store

A [store](../../GLOSSARY.md) is a live form: the values for one [shape](../../GLOSSARY.md), the [meta keys](../../GLOSSARY.md) of every [node](../../GLOSSARY.md), and the [behaviors](../../GLOSSARY.md) that keep them consistent. It is read, written and watched through references only: a node for its value, `node.key` for a meta key, and a few read-only references that the [core](../../GLOSSARY.md) derives.

First shown in [stage 1](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage1); `resolvePath` in [stage 12](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage12).

## Creating a store

```ts
import { form, object, field, metaKey, createStore, defineBehaviors, defineBehavior, initialOf } from "anyshape";

const note = metaKey<string | undefined>(undefined);

const shape = form(
  object({
    destination: field<string>().meta({ note }),
    nights: field<number>(),
    nightlyRate: field<number>(),
    budget: field<number>(),
  }),
);

const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(
    defineBehavior({
      name: "budget",
      triggers: [s.nights, s.nightlyRate],
      writes: [s.budget],
      run: (ctx) => ctx.set(s.budget, ctx.get(s.nights) * ctx.get(s.nightlyRate)),
    }),
  );
});

const store = createStore(
  shape,
  { destination: "", nights: 0, nightlyRate: 0, budget: 0 },
  {
    behaviors,
    onError: (error, info) => console.error(`${info.behavior} failed at "${info.scope}"`, error),
  },
);
```

`createStore(shape, initialValues, options)` takes the result of `form()`, the starting values (they become the [baseline](../../GLOSSARY.md), see below) and two options:

- `behaviors`: what `defineBehaviors` returns ([behaviors.md](behaviors.md)). They run once when the store is created, so the form starts consistent.
- `onError`: called when a behavior throws. The default logs with `console.error`. The failed run's writes are dropped and the form keeps working.

In React, `useForm` creates the store for a component ([react.md](react.md)).

## Reading and writing

```ts
store.set(shape.nights, 3);
store.set(shape.nightlyRate, 120);
store.get(shape.budget); // 360: the behavior ran during the write

store.set(shape.destination.note, "Ask about late check-in");
store.get(shape.destination.note);

const whole = store.get(shape); // the whole form's value
store.set(shape, { ...whole, destination: "Lisbon" });
```

`get` takes any reference. `set` takes a node or a meta key. Values are replaced, never changed in place, so `store.get(shape)` returns the same object until something in the form changes.

Every write has an [origin](../../GLOSSARY.md): who made it.

```ts
store.set(shape.destination, "Porto", { origin: "user" });
```

- `"program"` is the default: code writing to the form.
- `"user"` is a person editing a field. React's `useField` writes with it.
- `"initial"` is a baseline write, made with `{ as: "initial" }`.

Every write runs the behaviors it affects, whatever its origin. The origin is information: a behavior that should react only to edits says so with `origins: ["user"]` ([behaviors.md](behaviors.md)). No write skips behaviors, because a write that did would leave derived values stale.

`batch(fn)` groups writes: behaviors and listeners run once, after `fn` returns.

```ts
store.batch(() => {
  store.set(shape.nights, 5);
  store.set(shape.nightlyRate, 90);
});
```

## Baseline and reset

The baseline is the form's starting point: the initial values, or the last data loaded as initial. `initialOf(node)` reads a node's baseline value; it is read-only.

```ts
const changed = store.get(shape.destination) !== store.get(initialOf(shape.destination));

// Data from the server becomes the new baseline as well as the value.
store.set(shape, { destination: "Lisbon", nights: 4, nightlyRate: 100, budget: 400 }, { as: "initial" });

store.reset(); // back to the baseline
store.reset(shape.destination); // one node and what's below it
```

`reset(node)` puts the values under `node` back to their baseline and every meta key there back to its default, then runs the behaviors that write there as if the store were just created. A key declared with `keepOnReset` keeps its value: it is for state fed from outside the form, such as a list of options synced from React ([meta-keys.md](meta-keys.md)).

## Subscribing

```ts
const saveDraft = (value: unknown) => console.log("draft", value);

const unsubscribe = store.subscribe(shape, () => saveDraft(store.get(shape)));
const stopNote = store.subscribe(shape.destination.note, () => console.log(store.get(shape.destination.note)));
unsubscribe();
stopNote();
```

`subscribe(ref, listener)` calls `listener` once the store is done with a change, if the reference's value changed. It returns the function that unsubscribes.

- A node's subscription fires for any value change under it, so subscribing to the root sees every value change.
- Meta keys are separate: a change to `shape.destination.note` doesn't fire subscriptions to `shape` or `shape.destination`. Subscribe to the key itself.
- A listener can't write to the store; trying throws. Derived values are behaviors. Listeners are for side effects outside the form: saving a draft, analytics, logging.

## Substores

`store.substore(node)` returns a store focused on an object or array node. It reads and writes the same form, but only addresses that node and what's below it.

```ts
import { array } from "anyshape";

const trip = form(
  object({
    car: object({ license: field<string>() }),
    travelers: array(object({ name: field<string>() }), { create: () => ({ name: "" }) }),
  }),
);
const tripStore = createStore(trip, { car: { license: "" }, travelers: [] });

const carStore = tripStore.substore(trip.car);
carStore.set(trip.car.license, "B-1234");

const travelers = tripStore.substore(trip.travelers);
const row = travelers.append();
row.set(trip.travelers.item.name, "Ada");
```

An array's substore holds the row operations, and each row has its own store ([arrays.md](arrays.md)). A node inside a row is addressed through that row's store: the root store rejects `trip.travelers.item.name`, because it can't tell which row is meant.

In React, a substore or a row's store can be provided to a part of the tree ([react.md](react.md)).

## Development checks

anyshape is in development mode unless `process.env.NODE_ENV` is `"production"`, which bundlers set for production builds. Development mode changes no result; it only adds diagnostics:

- An error a behavior throws points at the place where that behavior was defined.
- A change that takes longer than one frame at 30 fps logs a warning naming the behaviors that took the most time, and the work shows on a performance track in the browser's DevTools.
- Likely mistakes in the React bindings log a warning: `useSync` on a key without `keepOnReset`, `useForm` given a different shape, and `useBehaviors` whose declarations changed while its `deps` stayed the same.

In production none of this is measured or logged. One warning is not a development check and is logged in both modes: `countIn` given a key without `aggregate`, or one no node under it declares, warns that the count is always 0.

## Common mistakes

- **Mirroring a value with `subscribe` and `set`.** It throws, since listeners can't write. Write a behavior.
- **Reading a row's node from the root store.** Use the row's store, or let the React hooks find it ([arrays.md](arrays.md)).
- **Expecting a write to skip behaviors.** No origin does. Filter in the behavior instead.

## See also

- [Behaviors](behaviors.md): what runs when the store changes.
- [Arrays and rows](arrays.md): array stores and row stores.
- [Async behaviors](async.md): `settle()` and [pending](../../GLOSSARY.md) state.
- [React](react.md): the store in components.
