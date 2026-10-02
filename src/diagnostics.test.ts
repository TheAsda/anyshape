// Diagnostics (dev only): the probe on the root, the flush budget warning and
// the DevTools performance tracks. Time comes from a stubbed performance.now
// that the test's reactions, listeners and behaviors advance.

import { form, object, array, field, createStore, defineBehavior, type InferValue, type RootStore } from "./index";
import type { ProbedInstance } from "./store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { concretePath } from "./internal";
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
      return `${reg.name}@${concretePath(host, host.node) || "<root>"}`;
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
        owners: [{ key: "lines[].email#error", triggers: ["lines[].email"], parts: ["unique @lines[1]", "required(lines[].email) @<root>"] }],
      },
    ]);

    events.length = 0;
    handle();
    expect(events.map((e) => e[0]).slice(0, 3)).toEqual(["registrationStart", "registrationEnd", "flushStart"]);
    expect(events[1][2]).toEqual({
      store: "<root>",
      added: [],
      removed: ["copy"],
      owners: [{ key: "lines[].email#error", triggers: ["lines[].email"], parts: ["unique @lines[1]"] }],
    });
  });
});
