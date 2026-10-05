// Focus recipe: registerFocus(store, node, target), focus(store, node), focusFirst(entries, compare).

import { form, object, field, createStore } from "form-lib";
import { control } from "./features";
import { rule, validate } from "./validation";
import { test as base, describe, expect } from "vitest";
import { focus, focusFirst, registerFocus, type FocusTarget } from "./focus";
import * as limits from "./test/fixtures/limits";

describe("Focus", () => {
  const { shape, L, initial, targets } = limits;
  const test = base.extend("store", () => createStore(shape, initial()));

  test("focusFirst: shape order by default, compare to reorder", ({ store: s }) => {
    const focused: string[] = [];
    const compare = targets(s, { name: 2, code: 1 }, focused);
    const entries = [
      { path: "name", ref: shape.name.error, store: s },
      { path: "code", ref: shape.code.error, store: s },
    ];
    expect(focusFirst(entries)?.path).toBe("name");
    expect(focusFirst(entries, compare)?.path).toBe("code");
    expect(focused).toEqual(["name", "code"]);
  });

  test("focusFirst skips entries without a focus target", ({ store: s }) => {
    const focused: string[] = [];
    const target = (id: string): FocusTarget => ({ focus: () => focused.push(id) });
    registerFocus(s, shape.code, target("code"));
    const entries = [
      { path: "name", ref: shape.name.error, store: s },
      { path: "flag", ref: shape.flag.disabled, store: s },
      { path: "code", ref: shape.code.error, store: s },
    ];
    expect(focusFirst(entries)?.path).toBe("code");
    expect(focused).toEqual(["code"]);
  });

  test("focusFirst skips entries whose row was removed", async () => {
    const s = createStore(shape, initial(), { behaviors: rule(L.qty, () => "bad") });
    const lines = s.substore(shape.lines);
    const [a, b] = lines.items();
    const focused: string[] = [];
    registerFocus(a, L.qty, { focus: () => focused.push("a") });
    registerFocus(b, L.qty, { focus: () => focused.push("b") });
    const { errors } = await validate(s);
    lines.remove(a);
    expect(focusFirst(errors)?.store).toBe(b);
    expect(focused).toEqual(["b"]);
  });

  test("focus(store, node): false without a target; focus() then scrollIntoView() with one", ({ store: s }) => {
    expect(focus(s, shape.name)).toBe(false);
    const calls: string[] = [];
    registerFocus(s, shape.name, { focus: () => calls.push("focus"), scrollIntoView: () => calls.push("scroll") });
    expect(focus(s, shape.name)).toBe(true);
    expect(calls).toEqual(["focus", "scroll"]);
  });

  test("a target registered through a section's store is found from any store in its scope", () => {
    const f = form({ step: object({ x: field<string>(), y: field<string>() }) });
    const s = createStore(f, { step: { x: "", y: "" } });
    const calls: string[] = [];
    registerFocus(s, f.step.x, { focus: () => calls.push("x") });
    registerFocus(s.substore(f.step), f.step.y, { focus: () => calls.push("y") });
    expect(focus(s.substore(f.step), f.step.x)).toBe(true);
    expect(focus(s, f.step.y)).toBe(true);
    expect(calls).toEqual(["x", "y"]);
  });

  test("reset() keeps targets; unregistering removes only the target it registered", ({ store: s }) => {
    const calls: string[] = [];
    const unregisterA = registerFocus(s, shape.name, { focus: () => calls.push("a") });
    s.reset();
    expect(focus(s, shape.name), "kept by reset").toBe(true);
    const unregisterB = registerFocus(s, shape.name, { focus: () => calls.push("b") });
    unregisterA();
    expect(focus(s, shape.name), "a later registration replaced it").toBe(true);
    unregisterB();
    expect(focus(s, shape.name)).toBe(false);
    expect(calls).toEqual(["a", "b"]);
  });

  test("a row's target is its own, and is skipped once the row is removed", ({ store: s }) => {
    const lines = s.substore(shape.lines);
    const [a, b] = lines.items();
    const calls: string[] = [];
    registerFocus(a, L.qty, { focus: () => calls.push("a") });
    expect(focus(b, L.qty), "another row").toBe(false);
    const unregister = registerFocus(b, L.qty, { focus: () => calls.push("b") });
    lines.remove(b);
    expect(focus(b, L.qty), "removed row").toBe(false);
    unregister(); // an input unmounting after its row was removed
    expect(focus(a, L.qty)).toBe(true);
    expect(calls).toEqual(["a"]);
  });
});
