import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Control",
  story: "Inputs need error state, touched/dirty tracking and focusing — opt in per field.",
  bullets: [
    ".meta(control()) on a field adds error/touched/dirty + a focus target (useControl also reports a pending check)",
    "useControl(node) replaces the manual useValue + set binding",
    "onBlur marks the field touched; errors still need rules (next stage)",
    "The status line under each input is live: watch untouched → touched · dirty",
  ],
  notes:
    "Nothing changed in the shape's field list — control() is metadata a field opts into. The binding swap from useValue+set to useControl gives the input everything a real form control needs. Note what did NOT happen: no useState for touched, no refs bookkeeping, no per-field blur handlers.",
};

