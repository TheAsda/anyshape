// O · Submit, handleSubmit, focus order, focus targets and resolvePath.

import {
  form, field, meta, MetaRef, createStore, countIn, rule, asyncRule, control, validation, submission,
  type FocusTarget,
} from "./index";
import { describe, it, expect } from "vitest";
import { sleep, deferred } from "./test/harness";
import * as account from "./test/fixtures/account";
import * as company from "./test/fixtures/company";
import * as limits from "./test/fixtures/limits";

describe('O · submit, focus and paths', () => {
  const { shape, L, initial, targets } = limits;

  it("focusFirst: shape order by default, compare to reorder", () => {
    const s = createStore(shape, initial());
    const focused: string[] = [];
    const compare = targets(s, { name: 2, code: 1 }, focused);
    const entries = [
      { path: "name", ref: shape.name, store: s },
      { path: "code", ref: shape.code, store: s },
    ];
    expect(s.focusFirst(entries)?.path).toBe("name");
    expect(s.focusFirst(entries, { compare })?.path).toBe("code");
    expect(focused).toEqual(["name", "code"]);
  });

  it("focusOrder store option is used by submit", async () => {
    const focused: string[] = [];
    const order = { name: 2, code: 1 };
    const s = createStore(shape, initial(), {
      behaviors: [rule(shape.name, () => "bad"), rule(shape.code, () => "bad")],
      focusOrder: (a, b) => order[(a as any).id as "name"] - order[(b as any).id as "name"],
    });
    targets(s, order, focused);
    await s.submit();
    expect(focused).toEqual(["code"]);
    await s.submit(undefined, undefined, { focus: false });
    expect(focused, "focus: false").toEqual(["code"]);
  });

  // ---------------------------------------------------------------------------
  // submit / handleSubmit
  it("handleSubmit: preventDefault, onValid with values", async () => {
    const s = createStore(shape, initial());
    let prevented = 0;
    const got: string[] = [];
    const handler = s.handleSubmit((values) => void got.push(values.name));
    const r = await handler({ preventDefault: () => prevented++ });
    expect(r.valid).toBe(true);
    expect(prevented).toBe(1);
    expect(got).toEqual(["Ann"]);
    await handler(); // no event
    expect(got.length).toBe(2);
  });

  it("onInvalid receives the result after focusing", async () => {
    const s = createStore(shape, initial(), { behaviors: rule(shape.name, () => "bad") });
    const seen: string[] = [];
    s.set(shape.name.focusTarget, { focus: () => seen.push("focus") });
    await s.handleSubmit(
      () => seen.push("valid"),
      (result) => void seen.push(`invalid:${result.errors.length}`)
    )();
    expect(seen).toEqual(["focus", "invalid:1"]);
  });

  it("a second submit while one is running returns the same promise", async () => {
    const s = createStore(shape, initial());
    const gate = deferred<void>();
    let calls = 0;
    const onValid = async () => {
      calls++;
      await gate.promise;
    };
    const p1 = s.submit(onValid);
    const p2 = s.handleSubmit(onValid)();
    expect(p1).toBe(p2);
    await sleep(0);
    expect(s.get(shape.submitting)).toBe(true);
    gate.resolve();
    await p1;
    expect(calls).toBe(1);
    expect(s.get(shape.submitCount)).toBe(1);
    await s.submit(onValid);
    expect(calls, "a new submit after completion").toBe(2);
  });

  it("an error in onValid rejects and resets submitting", async () => {
    const s = createStore(shape, initial());
    let caught: unknown;
    try {
      await s.submit(() => {
        throw new Error("save failed");
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toBe("save failed");
    expect(s.get(shape.submitting)).toBe(false);
    const r = await s.submit();
    expect(r.valid, "not stuck").toBe(true);
  });

  // ---------------------------------------------------------------------------
  // resolvePath
  it("resolvePath: fields, rows, nested rows, meta keys", () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
    const a = s.resolvePath("name")!;
    expect(a.store).toBe(s);
    expect(a.ref).toBe(shape.name);
    const b = s.resolvePath("lines[1].qty")!;
    expect(b.store).toBe(lines.itemAt(1));
    expect(b.ref).toBe(L.qty);
    const c = s.resolvePath("lines[1].notes[0].text#error")!;
    expect(c.store).toBe(lines.itemAt(1).substore(L.notes).itemAt(0));
    expect(c.ref instanceof MetaRef).toBe(true);
    expect((c.ref as MetaRef<any>).key).toBe("error");
    const root = s.resolvePath("")!;
    expect(root.ref).toBe(shape);
    expect(s.resolvePath("#submitCount")!.ref instanceof MetaRef).toBe(true);
  });

  it("resolvePath: unknown paths are undefined", () => {
    const s = createStore(shape, initial());
    for (const p of ["nope", "lines[9].qty", "lines[1].nope", "lines..qty", "lines[x].qty", "name[0]", "lines[1].qty#nokey", ".name", "name."]) {
      expect(s.resolvePath(p), p).toBe(undefined);
    }
  });

  it("resolvePath works from a row store (paths are from the form root)", () => {
    const s = createStore(shape, initial());
    const row = s.substore(shape.lines).itemAt(0);
    expect(row.resolvePath("name")!.store).toBe(s);
  });

  it("server errors: resolve and set", () => {
    const s = createStore(shape, initial());
    const server = { "lines[1].qty": "Out of stock", name: "Taken" };
    for (const [path, message] of Object.entries(server)) {
      const target = s.resolvePath(`${path}#error`);
      if (target) target.store.set(target.ref as MetaRef<string | undefined>, message);
    }
    expect(s.substore(shape.lines).itemAt(1).get(L.qty.error)).toBe("Out of stock");
    expect(s.get(countIn(shape, "error"))).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Focus
  it("focus(node): false without a target; focus() then scrollIntoView() with one", () => {
    const s = createStore(shape, initial());
    expect(s.focus(shape.name)).toBe(false);
    expect(s.focus(shape.flag), "a node without focusable()").toBe(false);
    const calls: string[] = [];
    s.set(shape.name.focusTarget, { focus: () => calls.push("focus"), scrollIntoView: () => calls.push("scroll") });
    expect(s.focus(shape.name)).toBe(true);
    expect(calls).toEqual(["focus", "scroll"]);
  });

  it("focusFirst skips entries whose row was removed", () => {
    const s = createStore(shape, initial(), { behaviors: rule(L.qty, () => "bad") });
    const lines = s.substore(shape.lines);
    const [a, b] = lines.items();
    const focused: string[] = [];
    a.set(L.qty.focusTarget, { focus: () => focused.push("a") });
    b.set(L.qty.focusTarget, { focus: () => focused.push("b") });
    const entries = s.collect(shape, "error");
    lines.remove(a);
    expect(s.focusFirst(entries)?.store).toBe(b);
    expect(focused).toEqual(["b"]);
  });
});

describe('O · submit with validation', () => {
  const { shape, L, initial, errors, lookup } = account;

  it("focusFirst skips errors without a focus target", () => {
    const s = createStore(shape, initial());
    const focused: string[] = [];
    const target = (id: string): FocusTarget => ({ focus: () => focused.push(id) });
    s.set(shape.email.focusTarget, target("email"));
    const entries = [
      { path: "name", ref: shape.name, store: s },
      { path: "email", ref: shape.email, store: s },
    ];
    expect(s.focusFirst(entries)?.path).toBe("email");
    expect(focused).toEqual(["email"]);
    expect(s.focus(shape.name)).toBe(false);
  });

  it("submit: counts, submitting, onValid with values, focus on errors", async () => {
    const s = createStore(shape, initial(), { behaviors: rule(shape.name, (v) => (v ? undefined : "Required")) });
    const submitted: unknown[] = [];
    let submittingSeen = false;
    const ok = await s.submit(async (values) => {
      submittingSeen = s.get(shape.submitting);
      submitted.push(values.name);
    });
    expect(ok.valid).toBe(true);
    expect(submitted).toEqual(["Ann"]);
    expect(submittingSeen).toBe(true);
    expect(s.get(shape.submitting)).toBe(false);
    expect(s.get(shape.submitCount)).toBe(1);

    const focused: string[] = [];
    s.set(shape.name.focusTarget, { focus: () => focused.push("name") });
    s.set(shape.name, "", { origin: "user" });
    const bad = await s.submit(() => submitted.push("never"));
    expect(bad.valid).toBe(false);
    expect(focused).toEqual(["name"]);
    expect(s.get(shape.submitCount)).toBe(2);
    expect(submitted.length).toBe(1);
  });

  it("submit reveals its subtree: existing rows yes, later rows no; reset clears", async () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
    expect(s.get(shape.name.revealed)).toBe(false);
    await s.submit();
    expect(s.get(shape.name.revealed)).toBe(true);
    expect(lines.items().map((row) => row.get(L.sku.revealed))).toEqual([true, true]);

    const added = lines.append();
    expect(added.get(L.sku.revealed), "a row added after submit starts hidden").toBe(false);
    await added.submit();
    expect(added.get(L.sku.revealed), "a row's submit reveals the row").toBe(true);

    s.reset();
    expect(s.get(shape.name.revealed)).toBe(false);
    expect(lines.items().map((row) => row.get(L.sku.revealed))).toEqual([false, false]);
  });

  it("a row's submit reveals only that row", async () => {
    const s = createStore(shape, initial());
    const [first, second] = s.substore(shape.lines).items();
    await second.submit();
    expect(first.get(L.sku.revealed)).toBe(false);
    expect(second.get(L.sku.revealed)).toBe(true);
    expect(s.get(shape.name.revealed)).toBe(false);
  });

  it("submit waits for a running async check", async () => {
    const { calls, check } = lookup();
    const s = createStore(shape, initial(), { behaviors: asyncRule(shape.email, check, { debounce: 1000 }) });
    s.set(shape.email, "late@x.io", { origin: "user" });
    const pending = s.submit();
    await sleep(0);
    expect(calls.length, "debounce skipped on submit").toBe(1);
    calls[0].d.resolve("Taken");
    const r = await pending;
    expect(r.valid).toBe(false);
    expect(r.errors[0].error).toBe("Taken");
  });

  // ---------------------------------------------------------------------------
  // submit without submission()
  it("submit works on a form whose root has no submission()", async () => {
    const f = form({ name: field<string>().meta(control()) });
    const s = createStore(f, { name: "x" });
    const got: unknown[] = [];
    const r = await s.submit((values) => void got.push(values));
    expect(r.valid).toBe(true);
    expect(got).toEqual([{ name: "x" }]);
    expect(s.get(f.name.revealed)).toBe(true);
  });
});

describe('O · focus targets', () => {
  const { shape, L, initial, originsOf } = company;

  // ---------------------------------------------------------------------------
  // Non-reactive keys
  it("focus targets never notify and work on detached rows", () => {
    const s = createStore(shape, initial());
    const lines = s.substore(shape.lines);
    const row = lines.itemAt(0);
    let calls = 0;
    s.subscribe(() => calls++);
    row.subscribeMeta(L.sku, () => calls++);
    const target: FocusTarget = { focus() {} };
    row.set(L.sku.focusTarget, target);
    expect(calls).toBe(0);
    expect(row.get(L.sku.focusTarget)).toBe(target);
    lines.remove(row);
    calls = 0;
    row.set(L.sku.focusTarget, undefined);        // unmount after removal must not throw
    expect(calls).toBe(0);
  });
});
