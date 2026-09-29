import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Reuse",
  story: "The rental car needs a date pair too — same behavior, different gap.",
  bullets: [
    "New fields, same structure: car.pickupOn / car.dropoffOn join the (already hidden-by-default) car group",
    "The inline behavior becomes twoDates(start, end, shiftDays) — a function taking nodes",
    "b.add(twoDates(s.startDate, s.endDate, 7), twoDates(s.car.pickupOn, s.car.dropoffOn, 3))",
    "The gap is data: the trip suggests a week, the rental a long weekend",
    "One writer per field: clearWhenHidden(car) would claim the dates too — the store rejects two owners, so the clearing is scoped to the license fields",
    "name derives from the node path — behaviors stay identifiable when debugging",
    "This is how library helpers like required(node) are shaped: node in, behavior out",
  ],
  notes:
    "The moment a second pair appears, copy-pasting the behavior is the wrong move — the nodes were the only thing specific about it. The factory takes FieldNodes plus a gap and returns the behavior; name it from the node path so it's traceable in logs. Try the naive version and the store refuses to mount: clearWhenHidden(car) already writes those fields, and one writer per target is enforced, not advisory. Scope the clearing, let the factory own the pair — hidden date values linger in memory, but hidden fields are never submitted. Notice the shape of this API: it's exactly what required() or minLength() look like from the outside. You've been consuming this pattern since stage 3; now you're writing it.",
};
