// ============================================================
// Generic input components over useControl. `useControl` returns
// value / onChange plus the control() state (error, touched,
// dirty, validating), a focusRef that registers the element
// for submit-time error focusing, and onBlur / showError.
//
// showError follows the display policy of the StoreProvider: by
// default an error shows once the field was left (onBlur) or
// covered by a submit, and then stays live while it's fixed.
// ============================================================

import { useId } from "react";
import { useControl, fromInput, fromCheckbox, type ControlNode } from "form-lib/react";

// Node types accepted by each component: a ControlNode whose value type
// matches the input. Passing e.g. a number field to TextField is a type
// error at the call site.
type StringNode = ControlNode & { readonly _type: string };
type NumberNode = ControlNode & { readonly _type: number | null | undefined };
type BooleanNode = ControlNode & { readonly _type: boolean };

interface CommonProps {
  label: string;
}

// ------------------------------------------------------------
// Text
// ------------------------------------------------------------
interface TextFieldProps extends CommonProps {
  node: StringNode;
  type?: "text" | "email" | "url";
  placeholder?: string;
  autoComplete?: string;
}

export function TextField({ node, label, type = "text", placeholder, autoComplete }: TextFieldProps) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  const show = c.showError;

  return (
    <div className={show ? "field field--error" : "field"}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={c.focusRef}
        className="field__input"
        type={type}
        value={c.value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onBlur={c.onBlur}
        aria-invalid={show || undefined}
        aria-describedby={show ? errorId : undefined}
        onChange={fromInput(c.onChange)}
      />
      {show && (
        <p className="field__error" id={errorId}>
          {c.error}
        </p>
      )}
      {c.validating && <p className="field__status">Checking…</p>}
    </div>
  );
}

// ------------------------------------------------------------
// Number
// ------------------------------------------------------------
interface NumberFieldProps extends CommonProps {
  node: NumberNode;
  min?: number;
  max?: number;
  placeholder?: string;
}

export function NumberField({ node, label, min, max, placeholder }: NumberFieldProps) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  const show = c.showError;

  return (
    <div className={show ? "field field--error" : "field"}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={c.focusRef}
        className="field__input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        placeholder={placeholder}
        value={c.value ?? ""}
        onBlur={c.onBlur}
        aria-invalid={show || undefined}
        aria-describedby={show ? errorId : undefined}
        onChange={(e) => c.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
      {show && (
        <p className="field__error" id={errorId}>
          {c.error}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Select
// ------------------------------------------------------------
interface SelectFieldProps extends CommonProps {
  node: StringNode;
  options: readonly { value: string; label: string }[];
}

export function SelectField({ node, label, options }: SelectFieldProps) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  const show = c.showError;

  return (
    <div className={show ? "field field--error" : "field"}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        ref={c.focusRef}
        className="field__input"
        value={c.value}
        onBlur={c.onBlur}
        aria-invalid={show || undefined}
        aria-describedby={show ? errorId : undefined}
        // A select always returns one of the listed option values.
        onChange={fromInput(c.onChange)}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {show && (
        <p className="field__error" id={errorId}>
          {c.error}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Checkbox
// ------------------------------------------------------------
interface CheckboxFieldProps extends CommonProps {
  node: BooleanNode;
}

export function CheckboxField({ node, label }: CheckboxFieldProps) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  const show = c.showError;

  return (
    <div className={show ? "field field--checkbox field--error" : "field field--checkbox"}>
      <input
        id={id}
        ref={c.focusRef}
        type="checkbox"
        checked={c.value}
        onBlur={c.onBlur}
        aria-invalid={show || undefined}
        aria-describedby={show ? errorId : undefined}
        onChange={fromCheckbox(c.onChange)}
      />
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {show && (
        <p className="field__error" id={errorId}>
          {c.error}
        </p>
      )}
    </div>
  );
}
