import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Rules",
  story: "Dates are mandatory and 'l' is not a destination.",
  bullets: [
    "defineBehaviors(shape, (b, s) => { b.add(required(s.destination), ...) })",
    "Behaviors are passed to useForm at mount — the shape stays reusable",
    "submission() on the root + handleSubmit(form, fn): invalid never submits",
    "A failed submit reveals every error and focuses the first (focusRef from stage 2)",
    "showError: shown once blurred or revealed by submit, then live",
  ],
  notes:
    "Rules live outside the shape, as behaviors — the same shape can carry different rules in different apps. Submit is a recipe over the store: handleSubmit(form, fn) validates, reveals, focuses. Try submitting empty, then type one character and blur: minLength is live once the field was left.",
};
