// ============================================================
// Shared UI plumbing for every stage. This file is deliberately
// NOT part of the presentation: stages import from here so the
// slide code stays pure shape + behaviors.
// ============================================================

import { useId } from "react";
import { useStore, useValue } from "form-lib/react";
import { useControl, fromInput, fromCheckbox, type ControlNode } from "../../../recipes/react";
import type { FieldNode } from "form-lib";

/** What each stage exports alongside its component. */
export type StageMeta = {
  /** Short tab / slide title, e.g. "Rules". */
  title: string;
  /** The one-sentence story that opens the slide. */
  story: string;
  /** "What's new" bullets shown above the code pane. */
  bullets: string[];
  /** Speaker notes: the fuller thing to say while presenting. */
  notes: string;
};

// ------------------------------------------------------------
// Stage 1 style binding: a plain value, no control metadata.
// ------------------------------------------------------------
export function ValueField({
  node,
  label,
  type = "text",
  placeholder,
}: {
  node: FieldNode<string>;
  label: string;
  type?: string;
  placeholder?: string;
}) {
  const value = useValue(node);
  const store = useStore();
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => store.set(node, e.target.value)}
      />
    </label>
  );
}

// ------------------------------------------------------------
// Stage 2+ style binding: a field with .meta(control()).
// ------------------------------------------------------------
type StringNode = ControlNode & { readonly _type: string };
type NumberNode = ControlNode & { readonly _type: number | null | undefined };
type BooleanNode = ControlNode & { readonly _type: boolean };

export function TextField({
  node,
  label,
  type = "text",
  placeholder,
  disabled,
}: {
  node: StringNode;
  label: string;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={c.focusRef}
        className="field__input"
        id={id}
        type={type}
        placeholder={placeholder}
        value={c.value}
        onChange={fromInput(c.onChange)}
        onBlur={c.onBlur}
        disabled={disabled}
        aria-invalid={c.showError && !!c.error}
        aria-describedby={c.showError && c.error ? errorId : undefined}
      />
      {c.showError && c.error && (
        <p className="field__error" id={errorId}>
          {c.error}
        </p>
      )}
      <p className="field__status">
        {c.touched ? "touched" : "untouched"}
        {c.dirty ? " · dirty" : ""}
      </p>
    </div>
  );
}

export function NumberField({
  node,
  label,
  placeholder,
  disabled,
}: {
  node: NumberNode;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const c = useControl(node);
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={c.focusRef}
        className="field__input"
        id={id}
        type="number"
        placeholder={placeholder}
        value={c.value === undefined ? "" : String(c.value)}
        onChange={(e) => c.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        onBlur={c.onBlur}
        disabled={disabled}
        aria-invalid={c.showError && !!c.error}
        aria-describedby={c.showError && c.error ? errorId : undefined}
      />
      {c.showError && c.error && (
        <p className="field__error" id={errorId}>
          {c.error}
        </p>
      )}
      <p className="field__status">
        {c.touched ? "touched" : "untouched"}
        {c.dirty ? " · dirty" : ""}
      </p>
    </div>
  );
}

export function CheckboxField({
  node,
  label,
}: {
  node: BooleanNode;
  label: string;
}) {
  const c = useControl(node);
  return (
    <div className="field field--checkbox">
      <label className="field__label">
        <input
          ref={c.focusRef}
          type="checkbox"
          checked={c.value}
          onChange={fromCheckbox(c.onChange)}
          onBlur={c.onBlur}
        />{" "}
        {label}
      </label>
      {c.showError && c.error && <p className="field__error">{c.error}</p>}
    </div>
  );
}

/** Read-only row for computed values (stage 4+). */
export function ReadonlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <p className="field__static">{value}</p>
    </div>
  );
}

/** The "what the server receives" card. */
export function ResultCard({
  title,
  values,
}: {
  title: string;
  values: unknown;
}) {
  return (
    <aside className="result">
      <h3>{title}</h3>
      <pre>{JSON.stringify(values, null, 2)}</pre>
    </aside>
  );
}

export function SubmitButton({ label }: { label: string }) {
  return (
    <button type="submit" className="button button--primary">
      {label}
    </button>
  );
}
