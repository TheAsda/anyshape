import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Control",
  story: "Inputs need error state, edited/dirty tracking and focusing — opt in per field.",
  bullets: [
    ".meta(control()) on a field adds error/edited/dirty/revealed; useControl adds a focus target and reports a pending check",
    "useControl(node) replaces the manual useValue + set binding",
    "Typing marks the field edited; onBlur marks it revealed. Together they decide when its error shows; errors still need rules (next stage)",
    "The status line under each input is live: watch unedited → edited · dirty",
  ],
  notes:
    "Nothing changed in the shape's field list — control() is metadata a field opts into. The binding swap from useValue+set to useControl gives the input everything a real form control needs. Note what did NOT happen: no useState for edited, no refs bookkeeping, no per-field blur handlers.",
};
