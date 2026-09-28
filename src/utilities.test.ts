import {
  form, object, array, field, createStore, defineBehavior, defineBehaviors, countIn,
  control, visibility, disableable,
  required, minLength, maxLength, min, max, pattern, email, isEmpty, labelOf,
  calculate, link, visibleWhen, disableWhen, clearWhenHidden, exclusive,
  type InferValue, type BehaviorBuilder,
} from "./index";
import { it, expect } from "vitest";

const shape = form({
  type: field<"person" | "company">(),
  name: field<string>().meta(control(), { label: "Full name" }),
  tags: field<string[]>().meta(control()),
  age: field<number | undefined>().meta(control()),
  email: field<string>().meta(control()),
  zip: field<string>().meta(control()),
  taxId: field<string>().meta(control(), { required: false }),
  personalId: field<string>().meta(control()),
  title: field<string>(),
  slug: field<string>(),
  start: field<number>(),
  end: field<number>(),
  plain: field<string>(),
  company: object({ vat: field<string>().meta(control()), phone: field<string>() }).meta(visibility()),
  price: field<number | undefined>().meta(control(), disableable(), { label: "Price" }),
  discount: field<number | undefined>().meta(control(), disableable(), { label: "Discount" }),
  promo: field<string>().meta(control(), disableable(), { label: "Promo code" }),
  note: field<string>().meta({ hint: "" }, disableable()),
  lines: array(object({ qty: field<number>().meta(control()), sku: field<string>().meta(control()) })),
});
type Values = InferValue<typeof shape>;
const L = shape.lines.item;

function initial(): Values {
  return {
    type: "person", name: "Ann", tags: ["a"], age: 30, email: "ann@x.io", zip: "LV-1010",
    taxId: "", personalId: "", title: "Hello", slug: "hello", start: 1, end: 3, plain: "",
    company: { vat: "", phone: "" }, price: undefined, discount: undefined, promo: "", note: "",
    lines: [{ qty: 1, sku: "A" }, { qty: 2, sku: "B" }],
  };
}

// Compile-time only – never called.
export function typeOnlyChecks() {
  // @ts-expect-error – no validation() feature
  required(shape.plain);
  // @ts-expect-error – min needs a number field
  min(shape.name, 1);
  // @ts-expect-error – minLength needs a string or array field
  minLength(shape.age, 1);
  // @ts-expect-error – email needs a string field
  email(shape.tags);
  // @ts-expect-error – `name` has no visibility()
  visibleWhen(shape.name, [shape.type], () => true);
  // @ts-expect-error – exclusive fields need disableable()
  exclusive([shape.name, shape.price]);
  // @ts-expect-error – the calculated value must match the target type
  calculate(shape.slug, [shape.title], (t) => t.length);
  calculate(shape.slug, [shape.title, shape.start], (title, start) => `${title}-${start.toFixed(0)}`);
}

// ---------------------------------------------------------------------------
// Rules
it("isEmpty and labelOf", () => {
  expect([undefined, null, "", "  ", [], 0, "x", [1], false].map(isEmpty)).toEqual([true, true, true, true, true, false, false, false, false]);
  expect(labelOf(shape.name)).toBe("Full name");
  expect(labelOf(shape.company.vat)).toBe("vat");
  expect(labelOf(L.qty)).toBe("qty");
});

it("required: strings, arrays, numbers; custom message", () => {
  const s = createStore(shape, initial(), {
    behaviors: [required(shape.name), required(shape.tags, { message: "Pick one" }), required(shape.age)],
  });
  s.set(shape.name, "  ");
  expect(s.get(shape.name.error)).toBe("Required");
  s.set(shape.tags, []);
  expect(s.get(shape.tags.error)).toBe("Pick one");
  s.set(shape.age, 0);
  expect(s.get(shape.age.error), "0 is a value").toBe(undefined);
  s.set(shape.age, undefined);
  expect(s.get(shape.age.error)).toBe("Required");
});

it("required follows the `required` meta key (switched by a behavior)", () => {
  const s = createStore(shape, initial(), {
    behaviors: [
      required(shape.taxId),
      defineBehavior({ triggers: [shape.type], writes: [shape.taxId.required], run: (c) => c.set(shape.taxId.required, c.get(shape.type) === "company") }),
    ],
  });
  expect(s.get(shape.taxId.error)).toBe(undefined);
  s.set(shape.type, "company");
  expect(s.get(shape.taxId.required)).toBe(true);
  expect(s.get(shape.taxId.error)).toBe("Required");
  s.set(shape.taxId, "LV123");
  expect(s.get(shape.taxId.error)).toBe(undefined);
});

it("format rules pass on empty values and combine with required", () => {
  const s = createStore(shape, initial(), {
    behaviors: [
      minLength(shape.name, 3), maxLength(shape.name, 5),
      min(shape.age, 18), max(shape.age, 99, { message: (v) => `${v} is too old` }),
      pattern(shape.zip, /^LV-\d{4}$/), email(shape.email), required(shape.email),
      minLength(shape.tags, 2, { message: "Two tags" }),
    ],
  });
  const err = (r: { error: any }) => s.get(r.error);
  s.set(shape.name, "");
  expect(err(shape.name), "empty passes minLength").toBe(undefined);
  s.set(shape.name, "Jo");
  expect(err(shape.name)).toBe("At least 3 characters");
  s.set(shape.name, "Johnny");
  expect(err(shape.name)).toBe("At most 5 characters");
  s.set(shape.age, 12);
  expect(err(shape.age)).toBe("Must be at least 18");
  s.set(shape.age, 120);
  expect(err(shape.age)).toBe("120 is too old");
  s.set(shape.age, undefined);
  expect(err(shape.age)).toBe(undefined);
  s.set(shape.zip, "1010");
  expect(err(shape.zip)).toBe("Invalid format");
  s.set(shape.email, "nope");
  expect(err(shape.email)).toBe("Invalid email address");
  s.set(shape.email, "");
  expect(err(shape.email), "required comes after email but email passes on empty").toBe("Required");
  expect(err(shape.tags)).toBe("Two tags");
});

// ---------------------------------------------------------------------------
// Behaviors
it("calculate, including stopOnUserEdit and reset", () => {
  const s = createStore(shape, initial(), {
    behaviors: calculate(shape.slug, [shape.title], (t) => t.toLowerCase().replace(/\s+/g, "-"), { stopOnUserEdit: true }),
  });
  s.set(shape.title, "Big News", { origin: "user" });
  expect(s.get(shape.slug)).toBe("big-news");
  s.set(shape.slug, "mine", { origin: "user" });
  s.set(shape.title, "Other", { origin: "user" });
  expect(s.get(shape.slug), "stopped after the user edit").toBe("mine");
  s.reset();
  s.set(shape.title, "Again", { origin: "user" });
  expect(s.get(shape.slug), "reset resumes it").toBe("again");
});

it("calculate in rows with an enclosing source", () => {
  const f = form({
    rate: field<number>(),
    rows: array(object({ net: field<number>(), gross: field<number>() })),
  });
  const s = createStore(f, { rate: 0.2, rows: [{ net: 10, gross: 0 }] }, {
    behaviors: calculate(f.rows.item.gross, [f.rows.item.net, f.rate], (net, rate) => net * (1 + rate)),
  });
  const row = s.substore(f.rows).itemAt(0);
  expect(row.get(f.rows.item.gross)).toBe(12);
  s.set(f.rate, 0.5);
  expect(row.get(f.rows.item.gross)).toBe(15);
});

it("link: two dates two apart", () => {
  const s = createStore(shape, initial(), {
    behaviors: link(shape.start, shape.end, { forward: (s) => s + 2, backward: (e) => e - 2 }),
  });
  s.set(shape.start, 10, { origin: "user" });
  expect(s.get(shape.end)).toBe(12);
  s.set(shape.end, 30, { origin: "user" });
  expect(s.get(shape.start)).toBe(28);
  s.batch(() => {
    s.set(shape.start, 1);
    s.set(shape.end, 9);
  });
  expect([s.get(shape.start), s.get(shape.end)], "both changed together: left alone").toEqual([1, 9]);
});

it("visibleWhen and disableWhen; hidden fields skip validation", () => {
  const s = createStore(shape, initial(), {
    behaviors: [
      visibleWhen(shape.company, [shape.type], (t) => t === "company"),
      disableWhen(shape.note, [shape.name], (n) => n === ""),
      required(shape.company.vat),
    ],
  });
  expect(s.get(shape.company.visible)).toBe(false);
  expect(s.get(shape.company.vat.error), "hidden: skipped").toBe(undefined);
  s.set(shape.type, "company");
  expect(s.get(shape.company.vat.error)).toBe("Required");
  s.set(shape.name, "");
  expect(s.get(shape.note.disabled)).toBe(true);
});

it("clearWhenHidden: back to the initial value, or to a given value", () => {
  const start = { ...initial(), type: "company" as const, company: { vat: "LV1", phone: "123" } };
  const s = createStore(shape, start, {
    behaviors: [
      visibleWhen(shape.company, [shape.type], (t) => t === "company"),
      clearWhenHidden(shape.company.vat, { to: "" }),
      clearWhenHidden(shape.company.phone),
    ],
  });
  s.set(shape.company.vat, "LV2");
  s.set(shape.company.phone, "999");
  s.set(shape.type, "person");
  expect(s.get(shape.company.vat)).toBe("");
  expect(s.get(shape.company.phone)).toBe("123");
  s.set(shape.type, "company");
  expect(s.get(shape.company.vat), "not restored when shown again").toBe("");
  expect(() => clearWhenHidden(shape.name)).toThrow(/declares visibility/);
});

// ---------------------------------------------------------------------------
// exclusive
function exclusiveStore(values: Partial<Values> = {}, required = false) {
  return createStore(shape, { ...initial(), ...values }, {
    behaviors: exclusive([shape.price, shape.discount, shape.promo], {
      required,
      isFilled: (v, f) => (f === shape.discount ? (v as number | undefined) !== undefined && (v as number) > 0 : !isEmpty(v)),
    }),
  });
}
const disabledOf = (s: ReturnType<typeof exclusiveStore>) => [shape.price, shape.discount, shape.promo].map((f) => s.get(f.disabled));
const errorsOf = (s: ReturnType<typeof exclusiveStore>) => [shape.price, shape.discount, shape.promo].map((f) => s.get(f.error));

it("exclusive: filling one disables the others", () => {
  const s = exclusiveStore();
  expect(disabledOf(s)).toEqual([false, false, false]);
  s.set(shape.promo, "SAVE", { origin: "user" });
  expect(disabledOf(s)).toEqual([true, true, false]);
  s.set(shape.promo, "", { origin: "user" });
  expect(disabledOf(s)).toEqual([false, false, false]);
  s.set(shape.discount, 0);
  expect(disabledOf(s), "custom isFilled: discount 0 is empty").toEqual([false, false, false]);
});

it("exclusive: several filled (loaded data) → all enabled, errors on the filled ones", () => {
  const s = exclusiveStore({ price: 10, promo: "SAVE" });
  expect(disabledOf(s)).toEqual([false, false, false]);
  expect(errorsOf(s)).toEqual(["Only one of Price, Discount, Promo code can be set", undefined, "Only one of Price, Discount, Promo code can be set"]);
  s.set(shape.promo, "", { origin: "user" });
  expect(errorsOf(s)).toEqual([undefined, undefined, undefined]);
  expect(disabledOf(s)).toEqual([false, true, true]);
});

it("exclusive: required", () => {
  const s = exclusiveStore({}, true);
  expect(errorsOf(s)).toEqual(Array(3).fill("One of Price, Discount, Promo code is required"));
  s.set(shape.price, 5);
  expect(errorsOf(s), "the others are disabled and skipped").toEqual([undefined, undefined, undefined]);
});

it("exclusive: disabled fields are left out of the submit values", async () => {
  const s = exclusiveStore();
  s.set(shape.promo, "SAVE", { origin: "user" });
  const r = await s.validate();
  expect("price" in r.values).toBe(false);
  expect(r.values.promo).toBe("SAVE");
});

// ---------------------------------------------------------------------------
// Builder
it("builder: when / otherwise with rules", () => {
  const behaviors = defineBehaviors(shape, (b) => {
    b.add(required(shape.name));
    b.when([shape.type], (t) => t === "company", (b) => {
      b.add(required(shape.taxId));
    }).otherwise((b) => {
      b.add(required(shape.personalId));
    });
  });
  expect(behaviors.length).toBe(3);
  const s = createStore(shape, initial(), { behaviors });
  expect(s.get(shape.personalId.error)).toBe("Required");
  expect(s.get(shape.taxId.error)).toBe(undefined);
  s.set(shape.type, "company");
  expect(s.get(shape.personalId.error)).toBe(undefined);
  expect(s.get(shape.taxId.error), "taxId: required meta is false").toBe(undefined);
  s.set(shape.taxId.required, true);
  expect(s.get(shape.taxId.error)).toBe("Required");
});

it("builder: opposite branches may write the same target", () => {
  const hint = (text: string) => defineBehavior({ triggers: [shape.name], writes: [shape.note.hint], run: (c) => c.set(shape.note.hint, text) });
  const behaviors = defineBehaviors(shape, (b) => {
    b.when([shape.type], (t) => t === "company", (b) => b.add(hint("company"))).otherwise((b) => b.add(hint("person")));
  });
  const s = createStore(shape, initial(), { behaviors });
  expect(s.get(shape.note.hint)).toBe("person");
  s.set(shape.type, "company");
  expect(s.get(shape.note.hint)).toBe("company");
  expect(() => createStore(shape, initial(), { behaviors: [hint("a"), hint("b")] })).toThrow(/already written/);
  const sameSide = defineBehaviors(shape, (b) => b.when([shape.type], () => true, (b) => b.add(hint("a"), hint("b"))));
  expect(() => createStore(shape, initial(), { behaviors: sameSide })).toThrow(/already written/);
});

it("builder: nested blocks accumulate guards", () => {
  const behaviors = defineBehaviors(shape, (b) => {
    b.when([shape.type], (t) => t === "company", (b) => {
      b.when([shape.name], (n) => n.startsWith("A"), (b) => b.add(required(shape.personalId)));
    });
  });
  const s = createStore(shape, initial(), { behaviors });
  expect(s.get(shape.personalId.error)).toBe(undefined);
  s.set(shape.type, "company");
  expect(s.get(shape.personalId.error)).toBe("Required");
  s.set(shape.name, "Bob");
  expect(s.get(shape.personalId.error)).toBe(undefined);
});

it("builder: each, reusable fragments, flattened arrays", () => {
  const lineRules = (b: BehaviorBuilder, line: typeof L) => b.add(min(line.qty, 1), required(line.sku));
  const behaviors = defineBehaviors(shape, (b) => {
    b.each(shape.lines, lineRules);
    b.add(exclusive([shape.price, shape.promo]));
  });
  expect(behaviors.length).toBe(5);
  const s = createStore(shape, initial(), { behaviors });
  const row = s.substore(shape.lines).itemAt(1);
  row.set(L.qty, 0);
  row.set(L.sku, "");
  expect(row.get(L.qty.error)).toBe("Must be at least 1");
  expect(s.get(countIn(shape.lines, "error"))).toBe(2);
});

it("builder output works with addBehavior (component rules)", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  const off = row.addBehavior(defineBehaviors(shape, (b) => b.add(maxLength(L.sku, 0, { message: "No SKU here" }))));
  expect(row.get(L.sku.error)).toBe("No SKU here");
  off();
  expect(row.get(L.sku.error)).toBe(undefined);
});

