# Async behaviors

A behavior's `run` may return a promise: a server check, a lookup. Its writes apply together when the promise resolves, unless a newer change cancelled the run first. While it runs, its targets are [pending](../../GLOSSARY.md), which the form can show and wait for.

First shown in [stage 12](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage12) (the destination check); pending counts in [stage 13](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage13).

## An async run

```ts
import { form, object, field, metaKey, defineBehavior, createStore, countIn, pendingIn, pendingOf } from "anyshape";

const error = metaKey<string | undefined>(undefined).aggregate((message) => message !== undefined);

const shape = form(
  object({
    destination: field<string>().meta({ error }),
    nights: field<number>(),
  }),
);

async function isAllowed(destination: string, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(`https://api.example.com/destinations/${encodeURIComponent(destination)}`, { signal });
  return response.ok;
}

const checkDestination = defineBehavior({
  name: "checkDestination",
  triggers: [shape.destination],
  writes: [shape.destination.error],
  origins: ["user"],
  runOn: { init: false },
  run: async (ctx) => {
    const destination = ctx.get(shape.destination);
    const allowed = await isAllowed(destination, ctx.signal);
    ctx.set(shape.destination.error, allowed ? undefined : "We don't travel there");
  },
});
```

The run is in flight until its promise settles; then its writes apply in one batch. The latest run wins. A run in flight is cancelled when:

- **a trigger or a `reads` reference changes.** The behavior runs again, and the new run's cause includes the cancelled run's, so `ctx.changed` and `ctx.origins` still describe everything since the last completed run;
- **another writer changes one of its targets**, such as the user editing a field the behavior fills in. It isn't rerun;
- **its guard turns false**, its row is removed, it is removed, or `store.reset()` covers it. It isn't rerun.

On cancellation `ctx.signal` aborts, so pass it to `fetch` and other cancellable work. After that, `ctx.get` and `ctx.set` throw the abort reason, which ends the run quietly: the store never reports it. A run that completes has therefore read only values that are still current.

Server checks usually run on edits only: `origins: ["user"]` and `runOn: { init: false }` keep loading a saved form from calling the server for every field.

## Debouncing and kept work

A debounce is written in the behavior: wait before the request, and let cancellation drop the runs that a newer change replaced.

```ts
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

const checkDestinationDebounced = defineBehavior({
  name: "checkDestinationDebounced",
  triggers: [shape.destination, shape.nights],
  writes: [shape.destination.error],
  origins: ["user"],
  runOn: { init: false },
  run: async (ctx) => {
    const destination = ctx.get(shape.destination);
    const nights = ctx.get(shape.nights);
    const allowed = await ctx.keep([destination], async (signal) => {
      await sleep(400, signal);
      return isAllowed(destination, signal);
    });
    ctx.set(shape.destination.error, allowed ? undefined : `We don't travel there for ${nights} nights`);
  },
});
```

`ctx.keep(key, start)` is [kept work](../../GLOSSARY.md): async work that a rerun can continue instead of restarting. Here, a change to `nights` cancels the run and starts a new one, but the destination is the same, so the new run gets the request already in flight instead of sending another. With a different key, the old work is aborted and `start` is called again. The rules:

- The work depends only on its key. It gets its own `signal`, never `ctx`, and must not read the form.
- Each behavior instance has one slot: one piece of kept work at a time.
- Kept work is aborted when a rerun asks for a different key, when no rerun takes it over, and when the row is removed, the behavior is removed or `reset()` covers it.

The [validation recipe](https://github.com/TheAsda/anyshape/blob/master/recipes/validation.ts) keeps its debounce and its async checks this way.

## Pending

The core derives which targets are pending; nothing declares or writes it. Two read-only references report it, and a store method waits for it:

- `pendingOf(target)` is `true` while a run that writes `target` is in flight.
- `pendingIn(node)` counts the pending targets under `node`, rows included. `pendingIn(node, definition)` counts only the meta keys declared with that definition.
- `store.settle(node)` resolves once no run that writes under `node` is in flight. Without a node, it waits for the store's whole subtree.

`pendingIn` pairs with `countIn(node, definition)`, which counts the nodes whose counted key is set ([meta-keys.md](meta-keys.md)): no errors and nothing pending answers "can this form be submitted now?".

```ts
const store = createStore(shape, { destination: "", nights: 3 }, { behaviors: [checkDestinationDebounced] });

const checking = store.get(pendingOf(shape.destination.error));
const canSubmit = store.get(countIn(shape, error)) === 0 && store.get(pendingIn(shape, error)) === 0;

async function submit(send: (values: { destination: string; nights: number }) => Promise<void>) {
  await store.settle();
  if (store.get(countIn(shape, error)) === 0) await send(store.get(shape));
}
```

These are references like any other: read them in React with `useValue(pendingIn(shape, error))` to show "Checking…" or disable a submit button ([react.md](react.md)).

Counts and pending tallies change without an origin: no person or program wrote them. So a behavior with an `origins` filter can't use one as a trigger, and registration says so.

## Common mistakes

- **Using `ctx` inside kept work.** The work outlives the run that started it; read what it needs before `ctx.keep` and pass it through the key.
- **Starting server checks on load.** Without `runOn: { init: false }` and an origins filter, a behavior runs when the store is created, for every row.
- **Submitting without `settle()`.** A check still in flight hasn't written its result yet.

## See also

- [Behaviors](behaviors.md): the run context.
- [Meta keys](meta-keys.md): counting with `countIn`.
- [React](react.md): showing pending state.
- [What your app owns](your-side.md): submitting.
