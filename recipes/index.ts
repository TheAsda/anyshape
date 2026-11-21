// The default recipes, `anyshape/recipes`. Every export is listed: this file
// is the entry's public surface. The React recipes are in react/.

export {
  errorKey,
  checkForcedKey,
  requiredNowKey,
  validation,
  defined,
  rule,
  asyncRule,
  validate,
  type InferChecked,
  type Defined,
  type DefinedOptions,
  type Validatable,
  type RulePart,
  type RuleContext,
  type AsyncRuleContext,
  type RuleOptions,
  type AsyncRuleOptions,
  type AsyncStart,
  type ErrorEntry,
  type ValidationResult,
} from "./validation.js";
export {
  required,
  minLength,
  maxLength,
  min,
  max,
  pattern,
  email,
  isEmpty,
  exclusive,
  type Lengthy,
  type Numeric,
  type Textual,
  type Message,
  type MessageOptions,
  type Limit,
  type ExclusiveOptions,
} from "./rules.js";
export { editedKey, dirtyKey, revealedKey, edited, dirty, revealed, control } from "./control.js";
export { visibleKey, visible, visibleWhen } from "./visibility.js";
export { disabledKey, disabled, disableWhen, type Disableable } from "./disabling.js";
export { calculate, link, clearWhen, startWith, emptyToUndefined, type LinkOptions } from "./values.js";
export { submittingKey, submitting, handleSubmit, type Submittable, type FormSubmitHandler } from "./submit.js";
export { registerFocus, focusFirst, type FocusTarget, type FocusEntry } from "./focus.js";
