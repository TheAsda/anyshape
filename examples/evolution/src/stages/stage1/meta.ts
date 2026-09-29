import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Values",
  story: "You need to know where and when someone is going.",
  bullets: [
    "form(object({...})) describes the fields; field<T>() is just a typed slot",
    "useForm(shape, initialValues) creates the store (once per mount)",
    "useValue(node) subscribes; store.set(node, value) writes",
    "No submit machinery yet: we read the whole value with useValue(shape)",
  ],
  notes:
    "Start from nothing. The shape is a plain typed tree — no React, no validation, no HTML. The store is just state: every input binds one node with useValue + set. Submit is a plain button reading the root value. Everything the library adds later is metadata and behaviors on top of this.",
};

