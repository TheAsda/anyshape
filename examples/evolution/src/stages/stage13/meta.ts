import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Status",
  story: "How do you know the form is mid-check? Count the control metadata.",
  bullets: [
    "countIn(shape, 'validating') — how many fields have an async check in flight, right now",
    "countIn(shape, 'error') — how many fields currently carry an error",
    "They're CountRefs: subscribe with useValue like any other value",
    "The submit button disables itself while anything is validating — no bookkeeping in the components",
  ],
  notes:
    "Type 'antarctica' and watch the button while the debounced check runs: 'Checking… (1)'. No component owns that state — it's derived from the same metadata each field already carries. This is the answer to 'how do I disable my submit while an async rule runs?' — you count. The error chip works the same way after a failed submit. Any metaKey you add (control()'s or your own) is countable this way.",
};
