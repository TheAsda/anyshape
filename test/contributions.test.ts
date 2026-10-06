import { test as base, describe, expect } from "vitest";

// Key contributions: a combined key (metaKey with `combine`) is written by one
// owner behavior per node instance, fed by contribute(ref, payload, decl).
// The keys here are test-local and unrelated to validation: `tags` lists the
// payloads of its active contributions.
import {
  form,
  object,
  array,
  field,
  createStore,
  contribute,
  defineBehavior,
  defineBehaviors,
  metaKey,
  when,
  pendingOf,
  type InferValue,
} from "../src/index";
import { deferred, flush } from "./support/harness";

/** Every owner run: the instance's run counter (ctx.state) and the parts it saw. */
interface Run {
  path: string;
  runs: number;
  tags: string[];
  origins: string[];
}

interface Log {
  runs: Run[];
  combined: string[];
}
let log: Log = { runs: [], combined: [] };

const tags = metaKey<readonly string[], string>([]).combine((self, key) => {
  log.combined.push(self.path);
  return {
    name: `${self.path}#tags`,
    triggers: [self],
    writes: [key],
    run(ctx) {
      const n = ((ctx.state.runs as number | undefined) ?? 0) + 1;
      ctx.state.runs = n;
      const list = ctx.parts.map((p) => p.payload);
      log.runs.push({ path: self.path, runs: n, tags: list, origins: [...ctx.origins] });
      ctx.set(key, list);
    },
  };
});

const shape = form(
  object({
    mode: field<string>(),
    other: field<string>(),
    a: field<string>().meta({ tags }),
    b: field<string>().meta({ note: "" }),
    rows: array(object({ x: field<number>().meta({ tags }) }), { create: () => ({ x: 0 }) }),
  }),
);
const R = shape.rows.item;
const initial = (): InferValue<typeof shape> => ({ mode: "", other: "", a: "", b: "", rows: [{ x: 0 }, { x: 0 }] });

const test = base.extend("log", (): Log => (log = { runs: [], combined: [] }));

describe("Registration", () => {
  test("a tally trigger from a contribution throws when the owner filters origins, and adds nothing", () => {
    const filtered = metaKey<readonly string[], string>([]).combine((self, key) => ({
      triggers: [self],
      writes: [key],
      origins: ["user"],
      run: (ctx) =>
        ctx.set(
          key,
          ctx.parts.map((p) => p.payload),
        ),
    }));
    const sh = form(object({ f: field<string>().meta({ filtered }), g: field<string>() }));
    const s = createStore(sh, { f: "", g: "" });
    s.addBehavior(contribute(sh.f.filtered, "plain"));
    expect(() => s.addBehavior(contribute(sh.f.filtered, "tally", { triggers: [pendingOf(sh.g)] }))).toThrow(
      `"${pendingOf(sh.g).path}" carries no origins (it is a tally) – drop the origins filter or the reference`,
    );
    s.set(sh.f, "x", { origin: "user" });
    expect(s.get(sh.f.filtered), "the owner still runs, without the rejected part").toEqual(["plain"]);
  });

  test("contributing to a key without `combine` throws at registration", () => {
    const s = createStore(shape, initial());
    expect(() => s.addBehavior(contribute(shape.b.note as any, "x"))).toThrow(/has no `combine`/);
  });

  test("`combine` and `behavior` are mutually exclusive, in either order", () => {
    expect(() =>
      // @ts-expect-error – the runtime check is what this test pins
      metaKey(0)
        .behavior(() => ({ run() {} }))
        .combine(() => ({ run() {} })),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      // @ts-expect-error – the runtime check is what this test pins
      metaKey(0)
        .combine(() => ({ run() {} }))
        .behavior(() => ({ run() {} })),
    ).toThrow(/mutually exclusive/);
  });

  test("each step returns a new definition: the one it was called on is unchanged", () => {
    const plain = metaKey<number, string>(0);
    const combined = plain.combine(() => ({ run() {} }));
    const sh = form(object({ f: field<string>().meta({ plain, combined }) }));
    const s = createStore(sh, { f: "" });
    expect(() => s.addBehavior(contribute(sh.f.plain, "x"))).toThrow(/has no `combine`/);
    expect(() => s.addBehavior(contribute(sh.f.combined, "x"))).not.toThrow();
  });

  test("no owner without a contribution: the key keeps its default and nothing runs", ({ log }) => {
    const s = createStore(shape, initial());
    expect(s.get(shape.a.tags)).toEqual([]);
    expect(log.runs).toEqual([]);
    expect(log.combined).toEqual([]);
  });

  test("combine(self, key) runs once per node: not per contribution, change or row", ({ log }) => {
    const s = createStore(shape, initial(), {
      behaviors: [contribute(shape.a.tags, "one"), contribute(R.x.tags, "row")],
    });
    const h = s.addBehavior(contribute(shape.a.tags, "two"));
    h();
    s.addBehavior(contribute(shape.a.tags, "three"));
    s.substore(shape.rows).append({ x: 1 });
    expect(log.combined).toEqual(["a", "rows[].x"]);
  });

  test("a combined key is written only by its owner among behaviors; application code may write it", () => {
    const writer = defineBehavior({ triggers: [shape.mode], writes: [shape.a.tags], run: () => {} });
    expect(() => createStore(shape, initial(), { behaviors: writer }), "even with no owner yet").toThrow(
      /is written only by the owner of its key/,
    );
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "one") });
    expect(() => s.addBehavior(writer)).toThrow(/is written only by the owner of its key/);
    s.set(shape.a.tags, ["server"]);
    expect(s.get(shape.a.tags)).toEqual(["server"]);
  });
});

describe("Uses", () => {
  /** Set to force a recheck; the owner clears it. */
  const forced = metaKey(false);
  const checked = metaKey<string, string>("")
    .uses(forced)
    .combine((self, key, [force]) => ({
      triggers: [self, force],
      writes: [key, force],
      run(ctx) {
        const isForced = ctx.get(force);
        ctx.set(key, `${ctx.parts.map((p) => p.payload)}${isForced ? " (forced)" : ""}`);
        if (isForced) ctx.set(force, false);
      },
    }));

  test("combine receives refs to the keys it uses, under whatever name the node declares them, in any .meta() call", () => {
    const sh = form(object({ f: field<string>().meta({ problem: checked }).meta({ recheck: forced }) }));
    const s = createStore(sh, { f: "" }, { behaviors: contribute(sh.f.problem, "base") });
    expect(s.get(sh.f.problem)).toBe("base");
    s.set(sh.f.recheck, true);
    expect(s.get(sh.f.problem)).toBe("base (forced)");
    expect(s.get(sh.f.recheck), "the owner cleared it").toBe(false);
  });

  test("a default behavior receives them too", () => {
    const mirrored = metaKey(false)
      .uses(forced)
      .behavior((_self, key, [force]) => ({
        triggers: [force],
        writes: [key],
        run: (ctx) => ctx.set(key, ctx.get(force)),
      }));
    const sh = form(object({ f: field<string>().meta({ shown: mirrored, recheck: forced }) }));
    const s = createStore(sh, { f: "" });
    s.set(sh.f.recheck, true);
    expect(s.get(sh.f.shown)).toBe(true);
  });

  test("a used key the node doesn't declare throws in createStore, before anything contributes", () => {
    const sh = form(object({ rows: array(object({ x: field<string>().meta({ problem: checked }) })) }));
    expect(() => createStore(sh, { rows: [] })).toThrow(
      `Key "problem" on "rows[].x" uses a key the node doesn't declare (uses[0], default false) – declare it in .meta()`,
    );
  });

  test("uses grants no access: the owner still declares the refs it reads or writes", () => {
    const errors: unknown[] = [];
    const undeclared = metaKey<string, string>("")
      .uses(forced)
      .combine((_self, key, [force]) => ({
        writes: [key],
        run: (ctx) => ctx.set(key, String(ctx.get(force))),
      }));
    const sh = form(object({ f: field<string>().meta({ problem: undeclared, recheck: forced }) }));
    const s = createStore(
      sh,
      { f: "" },
      { behaviors: contribute(sh.f.problem, "base"), onError: (e) => errors.push(e) },
    );
    expect(String(errors[0])).toMatch(/"f#recheck" is not declared in triggers, reads, writes or when/);
    expect(s.get(sh.f.problem)).toBe("");
  });

  test(".uses() comes before .combine() and .behavior(): the refs they receive are fixed then", () => {
    expect(() =>
      // @ts-expect-error – the runtime check is what this test pins
      metaKey(0)
        .combine(() => ({ run() {} }))
        .uses(forced),
    ).toThrow(/call .uses\(\) before .combine\(\) or .behavior\(\)/);
    expect(() =>
      // @ts-expect-error – the runtime check is what this test pins
      metaKey(0)
        .behavior(() => ({ run() {} }))
        .uses(forced),
    ).toThrow(/call .uses\(\) before .combine\(\) or .behavior\(\)/);
  });

  test(".uses() is declared once: a second call throws instead of dropping the first one's keys", () => {
    expect(() => metaKey(0).uses(forced).uses(metaKey(""))).toThrow(
      /\.uses\(\) is declared once – list every used key in one call/,
    );
  });

  test("a used key the node declares twice is ambiguous and throws in createStore", () => {
    const sh = form(object({ f: field<string>().meta({ problem: checked, recheck: forced }).meta({ again: forced }) }));
    expect(() => createStore(sh, { f: "" })).toThrow(
      `Key "problem" on "f" uses a key the node declares twice ("recheck", "again") (uses[0], default false) – declare it once`,
    );
  });
});

describe("Parts", () => {
  test("parts arrive in declaration order with the payload untouched", () => {
    const s = createStore(shape, initial(), {
      behaviors: [contribute(shape.a.tags, "1"), contribute(shape.a.tags, "2"), contribute(shape.a.tags, "3")],
    });
    expect(s.get(shape.a.tags)).toEqual(["1", "2", "3"]);
  });

  test("a false guard makes the contribution absent; its refs trigger the owner", () => {
    const s = createStore(shape, initial(), {
      behaviors: [
        contribute(shape.a.tags, "always"),
        contribute(shape.a.tags, "strict", { when: when([shape.mode], (m) => m === "strict") }),
      ],
    });
    expect(s.get(shape.a.tags)).toEqual(["always"]);
    s.set(shape.mode, "strict");
    expect(s.get(shape.a.tags)).toEqual(["always", "strict"]);
    s.set(shape.mode, "");
    expect(s.get(shape.a.tags), "recomputed without it, not 'skip and keep'").toEqual(["always"]);
  });

  test("a contribution's triggers rerun the owner; its reads do not", () => {
    const s = createStore(shape, initial(), {
      behaviors: [
        contribute(shape.a.tags, "t", { triggers: [shape.mode] }),
        contribute(shape.a.tags, "r", { reads: [shape.other] }),
      ],
    });
    log.runs.length = 0;
    s.set(shape.other, "x");
    expect(log.runs).toHaveLength(0);
    s.set(shape.mode, "x");
    expect(log.runs).toHaveLength(1);
  });

  test("a part carries the contribution's declared inputs (triggers, reads), never its guard refs; the owner may read them", () => {
    const seen: unknown[] = [];
    const probe = metaKey<number, null>(0).combine((_self, key) => ({
      writes: [key],
      run: (ctx) => void seen.push(...ctx.parts.flatMap((p) => p.inputs.map((r) => ctx.get(r)))),
    }));
    const sh = form(
      object({ f: field<string>().meta({ probe }), t: field<string>(), r: field<string>(), g: field<string>() }),
    );
    createStore(
      sh,
      { f: "", t: "T", r: "R", g: "G" },
      {
        behaviors: contribute(sh.f.probe, null, { triggers: [sh.t], reads: [sh.r], when: when([sh.g], () => true) }),
      },
    );
    expect(seen).toEqual(["T", "R"]);
  });

  test("contribute() needs a meta key reference", () => {
    expect(() => contribute(shape.a as any, "x")).toThrow(/must be a meta key reference/);
  });
});

describe("In-place update", () => {
  test("adding and removing contributions keeps the instance and its ctx.state", ({ log }) => {
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "base") });
    const h = s.addBehavior(contribute(shape.a.tags, "late", { triggers: [shape.mode] }));
    expect(s.get(shape.a.tags)).toEqual(["base", "late"]);
    s.set(shape.mode, "x");
    h();
    expect(s.get(shape.a.tags)).toEqual(["base"]);
    expect(
      log.runs.map((r) => r.runs),
      "one counter across every change",
    ).toEqual([1, 2, 3, 4]);
  });

  test("the owner keeps its place in the run order: a behavior registered after it still runs after it", ({ log }) => {
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "base") });
    const ownerRunsBefore: number[] = [];
    s.addBehavior(
      defineBehavior({
        name: "after",
        triggers: [shape.a],
        writes: [shape.other],
        run: () => void ownerRunsBefore.push(log.runs.length),
      }),
    );
    s.addBehavior(contribute(shape.a.tags, "late"));
    log.runs.length = 0;
    s.set(shape.a, "x");
    expect(ownerRunsBefore.at(-1), "the owner ran first in the flush").toBe(1);
  });

  test("merged declarations are rewired: a removed contribution's trigger no longer runs the owner", ({ log }) => {
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "base") });
    const h = s.addBehavior(contribute(shape.a.tags, "late", { triggers: [shape.mode] }));
    h();
    log.runs.length = 0;
    s.set(shape.mode, "y");
    expect(log.runs).toHaveLength(0);
  });

  test("the last contribution removes the owner and resets the key; the next one starts fresh", ({ log }) => {
    const s = createStore(shape, initial());
    const h = s.addBehavior(contribute(shape.a.tags, "one"));
    expect(s.get(shape.a.tags)).toEqual(["one"]);
    h();
    expect(s.get(shape.a.tags)).toEqual([]);
    log.runs.length = 0;
    s.set(shape.a, "x");
    expect(log.runs, "no owner left to run").toEqual([]);
    s.addBehavior(contribute(shape.a.tags, "two"));
    expect(log.runs.map((r) => r.runs)).toEqual([1]);
  });
});

describe("Calls", () => {
  test("behaviors and contributions in one call land in one flush, ranked by their declarations", ({ log }) => {
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "base") });
    const seen: unknown[] = [];
    s._react(shape.a.tags, (v) => seen.push(v));
    log.runs.length = 0;
    s.addBehavior([
      contribute(shape.a.tags, "reads other", { triggers: [shape.other] }),
      defineBehavior({ triggers: [shape.mode], writes: [shape.other], run: (ctx) => ctx.set(shape.other, "set") }),
    ]);
    expect(log.runs, "the owner ran once, after the behavior writing its new trigger").toHaveLength(1);
    expect(seen).toEqual([["base", "reads other"]]);
  });

  test("replaceBehavior swaps contributions in one update", ({ log }) => {
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "base") });
    const h = s.addBehavior(contribute(shape.a.tags, "v1"));
    log.runs.length = 0;
    s.replaceBehavior(h, contribute(shape.a.tags, "v2"));
    expect(log.runs.map((r) => [r.runs, r.tags])).toEqual([[3, ["base", "v2"]]]);
  });
});

describe("Order and dedup", () => {
  test("parts are ordered by call, then by position; replaceBehavior keeps the call's place, a new call is appended", () => {
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "base") });
    const h1 = s.addBehavior([contribute(shape.a.tags, "one a"), contribute(shape.a.tags, "one b")]);
    s.addBehavior(contribute(shape.a.tags, "two"));
    const h1b = s.replaceBehavior(h1, [
      contribute(shape.a.tags, "new a"),
      contribute(shape.a.tags, "new b"),
      contribute(shape.a.tags, "new c"),
    ]);
    expect(s.get(shape.a.tags)).toEqual(["base", "new a", "new b", "new c", "two"]);
    h1b();
    s.addBehavior(contribute(shape.a.tags, "three"));
    expect(s.get(shape.a.tags)).toEqual(["base", "two", "three"]);
  });

  test("the same contribution reaching one instance twice throws, in either order and in one call", () => {
    const c = contribute(R.x.tags, "c");
    const outerFirst = createStore(shape, initial(), { behaviors: c });
    expect(() => outerFirst.substore(shape.rows).items()[0].addBehavior(c)).toThrow(/registered twice/);
    const innerFirst = createStore(shape, initial());
    innerFirst.substore(shape.rows).items()[0].addBehavior(c);
    expect(() => innerFirst.addBehavior(c)).toThrow(/registered twice/);
    expect(innerFirst.substore(shape.rows).items()[0].get(R.x.tags), "nothing changed").toEqual(["c"]);
    expect(() => createStore(shape, initial(), { behaviors: [c, c] })).toThrow(/registered twice/);
  });

  test("the same contribution on sibling rows is fine; equal contributions are never merged", () => {
    const c = contribute(R.x.tags, "c");
    const s = createStore(shape, initial(), {
      behaviors: [contribute(R.x.tags, "same"), contribute(R.x.tags, "same")],
    });
    const [row0, row1] = s.substore(shape.rows).items();
    row0.addBehavior(c);
    row1.addBehavior(c);
    expect([row0.get(R.x.tags), row1.get(R.x.tags)]).toEqual([
      ["same", "same", "c"],
      ["same", "same", "c"],
    ]);
  });
});

describe("Checks", () => {
  test("a failing check in the same call changes nothing", ({ log }) => {
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "base") });
    log.runs.length = 0;
    expect(() =>
      s.addBehavior([
        contribute(shape.a.tags, "doomed"),
        defineBehavior({ triggers: [shape.a], writes: [shape.other], run: () => {} }),
        defineBehavior({ triggers: [shape.a], writes: [shape.other], run: () => {} }),
      ]),
    ).toThrow(/one writer per target/);
    s.set(shape.a, "x");
    expect(log.runs.map((r) => r.tags)).toEqual([["base"]]);
  });

  test("a contribution's refs must be in its target's scope chain; nothing changes when they aren't", () => {
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "base") });
    expect(() =>
      s.addBehavior([contribute(shape.a.tags, "late"), contribute(shape.a.tags, "row ref", { triggers: [R.x] })]),
    ).toThrow(/"rows\[\]\.x" is outside the target's scope/);
    expect(() => s.addBehavior(contribute(shape.a.tags, "guard", { when: when([R.x], () => true) }))).toThrow(
      /outside the target's scope/,
    );
    expect(s.get(shape.a.tags)).toEqual(["base"]);
  });

  test("a contribution's refs and target belong to this form", () => {
    const other = form(object({ a: field<string>().meta({ tags }), y: field<string>() }));
    const s = createStore(shape, initial());
    expect(() => s.addBehavior(contribute(shape.a.tags, "x", { reads: [other.y] }))).toThrow(
      /"y" is not part of this form/,
    );
    expect(() => s.addBehavior(contribute(other.a.tags, "x"))).toThrow(/"a#tags" is not part of this form/);
  });

  test("the target must be inside the store the contribution is added on", () => {
    const s = createStore(shape, initial());
    const row = s.substore(shape.rows).items()[0];
    expect(() => row.addBehavior(contribute(shape.a.tags, "x"))).toThrow(/outside the store it was added to/);
  });
});

describe("Rows", () => {
  test("a contribution added on a row applies to that row only; the others keep the default without running the owner", ({
    log,
  }) => {
    const s = createStore(shape, initial());
    const [row0, row1] = s.substore(shape.rows).items();
    const h = row1.addBehavior(contribute(R.x.tags, "row 1"));
    expect([row0.get(R.x.tags), row1.get(R.x.tags)]).toEqual([[], ["row 1"]]);
    expect(
      log.runs.map((r) => r.path),
      "only row 1's instance ran",
    ).toEqual(["rows[].x"]);
    h();
    expect(row1.get(R.x.tags)).toEqual([]);
  });

  test("a contribution added on a row reruns only that row's instance", ({ log }) => {
    const s = createStore(shape, { ...initial(), rows: [{ x: 0 }, { x: 0 }, { x: 0 }] });
    const rows = s.substore(shape.rows).items();
    rows[0].addBehavior(contribute(R.x.tags, "row 0"));
    log.runs.length = 0;
    rows[1].addBehavior(contribute(R.x.tags, "row 1"));
    expect(log.runs.map((r) => r.tags)).toEqual([["row 1"]]);
    expect(rows.map((r) => r.get(R.x.tags))).toEqual([["row 0"], ["row 1"], []]);
  });

  test("removing a row's contribution reruns only that row's instance", ({ log }) => {
    const s = createStore(shape, initial());
    const [row0, row1] = s.substore(shape.rows).items();
    row0.addBehavior(contribute(R.x.tags, "row 0"));
    row1.addBehavior(contribute(R.x.tags, "row 1"));
    const h = row1.addBehavior(contribute(R.x.tags, "row 1 extra"));
    log.runs.length = 0;
    h();
    expect(log.runs.map((r) => r.tags)).toEqual([["row 1"]]);
  });

  test("a contribution added on the root reruns every row's instance", ({ log }) => {
    const s = createStore(shape, initial());
    const [row0, row1] = s.substore(shape.rows).items();
    row0.addBehavior(contribute(R.x.tags, "row 0"));
    row1.addBehavior(contribute(R.x.tags, "row 1"));
    log.runs.length = 0;
    s.addBehavior(contribute(R.x.tags, "all rows"));
    expect(
      log.runs.map((r) => r.tags),
      "parts in call order",
    ).toEqual([
      ["row 0", "all rows"],
      ["row 1", "all rows"],
    ]);
  });

  test("a row's contribution triggers its row even when another row's contribution declared the same trigger first", ({
    log,
  }) => {
    const sh = form(object({ rows: array(object({ x: field<number>().meta({ tags }), y: field<number>() })) }));
    const Y = sh.rows.item;
    const s = createStore(
      sh,
      {
        rows: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      },
      { behaviors: contribute(Y.x.tags, "base") },
    );
    const [row0, row1] = s.substore(sh.rows).items();
    row0.addBehavior(contribute(Y.x.tags, "row 0", { triggers: [Y.y] }));
    row1.addBehavior(contribute(Y.x.tags, "row 1", { triggers: [Y.y] }));
    log.runs.length = 0;
    row1.set(Y.y, 1);
    expect(log.runs.map((r) => r.tags)).toEqual([["base", "row 1"]]);
  });

  test("a row added after an in-place update gets the merged declarations", () => {
    const s = createStore(shape, initial(), { behaviors: contribute(R.x.tags, "all rows") });
    s.addBehavior(contribute(R.x.tags, "strict rows", { when: when([shape.mode], (m) => m === "strict") }));
    s.substore(shape.rows).append({ x: 5 });
    const row2 = s.substore(shape.rows).items()[2];
    expect(row2.get(R.x.tags)).toEqual(["all rows"]);
    s.set(shape.mode, "strict");
    expect(row2.get(R.x.tags), "the enclosing-scope guard ref triggers the new row").toEqual([
      "all rows",
      "strict rows",
    ]);
  });
});

describe("Builder", () => {
  test("when adds its guard to contributions; nested guards accumulate", () => {
    const s = createStore(shape, initial(), {
      behaviors: defineBehaviors(shape, (b, s) => {
        b.when(
          [s.mode],
          (m) => m !== "",
          (b) => {
            b.when(
              [s.other],
              (o) => o === "x",
              (b) => b.add(contribute(s.a.tags, "both")),
            );
            b.add(contribute(s.a.tags, "mode"));
          },
        );
        b.when(
          [s.mode],
          (m) => m === "",
          (b) => b.add(contribute(s.a.tags, "no mode"), contribute(s.a.tags, "no mode either")),
        );
      }),
    });
    expect(s.get(shape.a.tags)).toEqual(["no mode", "no mode either"]);
    s.set(shape.mode, "on");
    expect(s.get(shape.a.tags)).toEqual(["mode"]);
    s.set(shape.other, "x");
    expect(s.get(shape.a.tags), "nested guards accumulate").toEqual(["both", "mode"]);
  });
});

describe("In-flight runs", () => {
  /**
   * Owner calls: async unless the run has no origins and isn't the first (a
   * contribution change at rest). "First" is kept in ctx.state: no run has
   * completed yet.
   */
  interface Call {
    signal: AbortSignal;
    d: ReturnType<typeof deferred<string>>;
    origins: string[];
    changed: boolean;
    first: boolean;
  }
  let calls: Call[] = [];

  const answer = metaKey<string, string>("").combine((self, key) => ({
    triggers: [self],
    writes: [key],
    run(ctx) {
      const first = ctx.state.started === undefined;
      const started = ((ctx.state.started as number | undefined) ?? 0) + 1;
      ctx.state.started = started;
      if (!first && !ctx.origins.size) return ctx.set(key, `idle ${ctx.parts.length}`);
      const d = deferred<string>();
      calls.push({ signal: ctx.signal, d, origins: [...ctx.origins], changed: ctx.changed(self), first });
      return d.promise.then((a) => ctx.set(key, `${a} ${ctx.parts.map((p) => p.payload)} (#${started})`));
    },
  }));
  const sh = form(object({ f: field<string>().meta({ answer }) }));

  function setup() {
    calls = [];
    const errors: unknown[] = [];
    const s = createStore(
      sh,
      { f: "" },
      { behaviors: contribute(sh.f.answer, "base"), onError: (error) => errors.push(error) },
    );
    return { s, errors };
  }

  test("a contribution change cancels the run in flight and reruns it with the cancelled run's cause; ctx.state is kept", async () => {
    const { s, errors } = setup();
    calls[0].d.resolve("init");
    await s.settle();
    expect(s.get(sh.f.answer)).toBe("init base (#1)");
    s.set(sh.f, "x", { origin: "user" });
    s.addBehavior(contribute(sh.f.answer, "late"));
    expect(calls[1].signal.aborted).toBe(true);
    expect(calls[2], "rerun with the cancelled run's origins and changed inputs").toMatchObject({
      origins: ["user"],
      changed: true,
      first: false,
    });
    calls[1].d.resolve("stale");
    await flush();
    expect(s.get(sh.f.answer)).toBe("init base (#1)");
    calls[2].d.resolve("fresh");
    await s.settle();
    expect(s.get(sh.f.answer), "#2, not #3: the cancelled run never saved its ctx.state").toBe("fresh base,late (#2)");
    expect(errors).toEqual([]);
  });

  test("kept work survives an in-place update: the rerun continues it instead of restarting", async () => {
    const starts: AbortSignal[] = [];
    const work = deferred<string>();
    const kept = metaKey<string, string>("").combine((self, key) => ({
      triggers: [self],
      writes: [key],
      runOn: { init: false },
      async run(ctx) {
        const value = ctx.get(self) as string;
        const result = await ctx.keep([value], (signal) => (starts.push(signal), work.promise));
        ctx.set(key, `${result} ${ctx.parts.length}`);
      },
    }));
    const k = form(object({ f: field<string>().meta({ kept }) }));
    const s = createStore(k, { f: "" }, { behaviors: contribute(k.f.kept, "base") });
    s.set(k.f, "x", { origin: "user" });
    s.addBehavior(contribute(k.f.kept, "late"));
    expect(starts).toHaveLength(1);
    expect(starts[0].aborted).toBe(false);
    work.resolve("checked");
    await s.settle();
    expect(s.get(k.f.kept)).toBe("checked 2");
  });

  test("a contribution added on one row leaves another row's run in flight running", async () => {
    calls = [];
    const rowsSh = form(object({ rows: array(object({ f: field<string>().meta({ answer }) })) }));
    const F = rowsSh.rows.item.f;
    const s = createStore(rowsSh, { rows: [{ f: "" }, { f: "" }] });
    const [row0, row1] = s.substore(rowsSh.rows).items();
    row0.addBehavior(contribute(F.answer, "row 0"));
    row1.addBehavior(contribute(F.answer, "row 1"));
    expect(calls[0].signal.aborted).toBe(false);
    expect(calls, "row 0's run, then row 1's first run with a part").toHaveLength(2);
    for (const c of calls) c.d.resolve("init");
    await s.settle();
    expect(row0.get(F.answer)).toBe("init row 0 (#1)");
  });

  test("an initial run in flight is rerun with no origins, still the first", async () => {
    const { s, errors } = setup();
    s.addBehavior(contribute(sh.f.answer, "late"));
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1]).toMatchObject({ origins: [], first: true });
    calls[1].d.resolve("init");
    await s.settle();
    expect(s.get(sh.f.answer)).toBe("init base,late (#1)");
    expect(errors).toEqual([]);
  });
});
