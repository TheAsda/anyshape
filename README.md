# anyshape

Form state for TypeScript: a typed shape, a store that holds values and metadata, and behaviors that keep them consistent.

> **0.x preview.** Until 1.0, breaking changes ship in minor versions. The [changelog](CHANGELOG.md) lists them.

## Why anyshape

- **Everything is a typed reference.** The shape gives every field, and every meta key declared on it, a reference: `shape.return`, `shape.return.error`. Reads, writes and behaviors take these references, never string paths, so a misspelled field or a value of the wrong type fails to compile.
- **The core reserves no meta key.** There is no built-in `error`, `touched` or `disabled`. You declare the keys your forms need and the behaviors that write them. [Recipes](recipes/README.md) provide common ones (validation, input state, submitting) as code you copy into your project and change.

## Install

```sh
npm install anyshape
```

- The package is ESM only and needs an ES2022 runtime.
- Its types need TypeScript 5.4 or later.
- The React bindings are in the same package, at `anyshape/react`, and need React 19. React is an optional peer dependency: the core has no dependencies, and an app that uses only the core doesn't install React.

## Example

```tsx
import { form, object, field, metaKey, defineBehaviors, defineBehavior, createStore } from "anyshape";
import { useField, useValue } from "anyshape/react";

// The core reserves no meta key: `error` is yours to declare.
const error = metaKey<string | undefined>(undefined);

const shape = form(
  object({
    departure: field<string>(),
    return: field<string>().meta({ error }),
  }),
);

const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(
    defineBehavior({
      name: "returnAfterDeparture",
      triggers: [s.departure, s.return],
      writes: [s.return.error],
      run: (ctx) => {
        const early = ctx.get(s.return) !== "" && ctx.get(s.return) < ctx.get(s.departure);
        ctx.set(s.return.error, early ? "Return before departure" : undefined);
      },
    }),
  );
});

const store = createStore(shape, { departure: "2026-05-01", return: "" }, { behaviors });
store.set(shape.return, "2026-04-28");
store.get(shape.return.error); // "Return before departure"

// React: the same references.
function ReturnField() {
  const { value, onChange } = useField(shape.return);
  const message = useValue(shape.return.error);
  return (
    <label>
      Return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      {message && <span role="alert">{message}</span>}
    </label>
  );
}
```

Every reference is checked by the compiler: `store.get(shape.departure.error)` doesn't compile, because `departure` declares no `error`, and neither does `store.set(shape.return.error, 42)`, because `error` holds a string.

Next, the [evolution example](examples/evolution/README.md) builds one form in 14 stages, from plain values to a form in steps, one concept per stage. The [basic example](examples/basic/README.md) is a complete form.

## Using anyshape with an AI agent

The package ships its guide, so an agent reads the docs of the version you installed. Add this line to your project's `AGENTS.md`:

```md
Before writing anyshape code, read `node_modules/anyshape/docs/guide/agents.md`.
```

## Documentation

These docs follow `master`. For the docs of a published version, open its [release tag](https://github.com/TheAsda/anyshape/tags).

[Glossary](GLOSSARY.md): the terms used across the docs and the code.

**Using anyshape**

- [Guide](docs/guide/README.md): the concepts, one page per topic, ending with writing your own recipe.
- [Evolution example](examples/evolution/README.md): one form in 14 stages.
- [Basic example](examples/basic/README.md): a complete form.
- [Recipes](recipes/README.md): validation, input state, submitting and more, to copy into your project.
- [Why anyshape works this way](docs/principles.md): the design principles, and what anyshape leaves out.
- [Changelog](CHANGELOG.md)
- [Security](SECURITY.md): how to report a vulnerability privately.

**Contributing**

- [Contributing](CONTRIBUTING.md): setup, tests, changesets.
- [Testing](docs/testing.md)
- [Architecture decisions](docs/adr/)

## License

[MIT](LICENSE)
