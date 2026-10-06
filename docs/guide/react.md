# React

`anyshape/react` connects a [store](../../GLOSSARY.md) to components. The hooks take the same references as the store, re-render a component only for what it reads, and leave the logic in declared [behaviors](../../GLOSSARY.md). React 19 is required for this entry only; the [core](../../GLOSSARY.md) doesn't use React.

Every stage of the [evolution example](https://github.com/TheAsda/anyshape/tree/master/examples/evolution) uses it. `useSync` and `useBehaviors` appear in no stage; this page is where they're shown.

## Creating and providing a store

```tsx
import {
  form,
  object,
  field,
  array,
  metaKey,
  defineBehaviors,
  defineBehavior,
  type FieldNode,
  type MetaRef,
  type InferValue,
} from "anyshape";
import { StoreProvider, useForm, useStore, useValue, useField, useArray, useSync, useBehaviors } from "anyshape/react";
import { useEffect } from "react";

const error = metaKey<string | undefined>(undefined);
const visible = metaKey(true);
const disabled = metaKey(false);
const destinations = metaKey<string[]>([], { keepOnReset: true });

const shape = form(
  object({
    destination: field<string>().meta({ error, destinations }),
    rentingCar: field<boolean>(),
    employerPays: field<boolean>(),
    car: object({ license: field<string>().meta({ error }) }).meta({ visible, disabled }),
    travelers: array(object({ name: field<string>().meta({ error }) }), { create: () => ({ name: "" }) }),
  }),
);

type Trip = InferValue<typeof shape>;

const initialValues: Trip = {
  destination: "",
  rentingCar: false,
  employerPays: false,
  car: { license: "" },
  travelers: [],
};

const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(
    defineBehavior({
      name: "showCar",
      triggers: [s.rentingCar],
      writes: [s.car.visible],
      run: (ctx) => ctx.set(s.car.visible, ctx.get(s.rentingCar)),
    }),
  );
  b.each(s.travelers, (b, t) => {
    b.add(
      defineBehavior({
        name: "travelerName",
        triggers: [t.name],
        writes: [t.name.error],
        run: (ctx) => ctx.set(t.name.error, ctx.get(t.name) === "" ? "Required" : undefined),
      }),
    );
  });
});

export function TripForm({ saved }: { saved?: Trip }) {
  const store = useForm(shape, initialValues, { behaviors, values: saved });
  return (
    <StoreProvider store={store}>
      <TextField node={shape.destination} label="Destination" />
      <CarSection />
      <Travelers />
    </StoreProvider>
  );
}
```

- `useForm(shape, initialValues, options)` creates the store once per mount. Its options are `createStore`'s (`behaviors`, `onError`) plus `values`: data to load. Each new `values` object is written as the [baseline](../../GLOSSARY.md), so `reset()` returns to it; while it is `undefined` (still loading), the form shows `initialValues`. Re-rendering with the same object does nothing, so the user's edits survive. Declare the [shape](../../GLOSSARY.md) outside components.
- `<StoreProvider store={store}>` provides a store to the hooks below it: the form, a substore, or a row's store.
- `useStore()` returns the provided store. Every hook also takes `{ store }` to use another one.

## Reading state

```tsx
function Summary() {
  const destination = useValue(shape.destination);
  const travelerCount = useValue(shape.travelers, (rows) => rows.length);
  return (
    <p>
      {travelerCount} going to {destination || "…"}
    </p>
  );
}
```

`useValue(ref)` reads any reference (a [node](../../GLOSSARY.md), a [meta key](../../GLOSSARY.md), `initialOf`, `countIn`, `pendingIn`, `pendingOf`) and re-renders when its value changes. `useValue(ref, select)` re-renders only when the selected result changes; pass `{ equals }` when the result is a new object each time.

## Inputs are controlled

```tsx
type TextNode = FieldNode<string> & { readonly error: MetaRef<string | undefined> };

function TextField({ node, label }: { node: TextNode; label: string }) {
  const { value, onChange } = useField(node);
  const message = useValue(node.error);
  return (
    <label>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} />
      {message && <span role="alert">{message}</span>}
    </label>
  );
}
```

`useField(node)` returns `{ value, onChange, store }`. `onChange` is stable and writes with the [origin](../../GLOSSARY.md) `"user"`. Meta keys are read with `useValue(node.key)`, so a field re-renders only for the keys it shows. There is no `register()`: every input is controlled, and its value lives in the store.

When an error appears is up to you. This field shows it as soon as it is set; the [recipes](../../GLOSSARY.md)' `useControl` hook waits until the field was left or the form submitted, and that decision is one line in your copy of it ([your-side.md](your-side.md)).

## Components take their node

`TextField` above takes its node as a prop, typed with the keys it reads. The same component serves `shape.destination` and every traveler's name, and a node without `error` doesn't compile. The store comes from the provider, so the component never needs to know where in the form it is.

Rows work the same way. `useArray(node)` returns the row stores and the row operations; each row renders under its own provider, and the template's nodes resolve to that row:

```tsx
function Travelers() {
  const { items, append, remove } = useArray(shape.travelers);
  return (
    <section>
      {items.map((row) => (
        <StoreProvider key={row.stableId} store={row}>
          <TextField node={shape.travelers.item.name} label="Name" />
          <button type="button" onClick={() => remove(row)}>
            Remove
          </button>
        </StoreProvider>
      ))}
      <button type="button" onClick={() => append()}>
        Add traveler
      </button>
    </section>
  );
}
```

`items` stays the same array until rows are added, removed or moved, so editing a name doesn't re-render the list. The row operations write with the origin `"user"`.

## Hidden and disabled groups

A group's keys describe the group, not its children ([guards.md](guards.md)). In components:

```tsx
function CarSection() {
  const shown = useValue(shape.car.visible);
  const locked = useValue(shape.car.disabled);
  if (!shown) return null;
  return (
    <fieldset disabled={locked}>
      <TextField node={shape.car.license} label="Driving license" />
    </fieldset>
  );
}
```

A hidden group isn't rendered, and `<fieldset disabled>` disables every input inside it. The values stay in the store either way, and are submitted unless a behavior clears them.

## Where logic lives

**In declared behaviors, by default.** Pass them to `useForm`, as `behaviors` above. They run whether or not a component is mounted, and they are checked when the store is created.

**React data enters through a key: `useSync`.** Props, context and query results that the form needs are written into a value or meta key, and behaviors read them from there:

```tsx
function DestinationOptions({ available }: { available: string[] }) {
  useSync(shape.destination.destinations, available);
  const options = useValue(shape.destination.destinations);
  return (
    <datalist id="destinations">
      {options.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}
```

`useSync(ref, value)` writes `value` (origin `"program"`) before paint whenever it changes. Declare a key fed this way with `keepOnReset`, or `reset()` clears it until the synced value changes again. A `useEffect` that calls `store.set` does the same job later, after paint; use `useSync`.

**`useBehaviors` only for logic that comes from the component.** When a rule depends on a prop, the component declares it:

```tsx
function DestinationRule({ banned }: { banned: string[] }) {
  useBehaviors(
    (b) => {
      b.add(
        defineBehavior({
          name: "bannedDestination",
          triggers: [shape.destination],
          writes: [shape.destination.error],
          run: (ctx) =>
            ctx.set(shape.destination.error, banned.includes(ctx.get(shape.destination)) ? "Not available" : undefined),
        }),
      );
    },
    [banned],
  );
  return null;
}
```

`useBehaviors(build, deps)` takes the same builder as `defineBehaviors`. It registers on the provided store before paint, replaces the registration in one step when `deps` change, and removes it on unmount: the meta keys it wrote return to their defaults, and the values stay. Under a row's provider, it registers for that row only. Put everything the declarations depend on in `deps`. A component rendered twice registers twice, so a behavior declared this way gets two writers and the second registration throws; declare such behaviors once, in `defineBehaviors` or a common parent.

**Effects on React state use `useValue` and `useEffect`.** A behavior writes only the form. Loading options into React state, showing a toast or logging belongs to the component:

```tsx
function CarToast({ notify }: { notify: (message: string) => void }) {
  const renting = useValue(shape.rentingCar);
  useEffect(() => {
    if (renting) notify("Bring your driving license");
  }, [renting, notify]);
  return null;
}
```

## State beside the form

A DOM element, a component handle or any other outside reference is not form state: it can't be submitted, compared or reset. Keep it in your own registry beside the form, keyed by the store and the node. The [focus recipe](https://github.com/TheAsda/anyshape/blob/master/recipes/focus.ts) is the pattern: `registerFocus(store, node, target)` stores a focus target in a `WeakMap` keyed by the node's [scope](../../GLOSSARY.md) store and the node, and returns the function that unregisters it. `reset()` leaves the registry alone, and the targets of removed rows are skipped by checking `store.isAttached()`.

## Common mistakes

- **Creating the shape inside a component.** `useForm` keeps the first one and warns in development; declare shapes at module level.
- **Mirroring props with `useEffect` and `store.set`.** Use `useSync`.
- **Reading a row's node outside its row's provider.** The hook throws and names the fix: render under a `<StoreProvider>` for that row, or pass `{ store: row }`.

## See also

- [The store](store.md): what the hooks read and write.
- [Arrays and rows](arrays.md): row stores.
- [What your app owns](your-side.md): showing errors, parsing input, submitting.
