// ============================================================
// The form definition: shape (fields + features) and behaviors
// (validation rules and reactive logic). Imported by the React
// components below – the library itself is framework-agnostic.
// ============================================================

import {
  form,
  object,
  field,
  array,
  control,
  submission,
  visibility,
  defineBehaviors,
  required,
  minLength,
  email,
  min,
  max,
  asyncRule,
  visibleWhen,
  clearWhenHidden,
  isEmpty,
  type InferValue,
} from "form-lib";

// ------------------------------------------------------------
// Shape
// ------------------------------------------------------------
// control()  = validation + touched + dirty + a focus target:
//              everything an input needs.
// visibility() adds `visible` (inherited down the subtree).
// submission() adds the root-level submitCount / submitting keys.
export const shape = form(
  object({
    name: field<string>().meta(control()),
    email: field<string>().meta(control()),
    accountType: field<"personal" | "company">().meta(control()),
    company: field<string>().meta(control(), visibility()),
    age: field<number | undefined>().meta(control()),
    newsletter: field<boolean>().meta(control()),
    skills: array(
      object({
        name: field<string>().meta(control()),
        level: field<number | undefined>().meta(control()),
      }),
      // Factory for new rows, so append() needs no arguments.
      { create: () => ({ name: "", level: undefined }) },
    ),
  }).meta(submission())
);

export type Values = InferValue<typeof shape>;

export const initialValues: Values = {
  name: "",
  email: "",
  accountType: "personal",
  company: "",
  age: undefined,
  newsletter: true,
  skills: [],
};

// ------------------------------------------------------------
// Behaviors
// ------------------------------------------------------------
const takenEmails = new Set(["admin@example.com", "dev@form-lib.dev"]);

/** Pretend server round-trip for the async rule demo. */
async function checkEmail(value: string): Promise<string | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return takenEmails.has(value.toLowerCase()) ? "This email is already registered" : undefined;
}

export const behaviors = defineBehaviors(shape, (b, s) => {
  b.add(required(s.name), minLength(s.name, 2));
  // Sync rules pass first; only then does the async rule run (debounced).
  b.add(required(s.email), email(s.email), asyncRule(s.email, checkEmail, { debounce: 300 }));

  // The company field exists only for company accounts: hidden otherwise,
  // its value is cleared while hidden, and hidden fields are not validated
  // and become optional in the submitted values. So `required` applies only
  // while the field is visible.
  b.add(visibleWhen(s.company, [s.accountType], (t) => t === "company"));
  b.add(clearWhenHidden(s.company));
  b.add(required(s.company));

  b.add(min(s.age, 13), max(s.age, 120));

  // Rules per array row: a row is either fully empty, or both parts are
  // filled in (each guard makes its rule live only while it holds).
  b.each(s.skills, (b, skill) => {
    b.when([skill.name], (name) => !isEmpty(name), (b) => {
      b.add(required(skill.level));
    });
    b.when([skill.level], (level) => level !== undefined, (b) => {
      b.add(required(skill.name));
    });
    b.add(min(skill.level, 1), max(skill.level, 5));
  });
});
