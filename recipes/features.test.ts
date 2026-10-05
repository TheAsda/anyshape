// Features: the default behaviors of touched and dirty.

import { form, object, field, createStore } from "anyshape";
import { describe, expect, test } from "vitest";

import { touched, dirty } from "./features";

describe("Features", () => {
  test("touched and dirty write the name they are declared under", () => {
    const f = form(object({ a: field<string>().meta({ wasEdited: touched, changed: dirty }) }));
    const s = createStore(f, { a: "" });
    s.set(f.a, "x");
    expect(s.get(f.a.wasEdited), "not a user change").toBe(false);
    expect(s.get(f.a.changed)).toBe(true);
    s.set(f.a, "", { origin: "user" });
    expect(s.get(f.a.wasEdited)).toBe(true);
    expect(s.get(f.a.changed), "back to the initial value").toBe(false);
  });
});
