# The evolution example

One trip-booking form, built up in 14 stages. Each stage adds one concept to the previous one, so reading them in order is the tutorial. Every stage is a folder under [`src/stages/`](src/stages/): `index.tsx` is the form, `meta.ts` holds the story and notes the app shows beside it.

The stages use the recipes for validation, input state and submitting, from a copied set in [`src/recipes/`](src/recipes/): the way a team that changes a default policy works. The copy is the package's [default recipes](../../recipes/README.md) with one edit, in [`src/recipes/react/control.ts`](src/recipes/react/control.ts): an error shows from the first keystroke, where the default recipes wait for a blur or a submit. Stage 3 is where it shows. Every stage imports the recipes from the copy and none from `anyshape/recipes`: a form that mixes the two sets is checked wrongly, since keys are matched by definition. To use the defaults as they are, import `anyshape/recipes` instead, as the [basic example](../basic/README.md) does.

## Running it

```sh
bun install                 # at the repository root: the library's own dependencies
cd examples/evolution
bun install
bun run dev
```

The example uses the library's source directly, so there's nothing to build first. Open the printed address, pick a stage from the tabs or move between stages with the left and right arrow keys, and keep the stage's folder open in your editor beside it.

## The stages

| Stage                                     | Story                                                          | Concept                                                                  | Guide                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [1. Values](src/stages/stage1)            | You need to know where and when someone is going.              | A shape, a store, reading and writing values.                            | [Shapes](../../docs/guide/shape.md), [the store](../../docs/guide/store.md)                       |
| [2. Control](src/stages/stage2)           | Inputs need error, edited and dirty state.                     | Meta keys and meta groups: `control()` on a field.                       | [Meta keys](../../docs/guide/meta-keys.md)                                                        |
| [3. Rules](src/stages/stage3)             | The dates are required, and "l" is no destination.             | Rules as contributions to `error`; submitting.                           | [Combined keys](../../docs/guide/contributions.md)                                                |
| [4. Derived](src/stages/stage4)           | Nights and budget follow from the dates.                       | A behavior computing a value from others.                                | [Behaviors](../../docs/guide/behaviors.md)                                                        |
| [5. Visibility](src/stages/stage5)        | Only someone renting a car is asked for a license.             | `visible`, computed both ways; rules guarded on it; clearing on purpose. | [Guards](../../docs/guide/guards.md)                                                              |
| [6. Disabled](src/stages/stage6)          | The employer pays, so the nightly rate is locked.              | `disabled` and `disableWhen`; a locked value is still submitted.         | [Guards](../../docs/guide/guards.md), [writing a recipe](../../docs/guide/writing-a-recipe.md)    |
| [7. Exclusive](src/stages/stage7)         | One discount per booking.                                      | Several reasons feeding one key.                                         | [Combined keys](../../docs/guide/contributions.md)                                                |
| [8. Guards](src/stages/stage8)            | Stays over 30 nights need a justification.                     | A rule that applies only while a condition holds.                        | [Guards](../../docs/guide/guards.md)                                                              |
| [9. Arrays](src/stages/stage9)            | People travel together.                                        | Rows, per-row rules, the array as a source.                              | [Arrays and rows](../../docs/guide/arrays.md)                                                     |
| [10. Custom behavior](src/stages/stage10) | Picking a departure suggests a one-week trip.                  | `defineBehavior` by hand: triggers, writes, origins, `runOn`.            | [Behaviors](../../docs/guide/behaviors.md)                                                        |
| [11. Reuse](src/stages/stage11)           | The rental car needs a date pair too.                          | A behavior as a function of its nodes; one writer per target.            | [Behaviors](../../docs/guide/behaviors.md)                                                        |
| [12. Async & server](src/stages/stage12)  | Some destinations are off-limits, and the server has opinions. | An async check, and server errors mapped by path.                        | [Async behaviors](../../docs/guide/async.md), [what your app owns](../../docs/guide/your-side.md) |
| [13. Status](src/stages/stage13)          | Is the form still checking? Count it.                          | Counting errors and pending checks across the form.                      | [Async behaviors](../../docs/guide/async.md), [meta keys](../../docs/guide/meta-keys.md)          |
| [14. Steps](src/stages/stage14)           | The booking splits in two; the room type has no default.       | A field that starts empty (`defined`); a step submitted on its own.      | [Forms in steps](../../docs/guide/your-side.md#forms-in-steps)                                    |

For a complete form in one piece, see the [basic example](../basic/README.md).
