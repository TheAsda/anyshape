# What your app owns

anyshape computes the form's state and gives you the tools to act on it. How the form looks and how it talks to a server are yours: when an error shows, how hidden and disabled fields render, how text becomes a number, how a server's errors land on fields, and what submitting does. Each section below shows the usual way to do it. The [principles](../principles.md) explain why the library stops here.

Server errors are first shown in [stage 12](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage12).

## When an error shows

An error usually shouldn't appear while the user is still typing their first character. When it does appear is a decision over a few keys: the error itself, whether the field was left or the form submitted, and whether a check is still running.

```tsx
import { form, object, field, metaKey, createStore, countIn, pendingOf, type FieldNode, type MetaRef } from "anyshape";
import { useField, useValue } from "anyshape/react";

const error = metaKey<string | undefined>(undefined).aggregate((message) => message !== undefined);
const revealed = metaKey(false);

type CheckedNode = FieldNode<string> & {
  readonly error: MetaRef<string | undefined>;
  readonly revealed: MetaRef<boolean>;
};

function useShownError(node: CheckedNode): string | undefined {
  const message = useValue(node.error);
  const wasRevealed = useValue(node.revealed);
  const checking = useValue(pendingOf(node.error));
  return wasRevealed && !checking ? message : undefined;
}
```

The recipes' `useControl` hook makes this decision in one line, `showError`, which your copy can change: show errors once the value changed, or right away, or never while a check runs ([recipe source](https://github.com/TheAsda/anyshape/blob/master/recipes/react/control.ts)). The library has no error display of its own to configure.

## Rendering hidden and disabled fields

A hidden or disabled field keeps its value, and the form submits it ([guards.md](guards.md)). How it renders is up to you:

- not rendered at all, for a section that doesn't apply;
- rendered read-only, so the user sees the value they can't change;
- rendered normally with a note, when "disabled" means "computed for you".

If a hidden value must not be submitted, add a behavior that clears it; if a rule must not apply to a hidden field, guard the rule. Both are declarations you can read in the form's behaviors.

## Parsing and formatting

A field holds the type you declare, and an input holds text. Where the conversion happens is your choice. For a value that is always valid, convert in the component:

```tsx
function NightsInput({ node }: { node: FieldNode<number | undefined> }) {
  const { value, onChange } = useField(node);
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
    />
  );
}
```

When the user may type text that doesn't parse, and the form should say so, keep the text in the form and derive the number with a behavior:

```ts
import { defineBehavior } from "anyshape";

const booking = form(
  object({
    rateText: field<string>().meta({ error, revealed }),
    rate: field<number | undefined>(),
  }),
);

const parseRate = defineBehavior({
  name: "parseRate",
  triggers: [booking.rateText],
  writes: [booking.rate, booking.rateText.error],
  run: (ctx) => {
    const text = ctx.get(booking.rateText).trim();
    const rate = text === "" ? undefined : Number(text.replace(",", "."));
    const valid = rate === undefined || Number.isFinite(rate);
    ctx.set(booking.rate, valid ? rate : undefined);
    ctx.set(booking.rateText.error, valid ? undefined : "Enter a number, like 89.50");
  },
});
```

## Server errors

A server reports errors by path, such as `"travelers[1].name"`. `store.resolvePath(path)` turns a path into the node and the store that addresses it (a row's store for a path inside a row), or `undefined` when the path doesn't exist. The error key is then found by its definition, never by its name:

```ts
import { array } from "anyshape";

const trip = form(
  object({
    startDate: field<string>().meta({ error }),
    travelers: array(object({ name: field<string>().meta({ error }) })),
  }),
);
const store = createStore(trip, { startDate: "2026-05-01", travelers: [{ name: "Ada" }, { name: "Ada" }] });

function showServerErrors(fieldErrors: Record<string, string>) {
  store.batch(() => {
    for (const [path, message] of Object.entries(fieldErrors)) {
      const found = store.resolvePath(path);
      const target = found?.store.collect(found.ref, error).find((entry) => entry.ref.node === found.ref);
      if (target) target.store.set(target.ref, message);
    }
  });
}

showServerErrors({ startDate: "No rooms left on this date", "travelers[1].name": "Already booked" });
```

When the field's own behavior writes `error` again (after the next edit, say), the server's message is replaced.

## Submitting

The form submits what the store holds: `store.get(trip)`. Nothing is dropped, cleaned up or transformed on the way. Before sending, wait for checks in flight and decide what blocks a submit:

```ts
async function submit(send: (values: { startDate: string; travelers: { name: string }[] }) => Promise<void>) {
  await store.settle();
  if (store.get(countIn(trip, error)) > 0) return;
  await send(store.get(trip));
}
```

The submit recipe's `handleSubmit(store, fn)` is one complete version: it reveals every error, validates, waits for async checks, calls `fn` with the form's value when valid, and otherwise focuses the first error ([recipe source](https://github.com/TheAsda/anyshape/blob/master/recipes/submit.ts)). Copy it and change what your forms need.

Focusing that first error needs the DOM elements, which aren't form state: the focus recipe keeps them in its own registry beside the form ([react.md](react.md#state-beside-the-form)).

## See also

- [Guards](guards.md): hidden and disabled values stay.
- [React](react.md): controlled inputs and components.
- [Async behaviors](async.md): `settle()` and pending checks.
- [Why anyshape works this way](../principles.md).
