# form-lib

A form state library: a typed shape, a store holding values and metadata, and behaviors that keep them consistent.

## Language

**Core**:
The published library: the mechanism every form needs, and no opinion about what any particular metadata key means.
_Avoid_: base, kernel

**Recipe**:
Consumer-owned code built only on the core's public interface that gives a metadata key or workflow one team's meaning (e.g. what `disabled` implies, when an error shows). Copied and adapted, not depended on.
_Avoid_: preset, defaults, extras, utilities

**Contribution**:
A declaration that supplies one input to the single behavior owning a meta key, without writing the key itself. The key decides how its contributions combine; a contribution whose guard is false is absent.
_Avoid_: provider, source, partial writer

**Cause**:
What a run exists to handle: the origins of the changes that started it, which inputs changed, and whether it is the initial run. A run cancelled by an input change passes its cause to the run that replaces it.
_Avoid_: trigger info, reason

**Kept work**:
Async work a run hands to the core under a key, so that a run replacing it can continue the same work instead of restarting it. It depends only on its key and never reads or writes the form.
_Avoid_: task, job, shared promise

**Pending**:
The state of a behavior target while a run that writes it is in flight. Derived by the core, never declared or written.
_Avoid_: loading, validating, busy
