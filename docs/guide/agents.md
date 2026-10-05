# anyshape for agents

Read this page before writing anyshape code. It ships inside the package, so it matches the installed version. It gives the rules, every public name with the page that explains it, the mistakes agents make most often, and which page to open for a task. Every other page in this folder stands alone: open only the ones the task needs.

## Rules

- **Reach everything through references.** A value is `shape.trip.return`, a meta key on it is `shape.trip.return.error`. Reads, writes, subscriptions and behaviors take these references, never string paths. The one exception is `store.resolvePath(path)`, for paths that come from a server ([your-side.md](your-side.md)).
- **No code finds a meta key by its name.** Code that needs a key is handed the node's reference (`node.error`) or, to sweep a subtree, the key's definition (`store.collect(node, error)`). Don't index a node with a string or list its keys.
- **The core declares no meta key.** There is no built-in `error`, `touched`, `visible` or `disabled`. Declare the keys a form needs ([meta-keys.md](meta-keys.md)), or copy a recipe from the [recipes folder](https://github.com/TheAsda/anyshape/tree/master/recipes). Recipes are not in the package: `anyshape/recipes` doesn't exist.
- **Build a form from an object node:** `form(object({ ... }))`.
- **A behavior declares every reference it touches** in `triggers`, `reads`, `writes` or a guard. `ctx.get` or `ctx.set` on anything else throws ([behaviors.md](behaviors.md)).
- **Each target has one writer.** A second behavior writing the same value or meta key is rejected when it is registered. When several declarations need a say in one key, make it a combined key and `contribute` to it ([contributions.md](contributions.md)).
- **Nothing happens implicitly.** Hidden or disabled fields keep their values and are submitted. Clearing a value, skipping a rule or disabling a group's children is a behavior or a guard you write ([guards.md](guards.md)).
- **Every write runs the behaviors it affects.** The origin (`"user"`, `"program"`, `"initial"`) tells writes apart; it never skips behaviors. A behavior that should ignore some writes filters by origin.
- **A guard switches a declaration on and off; it doesn't compute a value.** A behavior whose guard turns false keeps what it wrote. A value that follows a condition both ways is one behavior that computes both ([guards.md](guards.md)).
- **The store is read and watched through references only:** `store.get(ref)`, `store.set(ref, value)`, `store.subscribe(ref, listener)`. The whole form is `store.get(shape)`.
- **Derived values are behaviors; side effects are subscriptions.** A behavior writes only the form. Work outside the form (a toast, loading options into React state) subscribes, or uses `useValue` with `useEffect` in React ([react.md](react.md)).
- **In React, logic goes in `defineBehaviors`.** React data enters the form through `useSync`. `useBehaviors` is only for logic that comes from the component itself.
- **Inputs are controlled** through `useField`. There is no `register()`.
- **A reusable component takes its node as a prop.** The provider (the form, or a row) supplies the store.
- **References outside the form stay outside it.** A DOM element or another handle is not form state: keep it in your own registry beside the form, as the [focus recipe](https://github.com/TheAsda/anyshape/blob/master/recipes/focus.ts) does.

## API at a glance

Every public name, with the page that explains it. A test checks these tables against the package's export lists.

### `anyshape`

| Name | What it is | Page |
|---|---|---|
| `form` | Instantiates a shape: `form(object({ ... }))`. Every node gets its identity and path. | [shape.md](shape.md) |
| `object`, `field`, `array` | Declare a shape: an object of children, a typed value slot, an array of object rows. | [shape.md](shape.md) |
| `ShapeNode`, `FieldNode`, `ObjectNode`, `ArrayNode` | The node classes. `.meta(...)` declares meta keys on a node. | [shape.md](shape.md) |
| `AnyNode`, `ContainerNode` | Any node; an object or array node. | [shape.md](shape.md) |
| `InferValue`, `InferMeta` | The value type of a node or meta reference; a node's meta keys and their types. | [shape.md](shape.md) |
| `Ref`, `FieldId`, `ArrayOptions` | A node or a meta reference; a node's id; the options of `array()` (`create`). | [shape.md](shape.md) |
| `metaKey` | Declares a meta key with a default and options; `.aggregate`, `.uses`, `.behavior`, `.combine` add capabilities. | [meta-keys.md](meta-keys.md) |
| `MetaKeyDef` | A meta key's definition. Sweeps and counts find keys by it. | [meta-keys.md](meta-keys.md) |
| `MetaRef` | `node.key`: one meta key of one node. | [meta-keys.md](meta-keys.md) |
| `MetaKeyOptions` | `metaKey`'s options: `keepOnReset`. | [meta-keys.md](meta-keys.md) |
| `Meta`, `MergeMetaRefs`, `UsedRefs`, `NoPayload` | The types behind `.meta()` and `.uses()`; the payload type of a key without `combine`. | [meta-keys.md](meta-keys.md) |
| `countIn`, `CountRef` | How many nodes in a subtree have a counted key set. | [meta-keys.md](meta-keys.md) |
| `initialOf`, `InitialRef` | A node's baseline value. | [store.md](store.md) |
| `pendingIn`, `PendingInRef` | How many targets in a subtree a running async behavior is writing. | [async.md](async.md) |
| `pendingOf`, `PendingOfRef` | Whether a running async behavior is writing one target. | [async.md](async.md) |
| `AnyRef`, `RefValue` | Any reference; the type `get` returns for it. | [store.md](store.md) |
| `createStore` | Creates a store from a shape, its initial values and its behaviors. | [store.md](store.md) |
| `RootStore`, `BaseStore` | The store `createStore` returns; what every store (root, substore, row) shares. | [store.md](store.md) |
| `ArrayStore`, `ItemStore`, `NewItemArgs` | An array's store with its row operations; one row's store; what `append` and `insert` take. | [arrays.md](arrays.md) |
| `WriteOptions`, `Origin` | A write's options (`origin`, `as: "initial"`); who made a write. | [store.md](store.md) |
| `Listener`, `Unsubscribe` | `subscribe`'s callback and the function it returns. | [store.md](store.md) |
| `CollectEntry` | One entry of `store.collect(node, def)`. | [meta-keys.md](meta-keys.md) |
| `StoreOptions`, `BehaviorErrorInfo` | `createStore`'s options (`behaviors`, `onError`); what `onError` is told. | [store.md](store.md) |
| `defineBehavior`, `Behavior`, `BehaviorConfig` | Declares one behavior: its triggers, reads, writes and run. | [behaviors.md](behaviors.md) |
| `defineBehaviors`, `BehaviorBuilder` | Builds a form's list of behaviors: `b.add`, `b.when`, `b.each`. | [behaviors.md](behaviors.md) |
| `BehaviorContext` | A run's `ctx`: `get`, `set`, `changed`, `origins`, `state`, `signal`, `keep`. | [behaviors.md](behaviors.md) |
| `OriginKind`, `WritableRef`, `Declaration`, `AnyBehavior` | An origins filter's kinds; a reference a behavior may write; what behaviors and contributions share; either of them. | [behaviors.md](behaviors.md) |
| `BehaviorHandle` | What `store.addBehavior` returns: call it to remove the behaviors. | [behaviors.md](behaviors.md) |
| `when`, `Guard` | A guard: a test over declared references. | [guards.md](guards.md) |
| `contribute`, `Contribution` | Feeds a payload to a combined key's owner. | [contributions.md](contributions.md) |
| `OwnerConfig`, `OwnerContext`, `Part` | What `.combine` returns; the owner's `ctx` with `ctx.parts`; one contribution as the owner sees it. | [contributions.md](contributions.md) |

### `anyshape/react`

| Name | What it is | Page |
|---|---|---|
| `useForm`, `UseFormOptions` | Creates a store once per mount; `values` loads data as the baseline. | [react.md](react.md) |
| `StoreProvider`, `StoreProviderProps` | Provides a store (the form, a substore or a row) to the hooks below it. | [react.md](react.md) |
| `useStore`, `HookOptions` | The provided store; the `{ store }` option every hook takes. | [react.md](react.md) |
| `useValue`, `SelectOptions` | Reads any reference and re-renders when it changes; optionally through a selector. | [react.md](react.md) |
| `useField`, `FieldBinding` | A controlled input's binding: `{ value, onChange, store }`. | [react.md](react.md) |
| `useArray`, `ArrayBinding` | An array's rows and row operations. | [react.md](react.md) |
| `useSync` | Writes React data (props, query results) into a value or meta key. | [react.md](react.md) |
| `useBehaviors`, `UseBehaviorsOptions` | Registers behaviors from a component, for logic that comes from the component. | [react.md](react.md) |

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
const checkedError = metaKey<string | undefined, (value: string) => string | undefined>(undefined).combine((self, key) => ({
  triggers: [self],
  writes: [key],
  run: (ctx) => {
    const value = ctx.get(self) as string;
    ctx.set(key, ctx.parts.map((part) => part.payload(value)).find((message) => message !== undefined));
  },
}));

const checked = form(object({ code: field<string>().meta({ error: checkedError }) }));

const checks = [
  contribute(checked.code.error, (value) => (/^[A-Z]+$/.test(value) ? undefined : "Capitals only")),
  contribute(checked.code.error, (value) => (value.length > 8 ? "Too long" : undefined)),
];
const checkedStore = createStore(checked, { code: "" }, { behaviors: checks });
```

**Writing a combined key from a behavior.** A behavior with `writes: [checked.code.error]` is rejected: `"code#error" is written only by the owner of its key – contribute() to it instead`.

**Expecting a guard to undo a write.** A behavior whose guard turns false stops running; what it wrote stays. If the value must change back, write one behavior that computes both directions ([guards.md](guards.md)).

**Mirroring React data with an effect.** A `useEffect` that calls `store.set` writes after paint and duplicates what `useSync(ref, value)` does. Use `useSync`, and declare a meta key it feeds with `keepOnReset` ([react.md](react.md)).

**The same `useBehaviors` in a component rendered twice.** Each copy registers the behavior again, so its target has two writers and the second registration throws. Declare such behaviors once, in `defineBehaviors` or a common parent.

**Type errors.** These fail to compile:
- reading or writing a meta key the node doesn't declare, such as `store.get(shape.price.error)` here;
- writing a value of the wrong type, such as `store.set(shape.code.error, 42)`;
- passing a node without the keys a recipe needs to that recipe, such as a `disableWhen` target without `disabled`;
- importing from `anyshape/recipes`, which doesn't exist: copy the recipe into your project instead.

## Which page for which task

| Task | Read |
|---|---|
| Declare a form, its fields and rows | [shape.md](shape.md), [arrays.md](arrays.md) |
| Read, write, load, reset or watch values | [store.md](store.md) |
| Add a meta key beside a value (such as `error`, `visible` or `touched`) | [meta-keys.md](meta-keys.md) |
| Compute a field from others, or keep two fields consistent | [behaviors.md](behaviors.md) |
| Add validation | the [validation recipe](https://github.com/TheAsda/anyshape/blob/master/recipes/validation.ts), [contributions.md](contributions.md) |
| Apply a rule only under a condition, or show a section conditionally | [guards.md](guards.md) |
| Rows, with rules per row | [arrays.md](arrays.md) |
| Several reasons for one key (disabled, error) | [contributions.md](contributions.md) |
| A server check, debouncing, a "checking…" state | [async.md](async.md) |
| Bind inputs and components | [react.md](react.md) |
| When an error shows, server errors, parsing, submitting | [your-side.md](your-side.md) |
| Write your own reusable key and helpers | [writing-a-recipe.md](writing-a-recipe.md) |

Words used across the docs are defined in the [glossary](../../GLOSSARY.md).
