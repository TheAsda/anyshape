// Diagnostics (dev only): the probe on the root, the flush budget warning and
// the DevTools performance tracks. Time comes from a stubbed performance.now
// that the test's reactions, listeners and behaviors advance.

import { form, object, array, field, createStore, defineBehavior, type InferValue, type RootStore, type AnyRef, type AnyNode } from "./index";
import type { ProbedInstance } from "./store";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { pathLabel } from "./internal";
import { deferred, flush } from "./test/harness";
import { validation } from "./test/features";
import { required, rule } from "./test/rules";

const shape = form({
  code: field<string>(),
  name: field<string>(),
  rows: array(object({ sku: field<string>(), title: field<string>() })),
});
type Values = InferValue<typeof shape>;
const R = shape.rows.item;
const initial = (): Values => ({ code: "a", name: "", rows: [{ sku: "x", title: "" }, { sku: "y", title: "" }] });

/** Combined `error` keys, on the root and in rows. */
const signup = form({
  email: field<string>().meta(validation()),
  copy: field<string>(),
  lines: array(object({ email: field<string>().meta(validation()) })),
});
const L = signup.lines.item;
const signupValues = () => ({ email: "", copy: "", lines: [{ email: "" }, { email: "" }] });

/** The stubbed clock. */
let t = 0;
beforeEach(() => {
  t = 0;
  vi.spyOn(performance, "now").mockImplementation(() => t);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Replaces the store's probe with one that records every call, instances as "name@concrete path". */
function record(s: RootStore<any>): unknown[][] {
  const events: unknown[][] = [];
  const show = (arg: unknown) => {
    if (arg && typeof arg === "object" && "reg" in arg && "host" in arg) {
      const { reg, host } = arg as ProbedInstance;
      return `${reg.name}@${pathLabel(host, host.node)}`;
    }
    return typeof arg === "function" ? arg() : arg;
  };
  (s as any)._probe = new Proxy({}, { get: (_, name) => (...args: unknown[]) => void events.push([name, ...args.map(show)]) });
  return events;
}

describe("T · Probe", () => {
  test("a flush reports its start, the end of its reactions and its end", () => {
    const s = createStore(shape, initial());
    const events = record(s);
    s.react(shape.code, () => void (t += 3));
    s.subscribe(shape.code, () => void (t += 2));
    t = 10;
    s.set(shape.code, "b");
    expect(events).toEqual([
      ["flushStart", 10],
      ["reactionsEnd", 13],
      ["flushEnd", 15],
    ]);
  });

  test("a run reports its start and end, per instance, inside the flush", () => {
    const s = createStore(shape, initial());
    s.addBehavior(
      defineBehavior({
        name: "title", triggers: [R.sku], writes: [R.title],
        run: (ctx) => {
          t += 4;
          ctx.set(R.title, ctx.get(R.sku).toUpperCase());
        },
      })
    );
    const events = record(s);
    t = 10;
    s.set(shape.rows, [...s.get(shape.rows), { sku: "z", title: "" }]);
    expect(events).toEqual([
      ["flushStart", 10],
      ["runStart", "title@rows[2]", 10],
      ["runEnd", "title@rows[2]", 14, "sync"],
      ["reactionsEnd", 14],
      ["flushEnd", 14],
    ]);
  });

  test("an async run: its synchronous part, its flight until the promise settles, then applying its writes", async () => {
    const s = createStore(shape, initial());
    const lookup = deferred<string>();
    s.addBehavior(
      defineBehavior({
        name: "lookup", triggers: [shape.code], writes: [shape.name], runOn: { init: false },
        run: async (ctx) => {
          t += 2;
          const name = await lookup.promise;
          ctx.set(shape.name, name);
        },
      })
    );
    s.react(shape.name, () => void (t += 5));
    const events = record(s);
    t = 10;
    s.set(shape.code, "b");
    t = 100;
    lookup.resolve("Alpha");
    await flush();
    expect(events).toEqual([
      ["flushStart", 10],
      ["runStart", "lookup@<root>", 10],
      ["runEnd", "lookup@<root>", 12, "async"],
      ["reactionsEnd", 12],
      ["flushEnd", 12],
      ["flightEnd", "lookup@<root>", 100, false],
      ["runStart", "lookup@<root>", 100],
      ["runEnd", "lookup@<root>", 100, "apply"],
      ["flushStart", 100],
      ["reactionsEnd", 105],
      ["flushEnd", 105],
    ]);
  });

  test("a cancelled run's flight ends as cancelled", () => {
    const s = createStore(shape, initial());
    s.addBehavior(
      defineBehavior({
        name: "lookup", triggers: [shape.code], writes: [shape.name], runOn: { init: false },
        run: () => new Promise<void>(() => {}),
      })
    );
    s.set(shape.code, "b");
    const events = record(s);
    t = 50;
    s.set(shape.code, "c");
    expect(events).toEqual([
      ["flushStart", 50],
      ["flightEnd", "lookup@<root>", 50, true],
      ["runStart", "lookup@<root>", 50],
      ["runEnd", "lookup@<root>", 50, "async"],
      ["reactionsEnd", 50],
      ["flushEnd", 50],
    ]);
  });

  test("a registration change reports its start and end before the flush that runs it, with the owners it changed", () => {
    const s = createStore(signup, signupValues());
    const row = s.substore(signup.lines).itemAt(1);
    row.addBehavior(rule(L.email, () => undefined, { name: "unique" }));
    const events = record(s);
    t = 10;
    const handle = s.addBehavior([
      required(L.email),
      defineBehavior({ name: "copy", triggers: [signup.email], writes: [signup.copy], run: (ctx) => ctx.set(signup.copy, ctx.get(signup.email)) }),
    ]);
    expect(events.map((e) => e[0]).slice(0, 3)).toEqual(["registrationStart", "registrationEnd", "flushStart"]);
    expect(events[1]).toEqual([
      "registrationEnd", 10,
      {
        store: "<root>",
        added: ["copy"],
        removed: [],
        owners: [{ key: "lines[].email#error", triggers: ["lines[].email"], contributions: ["unique @lines[1]", "required(lines[].email) @<root>"], more: 0 }],
      },
    ]);

    events.length = 0;
    handle();
    expect(events.map((e) => e[0]).slice(0, 3)).toEqual(["registrationStart", "registrationEnd", "flushStart"]);
    expect(events[1][2]).toEqual({
      store: "<root>",
      added: [],
      removed: ["copy"],
      owners: [{ key: "lines[].email#error", triggers: ["lines[].email"], contributions: ["unique @lines[1]"], more: 0 }],
    });
  });
  test("disposing a handle that registered nothing is no registration change", () => {
    const s = createStore(shape, initial());
    const handle = s.addBehavior([]);
    const events = record(s);
    handle();
    expect(events).toEqual([]);
  });
});

describe("T · Flush budget", () => {
  const order = form({
    lines: array(object({ qty: field<number>(), total: field<number>() })),
    sum: field<number>(),
    note: field<string>(),
    profile: object({ size: field<number>() }),
  });
  const O = order.lines.item;
  const orderValues = () => ({ lines: [{ qty: 1, total: 0 }, { qty: 2, total: 0 }, { qty: 3, total: 0 }], sum: 0, note: "", profile: { size: 0 } });
  /** A behavior that takes `ms` per run and changes `write`, if any. */
  const slow = (name: string, ms: number, triggers: AnyRef[], write?: AnyNode) =>
    defineBehavior({
      name, triggers, writes: write ? [write] : [],
      run: (ctx) => {
        t += ms;
        if (write) ctx.set(write, ctx.get(write) + 1);
      },
    });

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("a flush over budget warns once: its total, reactions and UI listeners, and the three slowest behaviors over their instances", () => {
    const s = createStore(order, orderValues(), {
      behaviors: [
        slow("total", 10, [O.qty], O.total),
        slow("sum", 5, [order.lines], order.sum),
        slow("note", 1, [order.sum], order.note),
        slow("tiny", 0.5, [order.note]),
      ],
    });
    s.react(order.sum, () => void (t += 2));
    s.subscribe(order.lines, () => void (t += 4));
    warn.mockClear();
    s.set(order.lines, s.get(order.lines).map((l) => ({ ...l, qty: l.qty + 1 })));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "[form] A flush took 42.5 ms, over the 33.3 ms budget: 38.5 ms in reactions, 4.0 ms in UI listeners. " +
        'Slowest behaviors: "total" 30.0 ms (3 runs), "sum" 5.0 ms (1 run), "note" 1.0 ms (1 run).'
    );
  });

  test("a behavior registered row by row counts as one: its time adds up over the rows", () => {
    const lineTotal = () => slow("total", 10, [O.qty], O.total);
    const s = createStore(order, orderValues(), { behaviors: [slow("sum", 5, [order.lines], order.sum)] });
    for (const row of s.substore(order.lines).items()) row.addBehavior(lineTotal());
    warn.mockClear();
    s.batch(() => {
      for (const row of s.substore(order.lines).items()) row.set(O.qty, row.get(O.qty) + 1);
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "[form] A flush took 35.0 ms, over the 33.3 ms budget: 35.0 ms in reactions, 0.0 ms in UI listeners. " +
        'Slowest behaviors: "total" 30.0 ms (3 runs), "sum" 5.0 ms (1 run).'
    );
  });

  test("each listed behavior comes with where it was defined, as an error whose stack starts at its defineBehavior call", () => {
    const s = createStore(order, orderValues(), {
      behaviors: [slow("total", 10, [O.qty], O.total), slow("sum", 5, [order.lines], order.sum)],
    });
    warn.mockClear();
    s.set(order.lines, s.get(order.lines).map((l) => ({ ...l, qty: l.qty + 1 })));
    const [, ...definedAt] = warn.mock.calls[0] as [string, ...Error[]];
    expect(definedAt.map((e) => e.message)).toEqual(['"total" is defined here', '"sum" is defined here']);
    for (const e of definedAt) {
      const frames = e.stack!.split("\n").filter((l) => l.trim().startsWith("at "));
      expect(frames[0]).toMatch(/diagnostics\.test\.ts/); // the call to defineBehavior in `slow`
    }
  });

  test("a flush within budget doesn't warn", () => {
    const s = createStore(order, orderValues(), { behaviors: [slow("total", 10, [O.qty], O.total)] });
    warn.mockClear();
    s.set(order.lines, s.get(order.lines).map((l) => ({ ...l, qty: l.qty + 1 })));
    expect(warn).not.toHaveBeenCalled();
  });

  test("an async run counts its synchronous part and applying its writes, not its time in flight", async () => {
    const s = createStore(order, orderValues());
    const reply = deferred<void>();
    s.addBehavior(
      defineBehavior({
        name: "load", triggers: [order.note], writes: [order.profile], runOn: { init: false },
        run: async (ctx) => {
          t += 40;
          await reply.promise;
          let first = true;
          // Applying the write validates the object: a slow read stands for a big value.
          ctx.set(order.profile, { get size() { if (first) { first = false; t += 40; } return 1; } });
        },
      })
    );
    s.set(order.note, "go");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      '[form] A flush took 40.0 ms, over the 33.3 ms budget: 40.0 ms in reactions, 0.0 ms in UI listeners. Slowest behaviors: "load" 40.0 ms (1 run).'
    );
    t += 1000;
    reply.resolve();
    await flush();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toBe(
      '[form] A flush took 40.0 ms, over the 33.3 ms budget: 40.0 ms applying async writes, 0.0 ms in reactions, 0.0 ms in UI listeners. Slowest behaviors: "load" 40.0 ms.'
    );
  });
});


describe("T · DevTools tracks", () => {
  let stamp: Mock<(...args: unknown[]) => void>;
  let measure: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // Vitest's console has no timeStamp.
    console.timeStamp = stamp = vi.fn<(...args: unknown[]) => void>();
    measure = vi.spyOn(performance, "measure").mockImplementation(() => undefined as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    delete (console as Partial<Console>).timeStamp;
  });
  /** The detail.devtools of each performance.measure call, with its name, start and end. */
  const measured = () =>
    measure.mock.calls.map(([name, options]: any) => ({ name, start: options.start, end: options.end, ...options.detail.devtools }));

  test("each flush, its two phases and each run are entries in the form-lib group: label, start, end, track, color", () => {
    const s = createStore(shape, initial());
    s.addBehavior(
      defineBehavior({
        name: "title", triggers: [R.sku], writes: [R.title],
        run: (ctx) => {
          t += 4;
          ctx.set(R.title, ctx.get(R.sku).toUpperCase());
        },
      })
    );
    s.subscribe(shape.rows, () => void (t += 1));
    stamp.mockClear();
    t = 10;
    s.set(shape.rows, [...s.get(shape.rows), { sku: "z", title: "" }]);
    expect(stamp.mock.calls).toEqual([
      ["title @rows[2]", 10, 14, "behaviors", "form-lib", "primary"],
      ["reactions", 10, 14, "flush", "form-lib", "tertiary-light"],
      ["UI listeners", 14, 15, "flush", "form-lib", "tertiary-light"],
      ["flush", 10, 15, "flush", "form-lib", "tertiary"],
    ]);
  });

  test("a flush over budget is a detailed entry in the error color, with its split and slowest behaviors", () => {
    const s = createStore(shape, initial(), {
      behaviors: defineBehavior({ name: "title", triggers: [R.sku], writes: [R.title], run: () => void (t += 20) }),
    });
    s.subscribe(shape.rows, () => void (t += 1));
    stamp.mockClear();
    measure.mockClear();
    t = 10;
    s.set(shape.rows, s.get(shape.rows).map((r) => ({ ...r, sku: r.sku + "!" })));
    expect(stamp.mock.calls.filter((c) => c[3] === "flush").map((c) => c[0])).toEqual(["reactions", "UI listeners"]);
    expect(measured()).toEqual([
      {
        name: "flush over budget", start: 10, end: 51,
        dataType: "track-entry", track: "flush", trackGroup: "form-lib", color: "error",
        tooltipText: "A flush took 41.0 ms, over the 33.3 ms budget",
        properties: [
          ["Reactions", "40.0 ms"],
          ["UI listeners", "1.0 ms"],
          ["1. title", "40.0 ms (2 runs)"],
        ],
      },
    ]);
  });

  test("each run in flight is an entry on the async track from its start to its completion or cancellation; cancelled ones marked", async () => {
    const s = createStore(shape, initial());
    const replies: ReturnType<typeof deferred<string>>[] = [];
    s.addBehavior(
      defineBehavior({
        name: "lookup", triggers: [shape.code], writes: [shape.name], runOn: { init: false },
        run: async (ctx) => {
          t += 1;
          const reply = deferred<string>();
          replies.push(reply);
          ctx.set(shape.name, await reply.promise);
        },
      })
    );
    stamp.mockClear();
    t = 10;
    s.set(shape.code, "b");
    t = 20;
    s.set(shape.code, "c");
    t = 50;
    replies[1].resolve("Gamma");
    await flush();
    const tracks = (track: string) => stamp.mock.calls.filter((c) => c[3] === track).map((c) => [c[0], c[1], c[2], c[5]]);
    expect(tracks("async")).toEqual([
      ["lookup @<root> (cancelled)", 10, 20, "secondary-light"],
      ["lookup @<root>", 20, 50, "secondary"],
    ]);
    expect(tracks("behaviors")).toEqual([
      ["lookup @<root>", 10, 11, "primary"],
      ["lookup @<root>", 20, 21, "primary"],
      ["lookup @<root> (apply)", 50, 50, "primary"],
    ]);
  });

  test("a registration change is a detailed entry listing, per combined key it changed, the owner's triggers and contributions", () => {
    const s = createStore(signup, signupValues());
    s.substore(signup.lines).itemAt(1).addBehavior(rule(L.email, () => undefined, { name: "unique" }));
    measure.mockClear();
    t = 10;
    const handle = s.addBehavior([
      required(L.email),
      defineBehavior({ name: "copy", triggers: [signup.email], writes: [signup.copy], run: (ctx) => void (t += 3) }),
    ]);
    handle();
    expect(measured()).toEqual([
      {
        name: "registration @<root>", start: 10, end: 10,
        dataType: "track-entry", track: "registration", trackGroup: "form-lib", color: "tertiary-dark",
        tooltipText: "1 behavior added, 0 removed, 1 combined key changed",
        properties: [
          ["Added", "copy"],
          ["lines[].email#error triggers", "lines[].email"],
          ["lines[].email#error contributions", "unique @lines[1], required(lines[].email) @<root>"],
        ],
      },
      {
        name: "registration @<root>", start: 13, end: 13,
        dataType: "track-entry", track: "registration", trackGroup: "form-lib", color: "tertiary-dark",
        tooltipText: "0 behaviors added, 1 removed, 1 combined key changed",
        properties: [
          ["Removed", "copy"],
          ["lines[].email#error triggers", "lines[].email"],
          ["lines[].email#error contributions", "unique @lines[1]"],
        ],
      },
    ]);
  });

  test("an owner's contributions are listed up to 20, then counted", () => {
    const s = createStore(signup, signupValues());
    s.substore(signup.lines).itemAt(1).addBehavior(rule(L.email, () => undefined, { name: "unique" }));
    measure.mockClear();
    s.addBehavior(Array.from({ length: 21 }, (_, i) => rule(L.email, () => undefined, { name: `r${i}` })));
    const listed = Object.fromEntries(measured()[0].properties)["lines[].email#error contributions"];
    const first = ["unique @lines[1]", ...Array.from({ length: 19 }, (_, i) => `r${i} @<root>`)];
    expect(listed).toBe(`${first.join(", ")}, … and 2 more`);
  });

  test("settle() is a detailed entry on the async track while it waits; one that doesn't wait is none", async () => {
    const s = createStore(shape, initial());
    const reply = deferred<string>();
    s.addBehavior(
      defineBehavior({
        name: "lookup", triggers: [shape.code], writes: [shape.name], runOn: { init: false },
        run: async (ctx) => ctx.set(shape.name, await reply.promise),
      })
    );
    await s.settle();
    s.set(shape.code, "b");
    measure.mockClear();
    t = 10;
    const settled = s.settle();
    t = 30;
    reply.resolve("Beta");
    await settled;
    expect(measured()).toEqual([
      {
        name: "settle @<root>", start: 10, end: 30,
        dataType: "track-entry", track: "async", trackGroup: "form-lib", color: "secondary-dark",
        tooltipText: "settle() waited 20.0 ms for the runs in flight inside <root>",
        properties: [],
      },
    ]);
  });

  test("without console.timeStamp or performance.measure there are no entries, and the budget still warns", () => {
    delete (console as Partial<Console>).timeStamp;
    Object.defineProperty(performance, "measure", { value: undefined, configurable: true });
    try {
      const s = createStore(shape, initial(), {
        behaviors: defineBehavior({ name: "title", triggers: [R.sku], writes: [R.title], run: () => void (t += 40) }),
      });
      expect(console.warn).toHaveBeenCalledTimes(1);
      s.settle();
    } finally {
      delete (performance as Partial<Performance>).measure;
    }
    expect(stamp).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });
});


describe("T · Production", () => {
  test("in production nothing is measured: no clock reads, no warning, no entries", async () => {
    const stamp = (console.timeStamp = vi.fn());
    const measure = vi.spyOn(performance, "measure");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    try {
      const reply = deferred<string>();
      const s = createStore(shape, initial(), {
        behaviors: [
          defineBehavior({ name: "title", triggers: [R.sku], writes: [R.title], run: () => void (t += 40) }),
          defineBehavior({
            name: "lookup", triggers: [shape.code], writes: [shape.name], runOn: { init: false },
            run: async (ctx) => ctx.set(shape.name, await reply.promise),
          }),
        ],
      });
      s.set(shape.code, "b");
      const settled = s.settle();
      reply.resolve("Beta");
      await settled;
      s.addBehavior(defineBehavior({ name: "noop", triggers: [shape.name], run: () => {} }))();
    } finally {
      vi.unstubAllEnvs();
      delete (console as Partial<Console>).timeStamp;
    }
    expect(performance.now).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(stamp).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });
});
