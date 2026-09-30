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

**Pending**:
The state of a behavior target while a run that writes it is in flight or debounced. Derived by the core, never declared or written.
_Avoid_: loading, validating, busy
