// Key contributions: a combined key (metaKey with `combine`) is written by one
// owner behavior per node instance, fed by contribute(ref, payload, decl).
// The keys here are test-local and unrelated to validation: `tags` lists the
// payloads of its active contributions.
import { form, object, array, field, createStore, contribute, defineBehavior, defineBehaviors, metaKey, when, type InferValue } from "./index";
import { test as base, describe, expect } from "vitest";
import { deferred, flush } from "./test/harness";

/** Every owner run: the instance's run counter (ctx.state) and the parts it saw. */
interface Run { path: string; runs: number; tags: string[]; origins: string[]; isInit: boolean }

interface Log { runs: Run[]; combined: string[] }
let log: Log = { runs: [], combined: [] };

const tags = metaKey<readonly string[], string>([], {
  combine: (self, key) => {
    log.combined.push(self.path);
    return {
      name: `${self.path}#tags`,
      triggers: [self],
      writes: [key],
      run(ctx) {
        const n = ((ctx.state.runs as number | undefined) ?? 0) + 1;
        ctx.state.runs = n;
        const list = ctx.parts.map((p) => p.payload);
        log.runs.push({ path: `${ctx.store.node.path}:${self.path}`, runs: n, tags: list, origins: [...ctx.origins], isInit: ctx.isInit });
        ctx.set(key, list);
      },
    };
  },
});

const owned = metaKey(0, { owner: "feature" });

const shape = form(
  object({
    mode: field<string>(),
    other: field<string>(),
    a: field<string>().meta({ tags }),
    b: field<string>().meta({ note: "" }, { owned }),
    rows: array(object({ x: field<number>().meta({ tags }) }), { create: () => ({ x: 0 }) }),
  })
);
const R = shape.rows.item;
const initial = (): InferValue<typeof shape> => ({ mode: "", other: "", a: "", b: "", rows: [{ x: 0 }, { x: 0 }] });

const test = base.extend("log", (): Log => (log = { runs: [], combined: [] }));

describe("Registration", () => {
  test("contributing to a key without `combine` throws at registration", () => {
    const s = createStore(shape, initial());
    expect(() => s.addBehavior(contribute(shape.b.owned as any, "x"))).toThrow(/has no `combine`/);
    expect(() => s.addBehavior(contribute(shape.b.note as any, "x"))).toThrow(/has no `combine`/);
  });

  test("`combine` and `behavior` are mutually exclusive", () => {
    expect(() => metaKey(0, { behavior: () => ({ run() {} }), combine: () => ({ run() {} }) })).toThrow(/mutually exclusive/);
  });

  test("no owner without a contribution: the key keeps its default and nothing runs", ({ log }) => {
    const s = createStore(shape, initial());
    expect(s.get(shape.a.tags)).toEqual([]);
    expect(log.runs).toEqual([]);
    expect(log.combined).toEqual([]);
  });

  test("combine(self, key) runs once per node: not per contribution, change or row", ({ log }) => {
    const s = createStore(shape, initial(), { behaviors: [contribute(shape.a.tags, "one"), contribute(R.x.tags, "row")] });
    const h = s.addBehavior(contribute(shape.a.tags, "two"));
    h();
    s.addBehavior(contribute(shape.a.tags, "three"));
    s.substore(shape.rows).append({ x: 1 });
    expect(log.combined).toEqual(["a", "rows[].x"]);
  });

  test("a combined key is written only by its owner among behaviors; application code may write it", () => {
    const writer = defineBehavior({ triggers: [shape.mode], writes: [shape.a.tags], run: () => {} });
    expect(() => createStore(shape, initial(), { behaviors: writer }), "even with no owner yet").toThrow(/is written only by the owner of its key/);
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "one") });
    expect(() => s.addBehavior(writer)).toThrow(/is written only by the owner of its key/);
    s.set(shape.a.tags, ["server"]);
    expect(s.get(shape.a.tags)).toEqual(["server"]);
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
      behaviors: [contribute(shape.a.tags, "always"), contribute(shape.a.tags, "strict", { when: when([shape.mode], (m) => m === "strict") })],
    });
    expect(s.get(shape.a.tags)).toEqual(["always"]);
    s.set(shape.mode, "strict");
    expect(s.get(shape.a.tags)).toEqual(["always", "strict"]);
    s.set(shape.mode, "");
    expect(s.get(shape.a.tags), "recomputed without it, not 'skip and keep'").toEqual(["always"]);
  });

  test("a contribution's triggers rerun the owner; its reads do not", () => {
    const s = createStore(shape, initial(), {
      behaviors: [contribute(shape.a.tags, "t", { triggers: [shape.mode] }), contribute(shape.a.tags, "r", { reads: [shape.other] })],
    });
    log.runs.length = 0;
    s.set(shape.other, "x");
    expect(log.runs).toHaveLength(0);
    s.set(shape.mode, "x");
    expect(log.runs).toHaveLength(1);
  });

  test("a part carries the contribution's declared inputs (triggers, reads), never its guard refs; the owner may read them", () => {
    const seen: unknown[] = [];
    const probe = metaKey<number, null>(0, {
      combine: (_self, key) => ({
        writes: [key],
        run: (ctx) => void seen.push(...ctx.parts.flatMap((p) => p.inputs.map((r) => ctx.get(r)))),
      }),
    });
    const sh = form(object({ f: field<string>().meta({ probe }), t: field<string>(), r: field<string>(), g: field<string>() }));
    createStore(sh, { f: "", t: "T", r: "R", g: "G" }, {
      behaviors: contribute(sh.f.probe, null, { triggers: [sh.t], reads: [sh.r], when: when([sh.g], () => true) }),
    });
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
    expect(log.runs.map((r) => r.runs), "one counter across every change").toEqual([1, 2, 3, 4]);
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
    s.react(shape.a.tags, (v) => seen.push(v));
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
    const h1b = s.replaceBehavior(h1, [contribute(shape.a.tags, "new a"), contribute(shape.a.tags, "new b"), contribute(shape.a.tags, "new c")]);
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
    const s = createStore(shape, initial(), { behaviors: [contribute(R.x.tags, "same"), contribute(R.x.tags, "same")] });
    const [row0, row1] = s.substore(shape.rows).items();
    row0.addBehavior(c);
    row1.addBehavior(c);
    expect([row0.get(R.x.tags), row1.get(R.x.tags)]).toEqual([["same", "same", "c"], ["same", "same", "c"]]);
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
      ])
    ).toThrow(/one writer per target/);
    s.set(shape.a, "x");
    expect(log.runs.map((r) => r.tags)).toEqual([["base"]]);
  });

  test("a contribution's refs must be in its target's scope chain; nothing changes when they aren't", () => {
    const s = createStore(shape, initial(), { behaviors: contribute(shape.a.tags, "base") });
    expect(() => s.addBehavior([contribute(shape.a.tags, "late"), contribute(shape.a.tags, "row ref", { triggers: [R.x] })])).toThrow(
      /"rows\[\]\.x" is outside the target's scope/
    );
    expect(() => s.addBehavior(contribute(shape.a.tags, "guard", { when: when([R.x], () => true) }))).toThrow(/outside the target's scope/);
    expect(s.get(shape.a.tags)).toEqual(["base"]);
  });

  test("a contribution's refs and target belong to this form", () => {
    const other = form(object({ a: field<string>().meta({ tags }), y: field<string>() }));
    const s = createStore(shape, initial());
    expect(() => s.addBehavior(contribute(shape.a.tags, "x", { reads: [other.y] }))).toThrow(/"y" is not part of this form/);
    expect(() => s.addBehavior(contribute(other.a.tags, "x"))).toThrow(/"a#tags" is not part of this form/);
  });

  test("the target must be inside the store the contribution is added on", () => {
    const s = createStore(shape, initial());
    const row = s.substore(shape.rows).items()[0];
    expect(() => row.addBehavior(contribute(shape.a.tags, "x"))).toThrow(/outside the store it was added to/);
  });
});

describe("Rows", () => {
  test("a contribution added on a row applies to that row only; the others keep the default without running the owner", ({ log }) => {
    const s = createStore(shape, initial());
    const [row0, row1] = s.substore(shape.rows).items();
    const h = row1.addBehavior(contribute(R.x.tags, "row 1"));
    expect([row0.get(R.x.tags), row1.get(R.x.tags)]).toEqual([[], ["row 1"]]);
    expect(log.runs.map((r) => r.path), "only row 1's instance ran").toEqual(["rows[]:rows[].x"]);
    h();
    expect(row1.get(R.x.tags)).toEqual([]);
  });

  test("a row added after an in-place update gets the merged declarations", () => {
    const s = createStore(shape, initial(), { behaviors: contribute(R.x.tags, "all rows") });
    s.addBehavior(contribute(R.x.tags, "strict rows", { when: when([shape.mode], (m) => m === "strict") }));
    s.substore(shape.rows).append({ x: 5 });
    const row2 = s.substore(shape.rows).items()[2];
    expect(row2.get(R.x.tags)).toEqual(["all rows"]);
    s.set(shape.mode, "strict");
    expect(row2.get(R.x.tags), "the enclosing-scope guard ref triggers the new row").toEqual(["all rows", "strict rows"]);
  });
});

describe("Builder", () => {
  test("when / otherwise add their guards to contributions; branches don't matter for them", () => {
    const s = createStore(shape, initial(), {
      behaviors: defineBehaviors(shape, (b, s) => {
        b.when([s.mode], (m) => m !== "", (b) => {
          b.when([s.other], (o) => o === "x", (b) => b.add(contribute(s.a.tags, "both")));
          b.add(contribute(s.a.tags, "mode"));
        }).otherwise((b) => b.add(contribute(s.a.tags, "no mode"), contribute(s.a.tags, "no mode either")));
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
  /** Owner calls: async unless the run has no origins and isn't the initial one (a contribution change at rest). */
  interface Call { signal: AbortSignal; d: ReturnType<typeof deferred<string>>; origins: string[]; changed: boolean; isInit: boolean }
  let calls: Call[] = [];

  const answer = metaKey<string, string>("", {
    combine: (self, key) => ({
      triggers: [self],
      writes: [key],
      run(ctx) {
        const started = ((ctx.state.started as number | undefined) ?? 0) + 1;
        ctx.state.started = started;
        if (!ctx.isInit && !ctx.origins.size) return ctx.set(key, `idle ${ctx.parts.length}`);
        const d = deferred<string>();
        calls.push({ signal: ctx.signal, d, origins: [...ctx.origins], changed: ctx.changed(self), isInit: ctx.isInit });
        return d.promise.then((a) => ctx.set(key, `${a} ${ctx.parts.map((p) => p.payload)} (#${started})`));
      },
    }),
  });
  const sh = form(object({ f: field<string>().meta({ answer }) }));

  function setup() {
    calls = [];
    const errors: unknown[] = [];
    const s = createStore(sh, { f: "" }, { behaviors: contribute(sh.f.answer, "base"), onError: (error) => errors.push(error) });
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
    expect(calls[2], "rerun with the cancelled run's origins and changed inputs").toMatchObject({ origins: ["user"], changed: true, isInit: false });
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
    const kept = metaKey<string, string>("", {
      combine: (self, key) => ({
        triggers: [self],
        writes: [key],
        runOn: { init: false },
        async run(ctx) {
          const value = ctx.get(self) as string;
          const result = await ctx.keep([value], (signal) => (starts.push(signal), work.promise));
          ctx.set(key, `${result} ${ctx.parts.length}`);
        },
      }),
    });
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

  test("an initial run in flight is rerun as an initial run", async () => {
    const { s, errors } = setup();
    s.addBehavior(contribute(sh.f.answer, "late"));
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1]).toMatchObject({ origins: [], isInit: true });
    calls[1].d.resolve("init");
    await s.settle();
    expect(s.get(sh.f.answer)).toBe("init base,late (#1)");
    expect(errors).toEqual([]);
  });
});
