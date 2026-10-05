# Arrays and rows

An array node holds rows, and its `item` is the row template: one declaration that every row follows. Each row is its own [scope](../../GLOSSARY.md), with its own store, so behaviors declared on the template run separately in every row, and a change in one row doesn't run the others.

First shown in [stage 9](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage9).

## Declaring an array

```ts
import { form, object, field, array, defineBehavior, defineBehaviors, createStore } from "anyshape";

const shape = form(
  object({
    baseFare: field<number>(),
    total: field<number>(),
    travelers: array(
      object({
        name: field<string>(),
        age: field<number>(),
        fare: field<number>(),
      }),
      { create: () => ({ name: "", age: 30, fare: 0 }) },
    ),
  }),
);
```

`array(item, { create })` takes an object node as the row template. `create` returns a new row object each time it's called; with it, adding a row needs no argument. Without it, every new row must be passed in full.

`shape.travelers.item` is the template, and `shape.travelers.item.name` is "the name in a row". Which row depends on the store it is read through.

## Working with rows

```ts
const store = createStore(shape, { baseFare: 100, total: 0, travelers: [] });
const travelers = store.substore(shape.travelers);

const ada = travelers.append({ name: "Ada", age: 36 });
const tim = travelers.append({ name: "Tim", age: 8 });

ada.get(shape.travelers.item.name); // "Ada"
tim.set(shape.travelers.item.age, 9);

travelers.move(tim, 0);
travelers.remove(ada);
travelers.items(); // the row stores, in order: [tim]
```

`store.substore(arrayNode)` returns the array's store:

- `items()` returns the row stores in order, the same array until rows are added, removed or reordered. `itemAt(index)` returns one; `current()` returns the rows' values.
- `append(row?)` and `insert(index, row?)` add a row and return its store. With `create`, the argument is optional and partial.
- `remove(row)` and `move(row, toIndex)` take a row store.
- `subscribeItems(listener)` fires only when the sequence of rows changes.

Each row store reads and writes the template's nodes for its row. Its `stableId` stays the same for the row's lifetime, through edits and moves, so it makes a good React key. Once its row is removed, the store is detached and writing through it throws.

Writing the whole array with `store.set(shape.travelers, rows)` works too. Rows are told apart by object identity, so an array can't hold the same object twice.

## Behaviors per row

`b.each(array, (b, item) => { ... })` declares behaviors on the template. Each row gets its own instance, created when the row is added:

```ts
const behaviors = defineBehaviors(shape, (b, s) => {
  b.each(s.travelers, (b, t) => {
    b.add(
      defineBehavior({
        name: "fare",
        triggers: [t.age, s.baseFare],
        writes: [t.fare],
        run: (ctx) => ctx.set(t.fare, ctx.get(t.age) < 12 ? ctx.get(s.baseFare) / 2 : ctx.get(s.baseFare)),
      }),
    );
  });
});
```

- A row behavior may read and trigger on nodes outside its row, such as `baseFare` here. A change to `baseFare` runs the behavior once in every row.
- It writes only inside its own row. Registration rejects a row behavior that writes a form-level node.
- Sibling rows are independent: editing one traveler's age runs that row's instance only.

`row.addBehavior(...)` on a row store registers behaviors for that one row.

## Over the whole array

A behavior outside the rows can trigger on the array node itself. The array's value changes whenever a row is added, removed, moved or edited:

```ts
const total = defineBehavior({
  name: "total",
  triggers: [shape.travelers],
  writes: [shape.total],
  run: (ctx) => ctx.set(shape.total, ctx.get(shape.travelers).reduce((sum, traveler) => sum + traveler.fare, 0)),
});

const tripStore = createStore(
  shape,
  { baseFare: 100, total: 0, travelers: [{ name: "Ada", age: 36, fare: 0 }] },
  { behaviors: [...behaviors, total] },
);
tripStore.substore(shape.travelers).append({ name: "Tim", age: 8 });
tripStore.get(shape.total); // 150
```

The order is worked out from the declarations: the row behaviors write `fare`, which is inside `travelers`, so they run before `total`. Counting a key across all rows works the same way, with `countIn(shape.travelers, definition)` ([meta-keys.md](meta-keys.md)).

## Common mistakes

- **Reading a row's node through the root store.** `store.get(shape.travelers.item.name)` throws: the root can't tell which row is meant. Use the row's store. React hooks find it for you under a row's provider ([react.md](react.md)).
- **A row behavior writing outside its row.** Registration throws `... is outside the behavior's scope ("travelers[]") – behaviors write only their own scope`. Write the form-level target from a behavior outside `b.each` that triggers on the array.
- **Putting the same object in the array twice.** Rows are identified by their objects; the write throws.

## See also

- [The store](store.md): substores and scopes.
- [Behaviors](behaviors.md): declaring behaviors.
- [React](react.md): `useArray` and providing a row's store.
