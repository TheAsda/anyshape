import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Disabled",
  story: "The employer pays — so the nightly budget stays on screen, but locked.",
  bullets: [
    "{ disabled } adds a `disabled` key to a field",
    "disableWhen(node, [sources], fn) drives it exactly like visibleWhen",
    "Same contract as hidden: nothing implicit — rules that should pause are guarded on it, and the value is still submitted",
    "The value stays in the store — the estimated budget keeps computing from the locked rate",
    "It's ordinary metadata — the component subscribes with useValue and decides what it looks like",
  ],
  notes:
    "The counterpart to visibility, and the contrast is the point. Hiding removes the subtree from the screen (and, with clearWhen, wipes its values); disabling keeps everything visible and just locks editing. What they SHARE is that neither does anything implicitly: validation and submit treat them like any other field unless a rule is guarded on them — submit with the box checked and nightlyRate is in the result card, locked but intact, and the budget was computed from it.",
};
