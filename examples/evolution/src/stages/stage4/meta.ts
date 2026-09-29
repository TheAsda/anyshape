import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Derived",
  story: "Nights and budget follow from the dates — the form does the math.",
  bullets: [
    "calculate(target, [sources], fn) recomputes on every source change",
    "Derived fields are plain field<T>()s — no control(), users never touch them",
    "The budget multiplies three sources; edit any date or the rate and watch it update",
    "Sources are references: the same declaration works for lookups or array lengths (stage 6)",
  ],
  notes:
    "No useEffect, no useMemo, no manual recompute on change — a calculate is a behavior from a source list to one target. Because sources are references, stage 6 will add the travelers array as a source of the same budget and it just re-fires when rows are added or removed.",
};

