import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Arrays",
  story: "People travel together — a list of rows with per-row rules.",
  bullets: [
    "array(object({...}), { create }) — `create` is the factory for new rows",
    "b.each(s.travelers, (b, t) => { ... }) adds rules per row; rows validate independently",
    "useArray(node) → { items: row stores, append, remove }",
    "Each row renders inside <StoreProvider store={row}> — the template node drives it",
    "The budget now multiplies by travelers: the ARRAY NODE is a calculate source",
  ],
  notes:
    "An array is a shape whose item is a template. append() needs no arguments thanks to `create`. Per-row rules attach with b.each — required names here, but anything a field supports works inside a row. The kicker: estimatedBudget lists the travelers array as a source, so adding or removing a row recomputes it — same declaration as stage 4.",
};
