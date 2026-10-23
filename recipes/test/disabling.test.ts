// The `disabled` key and disableWhen (recipes/disabling.ts).
import { createStore } from "anyshape";
import { describe, expect, test } from "vitest";

import { disableWhen, exclusive } from "../index";
import { shape, initial } from "./fixtures/profile";

describe("disabled: reasons OR together", () => {
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
