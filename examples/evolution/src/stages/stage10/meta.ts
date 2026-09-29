import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Custom behavior",
  story: "Pick a departure while the return is empty — the form suggests a one-week trip.",
  bullets: [
    "defineBehavior is the primitive: every helper so far (required, calculate, visibleWhen) is one",
    "triggers: which changes wake it up; writes: which nodes it may set (declared, enforced)",
    "origins: ['user'] — loading or resetting data never autofills, only typing does",
    "runOn: { init: false } — mounting with a half-filled form does nothing either",
    "ctx.changed(node) tells WHICH trigger fired; ctx.get / ctx.set read and write",
    "The guard is explicit: only fill an empty return, never overwrite the user's choice",
  ],
  notes:
    "Until now behaviors came from a helper library; this one is ours. A behavior is a declaration, not an event handler: you say which writes it watches, what it may write, who may cause it and when it runs — the store schedules it. Watch the contract do work: typing a departure fills the return with +7 days, but a programmatic load with the same half-filled state does nothing, and an already-chosen return is never touched.",
};
