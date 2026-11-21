// The value behaviors (recipes/values.ts): calculate, link, clearWhen, startWith.
import { form, object, array, field, createStore, metaKey, defineBehavior, defineBehaviors } from "anyshape";
import { describe, expect, test } from "vitest";

import {
  calculate,
  link,
  clearWhen,
  visibleWhen,
  startWith,
  emptyToUndefined,
  defined,
  rule,
  submitting,
  handleSubmit,
  control,
} from "../index";
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

// ---------------------------------------------------------------------------
// startWith – a meta key's start, known at creation
// ---------------------------------------------------------------------------
describe("startWith", () => {
  test("the key holds its start from creation; a program write replaces it; reset returns the start", () => {
    const s = createStore(shape, initial(), { behaviors: startWith(shape.note.hint, "Your note") });
    expect(s.get(shape.note.hint)).toBe("Your note");
    s.set(shape.note.hint, "mine");
    expect(s.get(shape.note.hint), "a later write wins").toBe("mine");
    s.reset();
    expect(s.get(shape.note.hint), "reset returns the start, not the default").toBe("Your note");
  });

  test("a behavior that reads the key on its own first run sees the start, never the default", () => {
    const modeKey = metaKey("view");
    const f = form(object({ echo: field<string>() }).meta({ mode: modeKey }));
    const s = createStore(
      f,
      { echo: "" },
      { behaviors: [startWith(f.mode, "edit"), calculate(f.echo, [f.mode], (mode) => mode)] },
    );
    expect(s.get(f.echo), "the first run computed from the start").toBe("edit");
  });

  test("rows: every row gets the start, appended ones included", () => {
    const f = form(
      object({ rows: array(object({ qty: field<number>().meta(control()) }), { create: () => ({ qty: 0 }) }) }),
    );
    const behaviors = defineBehaviors(f, (b) => b.each(f.rows, (b, item) => b.add(startWith(item.qty.revealed, true))));
    const s = createStore(f, { rows: [{ qty: 1 }] }, { behaviors });
    const rows = s.substore(f.rows);
    expect(rows.itemAt(0).get(f.rows.item.qty.revealed)).toBe(true);
    expect(rows.append().get(f.rows.item.qty.revealed), "a row added later starts too").toBe(true);
  });

  test("a start on `revealed` shows a rule's error at once and leaves the submit working", async () => {
    const submittable = form(object({ name: field<string>().meta(control()) }).meta(submitting()));
    const s = createStore(
      submittable,
      { name: "Ann" },
      {
        behaviors: [
          startWith(submittable.name.revealed, true),
          rule(submittable.name, (v) => (v.length > 2 ? undefined : "Too short")),
        ],
      },
    );
    expect(s.get(submittable.name.revealed), "revealed from the start").toBe(true);
    s.set(submittable.name, "Jo");
    expect(s.get(submittable.name.error), "an edit shows at once, no blur needed").toBe("Too short");
    s.set(submittable.name, "Joanna");
    let calls = 0;
    await handleSubmit(s, async () => void calls++)();
    expect(calls, "the submit is not blocked by the started key").toBe(1);
  });

  test('a load ({ as: "initial" }) does not rerun the start', () => {
    const s = createStore(shape, initial(), { behaviors: startWith(shape.note.hint, "Your note") });
    s.set(shape.note.hint, "mine");
    s.set(shape, { ...initial(), title: "Loaded" }, { as: "initial" });
    expect(s.get(shape.title)).toBe("Loaded");
    expect(s.get(shape.note.hint), "the start is fixed at mount; the load leaves the key alone").toBe("mine");
  });

  test("a key with its own behavior, a combined key and a second start are rejected at registration", () => {
    expect(
      () => createStore(shape, initial(), { behaviors: startWith(shape.name.dirty, true) }),
      "dirty declares its own behavior",
    ).toThrow(/declares its own behavior/);
    expect(
      () => createStore(shape, initial(), { behaviors: startWith(shape.name.error, "nope") }),
      "error is combined",
    ).toThrow(/combined/);
    expect(
      () =>
        createStore(shape, initial(), {
          behaviors: [startWith(shape.note.hint, "a"), startWith(shape.note.hint, "b")],
        }),
      "one writer per target",
    ).toThrow(/one writer per target/);
  });

  test("the default name is startWith(<path>); { name } overrides it", () => {
    const hand = defineBehavior({ writes: [shape.note.hint], run: (ctx) => ctx.set(shape.note.hint, "hand") });
    expect(
      () => createStore(shape, initial(), { behaviors: [startWith(shape.note.hint, "a"), hand] }),
      "the default name names the key",
    ).toThrow(/is already written by "startWith\(note#hint\)"/);
    expect(
      () =>
        createStore(shape, initial(), { behaviors: [startWith(shape.note.hint, "a", { name: "hint start" }), hand] }),
      "a custom name replaces it",
    ).toThrow(/is already written by "hint start"/);
  });
});

describe("emptyToUndefined", () => {
  const opt = form(
    object({
      name: field<string | undefined>().meta(control(), defined()),
      tags: field<string[] | undefined>().meta(control(), defined()),
      rows: array(object({ label: field<string | undefined>().meta(control(), defined()) }), {
        create: () => ({ label: undefined }),
      }),
    }),
  );

  test('turns "" and [] into undefined on user and program writes; leaves whitespace and non-empty values alone', () => {
    const s = createStore(
      opt,
      { name: "Ada", tags: ["a"], rows: [] },
      { behaviors: [emptyToUndefined(opt.name), emptyToUndefined(opt.tags)] },
    );
    s.set(opt.name, " ", { origin: "user" });
    expect(s.get(opt.name), "whitespace stays a string so typing a leading space is not wiped").toBe(" ");

    s.set(opt.name, "", { origin: "user" });
    expect(s.get(opt.name)).toBeUndefined();
    expect(s.get(opt.name.error), "defined() sees undefined in the same flush").toBe("Required");

    s.set(opt.name, "Bob");
    expect(s.get(opt.name)).toBe("Bob");
    s.set(opt.name, ""); // program write
    expect(s.get(opt.name)).toBeUndefined();

    s.set(opt.tags, [], { origin: "user" });
    expect(s.get(opt.tags)).toBeUndefined();
    expect(s.get(opt.tags.error)).toBe("Required");
    s.set(opt.tags, ["x"], { origin: "user" });
    expect(s.get(opt.tags)).toEqual(["x"]);
    s.set(opt.tags, []); // program write
    expect(s.get(opt.tags)).toBeUndefined();
  });

  test('ignores initial values and loads ({ as: "initial" }), so a loaded "" stays clean', () => {
    const s = createStore(
      opt,
      { name: "", tags: [], rows: [] },
      { behaviors: [emptyToUndefined(opt.name), emptyToUndefined(opt.tags)] },
    );
    expect(s.get(opt.name)).toBe("");
    expect(s.get(opt.name.dirty)).toBe(false);
    expect(s.get(opt.tags)).toEqual([]);
    expect(s.get(opt.tags.dirty)).toBe(false);

    s.set(opt, { name: "", tags: [], rows: [] }, { as: "initial" });
    expect(s.get(opt.name)).toBe("");
    expect(s.get(opt.name.dirty)).toBe(false);
    expect(s.get(opt.tags)).toEqual([]);
    expect(s.get(opt.tags.dirty)).toBe(false);
  });

  test("works on rows via b.each", () => {
    const behaviors = defineBehaviors(opt, (b) => b.each(opt.rows, (b, item) => b.add(emptyToUndefined(item.label))));
    const s = createStore(opt, { name: "Ada", tags: ["a"], rows: [{ label: "x" }] }, { behaviors });
    const row = s.substore(opt.rows).itemAt(0);
    row.set(opt.rows.item.label, "", { origin: "user" });
    expect(row.get(opt.rows.item.label)).toBeUndefined();
    expect(row.get(opt.rows.item.label.error)).toBe("Required");
  });

  test("is the target's one writer; default name is emptyToUndefined(<path>) and { name } overrides it", () => {
    const other = calculate(opt.name, [opt.tags], () => "x");
    expect(() =>
      createStore(
        opt,
        { name: undefined, tags: undefined, rows: [] },
        { behaviors: [emptyToUndefined(opt.name), other] },
      ),
    ).toThrow(/is already written by "emptyToUndefined\(name\)"/);
    expect(() =>
      createStore(
        opt,
        { name: undefined, tags: undefined, rows: [] },
        { behaviors: [emptyToUndefined(opt.name, { name: "blank name" }), other] },
      ),
    ).toThrow(/is already written by "blank name"/);
  });
});
