// The ready-made rules (recipes/rules.ts): messages, reference limits, the `when` option.
import {
  form, object, array, field, createStore, defineBehavior, defineBehaviors, countIn, when,
  type AnyBehavior,
} from "form-lib";
import {
  control, required, minLength, maxLength, min, max, pattern, email, isEmpty, labelOf, calculate,
  exclusive,
} from "./index";
import { test as base, describe, expect } from "vitest";
import { shape, L, initial } from "./test/fixtures/profile";
import * as limits from "./test/fixtures/limits";

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
  // @ts-expect-error – email needs a string field
  email(shape.age);
  // @ts-expect-error – pattern needs a string field
  pattern(shape.tags, /x/);
  // @ts-expect-error – max needs a number field
  max(shape.name, 1);
  // @ts-expect-error – maxLength needs a string or array field
  maxLength(shape.age, 1);
  minLength(shape.tags, 1); // arrays have a length
  maxLength(shape.name, 5);
  min(shape.age, 0); // number | undefined is numeric
}

const test = base
  .extend("store", () => createStore(shape, initial()));

describe("N · Rules", () => {
  test("isEmpty and labelOf", () => {
    expect([undefined, null, "", "  ", [], 0, "x", [1], false].map(isEmpty)).toEqual([true, true, true, true, true, false, false, false, false]);
    expect(labelOf(shape.name), "the `label` key is not read").toBe("name");
    expect(labelOf(shape.company.vat)).toBe("vat");
    expect(labelOf(L.qty)).toBe("qty");
  });

  test("required: strings, arrays, numbers; custom message", () => {
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

  test("a switchable requirement is a guard on the `required` key", () => {
    const s = createStore(shape, initial(), {
      behaviors: defineBehaviors(shape, (b) => {
        b.when([shape.taxId.required], (r) => r, (b) => b.add(required(shape.taxId)));
        b.add(defineBehavior({ triggers: [shape.type], writes: [shape.taxId.required], run: (c) => c.set(shape.taxId.required, c.get(shape.type) === "company") }));
      }),
    });
    expect(s.get(shape.taxId.error)).toBe(undefined);
    s.set(shape.type, "company");
    expect(s.get(shape.taxId.required)).toBe(true);
    expect(s.get(shape.taxId.error)).toBe("Required");
    s.set(shape.taxId, "LV123");
    expect(s.get(shape.taxId.error)).toBe(undefined);
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
});

describe("N · Messages", () => {
  test("messages as functions; exclusive's custom messages; path segments in exclusive's default text", () => {
    const s = createStore(shape, initial(), {
      behaviors: [
        min(shape.age, 18, { message: (v) => `${v} is too young` }),
        pattern(shape.zip, /^LV-\d{4}$/, { message: (v) => `"${v}" is not a zip` }),
        ...exclusive([shape.price, shape.discount], { required: true, message: { tooMany: "Pick one", missing: "Need one" } }),
      ],
    });
    s.set(shape.age, 12);
    expect(s.get(shape.age.error)).toBe("12 is too young");
    s.set(shape.zip, "nope");
    expect(s.get(shape.zip.error)).toBe('"nope" is not a zip');
    expect(s.get(shape.price.error)).toBe("Need one");
    s.batch(() => {
      s.set(shape.price, 1);
      s.set(shape.discount, 2);
    });
    expect(s.get(shape.discount.error)).toBe("Pick one");

    const d = createStore(shape, initial(), { behaviors: exclusive([shape.price, shape.promo], { required: true }) });
    expect(d.get(shape.price.error), "last path segments, not `label`").toBe("One of price, promo is required");
  });
});

describe("N · Reference limits", () => {
  const { shape, L, initial, targets } = limits;

  // ---------------------------------------------------------------------------
  // Reference limits
  test("max with a reference limit: follows the reference, undefined passes", () => {
    const s = createStore(shape, initial(), { behaviors: max(L.qty, L.qty.maxQty) });
    const row = s.substore(shape.lines).itemAt(1);
    expect(row.get(L.qty.error), "no limit yet").toBe(undefined);
    row.set(L.qty.maxQty, 3);
    expect(row.get(L.qty.error), "re-validated when the limit arrives").toBe("Must be at most 3");
    row.set(L.qty.maxQty, 10);
    expect(row.get(L.qty.error)).toBe(undefined);
    s.reset();
    expect(row.get(L.qty.maxQty), "kept by reset").toBe(10);
    row.set(L.qty, 11, { origin: "user" });
    expect(row.get(L.qty.error)).toBe("Must be at most 10");
  });

  test("minLength with a reference from an enclosing scope-less key", () => {
    const s = createStore(shape, initial(), { behaviors: minLength(shape.code, shape.code.minCode, { message: "Too short" }) });
    expect(s.get(shape.code.error)).toBe(undefined);
    s.set(shape.code.minCode, 3);
    expect(s.get(shape.code.error)).toBe("Too short");
  });

  test("number limits keep working", () => {
    const s = createStore(shape, initial(), { behaviors: max(L.qty, 4) });
    expect(s.substore(shape.lines).itemAt(1).get(L.qty.error)).toBe("Must be at most 4");
  });

  // ---------------------------------------------------------------------------
  // A count as a rule limit
  test("a count as a rule limit: re-checked whenever the count changes", () => {
    const f = form({
      wanted: field<number>().meta(control()),
      rows: array(object({ v: field<string>().meta(control()) }), { create: () => ({ v: "" }) }),
    });
    const s = createStore(f, { wanted: 2, rows: [] }, { behaviors: max(f.wanted, countIn(f.rows, "dirty")) });
    const rows = s.substore(f.rows);
    expect(s.get(f.wanted.error)).toBe("Must be at most 0");
    rows.append(); // a new row's field starts dirty
    const second = rows.append();
    expect(s.get(f.wanted.error)).toBe(undefined);
    rows.remove(second);
    expect(s.get(f.wanted.error), "the message uses the current limit").toBe("Must be at most 1");
  });
});
describe("N · The `when` option", () => {
  test("the `when` option on rules and behaviors works like a builder block", () => {
    const isCompany = when([shape.type], (t) => t === "company");
    const viaOption: AnyBehavior[] = [
      required(shape.personalId, { when: isCompany }),
      calculate(shape.slug, [shape.title], (t) => t.toLowerCase(), { when: isCompany }),
    ];
    const viaBlock = defineBehaviors(shape, (b) =>
      b.when([shape.type], (t) => t === "company", (b) =>
        b.add(required(shape.personalId), calculate(shape.slug, [shape.title], (t) => t.toLowerCase()))
      )
    );
    const trace = (behaviors: readonly AnyBehavior[]) => {
      const s = createStore(shape, initial(), { behaviors });
      const seen: unknown[] = [];
      const snap = () => seen.push([s.get(shape.personalId.error), s.get(shape.slug)]);
      snap();
      s.set(shape.title, "ONE");
      snap();
      s.set(shape.type, "company");
      snap();
      s.set(shape.title, "TWO");
      snap();
      s.set(shape.type, "person");
      snap();
      return seen;
    };
    const expected = [
      [undefined, "hello"],
      [undefined, "hello"],
      ["Required", "one"],
      ["Required", "two"],
      [undefined, "two"],
    ];
    expect(trace(viaOption)).toEqual(expected);
    expect(trace(viaBlock)).toEqual(expected);
  });
});

