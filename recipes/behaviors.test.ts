// The ready-made behaviors (recipes/behaviors.ts) and the builder with them.
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
  required,
  maxLength,
  min,
  calculate,
  link,
  visibleWhen,
  disableWhen,
  clearWhen,
  exclusive,
  error,
} from "./index";
import { shape, L, initial, type Values } from "./test/fixtures/profile";

// Compile-time only – never called.
export function typeOnlyChecks() {
  // @ts-expect-error – `name` has no `visible`
  visibleWhen(shape.name, [shape.type], () => true);
  // @ts-expect-error – exclusive fields need `disabled`
  exclusive([shape.name, shape.price]);
  // @ts-expect-error – the calculated value must match the target type
  calculate(shape.slug, [shape.title], (t) => t.length);
  calculate(shape.slug, [shape.title, shape.start], (title, start) => `${title}-${start.toFixed(0)}`);
}

const test = base.extend("store", () => createStore(shape, initial()));

describe("N · Behaviors", () => {
  test("calculate: recalculated on every source change, a user edit included", () => {
    const s = createStore(shape, initial(), {
      behaviors: calculate(shape.slug, [shape.title], (t) => t.toLowerCase().replace(/\s+/g, "-")),
    });
    s.set(shape.title, "Big News", { origin: "user" });
    expect(s.get(shape.slug)).toBe("big-news");
    s.set(shape.slug, "mine", { origin: "user" });
    s.set(shape.title, "Other", { origin: "user" });
    expect(s.get(shape.slug), "the next source change overwrites the edit").toBe("other");
  });

  test("calculate in rows with an enclosing source", () => {
    const f = form(
      object({
        rate: field<number>(),
        rows: array(object({ net: field<number>(), gross: field<number>() })),
      }),
    );
    const s = createStore(
      f,
      { rate: 0.2, rows: [{ net: 10, gross: 0 }] },
      {
        behaviors: calculate(f.rows.item.gross, [f.rows.item.net, f.rate], (net, rate) => net * (1 + rate)),
      },
    );
    const row = s.substore(f.rows).itemAt(0);
    expect(row.get(f.rows.item.gross)).toBe(12);
    s.set(f.rate, 0.5);
    expect(row.get(f.rows.item.gross)).toBe(15);
  });

  test("link: two dates two apart", () => {
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

  test("visibleWhen and disableWhen; a hidden section's rules are guarded on its visibility", () => {
    const behaviors = defineBehaviors(shape, (b) => {
      b.add(visibleWhen(shape.company, [shape.type], (t) => t === "company"));
      b.add(disableWhen(shape.note, [shape.name], (n) => n === ""));
      b.when(
        [shape.company.visible],
        (v) => v,
        (b) => b.add(required(shape.company.vat)),
      );
    });
    const s = createStore(shape, initial(), { behaviors });
    expect(s.get(shape.company.visible)).toBe(false);
    expect(s.get(shape.company.vat.error), "hidden: the rule is absent").toBe(undefined);
    s.set(shape.type, "company");
    expect(s.get(shape.company.vat.error)).toBe("Required");
    s.set(shape.name, "");
    expect(s.get(shape.note.disabled)).toBe(true);
  });

  test("clearWhen: back to the initial value while the test holds", () => {
    const start = { ...initial(), type: "company" as const, company: { vat: "LV1", phone: "123" } };
    const s = createStore(shape, start, {
      behaviors: [
        visibleWhen(shape.company, [shape.type], (t) => t === "company"),
        clearWhen(shape.company.phone, [shape.company.visible], (visible) => !visible),
      ],
    });
    s.set(shape.company.phone, "999");
    s.set(shape.type, "person");
    expect(s.get(shape.company.phone)).toBe("123");
    s.set(shape.company.phone, "555");
    expect(s.get(shape.company.phone), "an edit is reset too while hidden").toBe("123");
    s.set(shape.type, "company");
    expect(s.get(shape.company.phone), "not restored when shown again").toBe("123");
    s.set(shape.company.phone, "777");
    expect(s.get(shape.company.phone), "shown: edits stay").toBe("777");
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

describe("N · exclusive", () => {
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

describe("N · disabled: reasons OR together", () => {
  test("disableWhen and exclusive on one field: disabled while either applies", () => {
    const s = createStore(shape, initial(), {
      behaviors: [
        ...exclusive([shape.price, shape.promo]),
        disableWhen(shape.promo, [shape.type], (t) => t === "company"),
      ],
    });
    expect(s.get(shape.promo.disabled)).toBe(false);
    s.set(shape.price, 10, { origin: "user" });
    expect(s.get(shape.promo.disabled), "exclusive").toBe(true);
    s.set(shape.type, "company");
    expect(s.get(shape.promo.disabled), "both").toBe(true);
    s.set(shape.price, undefined, { origin: "user" });
    expect(s.get(shape.promo.disabled), "disableWhen still applies").toBe(true);
    s.set(shape.type, "person");
    expect(s.get(shape.promo.disabled), "neither").toBe(false);
  });

  test("two disableWhen on one field", () => {
    const s = createStore(shape, initial(), {
      behaviors: [
        disableWhen(shape.note, [shape.name], (n) => n === ""),
        disableWhen(shape.note, [shape.type], (t) => t === "company"),
      ],
    });
    expect(s.get(shape.note.disabled)).toBe(false);
    s.set(shape.type, "company");
    expect(s.get(shape.note.disabled)).toBe(true);
    s.set(shape.name, "");
    s.set(shape.type, "person");
    expect(s.get(shape.note.disabled)).toBe(true);
    s.set(shape.name, "Ann");
    expect(s.get(shape.note.disabled)).toBe(false);
  });
});

describe("N · Builder", () => {
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
    expect(behaviors.length).toBe(3);
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
    expect(behaviors.length, "2 row rules + exclusive: a reason and a rule per field").toBe(6);
    const s = createStore(shape, initial(), { behaviors });
    const row = s.substore(shape.lines).itemAt(1);
    row.set(L.qty, 0);
    row.set(L.sku, "");
    expect(row.get(L.qty.error)).toBe("Must be at least 1");
    expect(s.get(countIn(shape.lines, error))).toBe(2);
  });

  test("builder output works with addBehavior (component rules)", ({ store: s }) => {
    const row = s.substore(shape.lines).itemAt(0);
    const off = row.addBehavior(defineBehaviors(shape, (b) => b.add(maxLength(L.sku, 0, { message: "No SKU here" }))));
    expect(row.get(L.sku.error)).toBe("No SKU here");
    off();
    expect(row.get(L.sku.error)).toBe(undefined);
  });
});

describe("N · link on load", () => {
  test("link: loading a whole new value changes both sides, nothing is written", () => {
    let writes = 0;
    const s = createStore(shape, initial(), {
      behaviors: link(shape.start, shape.end, {
        forward: (v) => (writes++, v + 2),
        backward: (v) => (writes++, v - 2),
      }),
    });
    s.set(shape, { ...initial(), start: 5, end: 100 });
    expect([s.get(shape.start), s.get(shape.end)]).toEqual([5, 100]);
    expect(writes).toBe(0);
  });
});

describe("N · Misuse", () => {
  test("exclusive needs two fields", () => {
    expect(() => exclusive([shape.price])).toThrow("exclusive() needs at least two fields");
  });
});
