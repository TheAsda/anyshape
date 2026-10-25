# Behaviors

A [behavior](../../GLOSSARY.md) is a declared rule that keeps the form consistent. It runs when one of its triggers changes, reads only the references it declares, and writes only its declared targets. Each target has exactly one writer. Derived values, autofill, validation and every other [recipe](../../GLOSSARY.md) are behaviors underneath.

First shown in [stage 4](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage4) (derived values); written by hand in [stage 10](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage10); turned into a function in [stage 11](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage11).

## Declaring one

```ts
import { form, object, field, pathOf, defineBehavior, defineBehaviors, createStore, type FieldNode } from "anyshape";

const DAY = 86_400_000;
const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString().slice(0, 10);

const shape = form(
  object({
    startDate: field<string>(),
    endDate: field<string>(),
    nights: field<number | undefined>(),
    car: object({ pickupOn: field<string>(), dropoffOn: field<string>() }),
  }),
);

// Picking a departure while the return is empty suggests a one-week trip.
const suggestReturn = defineBehavior({
  name: "suggestReturn",
  triggers: [shape.startDate],
  writes: [shape.endDate],
  origins: ["user"],
  runOn: { init: false },
  run: (ctx) => {
    const start = ctx.get(shape.startDate);
    if (start !== "" && ctx.get(shape.endDate) === "") ctx.set(shape.endDate, addDays(start, 7));
  },
});
```

A behavior's config declares everything it touches:

| Part       | Meaning                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | Used in error messages, DevTools and [origins](../../GLOSSARY.md). Give every behavior one.                                         |
| `triggers` | A change to any of these runs the behavior.                                                                                         |
| `reads`    | Readable in `run`, but a change to them doesn't run it.                                                                             |
| `writes`   | The only targets `ctx.set` accepts, values or [meta keys](../../GLOSSARY.md). Each target has one writer. Targets are readable too. |
| `when`     | [Guards](../../GLOSSARY.md): the behavior runs only while they pass ([guards.md](guards.md)).                                       |
| `runOn`    | `{ init: false }` skips the run when the behavior is created.                                                                       |
| `origins`  | Run on a change only when it came from one of these kinds: `"user"`, `"program"`, `"initial"`, `"behavior"`.                        |
| `run(ctx)` | The rule. It may return a promise ([async.md](async.md)).                                                                           |

`suggestReturn` runs only on the user's edits, so loading a half-filled form from the server never fills in the return, and it never runs at creation.

`defineBehaviors(shape, (b, s) => { ... })` builds the list a [store](../../GLOSSARY.md) takes. `b.add(...)` adds behaviors (arrays are flattened at any depth, as they are in `createStore`, `addBehavior` and `replaceBehavior`), `b.when(...)` adds guarded ones ([guards.md](guards.md)) and `b.each(...)` adds per-row ones ([arrays.md](arrays.md)). It returns a plain array: pass it to `createStore(shape, values, { behaviors })` or to `useForm`.

## The run context

`run` receives `ctx`:

- `ctx.get(ref)` reads a declared reference. After `ctx.set`, it returns the value this run wrote.
- `ctx.set(ref, value)` writes a declared target. Writes apply when the run completes, all together; a run that throws writes nothing.
- `ctx.changed(ref)` tells whether that trigger changed since the last run. It is false on the first run.
- `ctx.origins` holds the origins of the changes that caused this run. It is empty on the first run.
- `ctx.state` is an object kept between runs of this behavior instance, for what the behavior must remember. The run gets a copy, saved only if the run completes.
- `ctx.signal` and `ctx.keep` are for async runs ([async.md](async.md)).

`ctx.state` is how a behavior remembers something about the user, such as "the user typed their own value":

```ts
const nightsFromDates = defineBehavior({
  name: "nightsFromDates",
  triggers: [shape.startDate, shape.endDate, shape.nights],
  writes: [shape.nights],
  run: (ctx) => {
    if (ctx.changed(shape.nights) && ctx.origins.has("user")) ctx.state.edited = true;
    if (ctx.state.edited) return;
    const start = ctx.get(shape.startDate);
    const end = ctx.get(shape.endDate);
    ctx.set(shape.nights, start && end ? Math.round((Date.parse(end) - Date.parse(start)) / DAY) : undefined);
  },
});
```

The behavior both triggers on `nights` and writes it. Its own writes never trigger it, so it runs again only when the dates change or someone else writes `nights`. A behavior that needs to know whether it ran before keeps a flag in `ctx.state` the same way.

## When it runs

- **At creation**, unless `runOn: { init: false }`: when the store is created, when a row is added (for row behaviors), and again after `store.reset()` covers its targets. So the form starts consistent.
- **When a trigger changes**, if the origins filter lets the change through. Guard references are triggers too.
- **Once per change, in order.** The store orders behaviors from their declarations: one that writes what another reads runs first. Every behavior runs at most once per change and sees final values. A cycle between behaviors is rejected when they are registered.
- **Never on its own writes**, in any of its instances.

A synchronous behavior has finished by the time `store.set` returns. If it throws, the store passes the error to `onError` and drops the run's writes; the form keeps working.

## Starting a key with a value known at creation

A [meta key](../../GLOSSARY.md) starts at its default, and behaviors run at creation — so a key whose start is known when the store is created can hold it from the start. The default recipes ship this as `startWith(ref, value)`: no triggers, just the write. It runs inside `createStore`, before anything can read the key. That write makes `startWith` the key's writer, so a key that already has one — a key its own behavior writes (`dirty`), or one contributions combine into (`error`) — is rejected at registration, like any second writer.

```ts
import { metaKey } from "anyshape";
import { startWith } from "anyshape/recipes";

const editor = form(object({ title: field<string>() }).meta({ mode: metaKey<"create" | "edit">("create") }));

// A form created with content opens in edit mode.
const editorStore = createStore(editor, { title: "Hello" }, { behaviors: startWith(editor.mode, "edit") });
```

`startWith` runs again for every row that is added later (when it is registered for rows through the builder's `each`), and again after `reset()` — a key it started returns to its start, not its default. It does not run on a load (`{ as: "initial" }`): the start is fixed at mount. Declaration order doesn't matter: a behavior that reads `mode` triggers on it, so `startWith`'s write runs it again — what a behavior computes from `mode` is computed from `"edit"`, never from the default.

A start computed from the row's own data — a "same as name" checkbox born from whether the values already match — takes more than a fixed value, so it stays a hand-written behavior. The factory is registered for the root and for every row:

```ts
import { array, type MetaRef } from "anyshape";

function sameAsNameLink(name: FieldNode<string>, shortName: FieldNode<string> & { sameAsName: MetaRef<boolean> }) {
  return defineBehavior({
    name: `sameAsName(${pathOf(shortName)})`,
    triggers: [name, shortName, shortName.sameAsName],
    writes: [shortName.sameAsName, shortName],
    run: (ctx) => {
      // Creation and loads ({ as: "initial" }): start from the row's own data.
      if (ctx.origins.size === 0 || ctx.origins.has("initial")) {
        ctx.set(shortName.sameAsName, ctx.get(name) === ctx.get(shortName));
        return;
      }
      // The user typed their own short name: the checkbox follows the truth.
      if (ctx.changed(shortName) && ctx.get(name) !== ctx.get(shortName)) {
        ctx.set(shortName.sameAsName, false);
        return;
      }
      // While checked, the short name follows the name.
      if (ctx.get(shortName.sameAsName)) ctx.set(shortName, ctx.get(name));
    },
  });
}

const contacts = form(
  object({
    name: field<string>(),
    shortName: field<string>().meta({ sameAsName: metaKey(false) }),
    people: array(
      object({
        name: field<string>(),
        shortName: field<string>().meta({ sameAsName: metaKey(false) }),
      }),
      { create: () => ({ name: "", shortName: "" }) },
    ),
  }),
);

const contactBehaviors = defineBehaviors(contacts, (b, s) => {
  b.add(sameAsNameLink(s.name, s.shortName));
  b.each(s.people, (b, person) => b.add(sameAsNameLink(person.name, person.shortName)));
});

// Both checkboxes are born checked: the values they describe already match.
const contactsStore = createStore(
  contacts,
  { name: "Ada", shortName: "Ada", people: [{ name: "Grace Hopper", shortName: "Grace Hopper" }] },
  { behaviors: contactBehaviors },
);
```

Three things to know:

**The start and the rules are one behavior.** The creation branch and the copy branch live in the same `run` because the checkbox and the value it follows form a loop: while checked, the behavior writes the value; unchecked or not, it triggers on it. Split in two, each behavior would trigger on what the other writes, and the store rejects the cycle at registration. One behavior that triggers on all three and writes both targets has no cycle — its own writes never re-trigger it. `startWith` cannot express this: it takes a fixed value and writes once, so a computed start that also reacts stays one hand-written behavior.

**`reset()` restores the start.** Behaviors covering their targets re-run after `reset()` as if the store were just created, from the restored values — for every row that still exists. A start needs no `keepOnReset` and nothing to recompute by hand.

**In React, this is not `useSync`'s job.** `useSync` writes before paint, but the creation runs happen earlier, inside `createStore` — a behavior reading a synced key at creation sees the key's default, and anything it computed from the default stays. A start the readers must see on their first run belongs in `behaviors`, exactly as above; `useSync` is for data that arrives from React ([react.md](react.md)).

Both patterns start from data the store already has. A deep start that can't be worked out from the row's own values — one handed in from outside — belongs in the values, not in meta: as a value it loads with `values` and returns with `reset()`. And a start captured in `behaviors` is fixed at mount: `useForm` creates the store once per mount, so a later change to what the start was taken from doesn't reach it while the behaviors are the same object. Data that changes during the form's lifetime is `useSync`'s, with the first-run caveat above.

## Reuse is a plain function

When a second pair of dates needs the same rule, the [nodes](../../GLOSSARY.md) are the only thing that differs. Turn the behavior into a function that takes them:

```ts
function suggestEnd(start: FieldNode<string>, end: FieldNode<string>, days: number) {
  return defineBehavior({
    name: `suggestEnd(${pathOf(end)})`,
    triggers: [start],
    writes: [end],
    origins: ["user"],
    runOn: { init: false },
    run: (ctx) => {
      const value = ctx.get(start);
      if (value !== "" && ctx.get(end) === "") ctx.set(end, addDays(value, days));
    },
  });
}

const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(suggestEnd(s.startDate, s.endDate, 7), suggestEnd(s.car.pickupOn, s.car.dropoffOn, 3));
  b.add(nightsFromDates);
});

const store = createStore(
  shape,
  { startDate: "", endDate: "", nights: undefined, car: { pickupOn: "", dropoffOn: "" } },
  { behaviors },
);
```

This is the shape of every recipe helper: nodes and options in, behaviors out. A name built from the node's path keeps each copy identifiable in messages.

## Adding and removing behaviors later

`store.addBehavior(behaviors)` registers more behaviors on a live store, with the same checks as `createStore`. It returns a handle; calling it removes them. `store.replaceBehavior(handle, behaviors)` swaps them in one step and returns the new handle.

```ts
const handle = store.addBehavior(
  defineBehavior({
    name: "trimPickup",
    triggers: [shape.car.pickupOn],
    writes: [shape.car.pickupOn],
    run: (ctx) => ctx.set(shape.car.pickupOn, ctx.get(shape.car.pickupOn).trim()),
  }),
);
handle();
```

Removing a behavior resets the meta keys it wrote to their defaults, because the rule they described is gone. The values it wrote stay: they are the user's data. A behavior whose guard is false is different: it still exists, so what it wrote stays. In React, `useBehaviors` removes its behaviors this way on unmount ([react.md](react.md)).

## Mistakes the store rejects

These compile, and the store stops them with a message that names the fix:

- **A read that isn't declared.** `ctx.get` throws `Behavior "total": "price" is not declared in triggers, reads, writes or when`, the error goes to `onError`, and the run writes nothing. Add the reference to `triggers` or `reads`.
- **A write that isn't declared.** `ctx.set` throws `... is not declared in writes`. Add it to `writes`.
- **Two writers for one target.** Registration throws `... is already written by "other" – one writer per target`. Merge them into one behavior, or make the key a combined key ([contributions.md](contributions.md)).
- **A cycle.** Two behaviors that each trigger on what the other writes are rejected with `Behaviors form a cycle: "a", "b" – merge them into one behavior that writes all their targets`:

```ts
const startFromEnd = defineBehavior({
  name: "startFromEnd",
  triggers: [shape.endDate],
  writes: [shape.startDate],
  run: () => {},
});
const endFromStart = defineBehavior({
  name: "endFromStart",
  triggers: [shape.startDate],
  writes: [shape.endDate],
  run: () => {},
});
// createStore(shape, values, { behaviors: [startFromEnd, endFromStart] }) throws.
```

The fix is one behavior that triggers on both and writes both, using `ctx.changed` to tell which side moved.

- **A row behavior writing outside its row**, and an origins filter on a count or [pending](../../GLOSSARY.md) reference, are rejected too ([arrays.md](arrays.md), [async.md](async.md)).

## See also

- [Guards](guards.md): switching behaviors on and off.
- [Combined keys](contributions.md): several declarations feeding one key.
- [Async behaviors](async.md): runs that wait for a server.
- The design records: [behaviors declare their dependencies](https://github.com/TheAsda/anyshape/blob/master/docs/adr/0003-behaviors-declare-their-dependencies.md), [one ordered pass per change](https://github.com/TheAsda/anyshape/blob/master/docs/adr/0004-one-ordered-pass-per-flush.md), [one writer per target](https://github.com/TheAsda/anyshape/blob/master/docs/adr/0005-one-writer-per-target.md).
