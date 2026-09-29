import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Exclusive",
  story: "One discount per booking: fill the loyalty number and the promo code locks itself.",
  bullets: [
    "exclusive([a, b], { required: true }) — one call, the whole policy",
    "Exactly one filled → the others disable themselves (the mistake becomes impossible)",
    "None filled → submitting flags both with 'pick one'",
    "It composes from the same primitives: a disabler behavior + one rule per field",
  ],
  notes:
    "Watch the live interplay: type into loyalty and promo grays out; clear loyalty and it comes back. If you somehow get two filled (paste fast, or via code), every filled field gets an error and everything unlocks so the user can fix it. required: true adds the missing case — submit with both empty and both fields are flagged. Under the hood exclusive() returns a small list of behaviors — that's why it's spread into b.add(...).",
};
