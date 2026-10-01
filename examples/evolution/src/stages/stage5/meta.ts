import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Visibility",
  story: "Renting a car? Only then do we ask for license details.",
  bullets: [
    "visibility() on a group adds a `visible` flag, inherited by everything inside",
    "visibleWhen(node, [sources], fn) drives it from other fields",
    "clearWhen(node, [node.visible], (v) => !v): the group's values are wiped while it's hidden",
    "Hidden ⇒ not validated, and submit() omits it from the values (watch the result card)",
    "Flip the checkbox off after typing: values cleared, not merely ignored",
  ],
  notes:
    "Visibility is metadata on the subtree, inherited downward — fields inside don't know about it. The three properties compose: hidden fields aren't validated, aren't submitted, and (with clearWhen) don't keep stale values. Submit with the box unchecked: the result card has no `car` key at all — that IS what the server receives.",
};

