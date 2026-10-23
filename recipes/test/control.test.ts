// The control() keys (recipes/control.ts): the default behaviors of edited and dirty.

import { form, object, field, createStore } from "anyshape";
import { describe, expect, test } from "vitest";

import { editedKey, dirtyKey } from "../control";

describe("Control keys", () => {
  test("edited and dirty write the name they are declared under", () => {
    const f = form(object({ a: field<string>().meta({ wasEdited: editedKey, changed: dirtyKey }) }));
    const s = createStore(f, { a: "" });
    s.set(f.a, "x");
    expect(s.get(f.a.wasEdited), "not a user change").toBe(false);
    expect(s.get(f.a.changed)).toBe(true);
    s.set(f.a, "", { origin: "user" });
    expect(s.get(f.a.wasEdited)).toBe(true);
    expect(s.get(f.a.changed), "back to the initial value").toBe(false);
  });
});
