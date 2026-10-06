# Shapes and nodes

A [shape](../../GLOSSARY.md) declares a form's values: objects, fields, arrays of rows, and the [meta keys](../../GLOSSARY.md) each of them carries. Every type in anyshape is inferred from it. `form()` turns the declaration into [nodes](../../GLOSSARY.md), and each node is both the address of a value and the way to reach that value's meta keys.

First shown in [stage 1](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage1).

## Declaring a shape

```ts
import { form, object, field, array, createStore, type InferValue } from "anyshape";

const shape = form(
  object({
    destination: field<string>(),
    startDate: field<string>(),
    nightlyRate: field<number | undefined>(),
    car: object({
      license: field<string>(),
    }),
    travelers: array(object({ name: field<string>(), passport: field<string>() }), {
      create: () => ({ name: "", passport: "" }),
    }),
  }),
);

type Trip = InferValue<typeof shape>;

const initialValues: Trip = {
  destination: "",
  startDate: "",
  nightlyRate: undefined,
  car: { license: "" },
  travelers: [],
};
```

- `field<T>()` is a typed slot for a value. anyshape never checks a field's value at run time; the type is the contract.
- `object({ ... })` groups children under names.
- `array(item, { create })` holds rows. A row is always an object, so a list of strings is written as `array(object({ value: field<string>() }))`. `create` builds a new row, which lets `append()` run without an argument ([arrays.md](arrays.md)).
- `form(object({ ... }))` takes the root object and gives every node below it its identity: an `id`, a `path` such as `"car.license"`, and its `parent`. Use the nodes reached from what `form()` returns.

A few names belong to the node itself (`id`, `path`, `parent`, `lens`, `meta`) and can't name a field.

## A node is a typed reference

`shape.car.license` is a `FieldNode<string>`, and `shape.car` is an object node whose value is `{ license: string }`. The [store](../../GLOSSARY.md), [behaviors](../../GLOSSARY.md) and React hooks all take nodes, and their types follow:

```ts
const store = createStore(shape, initialValues);

store.set(shape.destination, "Lisbon");
const destination: string = store.get(shape.destination);
const car: { license: string } = store.get(shape.car);
```

A misspelled node doesn't compile, and neither does a value of the wrong type, such as a number written to `shape.destination`. There is no string path to get wrong: the only place anyshape reads a path is `store.resolvePath`, for errors a server reports by path ([your-side.md](your-side.md)).

A node's `path` is meant for messages and debugging. Code that needs a node is handed the node.

## Declaring meta on a node

`.meta({ ... })` declares meta keys: state that lives beside a node's value, with a default. Each key becomes a reference on the node, next to its children:

```ts
import { metaKey, type InferMeta } from "anyshape";

const error = metaKey<string | undefined>(undefined);

const booking = form(
  object({
    email: field<string>().meta({ error, label: "Email" }),
    car: object({ license: field<string>() }).meta({ visible: true }),
  }),
);

const emailStore = createStore(booking, { email: "", car: { license: "" } });
emailStore.set(booking.email.error, "Required");
const label: string = emailStore.get(booking.email.label);

type EmailMeta = InferMeta<typeof booking.email>; // { error: string | undefined; label: string }
```

- A plain value (`label: "Email"`, `visible: true`) declares a key with that default.
- A key definition made with `metaKey` (`error`) carries a default and can add capabilities: counting, a default behavior, combining several inputs ([meta-keys.md](meta-keys.md)).
- A [feature](../../GLOSSARY.md) is a function that returns several key definitions; spread it into `.meta()` with the rest: `field<string>().meta(control(), { label: "Email" })`.
- `.meta()` is called before `form()`, and it returns a new node: the one it was called on is unchanged. For meta on the root, call it on the root object: `form(object({ ... }).meta({ ... }))`.
- A node declares each key once, and a key can't share its name with a child.

## Reusing a piece of shape

Before `form()`, a node is a template. Using one template in two places gives two nodes, each with its own value and meta:

```ts
const address = object({ street: field<string>(), city: field<string>() });

const order = form(
  object({
    billing: address,
    shipping: address.meta({ visible: true }),
  }),
);

const orderStore = createStore(order, {
  billing: { street: "", city: "" },
  shipping: { street: "", city: "" },
});
orderStore.set(order.billing.city, "Porto"); // order.shipping.city is still ""
```

A function that returns a piece of shape works the same way, and can take parameters. Behaviors for a reused piece are reused as plain functions that take its nodes ([behaviors.md](behaviors.md)).

## Common mistakes

- **Calling `.meta()` on a node from `form()`'s result.** It throws: meta is declared on the template, before `form()`.
- **Passing the template instead of the form's node.** The template has no place in the form, so the store rejects it. Keep the result of `form()` and reach every node through it.
- **An array of primitives.** `array(field<string>())` throws; wrap the value in an object.

## See also

- [The store](store.md): reading and writing through nodes.
- [Meta keys](meta-keys.md): key definitions, features, counting.
- [Arrays and rows](arrays.md): row templates and row stores.
