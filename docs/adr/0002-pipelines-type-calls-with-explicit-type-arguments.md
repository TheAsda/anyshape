# Pipelines type calls that mix explicit and inferred type arguments

TypeScript has no partial type-argument inference. Once a call spells out any of its type arguments, every other argument falls back to its default and nothing is inferred. A key definition needs both kinds: the value and payload types are written out (`metaKey<string | undefined, RulePart>`, because nothing in the call reveals the payload type), and the keys it uses must be inferred so that `combine` gets a typed tuple of refs. We therefore split such a call into a pipeline. Each step is its own call, so each infers its own type arguments from what came before:

```ts
metaKey<string | undefined, RulePart>(undefined) // V, P: explicit
  .aggregate((e) => e !== undefined)             // typed by V
  .uses(forced)                                  // U: inferred from the arguments
  .combine((self, key, [force]) => …)            // typed by V, P and U
```

This is the recommended pattern for any public API with the same shape: some types given by hand, others inferred, and a callback typed by both. Each step returns a new immutable value. A step whose types depend on an earlier step must come after it, and the runtime enforces that order (`.uses()` after `.combine()` throws). There is one way to declare each thing: `aggregate`, `combine` and `behavior` exist only as steps, not also as options. A callback typed by the key's value is a step even when nothing else is inferred: in an options object next to the default, the callback's parameter type is a second inference source for `V`, and an annotated `(v: boolean) => v` next to `false` would narrow the key to the literal `false` ([#2](https://github.com/TheAsda/form-lib/issues/2)).

## Considered options

- **Everything in one options object, with the used keys' type parameter defaulting to `[]`.** Rejected. With `<V, P>` written out, `uses: [forced]` fails to compile with a confusing message, and the caller must also spell `U` (`metaKey<V, P, [typeof forced]>`).
- **A loose default for that parameter (`readonly MetaKeyDef[]`).** Rejected. The call compiles, but the refs are `MetaRef<any, any>`, so the typing the feature exists for disappears without a warning.
- **Infer everything.** Possible (`metaKey(undefined as string | undefined, { uses, combine: (self, key: MetaRef<…, RulePart>, [force]) => … })`), but the payload type then hides in a parameter annotation, and leaving it out silently gives `NoPayload`.

(Decided on [#45](https://github.com/TheAsda/form-lib/issues/45). Each option was checked with `tsc`.)
