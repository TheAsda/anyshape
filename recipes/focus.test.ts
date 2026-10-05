// Focus recipe: registerFocus(store, node, target), focusFirst(entries).

import { form, object, field, createStore, type MetaRef, type BaseStore } from "form-lib";
import { control } from "./features";
import { rule, validate } from "./validation";
import { test as base, describe, expect } from "vitest";
import { focusFirst, registerFocus, type FocusTarget } from "./focus";
import * as limits from "./test/fixtures/limits";

/** Focus one node through focusFirst, as a validation result's single error would. */
const focusOn = (store: BaseStore<any>, ref: MetaRef<any>) => focusFirst([{ ref, store }]) !== undefined;

describe("Focus", () => {
  const { shape, L, initial } = limits;
  const test = base.extend("store", () => createStore(shape, initial()));

  test("focusFirst: targets that are not DOM nodes keep the entries' order", ({ store: s }) => {
    const focused: string[] = [];
    registerFocus(s, shape.name, { focus: () => focused.push("name") });
    registerFocus(s, shape.code, { focus: () => focused.push("code") });
    const name = { path: "name", ref: shape.name.error, store: s };
    const code = { path: "code", ref: shape.code.error, store: s };
    expect(focusFirst([name, code])?.path).toBe("name");
    expect(focusFirst([code, name])?.path).toBe("code");
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

  test("focusFirst: nothing focused without a target; focus() then scrollIntoView() with one", ({ store: s }) => {
    expect(focusOn(s, shape.name.error)).toBe(false);
    const calls: string[] = [];
    registerFocus(s, shape.name, { focus: () => calls.push("focus"), scrollIntoView: () => calls.push("scroll") });
    expect(focusOn(s, shape.name.error)).toBe(true);
    expect(calls).toEqual(["focus", "scroll"]);
  });

  test("a target registered through a section's store is found from any store in its scope", () => {
    const f = form(object({ step: object({ x: field<string>().meta(control()), y: field<string>().meta(control()) }) }));
    const s = createStore(f, { step: { x: "", y: "" } });
    const calls: string[] = [];
    registerFocus(s, f.step.x, { focus: () => calls.push("x") });
    registerFocus(s.substore(f.step), f.step.y, { focus: () => calls.push("y") });
    expect(focusOn(s.substore(f.step), f.step.x.error)).toBe(true);
    expect(focusOn(s, f.step.y.error)).toBe(true);
    expect(calls).toEqual(["x", "y"]);
  });

  test("reset() keeps targets; unregistering removes only the target it registered", ({ store: s }) => {
    const calls: string[] = [];
    const unregisterA = registerFocus(s, shape.name, { focus: () => calls.push("a") });
    s.reset();
    expect(focusOn(s, shape.name.error), "kept by reset").toBe(true);
    const unregisterB = registerFocus(s, shape.name, { focus: () => calls.push("b") });
    unregisterA();
    expect(focusOn(s, shape.name.error), "a later registration replaced it").toBe(true);
    unregisterB();
    expect(focusOn(s, shape.name.error)).toBe(false);
    expect(calls).toEqual(["a", "b"]);
  });

  test("registerFocus rejects a node the store does not address", ({ store: s }) => {
    const other = form(object({ name: field<string>() }));
    const target: FocusTarget = { focus: () => {} };
    expect(() => registerFocus(s, L.qty, target), "a row node through the root store").toThrow(/inside an array item – use the item's store/);
    expect(() => registerFocus(s, other.name, target), "a node of another form").toThrow(/is not part of the store/);
  });

  test("a row's target is its own, and is skipped once the row is removed", ({ store: s }) => {
    const lines = s.substore(shape.lines);
    const [a, b] = lines.items();
    const calls: string[] = [];
    registerFocus(a, L.qty, { focus: () => calls.push("a") });
    expect(focusOn(b, L.qty.error), "another row").toBe(false);
    const unregister = registerFocus(b, L.qty, { focus: () => calls.push("b") });
    lines.remove(b);
    expect(focusOn(b, L.qty.error), "removed row").toBe(false);
    unregister(); // an input unmounting after its row was removed
    expect(focusOn(a, L.qty.error)).toBe(true);
    expect(calls).toEqual(["a"]);
  });
});
