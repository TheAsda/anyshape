import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Disabled",
  story: "The employer pays — so the nightly budget stays on screen, but locked.",
  bullets: [
    "disableable() adds a `disabled` key to a field (or a whole group — it inherits)",
    "disableWhen(node, [sources], fn) drives it exactly like visibleWhen",
    "Same contract as hidden: skipped by validation, omitted from submitted values",
    "…but the value stays in the store — the estimated budget keeps computing from the locked rate",
    "It's ordinary metadata — the component subscribes with useValue and decides what it looks like",
  ],
  notes:
    "The counterpart to visibility, and the contrast is the point. Hiding removes the subtree from the screen (and, with clearWhenHidden, wipes its values); disabling keeps everything visible and just locks editing. What they SHARE is the submit contract: hidden and disabled fields are both skipped by validation and left out of the values the server receives — submit with the box checked and nightlyRate is gone from the result card, yet the budget was still computed from it. The `disabled` key inherits down ('any' ancestor), so disableWhen on a group locks the whole group at once.",
};
