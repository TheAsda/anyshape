# anyshape for agents

Read this page before writing anyshape code. It ships inside the package, so it matches the installed version, and so do the recipe sources and the [policies file](../../recipes/POLICIES.md) it links to. Its links to examples and ADRs point at the repository's `master`, which may be newer. It gives the rules, every public name with the page that explains it, the mistakes agents make most often, and which page to open for a task. Every other page in this folder stands alone: open only the ones the task needs.

## Rules

- **Reach everything through references.** A value is `shape.trip.return`, a [meta key](../../GLOSSARY.md) on it is `shape.trip.return.error`. Reads, writes, subscriptions and [behaviors](../../GLOSSARY.md) take these references, never string paths. The one exception is `store.resolvePath(path)`, for paths that come from a server ([your-side.md](your-side.md)).
- **No code finds a meta key by its name.** Code that needs a key is handed the [node](../../GLOSSARY.md)'s reference (`node.error`) or, to sweep a subtree, the key's definition (`store.collect(node, errorKey)`). Don't index a node with a string or list its keys.
- **The [core](../../GLOSSARY.md) declares no meta key.** There is no built-in `error`, `edited`, `visible` or `disabled` in `anyshape`. Import them from the [default recipes](../../GLOSSARY.md): `anyshape/recipes` (validation, rules, input state, visibility, disabling, submit, focus) and `anyshape/recipes/react` (`useControl` and the input adapters). Their policies (when an error shows, what counts as empty, what a submit does) are listed in [`recipes/POLICIES.md`](../../recipes/POLICIES.md). Declare your own keys for anything else ([meta-keys.md](meta-keys.md)).
- **Declare keys through meta groups:** `field<string>().meta(control(), defined())`, `object({ ... }).meta(visible(), submitting())`. A bare `{ visible }` declares a key holding the function `visible`, which compiles. The definitions, with a `Key` suffix (`errorKey`, `revealedKey`), are for sweeps and counts only: `countIn(shape, errorKey)`.
- **To change a default policy, copy the whole set.** Copy `node_modules/anyshape/recipes/` into the project, edit the copy, and switch every recipe import to the copy at once. Keys are matched by definition, so a copied `validate` or `handleSubmit` doesn't see the keys the shipped `control()` declares, and a form that mixes the two is checked wrongly without a compile error ([recipes README](../../recipes/README.md#customizing-copy-the-whole-set)).
- **Build a form from an object node:** `form(object({ ... }))`.
- **A behavior declares every reference it touches** in `triggers`, `reads`, `writes` or a [guard](../../GLOSSARY.md). `ctx.get` or `ctx.set` on anything else throws ([behaviors.md](behaviors.md)).
- **Each target has one writer.** A second behavior writing the same value or meta key is rejected when it is registered. When several declarations need a say in one key, make it a combined key and `contribute` to it ([contributions.md](contributions.md)).
- **Nothing happens implicitly.** Hidden or disabled fields keep their values and are submitted. Clearing a value, skipping a rule or disabling a group's children is a behavior or a guard you write ([guards.md](guards.md)).
- **Every write runs the behaviors it affects.** The [origin](../../GLOSSARY.md) (`"user"`, `"program"`, `"initial"`) tells writes apart; it never skips behaviors. A behavior that should ignore some writes filters by origin.
- **A guard switches a declaration on and off; it doesn't compute a value.** A behavior whose guard turns false keeps what it wrote. A value that follows a condition both ways is one behavior that computes both ([guards.md](guards.md)).
- **The [store](../../GLOSSARY.md) is read and watched through references only:** `store.get(ref)`, `store.set(ref, value)`, `store.subscribe(ref, listener)`. The whole form is `store.get(shape)`.
- **Derived values are behaviors; side effects are subscriptions.** A behavior writes only the form. Work outside the form (a toast, loading options into React state) subscribes, or uses `useValue` with `useEffect` in React ([react.md](react.md)).
- **In React, logic goes in `defineBehaviors`.** React data enters the form through `useSync`. `useBehaviors` is only for logic that comes from the component itself.
- **Inputs are controlled** through `useField`, or `useControl` from `anyshape/recipes/react` for a node with `control()`. There is no `register()`. Destructure `useControl`'s result (`const { value, onChange, onBlur, focusRef } = useControl(node)`): the React compiler lint flags `c.focusRef` beside other reads of `c`.
- **A reusable component takes its node as a prop.** The provider (the form, or a row) supplies the store.
- **References outside the form stay outside it.** A DOM element or another handle is not form state: keep it in your own registry beside the form, as the [focus recipe](../../recipes/focus.ts) does.

## API at a glance

Every public name, with the page that explains it. A test checks these tables against the package's export lists.

### `anyshape`

| Name                                                      | What it is                                                                                                                                | Page                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `form`                                                    | Instantiates a [shape](../../GLOSSARY.md): `form(object({ ... }))`. Every node gets its identity and path.                                | [shape.md](shape.md)                 |
| `object`, `field`, `array`                                | Declare a shape: an object of children, a typed value slot, an array of object rows.                                                      | [shape.md](shape.md)                 |
| `ShapeNode`, `FieldNode`, `ObjectNode`, `ArrayNode`       | The node classes. `.meta(...)` declares meta keys on a node.                                                                              | [shape.md](shape.md)                 |
| `pathOf`, `parentOf`                                      | The path of a node or a reference ("" for the root); a node's parent container.                                                           | [shape.md](shape.md)                 |
| `AnyNode`, `ContainerNode`                                | Any node; an object or array node.                                                                                                        | [shape.md](shape.md)                 |
| `InferValue`, `InferMeta`                                 | The value type of a node or meta reference; a node's meta keys and their types.                                                           | [shape.md](shape.md)                 |
| `Ref`, `ArrayOptions`                                     | A node or a meta reference; the options of `array()` (`create`).                                                                          | [shape.md](shape.md)                 |
| `metaKey`                                                 | Declares a meta key with a default and options; `.aggregate`, `.uses`, `.behavior`, `.combine` add capabilities.                          | [meta-keys.md](meta-keys.md)         |
| `MetaKeyDef`                                              | A meta key's definition. Sweeps and counts find keys by it.                                                                               | [meta-keys.md](meta-keys.md)         |
| `MetaRef`                                                 | `node.key`: one meta key of one node.                                                                                                     | [meta-keys.md](meta-keys.md)         |
| `MetaKeyOptions`                                          | `metaKey`'s options: `keepOnReset`.                                                                                                       | [meta-keys.md](meta-keys.md)         |
| `Countable`, `Owned`                                      | The markers a definition's type carries after `.aggregate()`; after `.behavior()` or `.combine()`.                                        | [meta-keys.md](meta-keys.md)         |
| `Meta`, `MergeMetaRefs`, `UsedRefs`, `NoPayload`          | The types behind `.meta()` and `.uses()`; the payload type of a key without `combine`.                                                    | [meta-keys.md](meta-keys.md)         |
| `countIn`, `CountRef`                                     | How many nodes in a subtree have a counted key set.                                                                                       | [meta-keys.md](meta-keys.md)         |
| `initialOf`, `InitialRef`                                 | A node's [baseline](../../GLOSSARY.md) value.                                                                                             | [store.md](store.md)                 |
| `pendingIn`, `PendingInRef`                               | How many targets in a subtree a running async behavior is writing.                                                                        | [async.md](async.md)                 |
| `pendingOf`, `PendingOfRef`                               | Whether a running async behavior is writing one target.                                                                                   | [async.md](async.md)                 |
| `AnyRef`, `RefValue`                                      | Any reference; the type `get` returns for it.                                                                                             | [store.md](store.md)                 |
| `createStore`                                             | Creates a store from a shape, its initial values and its behaviors.                                                                       | [store.md](store.md)                 |
| `RootStore`, `BaseStore`                                  | The store `createStore` returns; what every store (root, substore, row) shares.                                                           | [store.md](store.md)                 |
| `ArrayStore`, `ItemStore`, `NewItemArgs`                  | An array's store with its row operations; one row's store; what `append` and `insert` take.                                               | [arrays.md](arrays.md)               |
| `WriteOptions`, `Origin`                                  | A write's options (`origin`, `as: "initial"`); who made a write.                                                                          | [store.md](store.md)                 |
| `Listener`, `Unsubscribe`                                 | `subscribe`'s callback and the function it returns.                                                                                       | [store.md](store.md)                 |
| `CollectEntry`                                            | One entry of `store.collect(node, def)`.                                                                                                  | [meta-keys.md](meta-keys.md)         |
| `StoreOptions`, `BehaviorErrorInfo`                       | `createStore`'s options (`behaviors`, `onError`); what `onError` is told.                                                                 | [store.md](store.md)                 |
| `defineBehavior`, `Behavior`, `BehaviorConfig`            | Declares one behavior: its triggers, reads, writes and run.                                                                               | [behaviors.md](behaviors.md)         |
| `defineBehaviors`, `BehaviorBuilder`                      | Builds a form's list of behaviors: `b.add`, `b.when`, `b.each`.                                                                           | [behaviors.md](behaviors.md)         |
| `BehaviorContext`                                         | A run's `ctx`: `get`, `set`, `changed`, `origins`, `state`, `signal`, `keep`.                                                             | [behaviors.md](behaviors.md)         |
| `OriginKind`, `WritableRef`, `Declaration`, `AnyBehavior` | An origins filter's kinds; a reference a behavior may write; what behaviors and [contributions](../../GLOSSARY.md) share; either of them. | [behaviors.md](behaviors.md)         |
| `BehaviorHandle`                                          | What `store.addBehavior` returns: call it to remove the behaviors.                                                                        | [behaviors.md](behaviors.md)         |
| `when`, `Guard`                                           | A guard: a test over declared references.                                                                                                 | [guards.md](guards.md)               |
| `contribute`, `Contribution`                              | Feeds a payload to a combined key's owner.                                                                                                | [contributions.md](contributions.md) |
| `OwnerConfig`, `OwnerContext`, `Part`                     | What `.combine` returns; the owner's `ctx` with `ctx.parts`; one contribution as the owner sees it.                                       | [contributions.md](contributions.md) |

### `anyshape/react`

| Name                                  | What it is                                                                            | Page                 |
| ------------------------------------- | ------------------------------------------------------------------------------------- | -------------------- |
| `useForm`, `UseFormOptions`           | Creates a store on mount (anew for a new shape); `values` loads data as the baseline. | [react.md](react.md) |
| `StoreProvider`, `StoreProviderProps` | Provides a store (the form, a substore or a row) to the hooks below it.               | [react.md](react.md) |
| `useStore`, `HookOptions`             | The provided store; the `{ store }` option every hook takes.                          | [react.md](react.md) |
| `useValue`, `SelectOptions`           | Reads any reference and re-renders when it changes; optionally through a selector.    | [react.md](react.md) |
| `useField`, `FieldBinding`            | A controlled input's binding: `{ value, onChange, store }`.                           | [react.md](react.md) |
| `useArray`, `ArrayBinding`            | An array's rows and row operations.                                                   | [react.md](react.md) |
| `useSync`                             | Writes React data (props, query results) into a value or meta key.                    | [react.md](react.md) |
| `useBehaviors`, `UseBehaviorsOptions` | Registers behaviors from a component, for logic that comes from the component.        | [react.md](react.md) |

### `anyshape/recipes`

| Name                                                                   | What it is                                                                                                                                                   | Page                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `control`                                                              | The meta group for an input: `validation()` plus `edited`, `dirty` and `revealed`.                                                                           | [POLICIES.md](../../recipes/POLICIES.md#when-an-error-shows)                       |
| `edited`, `dirty`, `revealed`                                          | One-key meta groups: the user changed the value; it differs from its baseline; its error may show (blur, submit, code).                                      | [POLICIES.md](../../recipes/POLICIES.md#edited-means-the-user-changed-the-value)   |
| `editedKey`, `dirtyKey`, `revealedKey`                                 | Their key definitions, for sweeps and counts (`countIn(shape, dirtyKey)`).                                                                                   | [meta-keys.md](meta-keys.md)                                                       |
| `validation`, `defined`                                                | Meta groups: `error`, `checkForced` and `requiredNow`; the "Required" check of a field that starts empty.                                                    | [contributions.md](contributions.md)                                               |
| `errorKey`, `checkForcedKey`, `requiredNowKey`, `definedKey`           | Their key definitions. `countIn(form, errorKey)` counts errors; `pendingIn(form, errorKey)` counts running checks.                                           | [async.md](async.md)                                                               |
| `rule`, `RuleOptions`, `RuleContext`                                   | A sync check of one node, contributed to its `error`: a message, or `undefined` when valid.                                                                  | [contributions.md](contributions.md)                                               |
| `asyncRule`, `AsyncRuleOptions`, `AsyncRuleContext`, `AsyncStart`      | An async check, after the sync rules pass; `start` and `debounce` per rule.                                                                                  | [async.md](async.md)                                                               |
| `validate`, `ValidationResult`, `ErrorEntry`                           | Checks a subtree, waits for its checks, and lists its errors in shape order.                                                                                 | [POLICIES.md](../../recipes/POLICIES.md#what-a-submit-does)                        |
| `InferChecked`, `Defined`                                              | A node's checked type: no `undefined` where `defined()` is declared; the mark it looks for.                                                                  | [your-side.md](your-side.md#forms-in-steps)                                        |
| `Validatable`, `RulePart`                                              | A node with `validation()`; what a rule contributes to `error`.                                                                                              | [contributions.md](contributions.md)                                               |
| `required`, `minLength`, `maxLength`, `min`, `max`, `pattern`, `email` | Ready rules. `required` also feeds `requiredNow`; the others pass on an empty value.                                                                         | [POLICIES.md](../../recipes/POLICIES.md#format-rules-pass-on-empty-values)         |
| `isEmpty`                                                              | What the rules count as empty: `undefined`, `null`, whitespace-only strings, empty arrays.                                                                   | [POLICIES.md](../../recipes/POLICIES.md#what-counts-as-empty)                      |
| `Message`, `MessageOptions`, `Limit`                                   | A rule's `message` (a string, or a function of the value) and `name`; a limit (a number or a reference).                                                     | [POLICIES.md](../../recipes/POLICIES.md#messages-are-fixed-english-strings)        |
| `exclusive`, `ExclusiveOptions`                                        | At most (or, with `required`, exactly) one of several fields filled: a rule and a `disabled` reason on each.                                                 | [contributions.md](contributions.md)                                               |
| `visible`, `visibleKey`, `visibleWhen`                                 | The `visible` meta group, its definition, and the behavior that computes it both ways.                                                                       | [guards.md](guards.md)                                                             |
| `disabled`, `disabledKey`, `disableWhen`, `Disableable`                | The `disabled` meta group (true while any reason applies), its definition, a reason, and a node with it.                                                     | [contributions.md](contributions.md)                                               |
| `calculate`, `link`, `LinkOptions`, `clearWhen`                        | Value behaviors: a value computed from others; two values kept in step both ways; a value reset to its baseline while a test holds.                          | [behaviors.md](behaviors.md)                                                       |
| `submitting`, `submittingKey`, `handleSubmit`                          | The meta group that makes a node submittable, its definition, and the submit: reveal, validate, then `fn` with the value as it is, or focus the first error. | [POLICIES.md](../../recipes/POLICIES.md#a-submit-passes-the-stores-value-as-it-is) |
| `Submittable`, `FormSubmitHandler`                                     | A node with `submitting()`; the handler `handleSubmit` returns, for `<form onSubmit>` or a call with no event.                                               | [your-side.md](your-side.md)                                                       |
| `registerFocus`, `focusFirst`, `FocusTarget`, `FocusEntry`             | The focus registry beside the form: where focusing an error moves the cursor, in document order.                                                             | [POLICIES.md](../../recipes/POLICIES.md#what-a-submit-does)                        |

### `anyshape/recipes/react`

| Name                                          | What it is                                                                                                                               | Page                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `useControl`, `ControlBinding`, `ControlNode` | An input's binding for a node with `control()`: `value`, `onChange`, `onBlur`, `error`, `showError`, `pending`, the keys and `focusRef`. | [POLICIES.md](../../recipes/POLICIES.md#when-an-error-shows) |
| `fromInput`, `fromCheckbox`                   | Turn an `onChange` for values into a DOM change handler, the same one for the same `onChange`.                                           | [react.md](react.md)                                         |

## Common mistakes

Each mistake below that compiles is shown as code, with the error it gives in prose and the fix after it. The type errors are described in prose only.

```ts
import { form, object, field, metaKey, defineBehavior, contribute, createStore } from "anyshape";

const error = metaKey<string | undefined>(undefined);

const shape = form(
  object({
    price: field<number>(),
    quantity: field<number>(),
    total: field<number>(),
    code: field<string>().meta({ error }),
  }),
);
```

**Reading a reference the behavior didn't declare.** This compiles, but every run throws `Behavior "total": "price" is not declared in triggers, reads, writes or when`. The store reports it to `onError` (by default `console.error`) and drops the run's writes.

```ts
const totalMissingRead = defineBehavior({
  name: "total",
  triggers: [shape.quantity],
  writes: [shape.total],
  run: (ctx) => ctx.set(shape.total, ctx.get(shape.price) * ctx.get(shape.quantity)),
});
```

Fix: declare it. In `triggers` the behavior reruns when it changes; in `reads` it doesn't.

```ts
const total = defineBehavior({
  name: "total",
  triggers: [shape.price, shape.quantity],
  writes: [shape.total],
  run: (ctx) => ctx.set(shape.total, ctx.get(shape.price) * ctx.get(shape.quantity)),
});
```

**Two behaviors writing one target.** Registering both throws `Behavior "codeLength": "code#error" is already written by "codeFormat" – one writer per target`, from `createStore` or `addBehavior`.

```ts
const codeFormat = defineBehavior({
  name: "codeFormat",
  triggers: [shape.code],
  writes: [shape.code.error],
  run: (ctx) => ctx.set(shape.code.error, /^[A-Z]+$/.test(ctx.get(shape.code)) ? undefined : "Capitals only"),
});
const codeLength = defineBehavior({
  name: "codeLength",
  triggers: [shape.code],
  writes: [shape.code.error],
  run: (ctx) => ctx.set(shape.code.error, ctx.get(shape.code).length > 8 ? "Too long" : undefined),
});
```

Fix: one behavior that computes the key from both checks, or a combined key that both feed with `contribute` ([contributions.md](contributions.md)):

```ts
const checkedError = metaKey<string | undefined, (value: string) => string | undefined>(undefined).combine(
  (self, key) => ({
    triggers: [self],
    writes: [key],
    run: (ctx) => {
      const value = ctx.get(self) as string;
      ctx.set(
        key,
        ctx.parts.map((part) => part.payload(value)).find((message) => message !== undefined),
      );
    },
  }),
);

const checked = form(object({ code: field<string>().meta({ error: checkedError }) }));

const checks = [
  contribute(checked.code.error, (value) => (/^[A-Z]+$/.test(value) ? undefined : "Capitals only")),
  contribute(checked.code.error, (value) => (value.length > 8 ? "Too long" : undefined)),
];
const checkedStore = createStore(checked, { code: "" }, { behaviors: checks });
```

**Writing a combined key from a behavior.** A behavior with `writes: [checked.code.error]` is rejected; the error prints the `contribute(checked.code.error, …)` call to register instead, with a `when` built from the behavior's own triggers.

**Expecting a guard to undo a write.** A behavior whose guard turns false stops running; what it wrote stays. If the value must change back, write one behavior that computes both directions ([guards.md](guards.md)).

**Mirroring React data with an effect.** A `useEffect` that calls `store.set` writes after paint and duplicates what `useSync(ref, value)` does. Use `useSync`, and declare a meta key it feeds with `keepOnReset` ([react.md](react.md)).

**The same `useBehaviors` in a component rendered twice.** Each copy registers the behavior again, so its target has two writers and the second registration throws. Declare such behaviors once, in `defineBehaviors` or a common parent.

**Typing a field that starts empty as its filled type.** A choice the user hasn't made yet is `undefined`. Typing the field as its filled type and forcing the empty start compiles, but every read then claims a value that isn't there, and the lie comes back on going back a step, on `reset()` and on a loaded draft.

```ts
type DeliveryType = "Electronic" | "Printed";

const forced = form(object({ deliveryType: field<DeliveryType>().meta({ error }) }));
const forcedStore = createStore(forced, { deliveryType: undefined as never });
forcedStore.get(forced.deliveryType).toLowerCase(); // compiles, throws at run time
```

Fix: type what the field holds while it is edited, `field<DeliveryType | undefined>()`, and narrow with `=== undefined` where a value is needed. To require it, declare `.meta(control(), defined())` from `anyshape/recipes`: its `error` says "Required" while the value is `undefined`, and `handleSubmit` hands its `fn` the value without `undefined` ([your-side.md](your-side.md#forms-in-steps)).

```ts
const honest = form(object({ deliveryType: field<DeliveryType | undefined>().meta({ error }) }));
const honestStore = createStore(honest, { deliveryType: undefined });
const chosen = honestStore.get(honest.deliveryType);
if (chosen !== undefined) chosen.toLowerCase();
```

**Type errors.** These fail to compile:

- reading or writing a meta key the node doesn't declare, such as `store.get(shape.price.error)` here;
- writing a value of the wrong type, such as `store.set(shape.code.error, 42)`;
- passing a node without the keys a recipe needs to that recipe, such as a `disableWhen` target without `disabled`.

**Declaring a recipe key without its meta group.** `.meta({ visible })` compiles: it declares a plain key whose value is the function `visible`, and `visibleWhen(node, …)` then fails to compile because `node.visible` isn't a boolean key. Call the meta group: `.meta(visible())`.

**Mixing the shipped recipes with a copy.** A recipe that sweeps a subtree finds keys by its own set's definitions. On a form declared with the shipped `control()` and `submitting()`, a copied `validate` finds no `error` key and reports an invalid form as valid, and a copied `handleSubmit` throws that the root doesn't declare `submitting()`. It compiles, because both sets' nodes have the same shape. Import every recipe from one place: the package or the copy.

## Hot reload

Under React Fast Refresh, `useForm` takes up an edited shape or behaviors. A new shape builds a new store that keeps each value (and its baseline) whose path and kind are unchanged; meta starts over. New behaviors replace the registered ones on the same store. Put the shape and its behaviors in separate modules, so that editing a behavior loses nothing. Never create either inside a component: the form would be rebuilt on every render. Details: [react.md](react.md#hot-reload).

## Which page for which task

| Task                                                                     | Read                                                                                                |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Declare a form, its fields and rows                                      | [shape.md](shape.md), [arrays.md](arrays.md)                                                        |
| Read, write, load, reset or watch values                                 | [store.md](store.md)                                                                                |
| Add a meta key beside a value (such as `error`, `visible` or `edited`)   | [meta-keys.md](meta-keys.md)                                                                        |
| Compute a field from others, or keep two fields consistent               | [behaviors.md](behaviors.md)                                                                        |
| Start a key (at the root or in every row) with a value known at creation | [behaviors.md](behaviors.md)                                                                        |
| Add validation                                                           | `anyshape/recipes` ([POLICIES.md](../../recipes/POLICIES.md)), [contributions.md](contributions.md) |
| Check whether a default policy fits, or change one                       | [POLICIES.md](../../recipes/POLICIES.md), the [recipes README](../../recipes/README.md)             |
| Apply a rule only under a condition, or show a section conditionally     | [guards.md](guards.md)                                                                              |
| Rows, with rules per row                                                 | [arrays.md](arrays.md)                                                                              |
| Several reasons for one key (disabled, error)                            | [contributions.md](contributions.md)                                                                |
| A server check, debouncing, a "checking…" state                          | [async.md](async.md)                                                                                |
| Bind inputs and components                                               | [react.md](react.md)                                                                                |
| When an error shows, server errors, parsing, submitting                  | [your-side.md](your-side.md)                                                                        |
| Write your own reusable key and helpers                                  | [writing-a-recipe.md](writing-a-recipe.md)                                                          |

Words used across the docs are defined in the [glossary](../../GLOSSARY.md).
