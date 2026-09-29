import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Guards",
  story: "Stays over 30 nights need a justification — the field is always there, its rule isn't.",
  bullets: [
    "b.when([sources], test, (b) => { ... }) — rules inside are live only while the test holds",
    "The field stays visible and editable; only validation toggles",
    "The guard source can be a COMPUTED value (nights), so editing dates flips the requirement",
    "Different from visibility: stage 5 removed the fields; here the same field gains/loses a rule",
  ],
  notes:
    "Set departure and a return 31+ nights out, submit — notes is suddenly required. Shrink the trip below 31 and the requirement is gone, with no other change anywhere. Guards compose with everything: array rows use the same pattern for 'a row is either empty or fully filled'. The condition is re-evaluated whenever any source changes — and since nights is computed from the dates, dragging a date is enough.",
};
