// ============================================================
// Generic input components over useControl. `useControl` returns
// value / onChange plus the control() state (error, touched,
// dirty, pending), a focusRef that registers the element
// for submit-time error focusing, and onBlur / showError.
//
// showError: an error shows once the field was left (onBlur) or
// covered by a submit and no check is pending, and then stays live
// while it's fixed. To change when, edit the expression in
// useControl (recipes/react/control.ts).
//
// Every field also takes an optional `hint`: static helper text
// that tells the user up front what the rules are (and how to
// trip them, in this demo), in addition to the live error.
// ============================================================

import { useId } from "react";
import { useValue } from "anyshape/react";
import { useControl, fromInput, fromCheckbox, type ControlNode } from "../../../recipes/react";
import type { AnyNode } from "anyshape";

// Node types accepted by each component: a ControlNode whose value type
// matches the input. Passing e.g. a number field to TextField is a type
// error at the call site.
type StringNode = ControlNode & { readonly _type: string };
type NumberNode = ControlNode & { readonly _type: number | null | undefined };
type BooleanNode = ControlNode & { readonly _type: boolean };
/** Any value node with a number value, control or not (e.g. computed fields). */
type NumberValueNode = AnyNode & { readonly _type: number | null | undefined };

interface CommonProps {
  label: string;
  /** Static helper text shown under the input, error or not. */
  hint?: string;
}

/** ids of the elements describing the input (hint and/or error), for aria. */
function describedBy(show: boolean, errorId: string, hasHint: boolean, hintId: string) {
  const parts: string[] = [];
  if (hasHint) parts.push(hintId);
  if (show) parts.push(errorId);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function Hint({ has, id, children }: { has: boolean; id: string; children?: string }) {
  if (!has) return null;
  return (
    <p className="field__hint" id={id}>
      {children}
    </p>
  );
}

function FieldError({ show, id, children }: { show: boolean; id: string; children?: string }) {
  if (!show) return null;
  return (
    <p className="field__error" id={id}>
      {children}
    </p>
  );
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

export function TextField({ node, label, hint, type = "text", placeholder, autoComplete }: TextFieldProps) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
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
        aria-describedby={describedBy(show, errorId, hint !== undefined, hintId)}
        onChange={fromInput(c.onChange)}
      />
      <Hint has={hint !== undefined} id={hintId}>
        {hint}
      </Hint>
      <FieldError show={show} id={errorId}>
        {c.error}
      </FieldError>
      {c.pending && <p className="field__status">Checking…</p>}
    </div>
  );
}

// ------------------------------------------------------------
// Multiline text
// ------------------------------------------------------------
interface TextAreaFieldProps extends CommonProps {
  node: StringNode;
  rows?: number;
  placeholder?: string;
}

export function TextAreaField({ node, label, hint, rows = 4, placeholder }: TextAreaFieldProps) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const show = c.showError;

  return (
    <div className={show ? "field field--error" : "field"}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        ref={c.focusRef}
        className="field__input"
        rows={rows}
        value={c.value}
        placeholder={placeholder}
        onBlur={c.onBlur}
        aria-invalid={show || undefined}
        aria-describedby={describedBy(show, errorId, hint !== undefined, hintId)}
        onChange={fromInput(c.onChange)}
      />
      <Hint has={hint !== undefined} id={hintId}>
        {hint}
      </Hint>
      <FieldError show={show} id={errorId}>
        {c.error}
      </FieldError>
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
  /** Unit rendered at the end of the input (e.g. "€"). */
  suffix?: string;
}

export function NumberField({ node, label, hint, min, max, placeholder, suffix }: NumberFieldProps) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const show = c.showError;

  return (
    <div className={show ? "field field--error" : "field"}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__affix">
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
          aria-describedby={describedBy(show, errorId, hint !== undefined, hintId)}
          onChange={(e) => c.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
        {suffix !== undefined && <span className="field__suffix">{suffix}</span>}
      </div>
      <Hint has={hint !== undefined} id={hintId}>
        {hint}
      </Hint>
      <FieldError show={show} id={errorId}>
        {c.error}
      </FieldError>
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

export function SelectField({ node, label, hint, options }: SelectFieldProps) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
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
        aria-describedby={describedBy(show, errorId, hint !== undefined, hintId)}
        // A select always returns one of the listed option values.
        onChange={fromInput(c.onChange)}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Hint has={hint !== undefined} id={hintId}>
        {hint}
      </Hint>
      <FieldError show={show} id={errorId}>
        {c.error}
      </FieldError>
    </div>
  );
}

// ------------------------------------------------------------
// Checkbox
// ------------------------------------------------------------
interface CheckboxFieldProps extends CommonProps {
  node: BooleanNode;
}

export function CheckboxField({ node, label, hint }: CheckboxFieldProps) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
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
        aria-describedby={describedBy(show, errorId, hint !== undefined, hintId)}
        onChange={fromCheckbox(c.onChange)}
      />
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <Hint has={hint !== undefined} id={hintId}>
        {hint}
      </Hint>
      <FieldError show={show} id={errorId}>
        {c.error}
      </FieldError>
    </div>
  );
}

// ------------------------------------------------------------
// Date
// ------------------------------------------------------------
interface DateFieldProps extends CommonProps {
  node: StringNode;
}

export function DateField({ node, label, hint }: DateFieldProps) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
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
        type="date"
        value={c.value}
        onBlur={c.onBlur}
        aria-invalid={show || undefined}
        aria-describedby={describedBy(show, errorId, hint !== undefined, hintId)}
        onChange={fromInput(c.onChange)}
      />
      <Hint has={hint !== undefined} id={hintId}>
        {hint}
      </Hint>
      <FieldError show={show} id={errorId}>
        {c.error}
      </FieldError>
    </div>
  );
}

// ------------------------------------------------------------
// Readonly (computed values)
// ------------------------------------------------------------
interface ReadonlyFieldProps {
  node: NumberValueNode;
  label: string;
  /** Unit rendered at the end of the input (e.g. "€"). */
  suffix?: string;
}

export function ReadonlyField({ node, label, suffix }: ReadonlyFieldProps) {
  const value = useValue(node);
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__affix">
        <input id={id} className="field__input" type="number" value={value ?? ""} readOnly />
        {suffix !== undefined && <span className="field__suffix">{suffix}</span>}
      </div>
    </div>
  );
}
