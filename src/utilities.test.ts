// Run: npx tsx src/utilities.test.ts   (type assertions: npx tsc)
import {
  form, object, array, field, createStore, defineBehavior, defineBehaviors, countIn,
  control, visibility, disableable,
  required, minLength, maxLength, min, max, pattern, email, isEmpty, labelOf,
  calculate, link, visibleWhen, disableWhen, clearWhenHidden, exclusive,
  type InferValue, type BehaviorBuilder,
} from "./index";
import { test, testAsync, runAsync, eq, deepEq, throws } from "./test/harness";

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
test("isEmpty and labelOf", () => {
  deepEq([undefined, null, "", "  ", [], 0, "x", [1], false].map(isEmpty), [true, true, true, true, true, false, false, false, false]);
  eq(labelOf(shape.name), "Full name");
  eq(labelOf(shape.company.vat), "vat");
  eq(labelOf(L.qty), "qty");
});

test("required: strings, arrays, numbers; custom message", () => {
  const s = createStore(shape, initial(), {
    behaviors: [required(shape.name), required(shape.tags, { message: "Pick one" }), required(shape.age)],
  });
  s.set(shape.name, "  ");
  eq(s.get(shape.name.error), "Required");
  s.set(shape.tags, []);
  eq(s.get(shape.tags.error), "Pick one");
  s.set(shape.age, 0);
  eq(s.get(shape.age.error), undefined, "0 is a value");
  s.set(shape.age, undefined);
  eq(s.get(shape.age.error), "Required");
});

test("required follows the `required` meta key (switched by a behavior)", () => {
  const s = createStore(shape, initial(), {
    behaviors: [
      required(shape.taxId),
      defineBehavior({ triggers: [shape.type], writes: [shape.taxId.required], run: (c) => c.set(shape.taxId.required, c.get(shape.type) === "company") }),
    ],
  });
  eq(s.get(shape.taxId.error), undefined);
  s.set(shape.type, "company");
  eq(s.get(shape.taxId.required), true);
  eq(s.get(shape.taxId.error), "Required");
  s.set(shape.taxId, "LV123");
  eq(s.get(shape.taxId.error), undefined);
});

test("format rules pass on empty values and combine with required", () => {
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
  eq(err(shape.name), undefined, "empty passes minLength");
  s.set(shape.name, "Jo");
  eq(err(shape.name), "At least 3 characters");
  s.set(shape.name, "Johnny");
  eq(err(shape.name), "At most 5 characters");
  s.set(shape.age, 12);
  eq(err(shape.age), "Must be at least 18");
  s.set(shape.age, 120);
  eq(err(shape.age), "120 is too old");
  s.set(shape.age, undefined);
  eq(err(shape.age), undefined);
  s.set(shape.zip, "1010");
  eq(err(shape.zip), "Invalid format");
  s.set(shape.email, "nope");
  eq(err(shape.email), "Invalid email address");
  s.set(shape.email, "");
  eq(err(shape.email), "Required", "required comes after email but email passes on empty");
  eq(err(shape.tags), "Two tags");
});

// ---------------------------------------------------------------------------
// Behaviors
test("calculate, including stopOnUserEdit and reset", () => {
  const s = createStore(shape, initial(), {
    behaviors: calculate(shape.slug, [shape.title], (t) => t.toLowerCase().replace(/\s+/g, "-"), { stopOnUserEdit: true }),
  });
  s.set(shape.title, "Big News", { origin: "user" });
  eq(s.get(shape.slug), "big-news");
  s.set(shape.slug, "mine", { origin: "user" });
  s.set(shape.title, "Other", { origin: "user" });
  eq(s.get(shape.slug), "mine", "stopped after the user edit");
  s.reset();
  s.set(shape.title, "Again", { origin: "user" });
  eq(s.get(shape.slug), "again", "reset resumes it");
});

test("calculate in rows with an enclosing source", () => {
  const f = form({
    rate: field<number>(),
    rows: array(object({ net: field<number>(), gross: field<number>() })),
  });
  const s = createStore(f, { rate: 0.2, rows: [{ net: 10, gross: 0 }] }, {
    behaviors: calculate(f.rows.item.gross, [f.rows.item.net, f.rate], (net, rate) => net * (1 + rate)),
  });
  const row = s.substore(f.rows).itemAt(0);
  eq(row.get(f.rows.item.gross), 12);
  s.set(f.rate, 0.5);
  eq(row.get(f.rows.item.gross), 15);
});

test("link: two dates two apart", () => {
  const s = createStore(shape, initial(), {
    behaviors: link(shape.start, shape.end, { forward: (s) => s + 2, backward: (e) => e - 2 }),
  });
  s.set(shape.start, 10, { origin: "user" });
  eq(s.get(shape.end), 12);
  s.set(shape.end, 30, { origin: "user" });
  eq(s.get(shape.start), 28);
  s.batch(() => {
    s.set(shape.start, 1);
    s.set(shape.end, 9);
  });
  deepEq([s.get(shape.start), s.get(shape.end)], [1, 9], "both changed together: left alone");
});

test("visibleWhen and disableWhen; hidden fields skip validation", () => {
  const s = createStore(shape, initial(), {
    behaviors: [
      visibleWhen(shape.company, [shape.type], (t) => t === "company"),
      disableWhen(shape.note, [shape.name], (n) => n === ""),
      required(shape.company.vat),
    ],
  });
  eq(s.get(shape.company.visible), false);
  eq(s.get(shape.company.vat.error), undefined, "hidden: skipped");
  s.set(shape.type, "company");
  eq(s.get(shape.company.vat.error), "Required");
  s.set(shape.name, "");
  eq(s.get(shape.note.disabled), true);
});

test("clearWhenHidden: back to the initial value, or to a given value", () => {
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
  eq(s.get(shape.company.vat), "");
  eq(s.get(shape.company.phone), "123");
  s.set(shape.type, "company");
  eq(s.get(shape.company.vat), "", "not restored when shown again");
  throws(() => clearWhenHidden(shape.name), /declares visibility/);
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

test("exclusive: filling one disables the others", () => {
  const s = exclusiveStore();
  deepEq(disabledOf(s), [false, false, false]);
  s.set(shape.promo, "SAVE", { origin: "user" });
  deepEq(disabledOf(s), [true, true, false]);
  s.set(shape.promo, "", { origin: "user" });
  deepEq(disabledOf(s), [false, false, false]);
  s.set(shape.discount, 0);
  deepEq(disabledOf(s), [false, false, false], "custom isFilled: discount 0 is empty");
});

test("exclusive: several filled (loaded data) → all enabled, errors on the filled ones", () => {
  const s = exclusiveStore({ price: 10, promo: "SAVE" });
  deepEq(disabledOf(s), [false, false, false]);
  deepEq(errorsOf(s), ["Only one of Price, Discount, Promo code can be set", undefined, "Only one of Price, Discount, Promo code can be set"]);
  s.set(shape.promo, "", { origin: "user" });
  deepEq(errorsOf(s), [undefined, undefined, undefined]);
  deepEq(disabledOf(s), [false, true, true]);
});

test("exclusive: required", () => {
  const s = exclusiveStore({}, true);
  deepEq(errorsOf(s), Array(3).fill("One of Price, Discount, Promo code is required"));
  s.set(shape.price, 5);
  deepEq(errorsOf(s), [undefined, undefined, undefined], "the others are disabled and skipped");
});

testAsync("exclusive: disabled fields are left out of the submit values", async () => {
  const s = exclusiveStore();
  s.set(shape.promo, "SAVE", { origin: "user" });
  const r = await s.validate();
  eq("price" in r.values, false);
  eq(r.values.promo, "SAVE");
});

// ---------------------------------------------------------------------------
// Builder
test("builder: when / otherwise with rules", () => {
  const behaviors = defineBehaviors(shape, (b) => {
    b.add(required(shape.name));
    b.when([shape.type], (t) => t === "company", (b) => {
      b.add(required(shape.taxId));
    }).otherwise((b) => {
      b.add(required(shape.personalId));
    });
  });
  eq(behaviors.length, 3);
  const s = createStore(shape, initial(), { behaviors });
  eq(s.get(shape.personalId.error), "Required");
  eq(s.get(shape.taxId.error), undefined);
  s.set(shape.type, "company");
  eq(s.get(shape.personalId.error), undefined);
  eq(s.get(shape.taxId.error), undefined, "taxId: required meta is false");
  s.set(shape.taxId.required, true);
  eq(s.get(shape.taxId.error), "Required");
});

test("builder: opposite branches may write the same target", () => {
  const hint = (text: string) => defineBehavior({ triggers: [shape.name], writes: [shape.note.hint], run: (c) => c.set(shape.note.hint, text) });
  const behaviors = defineBehaviors(shape, (b) => {
    b.when([shape.type], (t) => t === "company", (b) => b.add(hint("company"))).otherwise((b) => b.add(hint("person")));
  });
  const s = createStore(shape, initial(), { behaviors });
  eq(s.get(shape.note.hint), "person");
  s.set(shape.type, "company");
  eq(s.get(shape.note.hint), "company");
  throws(() => createStore(shape, initial(), { behaviors: [hint("a"), hint("b")] }), /already written/);
  const sameSide = defineBehaviors(shape, (b) => b.when([shape.type], () => true, (b) => b.add(hint("a"), hint("b"))));
  throws(() => createStore(shape, initial(), { behaviors: sameSide }), /already written/);
});

test("builder: nested blocks accumulate guards", () => {
  const behaviors = defineBehaviors(shape, (b) => {
    b.when([shape.type], (t) => t === "company", (b) => {
      b.when([shape.name], (n) => n.startsWith("A"), (b) => b.add(required(shape.personalId)));
    });
  });
  const s = createStore(shape, initial(), { behaviors });
  eq(s.get(shape.personalId.error), undefined);
  s.set(shape.type, "company");
  eq(s.get(shape.personalId.error), "Required");
  s.set(shape.name, "Bob");
  eq(s.get(shape.personalId.error), undefined);
});

test("builder: each, reusable fragments, flattened arrays", () => {
  const lineRules = (b: BehaviorBuilder, line: typeof L) => b.add(min(line.qty, 1), required(line.sku));
  const behaviors = defineBehaviors(shape, (b) => {
    b.each(shape.lines, lineRules);
    b.add(exclusive([shape.price, shape.promo]));
  });
  eq(behaviors.length, 5);
  const s = createStore(shape, initial(), { behaviors });
  const row = s.substore(shape.lines).itemAt(1);
  row.set(L.qty, 0);
  row.set(L.sku, "");
  eq(row.get(L.qty.error), "Must be at least 1");
  eq(s.get(countIn(shape.lines, "error")), 2);
});

test("builder output works with addBehavior (component rules)", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  const off = row.addBehavior(defineBehaviors(shape, (b) => b.add(maxLength(L.sku, 0, { message: "No SKU here" }))));
  eq(row.get(L.sku.error), "No SKU here");
  off();
  eq(row.get(L.sku.error), undefined);
});

runAsync("utilities.test.ts");
