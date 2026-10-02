// ============================================================
// Step 2: the line-items editor. This is the richest part of the
// demo: per-row async SKU lookups are APP-driven (async work is
// not expressible as a behavior yet), the catalog fill writes
// sibling fields through the row store, and the totals footer
// shows a computed chain plus a cross-field budget rule.
// ============================================================

import { useId, useRef } from "react";
import { countIn } from "form-lib";
import { StoreProvider, useArray, useValue } from "form-lib/react";
import { useControl } from "form-lib/recipes/react";
import { shape, CATALOG, lookingUp } from "./form";
import { NumberField, ReadonlyField } from "./fields";

// The row template: fields inside a StoreProvider row are addressed
// through the template and resolved against that row's store.
const item = shape.order.items.item;

/**
 * The SKU dropdown with its app-side catalog fill. Picking schedules a
 * debounced fill: while it runs the field carries a `lookingUp` tag
 * (a metaKey, so it can be counted across the form), and when the
 * entry arrives the row's name and unit price are written by the app.
 *
 * A SKU already picked in ANOTHER row is absent from this row's
 * options, so uniqueness holds by construction. The row's own value
 * stays listed – the select needs it to render the selection.
 */
function SkuField() {
  const c = useControl(item.sku);
  const rows = useValue(shape.order.items);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const taken = new Set(rows.map((row) => row.sku).filter((sku) => sku !== ""));

  // The store outlives this row, so a lookup in flight is deliberately
  // NOT cancelled on unmount – hiding the step must not freeze the tag
  // or drop the catalog fill.
  const lookup = (value: string) => {
    clearTimeout(timer.current);
    if (value === "") {
      c.store.set(item.sku.lookingUp, undefined);
      return;
    }
    c.store.set(item.sku.lookingUp, "catalog");
    timer.current = setTimeout(() => {
      const entry = CATALOG[value];
      if (entry) {
        c.store.set(item.name, entry.name);
        c.store.set(item.unitPrice, entry.unitPrice);
      }
      c.store.set(item.sku.lookingUp, undefined);
    }, 500);
  };

  return (
    <div className={c.showError ? "field field--error" : "field"}>
      <label className="field__label" htmlFor={id}>
        SKU
      </label>
      <select
        id={id}
        ref={c.focusRef}
        className="field__input"
        value={c.value}
        onBlur={c.onBlur}
        aria-invalid={c.showError || undefined}
        onChange={(e) => {
          c.onChange(e.target.value);
          lookup(e.target.value);
        }}
      >
        <option value="">— pick a SKU —</option>
        {Object.entries(CATALOG)
          .filter(([sku]) => !taken.has(sku) || sku === c.value)
          .map(([sku, entry]) => (
            <option key={sku} value={sku}>
              {sku} — {entry.name}
            </option>
          ))}
      </select>
      {c.showError && (
        <p className="field__error">{c.error}</p>
      )}
      {c.pending && <p className="field__status">Checking…</p>}
    </div>
  );
}

/** The catalog name, filled by the SKU lookup – read-only for the user. */
function ItemName() {
  const name = useValue(item.name);
  return (
    <div className="field">
      <span className="field__label">Item</span>
      <span className="field__static">{name || "—"}</span>
    </div>
  );
}

/** The total, computed and rule-checked; the input is read-only. */
function TotalField() {
  const c = useControl(shape.order.total);
  return (
    <div className={c.showError ? "field field--error" : "field"}>
      <span className="field__label">Total</span>
      <div className="field__affix">
        <input className="field__input" type="number" value={c.value ?? ""} readOnly />
        <span className="field__suffix">€</span>
      </div>
      {c.showError && <p className="field__error">{c.error}</p>}
    </div>
  );
}

export function ItemsSection() {
  const { items, append, remove } = useArray(shape.order.items);
  const lookups = useValue(countIn(shape, lookingUp));
  const budget = useValue(shape.requester.budget);

  return (
    <section className="items">
      <h2>Line items</h2>
      {lookups > 0 && <p className="items__loading">Looking up the catalog…</p>}
      {items.map((row) => (
        <StoreProvider key={row.stableId} store={row}>
          <div className="items__row">
            <SkuField />
            <ItemName />
            <NumberField node={item.qty} label="Qty" min={1} max={99} hint="1–99" />
            <NumberField
              node={item.unitPrice}
              label="Unit price"
              suffix="€"
              min={0.01}
              max={9999}
              hint="€0.01–€9,999"
            />
            <ReadonlyField node={item.lineTotal} label="Line total" suffix="€" />
            <button type="button" className="items__remove" onClick={() => remove(row)}>
              Remove
            </button>
          </div>
        </StoreProvider>
      ))}
      <button type="button" className="items__add" onClick={() => append()}>
        Add item
      </button>
      <footer className="items__totals">
        <ReadonlyField node={shape.order.subtotal} label="Subtotal" suffix="€" />
        <ReadonlyField node={shape.order.tax} label="VAT (19%)" suffix="€" />
        <TotalField />
        <p className="items__budget">
          Department budget:{" "}
          {budget !== undefined ? `€${budget.toLocaleString("en-US")} remaining` : "not looked up yet"}
        </p>
      </footer>
    </section>
  );
}
