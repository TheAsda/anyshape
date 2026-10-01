// ============================================================
// Native adapters – an onChange for values, adapted to DOM change events.
// ============================================================

const inputHandlers = new WeakMap<Function, Function>();
const checkboxHandlers = new WeakMap<Function, Function>();

/**
 * Adapt an onChange for strings to an input / textarea / select change
 * handler. The same onChange always gets the same handler (no hook needed).
 */
export function fromInput(onChange: (value: string) => void): (event: { target: { value: string } }) => void {
  let handler = inputHandlers.get(onChange);
  if (!handler) {
    handler = (event: { target: { value: string } }) => onChange(event.target.value);
    inputHandlers.set(onChange, handler);
  }
  return handler as (event: { target: { value: string } }) => void;
}

/** Adapt an onChange for booleans to a checkbox change handler. */
export function fromCheckbox(onChange: (checked: boolean) => void): (event: { target: { checked: boolean } }) => void {
  let handler = checkboxHandlers.get(onChange);
  if (!handler) {
    handler = (event: { target: { checked: boolean } }) => onChange(event.target.checked);
    checkboxHandlers.set(onChange, handler);
  }
  return handler as (event: { target: { checked: boolean } }) => void;
}
