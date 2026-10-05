import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Visibility",
  story: "Renting a car? Only then do we ask for license details.",
  bullets: [
    "{ visible } on a group adds a `visible` flag to the group itself; the fields inside don't carry it",
    "visibleWhen(node, [sources], fn) drives it from other fields",
    "clearWhen(node, [node.visible], (v) => !v): the group's values are wiped while it's hidden",
    "b.when([s.car.visible], (v) => v, …) guards the car rules: hidden ⇒ the rules are absent, not validated",
    "Flip the checkbox off after typing: values cleared, not merely ignored",
  ],
  notes:
    "Visibility is metadata on the group — the fields inside don't know about it, and the core doesn't pass it down to them. Nothing follows from it implicitly; each consequence is declared: rules guarded on it aren't checked while hidden, and clearWhen wipes stale values. Submit with the box unchecked: the car fields are back to empty and no car rule fired — the result card shows exactly what the server receives.",
};
