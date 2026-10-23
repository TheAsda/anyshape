# Default recipe policies

The default recipes (`anyshape/recipes` and `anyshape/recipes/react`) hard-code one policy for each decision a form library has to make: when an error shows, what counts as empty, what a submit does. This page lists every one of them, so you can decide whether the defaults fit your forms without reading the recipes' source.

Each entry says what the default recipes do, the main alternative, why the default was picked, and where to change it in a copy. The recipes have no options for any of this ([principle 9](../docs/principles.md#9-a-recipe-has-no-policy-options-a-team-edits-its-copy)). To use another policy, copy the whole set into your project and edit the copy; [Customizing: copy the whole set](README.md#customizing-copy-the-whole-set) says how.

A change to any policy on this page is a breaking change of the package, released as one.

## A submit passes the store's value as it is

**What the default recipes do.** `handleSubmit(store, fn)` hands `fn` exactly what the store holds for its node. Nothing is dropped, cleared or transformed: the values of hidden fields and of disabled fields are in it, and so is whatever a field held when it was hidden. The rules of a hidden or disabled field still run, so an empty required field that is hidden blocks the submit unless its rules are guarded.

**The main alternative.** Leave hidden or disabled fields out of the submitted value, or skip their rules.

**Why.** Whether a hidden value is submitted is your decision, not the library's ([principle 12](../docs/principles.md#12-nothing-implicit-the-form-submits-what-the-store-holds)). Hiding a section and showing it again keeps what the user typed. A team for which "disabled" means "read-only, but sent" isn't overruled by a policy keyed on a name.

**Where to change it.** Usually not in the recipes: declare what you mean as behaviors. `clearWhen(node, [node.visible], (v) => !v)` clears a value while it is hidden, and a guard on `visible` (`b.when([node.visible], (v) => v, …)`) switches a field's rules off while it is hidden. To filter the value at the submit boundary instead, edit the `fn(store.get(…))` call in `handleSubmit` in `submit.ts`.

## When an error shows

**What the default recipes do.** `useControl` sets `showError` when three things hold: the field is revealed, it has an error, and no check of it is running. A field is revealed on blur (the binding's `onBlur`), by a submit (every field the submit covers), or by code that writes its `revealed` key. Once shown, the error stays live while the user fixes it.

**The main alternative.** Show errors as the user types (after the first edit), or only after a submit.

**Why.** An error shown before the user has finished a field reads as nagging; one shown only after a submit comes too late to help. Hiding it while a check runs keeps a stale message from flickering in.

**Where to change it.** The `showError:` line in `react/control.ts`, for example `error !== undefined && edited` to show errors after the first edit.

## Tabbing through a field reveals its error

**What the default recipes do.** A blur reveals the field whether or not the user changed it. Tabbing through an empty required field shows "Required" at once.

**The main alternative.** Reveal on blur only after an edit, so that moving through a form shows nothing until the user types.

**Why.** Leaving a required field empty is the mistake the message is there for, and a user who tabs past it should hear about it.

**Where to change it.** The `onBlur` callback in `react/control.ts`, for example to write `revealed` only when `edited` is true.

## `edited` means the user changed the value

**What the default recipes do.** A field's `edited` key turns true on the first write with the `"user"` origin, the binding's `onChange` among them, and stays true. A write from code, a load and a submit don't set it. Many form libraries call a similar flag "touched" and set it on blur; here, blur sets `revealed` instead.

**The main alternative.** Set the flag on blur, or by a submit, as such libraries do.

**Why.** "The user changed this" and "the error may show now" are different facts, and one key for both would decide for you that they always coincide.

**Where to change it.** `editedKey` in `control.ts`: its `origins` and its trigger.

## `reset()` clears `edited` and `revealed`

**What the default recipes do.** `store.reset()` puts every value back to its baseline and every meta key back to its default: `edited`, `dirty` and `revealed` turn false, and so the form shows no errors until it is revealed again.

**The main alternative.** Keep `revealed` across a reset, so the errors of a reset form stay visible.

**Why.** A reset form is a fresh start, and it should look like one.

**Where to change it.** Declare the key with `keepOnReset`: `metaKey(false, { keepOnReset: true })` for `revealedKey` in `control.ts`.

## `dirty` compares with the baseline by identity

**What the default recipes do.** `dirty` is true while `Object.is(value, baseline)` is false, where the baseline is the initial value or the last value written as initial. An array or object field that gets a new array or object counts as dirty even when its contents are equal to the baseline's.

**The main alternative.** A deep comparison of the value with its baseline.

**Why.** An identity check is cheap on every keystroke and never wrong about a change. A deep comparison costs time in proportion to the value and has its own questions (dates, class instances, the order of keys).

**Where to change it.** `dirtyKey` in `control.ts`: the `Object.is(…)` in its `run`.

## What counts as empty

**What the default recipes do.** `isEmpty` treats `undefined`, `null`, strings with only whitespace in them, and empty arrays as empty. `0` and `false` are values. So `required` accepts a number field holding `0`, and a checkbox holding `false`.

**The main alternative.** Treat `0`, `false` or empty objects as empty too.

**Why.** `0` is often a real answer (zero children, a free item), and an unchecked checkbox has said "no". A checkbox that must be ticked ("I accept the terms") needs its own rule: `rule(node, (v) => (v ? undefined : "…"))`.

**Where to change it.** `isEmpty` in `rules.ts`. `required` and `exclusive` use it, and so do the format rules (next entry).

## Format rules pass on empty values

**What the default recipes do.** `minLength`, `maxLength`, `pattern` and `email` pass on an empty value; `min` and `max` pass on `null` and `undefined`. A field that must be filled needs `required` beside them.

**The main alternative.** Let a format rule fail on an empty value.

**Why.** An optional field with a format ("an email, if you give one") is common, and the rule shouldn't make it required. One rule for each concern keeps the message precise: "Required" for an empty field, "Invalid email address" for a wrong one.

**Where to change it.** The rule's check in `rules.ts`, such as the `!isEmpty(v)` in `minLength`.

## `defined` adds a "Required" check

**What the default recipes do.** A field declared with `defined()` (a field that starts empty, typed `field<T | undefined>()`) gets the error "Required" while its value is `undefined`, without a rule written for it. It runs after the field's sync rules, so a `required()` with its own message speaks first. It doesn't feed `requiredNow`: a field with only `defined()` says "Required" with `requiredNow` false. The submit's `fn` receives such a field's value without `undefined` in its type.

**The main alternative.** Leave the check to an explicit `required()`, or treat `null` as empty too.

**Why.** A field whose checked type has no `undefined` must never be submitted while it holds one, whatever rules the author remembered to add.

**Where to change it.** The `"Required"` string and the `value === undefined` test in `errorKey`'s owner in `validation.ts`. To treat `null` the same way, change both, and the `Exclude<…, undefined>` in `InferChecked` beside them.

## A field shows one message: its first failing rule

**What the default recipes do.** A field's sync rules run in the order they were registered, and the first one that fails gives the field's `error`. Then comes the `defined` check, and, if those pass, the async rules, one after another, until one fails. A field never holds a list of messages.

**The main alternative.** Collect every failing rule's message.

**Why.** One message tells the user what to fix next, and a list of them is noise beside a single input. Ordering your rules is how you choose which message comes first.

**Where to change it.** The loop over `ctx.parts` in `errorKey`'s owner in `validation.ts`, and the type of `errorKey`, which would hold a list.

## When async rules start, and how debounce combines

**What the default recipes do.** An async rule runs only once the field's sync rules and `defined` pass. By default it starts on a user edit (`start: "user"`); `start: "any"` starts it on any change except the initial value, and `start: "always"` on the initial value too. A value that no start covers stays unchecked until `validate()` or a submit, which check it at once and without debounce. A field has one debounce, the longest of its async rules'. While a check runs, `error` keeps the last completed result and `pendingOf(node.error)` is true. The last completed result is reused while the field's async rules, its value and the rules' inputs are the same as when it was checked, so an unrelated change, or a guarded rule coming back, repeats no request.

**The main alternative.** Check on every change, or on blur only.

**Why.** Checking on a user edit sends requests only for values someone typed, never for a loaded form, and a submit still makes sure that nothing stays unchecked.

**Where to change it.** Pass `start` and `debounce` per rule; they are data of one rule, not a policy switch. To change how they combine, edit the `starts` table and the `debounce` line in `errorKey`'s owner in `validation.ts`.

## A check that throws writes "Validation failed"

**What the default recipes do.** A sync check that throws, or an async check that rejects, is treated as a bug: the field's `error` becomes "Validation failed", the thrown value goes to `console.error`, and the result is not remembered, so the next run checks again. A failure you expect, such as an unavailable server, should return a message instead.

**The main alternative.** Treat a throwing check as passing, or let the error escape to the store's `onError`.

**Why.** A check that fails open lets bad data through, and a field that keeps its last good state hides the bug ([principle 18](../docs/principles.md#18-errors-are-never-swallowed-or-replaced-checks-fail-closed)).

**Where to change it.** `failed` in `errorKey`'s owner in `validation.ts`.

## What a submit does

**What the default recipes do.** `handleSubmit(store, fn)` works on a store whose own node declares `submitting()`: the form root, or a section or row that declares it itself. A call:

1. resolves at once, without calling `fn`, while a submit of the same store is running;
2. turns `submitting` on and reveals every field of its subtree, in one batch;
3. validates the subtree, starting every check that hasn't run and waiting for every check in flight;
4. when the subtree is valid, calls `fn` with its value (see the first entry); when it isn't, focuses the first field with an error, in document order, among the fields with a registered focus target;
5. turns `submitting` off. If `fn` throws, the promise the handler returns rejects with that error.

**The main alternative.** Queue a second submit, or submit despite errors and leave the decision to `fn`.

**Why.** A double click must not send twice, and `fn` should receive only a value its checks have passed.

**Where to change it.** `handleSubmit` in `submit.ts`; the focus order is the `.sort(…)` in `focusFirst` in `focus.ts`.

## Messages are fixed English strings

**What the default recipes do.** The messages are English: "Required", "At least 3 characters", "At most 3 characters", "Must be at least 3", "Must be at most 3", "Invalid format", "Invalid email address", "Only one of a, b can be set", "One of a, b is required" and "Validation failed". `exclusive` names its fields by the last segment of their paths.

**The main alternative.** A translation hook, or keys looked up in a message catalog.

**Why.** A hook would be an option every copy carries ([principle 9](../docs/principles.md#9-a-recipe-has-no-policy-options-a-team-edits-its-copy)), and passing a message where a rule is declared already covers it.

**Where to change it.** Per rule, pass `message`: a string, or a function of the value (`required(node, { message: t("required") })`). `exclusive` takes `message.tooMany` and `message.missing`. The `defined` check's "Required" and the "Validation failed" of a throwing check are in `validation.ts`; the fallbacks of the ready rules are in `rules.ts`.

## A calculated value follows its sources

**What the default recipes do.** `calculate(target, sources, fn)` writes the target on every change of a source. A value the user typed into the target is overwritten by the next change of a source.

**The main alternative.** Stop following the sources once the user has edited the target.

**Why.** A calculated field the user can override is a second policy with its own questions (how to resume following), and you can declare it as a behavior of your own.

**Where to change it.** `calculate` in `values.ts`: add the target to its triggers and keep a flag in `ctx.state` once `ctx.changed(target)` comes with a `"user"` origin, as the guide's [behaviors page](../docs/guide/behaviors.md#the-run-context) shows.

## `clearWhen` resets to the baseline

**What the default recipes do.** While its test holds, `clearWhen(target, refs, test)` writes the target's baseline value, and an edit made in that time is reset too. When the test stops holding, the value isn't restored.

**The main alternative.** Write a fixed empty value, or restore what the user had typed.

**Why.** The baseline is the value the form started with, so clearing means "as if never filled".

**Where to change it.** `const initial = initialOf(target)` in `clearWhen` in `values.ts`.
