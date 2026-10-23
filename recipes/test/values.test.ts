// The value behaviors (recipes/values.ts): calculate, link, clearWhen.
import { form, object, array, field, createStore } from "anyshape";
import { describe, expect, test } from "vitest";

import { calculate, link, clearWhen, visibleWhen } from "../index";
import { shape, initial } from "./fixtures/profile";

// Compile-time only – never called.
export function typeOnlyChecks() {
  // @ts-expect-error – the calculated value must match the target type
  calculate(shape.slug, [shape.title], (t) => t.length);
  calculate(shape.slug, [shape.title, shape.start], (title, start) => `${title}-${start.toFixed(0)}`);
}

describe("calculate", () => {
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
});

describe("link", () => {
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

describe("clearWhen", () => {
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
