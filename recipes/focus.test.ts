// Focus recipe: focus(store, node), focusFirst(entries, compare).

import { form, object, field, createStore, rule } from "form-lib";
import { control } from "./features";
import { test as base, describe, expect } from "vitest";
import { focus, focusFirst, type FocusTarget } from "./focus";
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
    s.set(shape.code.focusTarget, target("code"));
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
    a.set(L.qty.focusTarget, { focus: () => focused.push("a") });
    b.set(L.qty.focusTarget, { focus: () => focused.push("b") });
    const { errors } = await s.validate();
    lines.remove(a);
    expect(focusFirst(errors)?.store).toBe(b);
    expect(focused).toEqual(["b"]);
  });

  test("focus(store, node): false without a target; focus() then scrollIntoView() with one", ({ store: s }) => {
    expect(focus(s, shape.name)).toBe(false);
    expect(focus(s, shape.flag), "a node without focusable()").toBe(false);
    const calls: string[] = [];
    s.set(shape.name.focusTarget, { focus: () => calls.push("focus"), scrollIntoView: () => calls.push("scroll") });
    expect(focus(s, shape.name)).toBe(true);
    expect(calls).toEqual(["focus", "scroll"]);
  });

  test("focus through a section's store", () => {
    const f = form({ step: object({ x: field<string>().meta(control()) }) });
    const s = createStore(f, { step: { x: "" } });
    const calls: string[] = [];
    s.set(f.step.x.focusTarget, { focus: () => calls.push("x") });
    expect(focus(s.substore(f.step), f.step.x)).toBe(true);
    expect(calls).toEqual(["x"]);
  });
});
