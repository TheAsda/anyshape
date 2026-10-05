import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Async & server",
  story: "Trips end after they begin, some destinations are off-limits, and the server has opinions.",
  bullets: [
    "rule(end, (v, ctx) => ..., { triggers: [start] }) — a rule that reads a sibling field",
    "asyncRule(destination, check, { debounce: 400 }) — async errors are just rules",
    "submit() awaits pending async checks before deciding",
    'save() rejects with field errors addressed by path, e.g. "startDate"',
    "resolvePath(path) finds the field; its error key is found by definition (collect(field, error)) and set",
    "Submit reveals, so server errors show immediately; the next validation run clears them",
  ],
  notes:
    "Three beats. One: the end-date rule declares startDate as a trigger, so fixing the start re-validates the end. Two: the destination async check is debounced — type 'antarctica' and watch it come back red after a beat; submit waits for it. Three: our fake save() rejects the FIRST booked dates with a path-addressed error; the consumer maps paths to fields via resolvePath. Same mechanism the wizard example uses for row-level errors like items[0].sku.",
};
