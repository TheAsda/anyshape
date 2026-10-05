// ============================================================
// The form definition: shape (fields + features) and behaviors
// (validation rules and reactive logic), plus the fake backend
// the demo talks to. Imported by the React components below –
// the library itself is framework-agnostic.
// ============================================================

import {
  form,
  object,
  field,
  array,
  defineBehaviors,
  defineBehavior,
  metaKey,
  type InferValue,
  type FieldNode,
} from 'form-lib';
import {
  control,
  submission,
  visible,
  rule,
  asyncRule,
  required,
  minLength,
  email,
  min,
  max,
  calculate,
  visibleWhen,
  clearWhen,
  isEmpty,
} from '../../../recipes';

// A per-field "lookup in flight" tag. metaKey (not a plain value)
// so the key is countable: countIn(shape, lookingUp) counts every
// field currently carrying a tag, across the whole form.
export const lookingUp = metaKey<string | undefined>(undefined).aggregate(
  (v) => v !== undefined,
);

// ------------------------------------------------------------
// Shape
// ------------------------------------------------------------
// control()    = validation + touched + dirty + a focus target:
//                everything an input needs.
// { visible }  = adds `visible` to the group itself; its fields
//                don't carry it. Hidden groups are still validated:
//                their rules are guarded on it (b.when below).
// submission() = adds `submitting`: the node can be submitted with
//                handleSubmit(store, fn).
//
// The wizard steps are sibling objects that each declare submission();
// the App shows one at a time and Continue submits that step's store.
// Steps are not hidden when another step shows: the final submit
// still checks (and the server still rejects) step-1 fields. The
// nested `address` and `approval` groups DO use visibility +
// clearWhen, with their rules guarded on it – that contrast is the
// point of the demo.
export const shape = form(
  object({
    /** Which step is shown: 0 = requester, 1 = items, 2 = logistics. */
    step: field<number>(),
    requester: object({
      title: field<string>().meta(control()),
      email: field<string>().meta(control()),
    department: field<string>().meta(control(), { lookingUp }),
    /** Remaining budget of the department – filled by the app-side lookup. */
    budget: field<number | undefined>(),
    }).meta(submission()),
    order: object({
      items: array(
        object({
          sku: field<string>().meta(control(), { lookingUp }),
          /** Filled from the catalog by the app-side lookup – read-only for the user. */
          name: field<string>(),
          qty: field<number | undefined>().meta(control()),
          unitPrice: field<number | undefined>().meta(control()),
          /** Computed (calculate below); never touched by the user. */
          lineTotal: field<number | undefined>(),
        }),
        // Factory for new rows, so append() needs no arguments.
        {
          create: () => ({
            sku: '',
            name: '',
            qty: 1,
            unitPrice: undefined,
            lineTotal: undefined,
          }),
        },
      ),
      subtotal: field<number | undefined>(),
      tax: field<number | undefined>(),
      /** Carries control() because the budget rule targets it. */
      total: field<number | undefined>().meta(control()),
    }).meta(submission()),
    logistics: object({
      orderedOn: field<string>().meta(control()),
      neededBy: field<string>().meta(control()),
      /** Default true; switching off reveals (and later clears) the address. */
      shipToOffice: field<boolean>().meta(control()),
      address: object({
        street: field<string>().meta(control()),
        city: field<string>().meta(control()),
        zip: field<string>().meta(control()),
      }).meta({ visible }),
      /** Only total order values above €10,000 need an approval. */
      approval: object({
        approver: field<string>().meta(control()),
        justification: field<string>().meta(control()),
      }).meta({ visible }),
    }).meta(submission()),
  }).meta(submission()),
);

export type Values = InferValue<typeof shape>;

export const initialValues: Values = {
  step: 0,
  requester: { title: '', email: '', department: '', budget: undefined },
  order: { items: [], subtotal: undefined, tax: undefined, total: undefined },
  logistics: {
    orderedOn: '',
    neededBy: '',
    shipToOffice: true,
    address: { street: '', city: '', zip: '' },
    approval: { approver: '', justification: '' },
  },
};

// ------------------------------------------------------------
// Fake backend
// ------------------------------------------------------------
export const CATALOG: Record<string, { name: string; unitPrice: number }> = {
  'SKU-1001': { name: 'Mechanical keyboard', unitPrice: 129.99 },
  'SKU-1002': { name: '4K monitor', unitPrice: 349.0 },
  'SKU-1003': { name: 'USB-C dock', unitPrice: 89.5 },
  // In the catalog, but the server rejects it at save time:
  // async validation and server-side rules are different things.
  'SKU-9901': { name: 'Osmo action cam', unitPrice: 389.0 },
};

const EMPLOYEES: Record<string, string> = {
  'ada@example.com': 'Ada Lovelace',
  'dev@form-lib.dev': 'Dev Ovan',
};

const DEPARTMENTS: Record<string, { budget: number; frozen?: boolean }> = {
  'DEP-1100': { budget: 10_000 },
  'DEP-2201': { budget: 25_000, frozen: true },
  'DEP-3302': { budget: 50_000 },
};

/** Pretend employee-directory round-trip for the async rule. */
async function checkEmployee(value: string): Promise<string | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (value.toLowerCase() === 'dev@form-lib.dev')
    return 'This employee already has an open requisition';
  if (!EMPLOYEES[value.toLowerCase()]) return 'Unknown employee – is the address correct?';
  return undefined;
}

/** Pretend catalog round-trip for the async rule. */
async function checkSku(value: string): Promise<string | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return CATALOG[value] ? undefined : 'Unknown SKU – the catalog lists SKU-1001…1003';
}

/** Department lookup; drives the app-side budget fill (see App.tsx). */
export async function lookupDepartment(
  code: string,
): Promise<{ budget: number; frozen: boolean } | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  const dep = DEPARTMENTS[code.toUpperCase()];
  return dep && { budget: dep.budget, frozen: dep.frozen === true };
}

/** A server-side rejection: field errors addressed by path, as the server sees them. */
export class ServerRejection extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super('The server rejected this requisition.');
  }
}

/** What handleSubmit hands to the save callback: the form's value as it is. */
export type Submitted = Values;

/** Pretend to talk to a server. The sample data is rejected by path. */
export async function save(values: Submitted): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const errors: Record<string, string> = {};
  if (values.requester?.department === 'DEP-2201')
    errors['requester.department'] =
      'DEP-2201 is being reorganized – its budget is frozen, pick another department';
  values.order?.items.forEach((item, i) => {
    if (item.sku === 'SKU-9901')
      errors[`order.items[${i}].sku`] = `SKU-9901 was discontinued – replace row ${i + 1}`;
  });
  if (Object.keys(errors).length > 0) throw new ServerRejection(errors);
  console.log('Saved:', values);
}

// ------------------------------------------------------------
// Behaviors
// ------------------------------------------------------------
const DAY_MS = 86_400_000;

/** ISO date (YYYY-MM-DD) shifted by `days`. */
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** €-style rounding to two decimals. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A reusable two-date pair: picking one end while the other is empty
 * fills it `shiftDays` away (user picks only; loading or resetting
 * never autofills), and the end must be after the start.
 */
const twoDates = (start: FieldNode<string>, end: FieldNode<string>, shiftDays: number) =>
  defineBehavior({
    name: `twoDates(${start.path}-${end.path})`,
    triggers: [start, end],
    writes: [start, end],
    origins: ['user'],
    runOn: { init: false },
    run: (ctx) => {
      const from = ctx.get(start);
      const to = ctx.get(end);
      if (ctx.changed(start) && from !== '' && to === '')
        ctx.set(end, addDays(from, shiftDays));
      else if (ctx.changed(end) && to !== '' && from === '')
        ctx.set(start, addDays(to, -shiftDays));
    },
  });

export const behaviors = defineBehaviors(shape, (b, s) => {
  // ---- Step 1: requester ----
  b.add(required(s.requester.title), minLength(s.requester.title, 2));
  // Sync rules pass first; only then does the async rule run (debounced).
  b.add(
    required(s.requester.email),
    email(s.requester.email),
    asyncRule(s.requester.email, checkEmployee, { debounce: 300 }),
  );
  b.add(required(s.requester.department));
  b.add(
    rule(
      s.requester.department,
      (dep) =>
        dep !== '' && !/^DEP-\d{4}$/.test(dep)
          ? 'Department codes look like DEP-1234'
          : undefined,
    ),
  );

  // ---- Step 2: line items ----
  b.each(s.order.items, (b, item) => {
    // A row is either fully empty, or every part is required.
    b.when(
      [item.sku],
      (sku) => !isEmpty(sku),
      (b) => {
        b.add(required(item.qty), required(item.unitPrice));
      },
    );
    b.when(
      [item.qty],
      (qty) => qty !== undefined,
      (b) => {
        b.add(required(item.sku));
      },
    );
    b.add(min(item.qty, 1), max(item.qty, 99));
    b.add(min(item.unitPrice, 0.01), max(item.unitPrice, 9999));
    // Sync rules pass first; only then does the async rule run (debounced).
    b.add(asyncRule(item.sku, checkSku, { debounce: 400 }));
    b.add(
      calculate(item.lineTotal, [item.qty, item.unitPrice], (qty, price) =>
        qty !== undefined && price !== undefined ? round2(qty * price) : undefined,
      ),
    );
  });
  // An array node as a source re-fires on any nested row edit,
  // so the totals track appends, removes and in-row changes alike.
  b.add(
    calculate(s.order.subtotal, [s.order.items], (items) =>
      items.length > 0 ? round2(items.reduce((sum, it) => sum + (it.lineTotal ?? 0), 0)) : undefined,
    ),
    calculate(s.order.tax, [s.order.subtotal], (subtotal) =>
      subtotal !== undefined ? round2(subtotal * 0.19) : undefined,
    ),
    calculate(s.order.total, [s.order.subtotal, s.order.tax], (subtotal, tax) =>
      subtotal !== undefined && tax !== undefined ? round2(subtotal + tax) : undefined,
    ),
  );
  // The budget arrives asynchronously (app-side lookup), so the rule
  // must re-run when it lands – that's what triggers is for.
  b.add(
    rule(
      s.order.total,
      (total, ctx) => {
        const budget = ctx.get(s.requester.budget);
        return budget !== undefined && total !== undefined && total > budget
          ? `Total exceeds the remaining budget of €${budget.toLocaleString('en-US')}`
          : undefined;
      },
      { triggers: [s.requester.budget] },
    ),
  );

  // ---- Step 3: logistics ----
  b.add(twoDates(s.logistics.orderedOn, s.logistics.neededBy, 14));
  b.add(
    rule(
      s.logistics.neededBy,
      (neededBy, ctx) => {
        const orderedOn = ctx.get(s.logistics.orderedOn);
        return neededBy !== '' && orderedOn !== '' && neededBy <= orderedOn
          ? 'Needed-by must be after the order date'
          : undefined;
      },
      { triggers: [s.logistics.orderedOn] },
    ),
  );
  // Shipping somewhere else reveals the address; hiding it clears
  // the fields inside, and its rules apply only while it is shown.
  b.add(visibleWhen(s.logistics.address, [s.logistics.shipToOffice], (v) => !v));
  b.add(clearWhen(s.logistics.address, [s.logistics.address.visible], (visible) => !visible));
  b.when([s.logistics.address.visible], (v) => v, (b) => {
    b.add(
      required(s.logistics.address.street),
      required(s.logistics.address.city),
      required(s.logistics.address.zip),
    );
  });
  // Big orders need an approval; small ones don't even see it.
  b.add(
    visibleWhen(s.logistics.approval, [s.order.total], (total) => total !== undefined && total > 10_000),
  );
  b.add(clearWhen(s.logistics.approval, [s.logistics.approval.visible], (visible) => !visible));
  b.when([s.logistics.approval.visible], (v) => v, (b) => {
    b.add(required(s.logistics.approval.approver), required(s.logistics.approval.justification));
  });
});
