# Guards

A [guard](../../GLOSSARY.md) switches [behaviors](../../GLOSSARY.md) and [contributions](../../GLOSSARY.md) on and off: a test over declared references that must pass for the declaration to apply. A behavior whose guard fails stops running and keeps what it wrote. So a guard turns a rule on and off; it is not a way to compute a value that goes both ways.

First shown in [stage 5](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage5) (visibility); [stage 6](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage6) (disabled); [stage 8](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage8) (rules under a guard).

## Declaring a guard

```ts
import {
  form, object, field, metaKey, when, defineBehavior, defineBehaviors, contribute, createStore, initialOf,
} from "anyshape";

const visible = metaKey(true);
const disabled = metaKey(false);
// A combined `error`: each rule contributes a check, the key shows the first failure (contributions.md).
const error = metaKey<string | undefined, (value: unknown) => string | undefined>(undefined).combine((self, key) => ({
  triggers: [self],
  writes: [key],
  run: (ctx) => {
    const value = ctx.get(self);
    ctx.set(key, ctx.parts.map((part) => part.payload(value)).find((message) => message !== undefined));
  },
}));

const shape = form(
  object({
    nights: field<number>(),
    notes: field<string>().meta({ error }),
    rentingCar: field<boolean>(),
    car: object({
      license: field<string>().meta({ error, disabled }),
    }).meta({ visible, disabled }),
  }),
);

const requireNotes = contribute(shape.notes.error, (value) => (value === "" ? "Tell us why you stay this long" : undefined), {
  name: "requireNotes",
  when: when([shape.nights], (nights) => nights > 30),
});
```

A guard is `when(refs, test)`: `test` gets the references' values, typed, and returns whether the declaration applies. Put it in a behavior's or a contribution's `when` (an array of guards must all pass). Its references become triggers, so the guard is checked again whenever they change.

Inside `defineBehaviors`, `b.when(refs, test, (b) => { ... })` guards everything added in the block. Blocks nest, and their guards add up:

```ts
const rules = defineBehaviors(shape, (b, s) => {
  b.add(requireNotes);
  b.when([s.car.visible], (shown) => shown, (b) => {
    b.add(contribute(s.car.license.error, (value) => (value === "" ? "Required" : undefined), { name: "licenseRequired" }));
  });
});
```

What a failing guard does depends on what it guards:

- **A behavior** stops running. What it wrote stays.
- **A contribution** is absent. Its key's owner recomputes without it, so the license error above clears as soon as the car section hides.

## A guard or a value computed both ways?

The car section is shown while the user rents a car. It is tempting to guard a behavior that sets `visible`:

```ts
// Wrong: once shown, the section stays shown.
const showCarWrong = defineBehavior({
  name: "showCar",
  when: when([shape.rentingCar], (renting) => renting),
  writes: [shape.car.visible],
  run: (ctx) => ctx.set(shape.car.visible, true),
});
```

When the box is unchecked, the guard fails and the behavior stops running, but `visible` keeps the `true` it wrote. A value that follows a condition both ways is one behavior that computes both directions:

```ts
const showCar = defineBehavior({
  name: "showCar",
  triggers: [shape.rentingCar],
  writes: [shape.car.visible],
  run: (ctx) => ctx.set(shape.car.visible, ctx.get(shape.rentingCar)),
});
```

The same holds for any target that takes one value under a condition and another value otherwise: one behavior, one `ctx.set` of the computed value. The [recipes](../../GLOSSARY.md)' `visibleWhen` is this behavior as a function ([source](https://github.com/TheAsda/anyshape/blob/master/recipes/behaviors.ts); used in [stage 5](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage5)).

Use a guard when the rule itself comes and goes: a requirement that applies only to long stays, rules that apply only while a section is shown. Use a computed value when the rule always applies and only its result changes.

## Nothing happens implicitly

Hiding the car section changes `car.visible` and nothing else:

- the license keeps what the user typed, and the form submits it;
- its rules still run, unless you guard them on `car.visible` as above;
- the [meta keys](../../GLOSSARY.md) of the [nodes](../../GLOSSARY.md) inside the section don't change.

Disabling works the same way. Each consequence you want is a declaration you add. To clear the section while it is hidden, write the behavior that clears it:

```ts
const clearLicense = defineBehavior({
  name: "clearLicense",
  triggers: [shape.car.visible, shape.car.license],
  reads: [initialOf(shape.car.license)],
  writes: [shape.car.license],
  run: (ctx) => {
    const initial = ctx.get(initialOf(shape.car.license));
    if (!ctx.get(shape.car.visible) && ctx.get(shape.car.license) !== initial) ctx.set(shape.car.license, initial);
  },
});
```

So hiding a section and showing it again keeps what the user typed, unless you chose otherwise, and a team whose "disabled" means "read-only but submitted" gets exactly that. The recipes' `clearWhen` is this behavior as a function ([source](https://github.com/TheAsda/anyshape/blob/master/recipes/behaviors.ts); used in [stage 5](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage5)).

## Groups

A key on a group describes the group's own node, not its children. When a group is hidden or disabled, decide what that means for what's inside it:

- **Guard the rules on the group's own key**, as `b.when([s.car.visible], ...)` does above.
- **Don't render a hidden group**: the component reads `useValue(shape.car.visible)` ([react.md](react.md)).
- **Disable a whole group in the markup**: `<fieldset disabled={useValue(shape.car.disabled)}>` disables every input inside it ([react.md](react.md)).
- **Copy the group's value to a child** when the child's own key must follow it. The copying behavior is that key's one writer:

```ts
const licenseFollowsCar = defineBehavior({
  name: "licenseFollowsCar",
  triggers: [shape.car.disabled],
  writes: [shape.car.license.disabled],
  run: (ctx) => ctx.set(shape.car.license.disabled, ctx.get(shape.car.disabled)),
});

const store = createStore(
  shape,
  { nights: 1, notes: "", rentingCar: false, car: { license: "" } },
  { behaviors: [...rules, showCar, clearLicense, licenseFollowsCar] },
);
```

## Removing is not guarding

A guard and removal both stop a behavior, with different results. A behavior whose guard fails still exists, so its writes stay. A removed behavior (a handle called, or a `useBehaviors` component unmounted) is gone, so the meta keys it wrote return to their defaults; the values it wrote stay ([behaviors.md](behaviors.md)).

## See also

- [Behaviors](behaviors.md): the declarations guards apply to.
- [Combined keys](contributions.md): why a contribution with a failing guard is absent.
- [What your app owns](your-side.md): rendering hidden and disabled fields.
