# The anyshape guide

anyshape is a form library whose [core](../../GLOSSARY.md) reserves no error slot. It holds a form's values and the metadata beside them, and keeps them consistent through [behaviors](../../GLOSSARY.md) you declare; what `error`, `touched` or `disabled` mean is up to you.

This guide covers the package: the core (`anyshape`) and the React bindings (`anyshape/react`). It doesn't cover the [recipes](https://github.com/TheAsda/anyshape/tree/master/recipes) (validation, input state, submitting and others), which are code you copy into your project rather than part of the package; the guide links them where they show a concept at work, and its last page shows how to write your own.

Every page stands on its own: it introduces what it needs, links the [glossary](../../GLOSSARY.md) for each term the first time it appears, and points to the stage of the [evolution example](https://github.com/TheAsda/anyshape/tree/master/examples/evolution) where its concept first shows up. The code samples are typechecked against the library.

**Using an AI agent?** Point it at [agents.md](agents.md): the rules, every public name, and the common mistakes, on one page.

## The model

1. [Shapes and nodes](shape.md): declaring a form; every [node](../../GLOSSARY.md) is a typed reference.
2. [The store](store.md): reading, writing, loading, resetting and subscribing.
3. [Meta keys](meta-keys.md): state beside values; [features](../../GLOSSARY.md); counting and sweeping.
4. [Behaviors](behaviors.md): declared rules that keep the form consistent.
5. [Guards](guards.md): switching rules on and off, and when to compute a value both ways instead.
6. [Arrays and rows](arrays.md): rows as [scopes](../../GLOSSARY.md), and behaviors per row.
7. [Combined keys](contributions.md): one owner, many [contributions](../../GLOSSARY.md).
8. [Async behaviors](async.md): cancellation, [kept work](../../GLOSSARY.md) and [pending](../../GLOSSARY.md) state.

## In an app

9. [React](react.md): the hooks, and where logic lives.
10. [What your app owns](your-side.md): showing errors, parsing input, server errors and submitting.

## Extending

11. [Writing your own recipe](writing-a-recipe.md): `disabled` and `disableWhen`, step by step.

## Also

- [Glossary](../../GLOSSARY.md): the terms used across the docs and the code.
- [Why anyshape works this way](../principles.md): the design principles, and what anyshape leaves out.
- The [evolution example](https://github.com/TheAsda/anyshape/tree/master/examples/evolution) is the worked tutorial: one form built in 13 stages, each linked from the page that explains its concept.
