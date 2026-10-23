// The `visible` key and visibleWhen (recipes/visibility.ts).
import { createStore, defineBehaviors } from "anyshape";
import { describe, expect, test } from "vitest";

import { required, visibleWhen, disableWhen } from "../index";
import { shape, initial } from "./fixtures/profile";

// Compile-time only – never called.
export function typeOnlyChecks() {
  // @ts-expect-error – `name` has no `visible`
  visibleWhen(shape.name, [shape.type], () => true);
}

describe("visibleWhen", () => {
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
});
