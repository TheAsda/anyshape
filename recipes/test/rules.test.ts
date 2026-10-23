// The ready-made rules (recipes/rules.ts): messages, reference limits, guarded by a builder block.
import {
  form,
  object,
  array,
  field,
  createStore,
  defineBehavior,
  defineBehaviors,
  countIn,
  type BehaviorBuilder,
} from "anyshape";
import { test as base, describe, expect } from "vitest";

import {
  control,
  required,
  minLength,
  maxLength,
  min,
  max,
  pattern,
  email,
  isEmpty,
  calculate,
  exclusive,
  dirtyKey,
  errorKey,
} from "../index";
import * as limits from "./fixtures/limits";
import { shape, L, initial, type Values } from "./fixtures/profile";

// Compile-time only – never called.
export function typeOnlyChecks() {
  // @ts-expect-error – no validation() meta group
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
  // @ts-expect-error – exclusive fields need `disabled`
  exclusive([shape.name, shape.price]);
}

const test = base.extend("store", () => createStore(shape, initial()));

describe("Rules", () => {
  test("isEmpty", () => {
    expect([undefined, null, "", "  ", [], 0, "x", [1], false].map(isEmpty)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
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

  test("a switchable requirement is a guard; `requiredNow` is true while the guard holds", () => {
    const s = createStore(shape, initial(), {
      behaviors: defineBehaviors(shape, (b) => {
        b.when(
          [shape.type],
          (t) => t === "company",
          (b) => b.add(required(shape.taxId)),
        );
      }),
    });
    expect(s.get(shape.taxId.requiredNow)).toBe(false);
    expect(s.get(shape.taxId.error)).toBe(undefined);
    s.set(shape.type, "company");
    expect(s.get(shape.taxId.requiredNow)).toBe(true);
    expect(s.get(shape.taxId.error)).toBe("Required");
    s.set(shape.taxId, "LV123");
    expect(s.get(shape.taxId.requiredNow), "a filled field stays mandatory").toBe(true);
    s.set(shape.type, "person");
    expect(s.get(shape.taxId.requiredNow)).toBe(false);
  });

  test("`requiredNow` stays true until every required() on the node is absent", () => {
    const s = createStore(shape, initial(), {
      behaviors: defineBehaviors(shape, (b) => {
        b.when(
          [shape.type],
          (t) => t === "company",
          (b) => b.add(required(shape.taxId)),
        );
        b.when(
          [shape.personalId],
          (id) => id === "",
          (b) => b.add(required(shape.taxId, { message: "Tax ID or personal ID" })),
        );
      }),
    });
    expect(s.get(shape.taxId.requiredNow), "personal ID empty").toBe(true);
    s.set(shape.type, "company");
    s.set(shape.personalId, "010101-12345");
    expect(s.get(shape.taxId.requiredNow), "company").toBe(true);
    s.set(shape.type, "person");
    expect(s.get(shape.taxId.requiredNow)).toBe(false);
  });

  test("required() goes into a list as one item: b.add and createStore flatten it", () => {
    const listed = createStore(shape, initial(), { behaviors: [required(shape.taxId), required(shape.personalId)] });
    const added = createStore(shape, initial(), {
      behaviors: defineBehaviors(shape, (b) => b.add([required(shape.taxId), required(shape.personalId)])),
    });
    for (const s of [listed, added]) {
      expect(s.get(shape.taxId.error)).toBe("Required");
      expect(s.get(shape.personalId.requiredNow)).toBe(true);
    }
  });

  test("other rules leave `requiredNow` false", () => {
    const s = createStore(shape, initial(), { behaviors: [minLength(shape.name, 3), email(shape.email)] });
    expect(s.get(shape.name.requiredNow)).toBe(false);
    expect(s.get(shape.email.requiredNow)).toBe(false);
  });

  test("format rules pass on empty values and combine with required", () => {
    const s = createStore(shape, initial(), {
      behaviors: [
        minLength(shape.name, 3),
        maxLength(shape.name, 5),
        min(shape.age, 18),
        max(shape.age, 99, { message: (v) => `${v} is too old` }),
        pattern(shape.zip, /^LV-\d{4}$/),
        email(shape.email),
        required(shape.email),
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

describe("Messages", () => {
  test("messages as functions; exclusive's custom messages; path segments in exclusive's default text", () => {
    const s = createStore(shape, initial(), {
      behaviors: [
        min(shape.age, 18, { message: (v) => `${v} is too young` }),
        pattern(shape.zip, /^LV-\d{4}$/, { message: (v) => `"${v}" is not a zip` }),
        ...exclusive([shape.price, shape.discount], {
          required: true,
          message: { tooMany: "Pick one", missing: "Need one" },
        }),
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

describe("Reference limits", () => {
  const { shape, L, initial } = limits;

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
    const s = createStore(shape, initial(), {
      behaviors: minLength(shape.code, shape.code.minCode, { message: "Too short" }),
    });
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
    const f = form(
      object({
        wanted: field<number>().meta(control()),
        rows: array(object({ v: field<string>().meta(control()) }), { create: () => ({ v: "" }) }),
      }),
    );
    const s = createStore(f, { wanted: 2, rows: [] }, { behaviors: max(f.wanted, countIn(f.rows, dirtyKey)) });
    const rows = s.substore(f.rows);
    expect(s.get(f.wanted.error)).toBe("Must be at most 0");
    rows.append(); // a new row's field starts dirty
    const second = rows.append();
    expect(s.get(f.wanted.error)).toBe(undefined);
    rows.remove(second);
    expect(s.get(f.wanted.error), "the message uses the current limit").toBe("Must be at most 1");
  });
});
describe("Guarded recipes", () => {
  test("a builder block guards a rule and a behavior: absent while false, run when it turns true", () => {
    const behaviors = defineBehaviors(shape, (b) =>
      b.when(
        [shape.type],
        (t) => t === "company",
        (b) =>
          b.add(
            required(shape.personalId),
            calculate(shape.slug, [shape.title], (t) => t.toLowerCase()),
          ),
      ),
    );
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
    expect(seen).toEqual([
      [undefined, "hello"],
      [undefined, "hello"],
      ["Required", "one"],
      ["Required", "two"],
      [undefined, "two"],
    ]);
  });
});

function exclusiveStore(values: Partial<Values> = {}, required = false) {
  return createStore(
    shape,
    { ...initial(), ...values },
    {
      behaviors: exclusive([shape.price, shape.discount, shape.promo], { required }),
    },
  );
}
const disabledOf = (s: ReturnType<typeof exclusiveStore>) =>
  [shape.price, shape.discount, shape.promo].map((f) => s.get(f.disabled));
const errorsOf = (s: ReturnType<typeof exclusiveStore>) =>
  [shape.price, shape.discount, shape.promo].map((f) => s.get(f.error));

describe("exclusive", () => {
  test("exclusive: filling one disables the others", () => {
    const s = exclusiveStore();
    expect(disabledOf(s)).toEqual([false, false, false]);
    s.set(shape.promo, "SAVE", { origin: "user" });
    expect(disabledOf(s)).toEqual([true, true, false]);
    s.set(shape.promo, "", { origin: "user" });
    expect(disabledOf(s)).toEqual([false, false, false]);
  });

  test("exclusive: several filled (loaded data) → all enabled, errors on the filled ones", () => {
    const s = exclusiveStore({ price: 10, promo: "SAVE" });
    expect(disabledOf(s)).toEqual([false, false, false]);
    expect(errorsOf(s)).toEqual([
      "Only one of price, discount, promo can be set",
      undefined,
      "Only one of price, discount, promo can be set",
    ]);
    s.set(shape.promo, "", { origin: "user" });
    expect(errorsOf(s)).toEqual([undefined, undefined, undefined]);
    expect(disabledOf(s)).toEqual([false, true, true]);
  });

  test("exclusive: required", () => {
    const s = exclusiveStore({}, true);
    expect(errorsOf(s)).toEqual(Array(3).fill("One of price, discount, promo is required"));
    s.set(shape.price, 5);
    expect(errorsOf(s), "the others are disabled and skipped").toEqual([undefined, undefined, undefined]);
  });
});

describe("Builder", () => {
  test("builder: when with rules", () => {
    const behaviors = defineBehaviors(shape, (b) => {
      b.add(required(shape.name));
      b.when(
        [shape.type],
        (t) => t === "company",
        (b) => b.add(required(shape.taxId)),
      );
      b.when(
        [shape.type],
        (t) => t !== "company",
        (b) => b.add(required(shape.personalId)),
      );
    });
    expect(behaviors.length, "each required(): the rule and its `requiredNow` contribution").toBe(6);
    const s = createStore(shape, initial(), { behaviors });
    expect(s.get(shape.personalId.error)).toBe("Required");
    expect(s.get(shape.taxId.error)).toBe(undefined);
    s.set(shape.type, "company");
    expect(s.get(shape.personalId.error)).toBe(undefined);
    expect(s.get(shape.taxId.error)).toBe("Required");
  });

  test("builder: a target with a value under a condition and another otherwise is one behavior", () => {
    const hint = defineBehavior({
      triggers: [shape.type],
      writes: [shape.note.hint],
      run: (c) => c.set(shape.note.hint, c.get(shape.type) === "company" ? "company" : "person"),
    });
    const s = createStore(shape, initial(), { behaviors: defineBehaviors(shape, (b) => b.add(hint)) });
    expect(s.get(shape.note.hint)).toBe("person");
    s.set(shape.type, "company");
    expect(s.get(shape.note.hint)).toBe("company");

    const fixed = (text: string) =>
      defineBehavior({ triggers: [shape.name], writes: [shape.note.hint], run: (c) => c.set(shape.note.hint, text) });
    const opposite = defineBehaviors(shape, (b) => {
      b.when(
        [shape.type],
        (t) => t === "company",
        (b) => b.add(fixed("company")),
      );
      b.when(
        [shape.type],
        (t) => t !== "company",
        (b) => b.add(fixed("person")),
      );
    });
    expect(
      () => createStore(shape, initial(), { behaviors: opposite }),
      "opposite guards don't exempt two writers",
    ).toThrow(/already written/);
  });

  test("builder: nested blocks accumulate guards", () => {
    const behaviors = defineBehaviors(shape, (b) => {
      b.when(
        [shape.type],
        (t) => t === "company",
        (b) => {
          b.when(
            [shape.name],
            (n) => n.startsWith("A"),
            (b) => b.add(required(shape.personalId)),
          );
        },
      );
    });
    const s = createStore(shape, initial(), { behaviors });
    expect(s.get(shape.personalId.error)).toBe(undefined);
    s.set(shape.type, "company");
    expect(s.get(shape.personalId.error)).toBe("Required");
    s.set(shape.name, "Bob");
    expect(s.get(shape.personalId.error)).toBe(undefined);
  });

  test("builder: each, reusable fragments, flattened arrays", () => {
    const lineRules = (b: BehaviorBuilder, line: typeof L) => b.add(min(line.qty, 1), required(line.sku));
    const behaviors = defineBehaviors(shape, (b) => {
      b.each(shape.lines, lineRules);
      b.add(exclusive([shape.price, shape.promo]));
    });
    expect(
      behaviors.length,
      "min, required (the rule and `requiredNow`) + exclusive: a reason and a rule per field",
    ).toBe(7);
    const s = createStore(shape, initial(), { behaviors });
    const row = s.substore(shape.lines).itemAt(1);
    row.set(L.qty, 0);
    row.set(L.sku, "");
    expect(row.get(L.qty.error)).toBe("Must be at least 1");
    expect(s.get(countIn(shape.lines, errorKey))).toBe(2);
  });

  test("builder output works with addBehavior (component rules)", ({ store: s }) => {
    const row = s.substore(shape.lines).itemAt(0);
    const off = row.addBehavior(defineBehaviors(shape, (b) => b.add(maxLength(L.sku, 0, { message: "No SKU here" }))));
    expect(row.get(L.sku.error)).toBe("No SKU here");
    off();
    expect(row.get(L.sku.error)).toBe(undefined);
  });
});

describe("Misuse", () => {
  test("exclusive needs two fields", () => {
    expect(() => exclusive([shape.price])).toThrow("exclusive() needs at least two fields");
  });
});
