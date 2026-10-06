# Combined keys

Sometimes several declarations need a say in one [meta key](../../GLOSSARY.md): several reasons to disable a field, several rules behind one error message. Each target has one writer, so they can't all write it. Instead, the key is written by one owner [behavior](../../GLOSSARY.md), and the others [contribute](../../GLOSSARY.md) inputs to it. The key decides how its contributions combine.

First shown in [stage 3](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage3) (rules feeding `error`); [stage 7](https://github.com/TheAsda/anyshape/tree/master/examples/evolution/src/stages/stage7) (several reasons to disable).

## Declaring a combined key

```ts
import { form, object, field, metaKey, contribute, when, createStore, type BehaviorContext } from "anyshape";

// Disabled while any reason is present. Each contribution is a reason, as a string.
const disabled = metaKey<boolean, string>(false).combine((self, key) => ({
  writes: [key],
  run: (ctx) => ctx.set(key, ctx.parts.length > 0),
}));

const shape = form(
  object({
    loyaltyNumber: field<string>(),
    promoCode: field<string>().meta({ disabled }),
    employerPays: field<boolean>(),
  }),
);
```

`metaKey<V, P>(default).combine((self, key, uses) => config)` declares a combined key. `V` is the key's value and `P` the payload each contribution carries. Every [node](../../GLOSSARY.md) that declares the key gets one owner: a behavior built from the returned config, which writes the key. Its run reads `ctx.parts`, the contributions that currently apply, in the order they were registered. Each part has:

- `payload`: what the contribution passed, typed `P`;
- `name` and a stable `id`;
- `inputs`: the references the contribution declared, which the owner may read with `ctx.get`.

The owner's config is an ordinary behavior config. The [store](../../GLOSSARY.md) adds every contribution's triggers, reads and [guard](../../GLOSSARY.md) references to it, so the owner reruns when any of them changes.

## Contributing

```ts
const loyaltyReason = contribute(shape.promoCode.disabled, "One discount per booking", {
  name: "oneDiscount",
  when: when([shape.loyaltyNumber], (loyalty) => loyalty !== ""),
});
const employerReason = contribute(shape.promoCode.disabled, "Your employer pays", {
  name: "employerPays",
  when: when([shape.employerPays], (pays) => pays),
});

const store = createStore(
  shape,
  { loyaltyNumber: "", promoCode: "", employerPays: false },
  { behaviors: [loyaltyReason, employerReason] },
);
store.set(shape.loyaltyNumber, "LX-1");
store.get(shape.promoCode.disabled); // true
store.set(shape.loyaltyNumber, "");
store.get(shape.promoCode.disabled); // false
```

`contribute(ref, payload, declaration)` takes the node's reference to the key, a payload of the key's payload type, and the parts of a declaration: `name`, `triggers`, `reads` and `when`. A payload of another type doesn't compile, and neither does contributing to a key declared without `combine`. Contributions are registered like behaviors: `b.add`, `createStore`'s `behaviors`, `store.addBehavior`. A key's default can also be a contribution: every node that declares the key adds it ([meta-keys.md](meta-keys.md#a-keys-default-behavior)).

A contribution whose guard fails is absent: the owner recomputes without it. Removing a contribution has the same effect, and when the last one goes, the key returns to whatever the owner computes from none.

Contributions don't conflict with each other. Two places that both have a reason to disable a field each add one; neither needs to know about the other.

## Payloads that read the form

A payload can be a function, called by the owner with what it needs. Here each check gets the value and the owner's `ctx`, and may read the references its contribution declared:

```ts
type Check = (value: unknown, ctx: BehaviorContext) => string | undefined;

const error = metaKey<string | undefined, Check>(undefined).combine((self, key) => ({
  triggers: [self],
  writes: [key],
  run: (ctx) => {
    const value = ctx.get(self);
    for (const part of ctx.parts) {
      const message = part.payload(value, ctx);
      if (message !== undefined) return ctx.set(key, message);
    }
    ctx.set(key, undefined);
  },
}));

const dates = form(object({ startDate: field<string>(), endDate: field<string>().meta({ error }) }));

const endAfterStart = contribute(
  dates.endDate.error,
  (value, ctx) => (String(value) < ctx.get(dates.startDate) ? "Return before departure" : undefined),
  { name: "endAfterStart", triggers: [dates.startDate] },
);
const endRequired = contribute(dates.endDate.error, (value) => (value === "" ? "Required" : undefined), {
  name: "endRequired",
});

const datesStore = createStore(
  dates,
  { startDate: "2026-05-01", endDate: "" },
  { behaviors: [endRequired, endAfterStart] },
);
```

`endAfterStart` declares `startDate` as a trigger, so the owner reads it and reruns when it changes: fixing the departure re-checks the return.

## How the validation recipe uses it

The [validation recipe](https://github.com/TheAsda/anyshape/blob/master/recipes/validation.ts) is built this way. Its `error` key is combined, and `rule(node, check)` and `asyncRule(node, check)` are contributions to it. The owner runs a field's sync rules in order until one fails, then its async rules if they all pass, and writes the first message. The recipe's `defined` key contributes a backstop that runs between the two: when the sync rules pass and the value is `undefined`, the message is "Required" and the async rules don't start. The key's default is that contribution, so a field that declares `defined` can't be left empty even when no rule says so. `validation()` is the [feature](../../GLOSSARY.md) that declares `error` on a node. Because validation is a [recipe](../../GLOSSARY.md) on top of combined keys, the [core](../../GLOSSARY.md) reserves no error slot; the [design record](https://github.com/TheAsda/anyshape/blob/master/docs/adr/0001-validation-is-a-recipe-on-key-contributions.md) explains the choice.

## Common mistakes

- **Writing a combined key from a behavior.** Registration rejects it: `... is written only by the owner of its key – contribute() to it instead`.
- **Expecting a contribution to leave its mark when its guard fails.** It is absent, and the owner recomputes as if it never existed. That is the difference from a guarded behavior, which keeps its writes ([guards.md](guards.md)).
- **Registering the same contribution twice for the same node.** Registration throws; a contribution is one input.

## See also

- [Meta keys](meta-keys.md): key definitions and their steps.
- [Guards](guards.md): guarded contributions.
- [Writing your own recipe](writing-a-recipe.md): `disabled` and `disableWhen`, step by step.
