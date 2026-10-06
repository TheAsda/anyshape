# anyshape

A form state library: a typed shape, a store holding values and metadata, and behaviors that keep them consistent.

## Language

**Core**:
The published library: the mechanism every form needs, and no opinion about what any particular metadata key means.
_Avoid_: base, kernel

**Recipe**:
Consumer-owned code built only on the core's public interface that gives a metadata key or workflow one team's meaning (e.g. what `disabled` implies, when an error shows). Copied and adapted, not depended on.
_Avoid_: preset, defaults, extras, utilities

**Shape**:
The declaration of a form's structure (its fields, objects and arrays, and the meta keys each one carries) from which every value and meta type is inferred.
_Avoid_: schema, model

**Node**:
One position in a shape: a field, an object or an array. A node is both the address of a value and the way to reach its meta keys. A node inside an array item stands for that position in every row.
_Avoid_: path, selector

**Store**:
A live form: the values for one shape, the meta of every node, and the behaviors that keep them consistent.
_Avoid_: state, form instance

**Scope**:
The form root or one row: the instance in which a node's value and meta are read and written. A behavior declared on a row's nodes runs separately in each row's scope.
_Avoid_: context

**Meta key**:
A named piece of state a node declares beside its value (such as `error`, `visible` or `touched`), with a default. The core gives no meta key a meaning.
_Avoid_: flag, attribute, status

**Feature**:
A reusable bundle of meta key definitions declared together.
_Avoid_: plugin, mixin

**Behavior**:
A declared rule that runs when one of its triggers changes, reads only the references it lists, and writes its targets. Each target has exactly one behavior writing it.
_Avoid_: effect, watcher, listener, reaction

**Guard**:
A condition over declared references that switches behaviors and contributions on and off. A behavior whose guard is false keeps its earlier writes.
_Avoid_: condition, predicate

**Origin**:
Where a write came from: the user, the program, the initial value, or a behavior. Behaviors can read it to tell changes apart; no origin lets a write skip the behaviors it affects.
_Avoid_: source, silent write

**Baseline**:
The value a node is compared against for `dirty` and returned to on reset: the initial value, or the last value written as initial.
_Avoid_: default, original, pristine

**Contribution**:
A declaration that supplies one input to the single behavior owning a meta key, without writing the key itself. The key decides how its contributions combine; a contribution whose guard is false is absent.
_Avoid_: provider, source, partial writer

**Cause**:
What a run exists to handle: the origins of the changes that started it and which inputs changed. A run cancelled by an input change passes its cause to the run that replaces it.
_Avoid_: trigger info, reason

**Kept work**:
Async work a run hands to the core under a key, so that a run replacing it can continue the same work instead of restarting it. It depends only on its key and never reads or writes the form.
_Avoid_: task, job, shared promise

**Pending**:
The state of a behavior target while a run that writes it is in flight. Derived by the core, never declared or written.
_Avoid_: loading, validating, busy

**Tally**:
A read-only value the core derives over the tree: a count of a key over a subtree (`countIn`), the pending targets in a subtree (`pendingIn`), or whether one target is pending (`pendingOf`). Its changes carry no origins, so a behavior with an origins filter can't trigger on one.
_Avoid_: aggregate (that is the step a key declares to be counted)

**Stored type**:
What a node's value can be while the form is being edited, including the empty part a field starts with or is cleared to. Reads return it.
_Avoid_: input type, raw type

**Checked type**:
What a node's value is once its checks pass: the stored type without the empty part a check rules out. The submit boundary hands it over.
_Avoid_: output type, valid type, parsed type
