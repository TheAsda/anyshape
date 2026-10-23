import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Rules",
  story: "Dates are mandatory and 'l' is not a destination.",
  bullets: [
    "defineBehaviors(shape, (b, s) => { b.add(required(s.destination), ...) })",
    "Behaviors are passed to useForm at mount — the shape stays reusable",
    "submitting() on the root + handleSubmit(form, fn): invalid never submits",
    "A failed submit reveals every error and focuses the first (focusRef from stage 2)",
    "showError: this example's copy of the recipes shows an error once the field is edited or revealed; the default recipes wait for a blur or a submit",
  ],
  notes:
    "Rules live outside the shape, as behaviors — the same shape can carry different rules in different apps. Submit is a recipe over the store: handleSubmit(form, fn) validates, reveals, focuses. Type one character into the destination: minLength speaks at once. That's a policy, and this example changed it: it uses a copied set of the recipes (src/recipes/), whose showError line in react/control.ts adds `edited`. With the default recipes from anyshape/recipes, the error would wait until you left the field. To change a policy, copy the whole set and edit the copy; recipes/POLICIES.md lists them all.",
};
